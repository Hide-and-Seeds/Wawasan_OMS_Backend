#requires -version 5.1
# Diagnose.ps1 - READ-ONLY health check of the SQL Account -> OMS sync on this PC.
# Creates no orders and changes no settings: the database is read from a temp copy,
# both webhook calls are dry-runs. Never prints the webhook secret. The only write is
# the one "DRY-RUN ok" line Sync-Once adds to sync.log. ASCII-only (PS 5.1 -File).
# Run: double-click DIAGNOSE.bat, or
#      powershell -NoProfile -ExecutionPolicy Bypass -File .\Diagnose.ps1 [-SkipDryRun]
param([switch]$SkipDryRun)
$ErrorActionPreference = 'Continue'
$ProgressPreference = 'SilentlyContinue'
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12

$script:issues = @()
function Head($m) { Write-Host ''; Write-Host ('== ' + $m) -ForegroundColor Cyan }
function Ok($m)   { Write-Host ('  [ OK ] ' + $m) -ForegroundColor Green }
function Info($m) { Write-Host ('         ' + $m) }
function Note($kind, $color, $m, $fix) {
  Write-Host ('  [' + $kind + '] ' + $m) -ForegroundColor $color
  $script:issues += ($kind + '  ' + $m + $(if ($fix) { "`r`n        fix: " + $fix } else { '' }))
}
function Warn($m, $fix) { Note 'WARN' 'Yellow' $m $fix }
function Bad($m, $fix)  { Note 'FAIL' 'Red' $m $fix }
function Finish {
  Head 'Summary'
  if (-not $script:issues.Count) {
    Ok 'no problems found.'
    Info 'Invoice still missing? It must be SI... (L... is never sent), dated within the last'
    Info 'DaysBack days, and saved in the database shown above. Then run SYNC-NOW.bat.'
  } else { $script:issues | ForEach-Object { Write-Host ('  ' + $_) } }
  exit
}

# ---------------------------------------------------------------- config
Head 'Config (config.ps1)'
$cfg = Join-Path $PSScriptRoot 'config.ps1'
if (-not (Test-Path -LiteralPath $cfg)) { Bad "config.ps1 not found in $PSScriptRoot" 'run this from the sync folder that holds config.ps1'; Finish }
. $cfg
Info ('folder     : ' + $PSScriptRoot)
Info ('WebhookUrl : ' + $WebhookUrl)
Info ('FdbPath    : ' + $FdbPath)
Info ('DaysBack   : ' + $DaysBack)
if (-not $WebhookSecret -or $WebhookSecret -eq 'PASTE_THE_WEBHOOK_SECRET_HERE') { Bad 'WebhookSecret is not set' 'paste the backend SQL_ACCOUNT_WEBHOOK_SECRET into config.ps1' }
else { Ok ('WebhookSecret set (' + $WebhookSecret.Length + ' chars, value not shown)') }
if ($WebhookUrl -notmatch '/api/orders/webhook/sql-account-csv$') { Warn 'WebhookUrl does not end in /api/orders/webhook/sql-account-csv' 'these scripts POST CSV - point WebhookUrl at the -csv endpoint' }

# ---------------------------------------------------------------- script version
Head 'Sync scripts in this folder'
$watchSrc = [string](Get-Content -LiteralPath (Join-Path $PSScriptRoot 'Watch.ps1') -Raw -EA SilentlyContinue)
$syncSrc  = [string](Get-Content -LiteralPath (Join-Path $PSScriptRoot 'Sync-Once.ps1') -Raw -EA SilentlyContinue)
if ($watchSrc -match 'Get-FdbStamp' -and $syncSrc -match 'BatchInvoices') { Ok 'current version (polls the DB timestamp, batched sends)' }
else { Warn 'OLD script version: file-watch misses Firebird saves, no batching, racing watchers' 'TURN-OFF.bat, copy the new .ps1 files over these (KEEP config.ps1), then RUN-ME.bat' }

# ---------------------------------------------------------------- watcher + auto-start
Head 'Background watcher'
$procs = @(Get-CimInstance Win32_Process -Filter "Name='powershell.exe'" -EA SilentlyContinue |
           Where-Object { $_.CommandLine -match 'Watch\.ps1' })
