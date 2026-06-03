@echo off
title MOTOR VIKI PATCHRIGHT + CLOUDFLARE TUNNEL
setlocal
set "PORT=3000"
set "VIKI_PATCHRIGHT_HEADFUL=1"
set "VIKI_PATCHRIGHT_CHANNEL=chrome"
for /f %%T in ('powershell -NoProfile -Command "[guid]::NewGuid().ToString('N') + [guid]::NewGuid().ToString('N')"') do set "VIKI_MOTOR_TOKEN=%%T"

powershell -NoProfile -ExecutionPolicy Bypass -Command "New-Item -ItemType Directory -Force -Path '%~dp0artifacts' | Out-Null; Set-Content -Path '%~dp0artifacts\last-motor-token.txt' -Value $env:VIKI_MOTOR_TOKEN -NoNewline"

powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\start-viki-motor-tunnel.ps1" -RestartMotor
pause
