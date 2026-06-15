#requires -version 5.1
# Watch.ps1 - always-on. Watches the SQL Account DB file; the instant it changes
# (an invoice saved), waits for the writes to settle, then runs Sync-Once. Also a
# periodic safety sync. No admin needed. ASCII-only.
$ErrorActionPreference='Continue'
. "$PSScriptRoot\config.ps1"
function Write-Log($m){ $l=('{0}  {1}' -f (Get-Date -Format 's'),$m); if($LogFile){ try{ Add-Content -LiteralPath $LogFile -Value $l }catch{} } }

if(-not (Test-Path -LiteralPath $FdbPath)){ Write-Log "Watch: FDB not found '$FdbPath' - run Install.ps1"; exit 1 }

# Single-instance: if another Watch.ps1 is already running, exit. Multiple watchers
# would race the shared snapshot/temp files and corrupt every sync.
try {
  $others = Get-CimInstance Win32_Process -Filter "Name='powershell.exe'" -EA SilentlyContinue |
            Where-Object { $_.ProcessId -ne $PID -and $_.CommandLine -match 'Watch\.ps1' }
  if($others){ Write-Log ("another watcher already running (PID {0}) - this instance exits" -f ($others.ProcessId -join ',')); exit 0 }
} catch { }

$dir  = Split-Path -LiteralPath $FdbPath
$name = Split-Path -LiteralPath $FdbPath -Leaf

$fsw = New-Object System.IO.FileSystemWatcher $dir, $name
$fsw.NotifyFilter = [System.IO.NotifyFilters]'LastWrite,Size'
$fsw.IncludeSubdirectories = $false

Write-Log "Watch started on $FdbPath (debounce ${DebounceSeconds}s, safety ${SafetyMinutes}m)"

# be current at startup
try { & "$PSScriptRoot\Sync-Once.ps1" } catch { Write-Log "startup sync error: $($_.Exception.Message)" }

$safetyMs = [int]([math]::Min($SafetyMinutes*60*1000, 2147483))   # WaitForChanged timeout is int ms
while($true){
  $res = $fsw.WaitForChanged([System.IO.WatcherChangeTypes]::All, $safetyMs)
  if($res.TimedOut){
    try { & "$PSScriptRoot\Sync-Once.ps1" } catch { Write-Log "safety sync error: $($_.Exception.Message)" }
    continue
  }
  # change detected: let the burst of writes settle by draining further changes
  do {
    $more = $fsw.WaitForChanged([System.IO.WatcherChangeTypes]::All, [int]($DebounceSeconds*1000))
  } while(-not $more.TimedOut)
  try { & "$PSScriptRoot\Sync-Once.ps1" } catch { Write-Log "change sync error: $($_.Exception.Message)" }
}