if ($procs.Count -eq 0) { Bad 'no Watch.ps1 is running - nothing is syncing' 'double-click RUN-ME.bat (re-installs auto-start and launches it)' }
else {
  foreach ($p in $procs) { Info ('PID ' + $p.ProcessId + ', started ' + $p.CreationDate + ': ' + $p.CommandLine) }
  if ($procs.Count -gt 1) { Warn ([string]$procs.Count + ' watchers running at once') 'TURN-OFF.bat, then RUN-ME.bat' } else { Ok 'one watcher running' }
  $mine = @($procs | Where-Object { $_.CommandLine.IndexOf($PSScriptRoot, [StringComparison]::OrdinalIgnoreCase) -ge 0 })
  if (-not $mine.Count) { Warn 'the running watcher is from a DIFFERENT folder than this one' 'fix the folder in the command line above, or TURN-OFF.bat there and RUN-ME.bat here' }
}
$vbs = Join-Path ([Environment]::GetFolderPath('Startup')) 'WawasanOMS-Sync.vbs'
if (Test-Path -LiteralPath $vbs) {
  $v = [string](Get-Content -LiteralPath $vbs -Raw)
  if ($v -match '-File ""([^"]+)""') {
    Info ('auto-start runs: ' + $Matches[1])
    if (Test-Path -LiteralPath $Matches[1]) { Ok 'auto-start at logon installed' }
    else { Bad ('auto-start points to a missing file: ' + $Matches[1]) 'RUN-ME.bat from the current folder' }
  } else { Ok 'auto-start at logon installed' }
} else { Bad 'no auto-start - the sync will not come back after a restart or logoff' 'RUN-ME.bat' }
Info ('Windows user: ' + $env:USERNAME + ' (auto-start only runs when THIS user is logged in)')

# ---------------------------------------------------------------- database
Head 'SQL Account database'
$sqlacc = @(Get-Process -EA SilentlyContinue | Where-Object { $_.ProcessName -match 'SQLAcc' })
if ($sqlacc.Count) { Ok ('SQL Account is open (' + $sqlacc[0].ProcessName + ')') }
else { Info 'SQL Account process not seen on this PC (are invoices keyed on THIS PC?)' }
$cfgFdb = $null
if ($FdbPath -and (Test-Path -LiteralPath $FdbPath)) {
  $cfgFdb = Get-Item -LiteralPath $FdbPath
  Ok ('sync reads: ' + $cfgFdb.FullName + ' (' + [math]::Round($cfgFdb.Length / 1MB) + ' MB, last written ' + $cfgFdb.LastWriteTime + ')')
} else { Bad ("configured DB not found: '" + $FdbPath + "'") 'set $FdbPath in config.ps1 to the live company .FDB, then RUN-ME.bat' }
$roots = @('C:\eStream'); if ($cfgFdb) { $roots += $cfgFdb.DirectoryName }
$cands = @($roots | Select-Object -Unique | Where-Object { Test-Path -LiteralPath $_ } |
           ForEach-Object { Get-ChildItem -LiteralPath $_ -Recurse -Filter *.fdb -File -EA SilentlyContinue } |
           Where-Object { $_.Length -gt 5MB } | Sort-Object FullName -Unique | Sort-Object LastWriteTime -Descending)
if ($cands.Count) {
  Info 'company databases on this PC (newest-written first, -> = the one the sync reads):'
  foreach ($c in ($cands | Select-Object -First 8)) {
    $mark = if ($cfgFdb -and $c.FullName -eq $cfgFdb.FullName) { '->' } else { '  ' }
    Info ('{0} {1:yyyy-MM-dd HH:mm}  {2,6} MB  {3}' -f $mark, $c.LastWriteTime, [math]::Round($c.Length / 1MB), $c.FullName)
  }
  if ($cfgFdb -and $cands[0].FullName -ne $cfgFdb.FullName -and $cands[0].LastWriteTime -gt $cfgFdb.LastWriteTime.AddMinutes(1)) {
    Warn ('sync reads ' + $cfgFdb.Name + ' but ' + $cands[0].Name + ' was written more recently - SQL Account may be on another company/DB now') 'confirm the DB in SQL Account, set $FdbPath to it, RUN-ME.bat'
  }
}
if ($cfgFdb -and $cfgFdb.LastWriteTime -lt (Get-Date).AddDays(-2)) {
  Warn ('the DB the sync reads has not changed for ' + [int]((Get-Date) - $cfgFdb.LastWriteTime).TotalDays + ' days') 'SQL Account is probably writing another file - set $FdbPath to the live one'
}

