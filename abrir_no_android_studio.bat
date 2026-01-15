@echo off
echo Abrindo Eudorama no Android Studio...
echo.

set "STUDIO_PATH=C:\Program Files\Android\Android Studio\bin\studio64.exe"

if exist "%STUDIO_PATH%" (
    start "" "%STUDIO_PATH%" "%~dp0android"
) else (
    echo [AVISO] Nao encontrei o Android Studio no caminho padrao.
    echo Tentando abrir via comando Capacitor...
    call npx cap open android
)

echo.
echo Tudo pronto! O Android Studio deve abrir em instantes.
timeout /t 5
