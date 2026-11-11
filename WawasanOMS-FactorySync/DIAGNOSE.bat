@echo off
cd /d "%~dp0"
echo ============================================================
echo   Wawasan OMS - SQL Account sync health check (read-only)
echo ============================================================
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0Diagnose.ps1"
echo.
pause