# ---------------------------------------------------------------- newest invoices in that DB
Head 'Newest invoices inside that database (latest keyed first)'
$isql = Join-Path $FirebirdDir 'isql.exe'
if (-not (Test-Path -LiteralPath $isql)) { Bad ('Firebird isql not found at ' + $isql) 'RUN-ME.bat (downloads it)' }
elseif ($cfgFdb) {
  $copy = Join-Path $env:TEMP ('wws-diag-' + $PID + '.fdb')
  $qf   = Join-Path $env:TEMP ('wws-diag-' + $PID + '.sql')
  $of   = Join-Path $env:TEMP ('wws-diag-' + $PID + '.txt')
  try {
    Copy-Item -LiteralPath $cfgFdb.FullName -Destination $copy -Force -EA Stop
    $q = @'
SELECT FIRST 12 TRIM(h.DOCNO) AS DOCNO, h.DOCDATE, h.CANCELLED,
  SUBSTRING(COALESCE(h.COMPANYNAME,'') FROM 1 FOR 32) AS CUSTOMER
FROM SL_IV h ORDER BY h.DOCKEY DESC;
'@
    Set-Content -LiteralPath $qf -Value $q -Encoding ASCII
    & $isql -user SYSDBA -password masterkey -b -q -i $qf -o $of $copy
    $code = $LASTEXITCODE
    $out = @(if (Test-Path -LiteralPath $of) { Get-Content -LiteralPath $of })
    if ($code -ne 0) { Bad ('isql could not read the DB (exit ' + $code + '): ' + (($out | Select-Object -First 3) -join ' ')) 'if it mentions on-disk structure: delete %LOCALAPPDATA%\WawasanOMS\firebird, then RUN-ME.bat' }
    else {
      Ok 'database readable'
      $out | Where-Object { $_.Trim() } | ForEach-Object { Info $_ }
      Info ('Sent = SI... invoices, not cancelled, dated within the last ' + $DaysBack + ' days. L... (marketplace) and SO... (sales order) never.')
      Info 'Is the missing invoice in this list? If not, the sync is reading the wrong database.'
    }
  } catch { Bad ('could not copy the DB: ' + $_.Exception.Message) 'disk full? or the DB is on a server/share that locks the file' }
  finally { Remove-Item -LiteralPath $copy, $qf, $of -Force -EA SilentlyContinue }
}

# ---------------------------------------------------------------- sync log
Head ('Sync log: ' + $LogFile)
if (-not $LogFile -or -not (Test-Path -LiteralPath $LogFile)) { Bad 'no sync log - the sync has never run as this Windows user' 'RUN-ME.bat' }
else {
  $lines = @(Get-Content -LiteralPath $LogFile -Tail 400)
  $ev = @($lines | ForEach-Object {
    if ($_ -match '^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2})\s+(.*)$') { [pscustomobject]@{ At = [datetime]$Matches[1]; Msg = $Matches[2] } }
  })
  $lastAny  = $ev | Select-Object -Last 1
  $lastSent = $ev | Where-Object { $_.Msg -match '^sent:' } | Select-Object -Last 1
  $lastErr  = $ev | Where-Object { $_.Msg -match 'error|failed' } | Select-Object -Last 1
  $quietMax = [int]$(if ($SafetyMinutes) { $SafetyMinutes } else { 10 }) * 2 + 5
  if (-not $lastAny) { Warn 'log has no timestamped lines' '' }
  elseif (((Get-Date) - $lastAny.At).TotalMinutes -gt $quietMax) {
    Bad ('nothing logged for ' + [int]((Get-Date) - $lastAny.At).TotalMinutes + ' min (last: ' + $lastAny.At + ') - watcher dead or stuck') 'TURN-OFF.bat, then RUN-ME.bat'
  } else { Ok ('active - last entry ' + $lastAny.At) }
  if ($lastSent) { Info ('last send : ' + $lastSent.At + '  ' + $lastSent.Msg) } else { Warn 'no successful send in the recent log' '' }
  if ($lastErr -and (-not $lastSent -or $lastErr.At -gt $lastSent.At)) { Bad ('latest attempt FAILED: ' + $lastErr.Msg) 'see the error text; 401 = secret, isql = DB/Firebird, other = network' }
  Info 'last 15 lines:'
  $lines | Select-Object -Last 15 | ForEach-Object { Info ('  ' + $_) }
}

