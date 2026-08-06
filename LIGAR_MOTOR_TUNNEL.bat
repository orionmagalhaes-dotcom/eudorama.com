@echo off
title MOTOR VIKI PATCHRIGHT + CLOUDFLARE TUNNEL
setlocal

set "PORT=3000"
set "TOKEN_FILE=%~dp0artifacts\last-motor-token.txt"
set "VIKI_MOTOR_TOKEN="

rem Se o arquivo de token existir, carrega o token estavel existente
if exist "%TOKEN_FILE%" (
    for /f "usebackq tokens=*" %%T in ("%TOKEN_FILE%") do set "VIKI_MOTOR_TOKEN=%%T"
)

rem Se nao houver token salvo, gera um novo token seguro e salva no arquivo
if "%VIKI_MOTOR_TOKEN%"=="" (
    for /f %%T in ('powershell -NoProfile -Command "$b=New-Object byte[] 32;[Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($b);[Convert]::ToBase64String($b).TrimEnd('=').Replace('+','-').Replace('/','_')"') do set "VIKI_MOTOR_TOKEN=%%T"
    powershell -NoProfile -ExecutionPolicy Bypass -Command "New-Item -ItemType Directory -Force -Path '%~dp0artifacts' | Out-Null; Set-Content -Path '%TOKEN_FILE%' -Value '%VIKI_MOTOR_TOKEN%' -NoNewline"
)

rem Executa o script principal passando o token estavel e sincronizando com o Worker Cloudflare
powershell -NoProfile -ExecutionPolicy Bypass -Command "$env:VIKI_MOTOR_TOKEN = '%VIKI_MOTOR_TOKEN%'; & '%~dp0scripts\start-viki-motor-tunnel.ps1' -RestartMotor"

pause
