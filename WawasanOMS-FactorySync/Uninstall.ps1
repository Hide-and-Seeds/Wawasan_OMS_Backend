#requires -version 5.1
# Uninstall.ps1 - one-click turn-off (no admin). Removes the logon auto-start and
# stops the running watcher. Add -Purge to also delete the downloaded Firebird tool
# and the log. Leaves config.ps1 in place so re-install is easy. ASCII-only.
param([switch]$Purge)
$ErrorActionPreference='Continue'
function Say($m){ Write-Host ("[uninstall] " + $m) }

$cfg = "$PSScriptRoot\config.ps1"
if(Test-Path $cfg){ . $cfg }   # for $FirebirdDir / $LogFile

# 1. remove the Startup auto-start launcher
$startup = [Environment]::GetFolderPath('Startup')
$vbs = Join-Path $startup 'WawasanOMS-Sync.vbs'
if(Test-Path $vbs){ Remove-Item -LiteralPath $vbs -Force; Say "removed auto-start: $vbs" }
else { Say "no auto-start launcher found (already off?)" }

# 2. stop any running watcher (hidden powershell running Watch.ps1)
$killed = 0
Get-CimInstance Win32_Process -Filter "Name='powershell.exe'" -EA SilentlyContinue |
  Where-Object { $_.CommandLine -and $_.CommandLine -match 'Watch\.ps1' } |
  ForEach-Object { try { Stop-Process -Id $_.ProcessId -Force -EA Stop; $killed++ } catch {} }
Say "stopped $killed running watcher process(es)"

# 3. optional purge of the downloaded tool + log (config.ps1 is kept)
if($Purge){
  if($FirebirdDir -and (Test-Path $FirebirdDir)){ Remove-Item -LiteralPath $FirebirdDir -Recurse -Force -EA SilentlyContinue; Say "removed Firebird tool: $FirebirdDir" }
  if($LogFile -and (Test-Path $LogFile)){ Remove-Item -LiteralPath $LogFile -Force -EA SilentlyContinue; Say "removed log: $LogFile" }
  Say "purge done (config.ps1 kept)"
}

Say "DONE. Sync is OFF. Re-run Install.ps1 to turn it back on."
