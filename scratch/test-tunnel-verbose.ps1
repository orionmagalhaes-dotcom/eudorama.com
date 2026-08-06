param([string]$TunnelUrl = "")

$repoRoot = Join-Path $env:USERPROFILE "Documents\Projetos\Eudorama\eudorama.com"
$tokenPath = Join-Path $repoRoot "artifacts\last-motor-token.txt"
$token = (Get-Content $tokenPath -Raw -ErrorAction SilentlyContinue)
if ($token) { $token = $token.Trim() }
$logDir = Join-Path $repoRoot "artifacts\patchright-motor-tunnel"
$logFile = Join-Path $logDir "cloudflared.err.log"

if (-not $TunnelUrl) {
    # Inicia um novo tunnel para teste
    $cloudflared = (Get-Command cloudflared.exe -ErrorAction Stop).Source
    Remove-Item -LiteralPath $logFile -Force -ErrorAction SilentlyContinue
    Write-Host "Iniciando tunnel..."
    $proc = Start-Process -WindowStyle Hidden -FilePath $cloudflared -ArgumentList @(
        "tunnel", "--no-autoupdate", "--url", "http://localhost:3000"
    ) -RedirectStandardError $logFile -PassThru
    
    # Aguarda URL
    $deadline = (Get-Date).AddSeconds(45)
    do {
        Start-Sleep -Seconds 1
        if (Test-Path $logFile) {
            $m = Select-String -Path $logFile -Pattern "https://[-a-z0-9]+\.trycloudflare\.com" -AllMatches -EA SilentlyContinue
            foreach ($match in $m) {
                foreach ($item in $match.Matches) {
                    $TunnelUrl = $item.Value
                }
            }
        }
    } while (-not $TunnelUrl -and (Get-Date) -lt $deadline)
    
    if (-not $TunnelUrl) {
        Write-Host "ERRO: tunnel nao abriu URL em 45s"
        Stop-Process -Id $proc.Id -Force -ErrorAction SilentlyContinue
        exit 1
    }
    Write-Host "Tunnel URL: $TunnelUrl (PID $($proc.Id))"
}

$healthUrl = "$TunnelUrl/api/viki-tv-automation/status?requestId=manual-test"
Write-Host ""
Write-Host "=== Testando COM token (verbose) ==="
Write-Host "URL: $healthUrl"
Write-Host ""

# Testa com timeouts maiores e verbose
for ($i = 1; $i -le 5; $i++) {
    Write-Host "--- Tentativa $i ---"
    $r = curl.exe -v --connect-timeout 10 --max-time 20 -H "Authorization: Bearer $token" $healthUrl 2>&1
    Write-Host ($r -join "`n")
    Write-Host ""
    if ($LASTEXITCODE -eq 0) { break }
    Start-Sleep -Seconds 3
}

if ($proc) {
    Write-Host "Encerrando tunnel PID $($proc.Id)"
    Stop-Process -Id $proc.Id -Force -ErrorAction SilentlyContinue
}
