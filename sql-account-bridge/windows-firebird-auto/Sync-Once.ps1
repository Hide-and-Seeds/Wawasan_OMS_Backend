#requires -version 5.1
# Sync-Once.ps1 - one snapshot read of the SQL Account DB -> OMS webhook.
# Copies the .FDB (safe while SQL Account is open), reads recent invoices with the
# bundled Firebird isql (embedded, no server), builds CSV, POSTs to the cloud which
# parses + de-duplicates. Run -DryRun to preview without creating anything.
# ASCII-only on purpose: PS 5.1 'powershell -File' mis-parses non-ASCII.
param([switch]$DryRun)
$ErrorActionPreference='Stop'
[Net.ServicePointManager]::SecurityProtocol=[Net.SecurityProtocolType]::Tls12
. "$PSScriptRoot\config.ps1"

function Write-Log($m){ $l=('{0}  {1}' -f (Get-Date -Format 's'),$m); Write-Host $l; if($LogFile){ try{ Add-Content -LiteralPath $LogFile -Value $l }catch{} } }

if(-not $WebhookSecret -or $WebhookSecret -eq 'PASTE_THE_WEBHOOK_SECRET_HERE'){ throw 'Set $WebhookSecret in config.ps1' }
if(-not $FdbPath -or -not (Test-Path -LiteralPath $FdbPath)){ throw "FDB not found: '$FdbPath' (set FdbPath in config.ps1, or run Install.ps1)" }
$isql = Join-Path $FirebirdDir 'isql.exe'
if(-not (Test-Path -LiteralPath $isql)){ throw "isql not found at $isql - run Install.ps1 first" }

# 1. snapshot copy (sidesteps the embedded lock; the .FDB is copyable while the app is open)
$copy = Join-Path $env:TEMP 'wws-acc-copy.fdb'
Copy-Item -LiteralPath $FdbPath -Destination $copy -Force

# 2. CSV-emitting query (one row per invoice line). The SQL builds quoted, escaped
#    CSV fields itself; we prepend the header below. Date is forced to ISO YYYY-MM-DD.
$q = @'
SET HEADING OFF;
SET LIST OFF;
SELECT
 '"'||REPLACE(TRIM(h.DOCNO),'"','""')||'",'||
 (EXTRACT(YEAR FROM h.DOCDATE)||'-'||LPAD(EXTRACT(MONTH FROM h.DOCDATE),2,'0')||'-'||LPAD(EXTRACT(DAY FROM h.DOCDATE),2,'0'))||','||
 '"'||REPLACE(COALESCE(h.COMPANYNAME,''),'"','""')||'",'||
 '"'||REPLACE(COALESCE(h.PHONE1,''),'"','""')||'",'||
 '"'||REPLACE(COALESCE(h.TERMS,''),'"','""')||'",'||
 '"'||REPLACE(COALESCE(d.ITEMCODE,''),'"','""')||'",'||
 '"'||REPLACE(COALESCE(d.DESCRIPTION,''),'"','""')||'",'||
 CAST(COALESCE(d.QTY,0) AS VARCHAR(40))||','||
 '"'||REPLACE(COALESCE(d.UOM,''),'"','""')||'",'||
 '"'||REPLACE(COALESCE(h.DADDRESS1,''),'"','""')||'",'||
 '"'||REPLACE(COALESCE(h.DADDRESS2,''),'"','""')||'",'||
 '"'||REPLACE(COALESCE(h.DADDRESS3,''),'"','""')||'",'||
 '"'||REPLACE(COALESCE(h.DADDRESS4,''),'"','""')||'",'||
 '"'||REPLACE(COALESCE(h.DPOSTCODE,''),'"','""')||'",'||
 '"'||REPLACE(COALESCE(h.DCITY,''),'"','""')||'",'||
 '"'||REPLACE(COALESCE(h.DSTATE,''),'"','""')||'"'
FROM SL_IV h JOIN SL_IVDTL d ON d.DOCKEY=h.DOCKEY
WHERE h.CANCELLED=FALSE AND h.DOCDATE IS NOT NULL AND h.DOCDATE >= CURRENT_DATE - __DAYS__
ORDER BY h.DOCNO, d.SEQ;
'@
$q = $q.Replace('__DAYS__', [string][int]$DaysBack)
$qFile  = Join-Path $env:TEMP 'wws-q.sql'
$outFile= Join-Path $env:TEMP 'wws-out.txt'
Set-Content -LiteralPath $qFile -Value $q -Encoding ASCII

# 3. read the copy in embedded mode (no server)
& $isql -user SYSDBA -password masterkey -b -q -i $qFile -o $outFile $copy
$code=$LASTEXITCODE
Remove-Item -LiteralPath $copy -Force -EA SilentlyContinue
if($code -ne 0){ $err=''; if(Test-Path $outFile){ $err=(Get-Content -LiteralPath $outFile -Raw) }; throw "isql failed (exit $code). $err" }

# 4. assemble CSV: our header + the emitted data lines (each starts with a double-quote)
$header='DocNo,DocDate,CompanyName,Phone,Terms,ItemCode,Description,Qty,UOM,DeliveryAddress1,DeliveryAddress2,DeliveryAddress3,DeliveryAddress4,DeliveryAddress5,DeliveryAddress6,DeliveryAddress7'
$rows = @(Get-Content -LiteralPath $outFile | Where-Object { $_ -match '^"' })
if($rows.Count -eq 0){ Write-Log 'no invoices in window - nothing to send'; return }
$csv = $header + "`r`n" + ($rows -join "`r`n")

# 5. POST. The cloud parses + de-dups, so re-sending the same window is harmless.
$payload=@{ csv=$csv }
if($DryRun){ $payload.dry_run=$true }
$body=$payload|ConvertTo-Json -Compress
try{
  $r=Invoke-RestMethod -Uri $WebhookUrl -Method Post -ContentType 'application/json' -Headers @{ 'x-webhook-secret'=$WebhookSecret } -Body $body
  if($DryRun){ Write-Log ("DRY-RUN ok: lines={0} invoices={1} new={2} (nothing created)" -f $rows.Count,$r.total,$r.new_count) }
  else       { Write-Log ("sent: lines={0} invoices={1} created={2} duplicate={3}" -f $rows.Count,$r.total,$r.created,$r.duplicate) }
}catch{
  $d=$_.ErrorDetails.Message; if(-not $d){ $d=$_.Exception.Message }
  Write-Log ("ERROR posting: $d"); throw
}
