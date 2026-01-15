@echo off
setlocal
echo ==========================================
echo      Eudorama: Gerador de APK Completo
echo ==========================================
echo.

REM --- 1. Detectar Java ---
if exist "C:\Program Files\Android\Android Studio\jbr" (
    set "JAVA_HOME=C:\Program Files\Android\Android Studio\jbr"
)
if defined JAVA_HOME (
    set "PATH=%JAVA_HOME%\bin;%PATH%"
)

echo [1/4] Preparando arquivos web...
call npm run build

echo.
echo [2/4] Sincronizando com Android...
call npx cap sync

echo.
echo [3/4] Compilando APK (isso pode demorar)...
cd android
call gradlew assembleDebug

if %errorlevel% neq 0 (
    echo.
    echo [ERRO] Falha na compilacao. 
    echo Tente abrir o projeto no Android Studio pelo arquivo 'abrir_no_android_studio.bat'
    pause
    exit /b
)

echo.
echo [4/4] SUCESSO! Abrindo pasta do APK...
explorer app\build\outputs\apk\debug
echo.
echo Pronto! Voce ja pode copiar o 'app-debug.apk' para seu celular.
pause
