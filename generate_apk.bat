@echo off
setlocal
echo ==========================================
echo      Eudorama Android Build Launcher
echo ==========================================
echo.

REM --- 1. Tentar detectar JAVA_HOME do Android Studio (JBR) ---
if exist "C:\Program Files\Android\Android Studio\jbr" (
    set "JAVA_HOME=C:\Program Files\Android\Android Studio\jbr"
    echo [INFO] Encontrado Java no Android Studio: %JAVA_HOME%
) else (
    REM Fallback para JRE antigo se JBR nao existir
    if exist "C:\Program Files\Android\Android Studio\jre" (
       set "JAVA_HOME=C:\Program Files\Android\Android Studio\jre"
       echo [INFO] Encontrado JRE no Android Studio.
    )
)

REM --- 2. Tentar detectar ANDROID_HOME ---
if not defined ANDROID_HOME (
    if exist "%LOCALAPPDATA%\Android\Sdk" (
        set "ANDROID_HOME=%LOCALAPPDATA%\Android\Sdk"
        echo [INFO] Encontrado Android SDK: %ANDROID_HOME%
    )
)

REM --- 3. Configurar PATH ---
if defined JAVA_HOME (
    set "PATH=%JAVA_HOME%\bin;%PATH%"
)

echo.
echo Verificando instalacao do Java...
java -version >nul 2>&1
if %errorlevel% neq 0 (
    echo [ERRO] Java nao encontrado mesmo buscando no Android Studio.
    echo Certifique-se de que o Android Studio esta instalado padrao.
    pause
    exit /b
)

echo Java OK! Iniciando compilacao do APK...
echo.
cd android
call gradlew assembleDebug

if %errorlevel% neq 0 (
    echo.
    echo [ERRO] Falha na compilacao.
    echo Verifique o erro acima.
    pause
    exit /b
)

echo.
echo [SUCESSO] APK gerado com sucesso!
echo.
echo O arquivo esta na pasta que vai abrir agora...
start .
explorer app\build\outputs\apk\debug
pause
