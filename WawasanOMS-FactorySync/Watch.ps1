#requires -version 5.1
# Watch.ps1 - always-on. POLLS the SQL Account DB file mtime+size and runs Sync-Once
# whenever it changes. (FileSystemWatcher is UNRELIABLE for Firebird: it writes pages
# via memory-mapped I/O, so the file mtime updates but Windows fires no change EVENT.
# Polling the mtime is reliable - we can always read the fresh timestamp.) Plus a
# periodic safety sync. No admin needed. ASCII-only (PS 5.1 -File mis-parses non-ASCII).
$ErrorActionPreference='Continue'
. "$PSScriptRoot\config.ps1"
function Write-Log($m){ $l=('{0}  {1}' -f (Get-Date -Format 's'),$m); if($LogFile){ try{ Add-Content -LiteralPath $LogFile -Value $l }catch{} } }

if(-not (Test-Path -LiteralPath $FdbPath)){ Write-Log "Watch: FDB not found '$FdbPath' - run Install.ps1"; exit 1 }

# Single-instance guard: if another Watch.ps1 is already running, exit. Two watchers
# would race the per-process snapshot/temp files.
try {
  $others = Get-CimInstance Win32_Process -Filter "Name='powershell.exe'" -EA SilentlyContinue |
            Where-Object { $_.ProcessId -ne $PID -and $_.CommandLine -match 'Watch\.ps1' }
  if($others){ Write-Log ("another watcher already running (PID {0}) - this instance exits" -f ($others.ProcessId -join ',')); exit 0 }
} catch { }

$poll   = if($PollSeconds){ [int]$PollSeconds } else { 5 }
$deb    = if($DebounceSeconds){ [int]$DebounceSeconds } else { 4 }
$safety = if($SafetyMinutes){ [double]$SafetyMinutes } else { 10 }

# stamp = name + LastWrite ticks + length of the newest ACC-*.FDB in the DB folder, so it
# changes whenever SQL Account writes the DB AND when it moves the company to another
# copy (Sync-Once follows the move; see its step 0). $FollowNewestDb = $false pins it
# to $FdbPath. Reads the folder, not $FdbPath, so archiving the old copy cannot blind it.
function Get-FdbStamp {
  try {
    $f = $null
    if($FollowNewestDb -ne $false){
      $f = Get-ChildItem -LiteralPath (Split-Path -Parent $FdbPath) -Filter 'ACC-*.FDB' -File -EA Stop |
           Sort-Object LastWriteTimeUtc -Descending | Select-Object -First 1
    }
    if(-not $f){ $f = Get-Item -LiteralPath $FdbPath -EA Stop }
    return ('{0}:{1}:{2}' -f $f.Name, $f.LastWriteTimeUtc.Ticks, $f.Length)
  } catch { return $null }
}

Write-Log "Watch started (poll ${poll}s, debounce ${deb}s, safety ${safety}m) on $FdbPath"

# be current at startup
try { & "$PSScriptRoot\Sync-Once.ps1" } catch { Write-Log "startup sync error: $($_.Exception.Message)" }
$seen     = Get-FdbStamp
$lastSync = Get-Date

while($true){
  Start-Sleep -Seconds $poll
  $now = Get-FdbStamp
  if($now -and $now -ne $seen){
    # change detected: wait for the burst of writes to settle (stamp stable across one debounce)
    do {
      $seen = $now
      Start-Sleep -Seconds $deb
      $now = Get-FdbStamp
    } while($now -and $now -ne $seen)
    try { & "$PSScriptRoot\Sync-Once.ps1" } catch { Write-Log "change sync error: $($_.Exception.Message)" }
    $seen = Get-FdbStamp
    $lastSync = Get-Date
    continue
  }
  if(((Get-Date) - $lastSync).TotalMinutes -ge $safety){
    try { & "$PSScriptRoot\Sync-Once.ps1" } catch { Write-Log "safety sync error: $($_.Exception.Message)" }
    $seen = Get-FdbStamp
    $lastSync = Get-Date
  }
}
