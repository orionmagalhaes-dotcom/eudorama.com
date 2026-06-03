@echo off
title MOTOR VIKI PATCHRIGHT + CLOUDFLARE TUNNEL
setlocal
set "PORT=3000"
for /f %%T in ('powershell -NoProfile -Command "[guid]::NewGuid().ToString('N') + [guid]::NewGuid().ToString('N')"') do set "VIKI_MOTOR_TOKEN=%%T"

start "MOTOR VIKI PATCHRIGHT LOCAL" /min cmd /d /s /c "cd /d ""%~dp0"" && set PORT=%PORT%&& set VIKI_MOTOR_TOKEN=%VIKI_MOTOR_TOKEN%&& npx -y tsx automation-server.ts"
timeout /t 10 /nobreak >nul

powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\start-viki-motor-tunnel.ps1" -SkipMotor
pause