# ---------------------------------------------------------------- cloud
Head 'OMS cloud'
$base = $WebhookUrl -replace '/api/.*$', ''
try {
  $h = Invoke-RestMethod -Uri ($base + '/api/health') -TimeoutSec 20
  Ok ('backend reachable: ' + $base)
  if ($h.timestamp) {
    $srv = if ($h.timestamp -is [datetime]) { $h.timestamp.ToUniversalTime() } else { [DateTimeOffset]::Parse([string]$h.timestamp).UtcDateTime }
    $skew = [math]::Abs(((Get-Date).ToUniversalTime() - $srv).TotalMinutes)
    if ($skew -gt 5) { Warn ('PC clock is off by ' + [int]$skew + ' min') 'fix Windows date/time - a wrong date shifts the DaysBack invoice window' }
  }
} catch { Bad ('cannot reach ' + $base + ': ' + $_.Exception.Message) 'check internet / proxy / firewall / antivirus web filter on this PC' }

$probe = 'DocNo,DocDate,CompanyName,ItemCode,Description,Qty,UOM' + "`r`n" +
         '"DIAG-PROBE",' + (Get-Date -Format 'yyyy-MM-dd') + ',"Diagnostic probe","X","probe",1,"PCS"'
$body = @{ csv = $probe; dry_run = $true } | ConvertTo-Json -Compress
try {
  $r = Invoke-RestMethod -Uri $WebhookUrl -Method Post -ContentType 'application/json' -Headers @{ 'x-webhook-secret' = $WebhookSecret } -Body $body -TimeoutSec 60
  if ($r.skipped -eq 'intake_disabled') { Bad 'OMS says Order tracking is PAUSED - every invoice is declined (silently, HTTP 200)' 'Boss login > Settings > Order tracking: turn ON' }
  elseif ($r.mode -eq 'dry_run') { Ok 'webhook accepts the secret and Order tracking is ON (dry-run, nothing created)' }
  else { Warn ('unexpected webhook reply: ' + ($r | ConvertTo-Json -Compress)) '' }
} catch {
  $st = 0; try { $st = [int]$_.Exception.Response.StatusCode } catch { }
  $d = $_.ErrorDetails.Message; if (-not $d) { $d = $_.Exception.Message }
  if ($st -eq 401) { Bad 'webhook REJECTED the secret (401) - config.ps1 no longer matches the server' 'paste the current SQL_ACCOUNT_WEBHOOK_SECRET (Vercel > backend > env) into config.ps1, RUN-ME.bat' }
  elseif ($st -eq 404) { Bad 'webhook URL not found (404)' 'fix WebhookUrl in config.ps1' }
  else { Bad ('webhook call failed (' + $st + '): ' + $d) '' }
}

# ---------------------------------------------------------------- full pipe
if (-not $SkipDryRun) {
  Head 'Full pipe dry-run: DB copy -> isql -> cloud (creates nothing)'
  try {
    & (Join-Path $PSScriptRoot 'Sync-Once.ps1') -DryRun
    Info 'new=N = invoices in the DB window that are NOT on the board yet.'
    Info 'N > 0 while the watcher looks healthy -> run SYNC-NOW.bat and read its result.'
  } catch { Bad ('dry-run failed: ' + $_.Exception.Message) 'read the error: 401 = secret, FDB/isql = database, other = network' }
}

Finish
