@echo off
REM Double-click this file to send a test order to the OMS board.
REM It runs run-test.ps1 with PowerShell (no setup needed).
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0run-test.ps1"
echo.
pause
