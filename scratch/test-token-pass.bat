@echo off
setlocal

for /f %%T in ('powershell -NoProfile -Command "$b=New-Object byte[] 32;[Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($b);[Convert]::ToBase64String($b).TrimEnd('=').Replace('+','-').Replace('/','_')"') do set "VIKI_MOTOR_TOKEN=%%T"

echo Token gerado: [%VIKI_MOTOR_TOKEN%]
echo Comprimento esperado: 43 chars

powershell -NoProfile -ExecutionPolicy Bypass -Command "Write-Host 'Token recebido pelo PS:' $env:VIKI_MOTOR_TOKEN; $env:VIKI_MOTOR_TOKEN = '%VIKI_MOTOR_TOKEN%'; Write-Host 'Token injetado:' $env:VIKI_MOTOR_TOKEN"

pause
