#requires -version 5.1
# Install.ps1 - no-admin, do-everything setup of the SQL Account -> OMS instant sync.
# Finds the database, downloads the matching Firebird tool to your user folder,
# validates end to end with a dry-run, installs an auto-start at logon (current
# user, NO admin), and launches it. ASCII-only.
$ErrorActionPreference='Stop'
$ProgressPreference='SilentlyContinue'
[Net.ServicePointManager]::SecurityProtocol=[Net.SecurityProtocolType]::Tls12

function Say($m){ Write-Host ("[install] " + $m) }

$cfgPath = "$PSScriptRoot\config.ps1"
if(-not (Test-Path $cfgPath)){ throw "First: copy config.example.ps1 to config.ps1 and paste the webhook secret." }
. $cfgPath
if(-not $WebhookSecret -or $WebhookSecret -eq 'PASTE_THE_WEBHOOK_SECRET_HERE'){ throw "Set `$WebhookSecret in config.ps1 first." }

# base folder for tool + logs
$base = Split-Path -Parent $LogFile
New-Item -ItemType Directory -Force -Path $base | Out-Null

# 1. locate the .FDB
if(-not $FdbPath){
  Say "auto-detecting .FDB under C:\eStream ..."
  $f = Get-ChildItem 'C:\eStream' -Recurse -Filter *.fdb -File -EA SilentlyContinue | Sort-Object Length -Descending | Select-Object -First 1
  if(-not $f){ throw "No .FDB found under C:\eStream - set `$FdbPath in config.ps1." }
  $FdbPath = $f.FullName
}
if(-not (Test-Path -LiteralPath $FdbPath)){ throw "FDB not found: $FdbPath" }
Say "database: $FdbPath"

# 2. detect ODS from a copy (avoids the lock) -> pick Firebird version
$tmp = Join-Path $env:TEMP 'wws-odscheck.fdb'
Copy-Item -LiteralPath $FdbPath -Destination $tmp -Force
$bytes = [System.IO.File]::ReadAllBytes($tmp)
$ods = [BitConverter]::ToUInt16($bytes,18) -band 0x7FFF
Remove-Item $tmp -Force -EA SilentlyContinue
$fbTag = if($ods -ge 13){ 'v5.0.4' } else { 'v4.0.6' }   # FB5 opens ODS 13.x; FB4 opens ODS 12 + 13.0 (not 13.1). No single build covers 12 AND 13.1.
Say "database ODS = $ods -> Firebird $fbTag"

# 3. download + extract Firebird (no admin) unless already there
$isql = Join-Path $FirebirdDir 'isql.exe'
if(Test-Path $isql){ Say "Firebird tool already present." }
else {
  Say "downloading Firebird $fbTag ..."
  $rel = Invoke-RestMethod "https://api.github.com/repos/FirebirdSQL/firebird/releases/tags/$fbTag" -Headers @{ 'User-Agent'='wws' }
  # FB5 asset is '...-windows-x64.zip'; FB4 asset is '...-x64.zip'. Match both, exclude 32-bit + debug.
  $asset = $rel.assets | Where-Object { $_.name -match 'x64\.zip$' -and $_.name -notmatch 'pdb|Win32' } | Select-Object -First 1
  if(-not $asset){ throw "No Firebird $fbTag x64 zip found. Install Firebird manually and set `$FirebirdDir." }
  $zip = Join-Path $env:TEMP $asset.name
  Invoke-WebRequest -Uri $asset.browser_download_url -OutFile $zip
  New-Item -ItemType Directory -Force -Path $FirebirdDir | Out-Null
  Expand-Archive -Path $zip -DestinationPath $FirebirdDir -Force
  if(-not (Test-Path $isql)){ throw "isql.exe missing after extract in $FirebirdDir" }
  Say "Firebird ready at $FirebirdDir"
}

# 4. persist the resolved FdbPath into config.ps1 so Watch/Sync use it
$lines = Get-Content -LiteralPath $cfgPath | ForEach-Object {
  if($_ -match '^\s*\$FdbPath\s*='){ '$FdbPath       = "' + $FdbPath + '"' } else { $_ }
}
Set-Content -LiteralPath $cfgPath -Value $lines -Encoding ASCII

# 5. validate end to end (creates nothing on the board)
Say "validating with a dry-run (no orders created) ..."
& "$PSScriptRoot\Sync-Once.ps1" -DryRun

# 6. auto-start at logon - current user, NO admin: a hidden launcher in the Startup folder
$startup = [Environment]::GetFolderPath('Startup')
$vbs   = Join-Path $startup 'WawasanOMS-Sync.vbs'
$watch = Join-Path $PSScriptRoot 'Watch.ps1'
$vbsBody = 'Set s=CreateObject("WScript.Shell") : s.Run "powershell -NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File ""' + $watch + '""", 0, False'
Set-Content -LiteralPath $vbs -Value $vbsBody -Encoding ASCII
Say "auto-start installed (logon, no admin): $vbs"

# 7. launch it now
Start-Process wscript.exe -ArgumentList ('"' + $vbs + '"')
Say "DONE. Sync is running and auto-starts at logon."
Say "Watch progress in the log: $LogFile"
Say "To turn it off: run  Uninstall.ps1"
