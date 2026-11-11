@echo off
cd /d "%~dp0"
echo Turning OFF the Wawasan OMS auto-sync...
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0Uninstall.ps1"
echo.
echo Done. The sync is stopped and will not restart at login.
pause
