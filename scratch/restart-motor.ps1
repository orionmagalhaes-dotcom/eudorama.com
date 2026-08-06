$port = 3000
$repoRoot = "c:\Users\Orion Magalhães\Documents\Projetos\Eudorama\eudorama.com"
$tokenPath = Join-Path $repoRoot "artifacts\last-motor-token.txt"
$token = (Get-Content $tokenPath -Raw -ErrorAction SilentlyContinue).Trim()

Write-Host "Token atual: $($token.Substring(0, [Math]::Min(10, $token.Length)))..."

# Mata todos os processos na porta 3000
$conns = Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue
foreach ($c in $conns) {
    Write-Host "Encerrando PID $($c.OwningProcess)..."
    $result = & taskkill /PID $($c.OwningProcess) /F /T 2>&1
    Write-Host $result
    Start-Sleep -Seconds 1
}

# Aguarda porta liberar
$deadline = (Get-Date).AddSeconds(10)
do { Start-Sleep -Seconds 1 } while (
    (Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue) -and
    ((Get-Date) -lt $deadline)
)

$still = Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue
if ($still) {
    Write-Host "AVISO: Porta $port ainda em uso pelo PID $($still.OwningProcess). Tentando continuar mesmo assim..."
} else {
    Write-Host "Porta $port liberada."
}

# Inicia o motor com o token correto
Write-Host "Iniciando motor com token correto..."
$cmdArgs = "/d /s /c set PORT=$port&& set VIKI_MOTOR_TOKEN=$token&& npx -y tsx automation-server.ts"
Start-Process -WindowStyle Normal -FilePath "cmd.exe" -WorkingDirectory $repoRoot -ArgumentList $cmdArgs
Write-Host "Motor iniciado. Aguardando porta..."

$deadline2 = (Get-Date).AddSeconds(30)
do {
    if (Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue) {
        Write-Host "[ok] Motor ouvindo na porta $port."
        break
    }
    Start-Sleep -Seconds 1
} while ((Get-Date) -lt $deadline2)

if (-not (Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue)) {
    Write-Host "[erro] Motor nao abriu a porta $port em 30 segundos."
    exit 1
}
