@echo off
title MOTOR DE AUTOMACAO EUDORAMA + TUNNEL
echo Iniciando Motor de Automacao e Tunnel Cloudflare...
echo.
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\start-viki-motor-tunnel.ps1" -RestartMotor
pause
