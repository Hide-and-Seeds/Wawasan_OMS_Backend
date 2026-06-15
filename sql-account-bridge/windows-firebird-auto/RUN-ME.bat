@echo off
cd /d "%~dp0"
echo ============================================================
echo   Wawasan OMS - SQL Account auto-sync  (one-time setup)
echo ============================================================
echo.
echo Installing... this downloads a small tool and starts the sync.
echo No admin password needed.
echo.
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0Install.ps1"
echo.
echo ------------------------------------------------------------
echo If you see DONE above, it is running and will auto-start at
echo every login. You can close this window now.
echo ------------------------------------------------------------
pause
