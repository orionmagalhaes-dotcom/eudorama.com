@echo off
title MOTOR VIKI PATCHRIGHT + CLOUDFLARE TUNNEL
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\start-viki-motor-tunnel.ps1" -RestartMotor
pause
