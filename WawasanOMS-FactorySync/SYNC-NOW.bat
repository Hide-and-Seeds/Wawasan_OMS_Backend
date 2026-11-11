@echo off
cd /d "%~dp0"
echo Sending new SQL Account invoices to the OMS now...
echo.
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0Sync-Once.ps1"
echo.
echo "sent: ... created=N" above means N new orders reached the board.
echo "duplicate" = already on the board. An ERROR line = see DIAGNOSE.bat.
pause
