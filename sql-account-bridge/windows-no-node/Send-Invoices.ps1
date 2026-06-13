#requires -version 5.1
<#
  Send-Invoices.ps1  -  SQL Account CSV  ->  Wawasan OMS   (NO Node needed)

  Reads your exported invoice CSV and POSTs it to the OMS cloud, which parses
  and de-duplicates server-side (POST /api/orders/webhook/sql-account-csv).

  Safe to run on a schedule: invoices already on the board come back as
  "duplicate" and are skipped - the cloud is the de-dup authority, so this
  script keeps no state of its own.

  SETUP (one time):
    1. Copy  config.example.ps1  ->  config.ps1   and edit it.
    2. Test (safe, creates nothing):  .\Send-Invoices.ps1 -DryRun
       Send for real:                 .\Send-Invoices.ps1
    3. Schedule it with Task Scheduler (see SETUP.md).

  NOTE: keep this file ASCII-only. PowerShell 5.1 'powershell -File' decodes a
  no-BOM file as ANSI, so non-ASCII chars (em-dash, smart quotes) corrupt the
  parse and throw a misleading "Missing closing '}'".
#>
param(
  [string]$Config = "$PSScriptRoot\config.ps1",
  [switch]$DryRun                       # preview only: server parses + counts, creates nothing
)

$ErrorActionPreference = 'Stop'
# Older Windows defaults TLS too low for HTTPS to Vercel - force TLS 1.2.
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12

if (-not (Test-Path $Config)) {
  throw "Config not found: $Config  (copy config.example.ps1 to config.ps1 and edit it)"
}
. $Config   # provides $WebhookUrl, $WebhookSecret, $CsvPath, optional $LogFile

function Write-Log($msg) {
  $line = "{0}  {1}" -f (Get-Date -Format 's'), $msg
  Write-Host $line
  if ($LogFile) { Add-Content -Path $LogFile -Value $line }
}

if (-not $WebhookUrl)    { throw "Set `$WebhookUrl in config.ps1" }
if (-not $WebhookSecret) { throw "Set `$WebhookSecret in config.ps1" }
if (-not $CsvPath)       { throw "Set `$CsvPath in config.ps1" }

# $CsvPath may be a single file OR a folder. Folder -> send the newest *.csv.
if (Test-Path $CsvPath -PathType Container) {
  $file = Get-ChildItem -Path $CsvPath -Filter *.csv -File |
          Sort-Object LastWriteTime -Descending | Select-Object -First 1
  if (-not $file) { Write-Log "No .csv files in $CsvPath - nothing to send."; return }
  $csvFile = $file.FullName
} elseif (Test-Path $CsvPath) {
  $csvFile = (Resolve-Path $CsvPath).Path
} else {
  Write-Log "CSV path not found: $CsvPath - nothing to send."; return
}

# Read as UTF-8. If accented names/addresses look garbled on the board, change
# -Encoding UTF8 to -Encoding Default (SQL Account sometimes exports ANSI).
# Cast to [string]: Get-Content -Raw returns a string carrying PS note-properties
# (PSPath, PSChildName, ...). Without the cast, PowerShell 5.1's ConvertTo-Json
# serializes those as an object ({"value":...,"PSPath":...}) and the server sees
# csv as a non-string -> "No CSV provided". The cast yields a clean bare string.
$text = [string](Get-Content -Path $csvFile -Raw -Encoding UTF8)
if (-not $text -or -not $text.Trim()) { Write-Log "CSV is empty: $csvFile"; return }

$payload = @{ csv = $text }
if ($DryRun) { $payload.dry_run = $true }   # server parses + counts, creates nothing
$body    = $payload | ConvertTo-Json -Compress
$headers = @{ 'x-webhook-secret' = $WebhookSecret }

try {
  $resp = Invoke-RestMethod -Uri $WebhookUrl -Method Post `
            -ContentType 'application/json' -Headers $headers -Body $body
  if ($DryRun) {
    Write-Log ("DRY-RUN {0}: total={1} new={2} (nothing created)" -f `
      (Split-Path $csvFile -Leaf), $resp.total, $resp.new_count)
  } else {
    Write-Log ("Sent {0}: total={1} created={2} duplicate={3} failed={4}" -f `
      (Split-Path $csvFile -Leaf), $resp.total, $resp.created, $resp.duplicate, $resp.failed)
  }
} catch {
  # Surface the server's error body if there is one - easier to debug.
  $detail = $_.Exception.Message
  try {
    $stream = $_.Exception.Response.GetResponseStream()
    if ($stream) { $detail = (New-Object IO.StreamReader($stream)).ReadToEnd() }
  } catch { }
  Write-Log ("ERROR posting {0}: {1}" -f (Split-Path $csvFile -Leaf), $detail)
  exit 1
}
