param(
  [int]$Port = 3000,
  [string]$WorkerDir = "viki-worker",
  [string]$LogDir = "artifacts\patchright-motor-tunnel",
  [switch]$RestartMotor,
  [switch]$Once
)

$ErrorActionPreference = "Stop"

function Write-Info($message) {
  Write-Host "[info] $message"
}

function Write-Ok($message) {
  Write-Host "[ok] $message"
}

function Get-TunnelUrlFromLog($path) {
  if (-not (Test-Path $path)) { return $null }
  $matches = Select-String -Path $path -Pattern "https://[-a-z0-9]+\.trycloudflare\.com" -AllMatches -ErrorAction SilentlyContinue
  $urls = @()
  foreach ($match in $matches) {
    foreach ($item in $match.Matches) {
      $urls += $item.Value
    }
  }
  if ($urls.Count -eq 0) { return $null }
  return $urls[-1]
}

function Wait-ForTunnelUrl($path, $timeoutSeconds) {
  $deadline = (Get-Date).AddSeconds($timeoutSeconds)
  do {
    $url = Get-TunnelUrlFromLog $path
    if ($url) { return $url }
    Start-Sleep -Seconds 1
  } while ((Get-Date) -lt $deadline)
  throw "Tunnel iniciou, mas nenhum URL trycloudflare.com apareceu em $path"
}

function Test-LocalPort($port) {
  return [bool](Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue)
}

function New-MotorToken() {
  $bytes = New-Object byte[] 32
  $rng = [System.Security.Cryptography.RandomNumberGenerator]::Create()
  try {
    $rng.GetBytes($bytes)
  } finally {
    $rng.Dispose()
  }
  return [Convert]::ToBase64String($bytes).TrimEnd("=").Replace("+", "-").Replace("/", "_")
}

function Stop-MotorOnPort($port) {
  $connections = Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue
  foreach ($connection in $connections) {
    $process = Get-CimInstance Win32_Process -Filter "ProcessId = $($connection.OwningProcess)" -ErrorAction SilentlyContinue
    if ($process -and $process.CommandLine -match "automation-server\.ts") {
      Stop-Process -Id $connection.OwningProcess -Force -ErrorAction SilentlyContinue
      Write-Ok "Motor anterior parado. PID $($connection.OwningProcess)."
    }
  }
}

function Start-MotorIfNeeded($port, $logDir, $restartExisting) {
  if ($restartExisting -and (Test-LocalPort $port)) {
    Stop-MotorOnPort $port
    Start-Sleep -Seconds 2
  }

  if (Test-LocalPort $port) {
    Write-Ok "Motor ja esta ouvindo na porta $port."
    return
  }

  $out = Join-Path $logDir "motor.out.log"
  $err = Join-Path $logDir "motor.err.log"
  Write-Info "Iniciando motor Patchright na porta $port..."
  $safeToken = [string]($env:VIKI_MOTOR_TOKEN).Replace("'", "''")
  $command = "`$env:PORT='$port'; `$env:VIKI_MOTOR_TOKEN='$safeToken'; npx -y tsx automation-server.ts"
  $process = Start-Process -WindowStyle Hidden -FilePath powershell.exe -WorkingDirectory (Get-Location) -ArgumentList @(
    "-NoProfile",
    "-ExecutionPolicy",
    "Bypass",
    "-Command",
    $command
  ) -RedirectStandardOutput $out -RedirectStandardError $err -PassThru

  Start-Sleep -Seconds 5
  if (-not (Test-LocalPort $port)) {
    throw "Motor nao abriu a porta $port. Confira $err"
  }
  Write-Ok "Motor iniciado. PID $($process.Id)."
}

function Start-QuickTunnel($port, $logDir) {
  $cloudflared = (Get-Command cloudflared.exe -ErrorAction Stop).Source
  $out = Join-Path $logDir "cloudflared.out.log"
  $err = Join-Path $logDir "cloudflared.err.log"
  Remove-Item -LiteralPath $out, $err -Force -ErrorAction SilentlyContinue

  Write-Info "Abrindo Cloudflare quick tunnel para http://localhost:$port..."
  $process = Start-Process -WindowStyle Hidden -FilePath $cloudflared -ArgumentList @(
    "tunnel",
    "--no-autoupdate",
    "--url",
    "http://localhost:$port"
  ) -RedirectStandardOutput $out -RedirectStandardError $err -PassThru

  $url = Wait-ForTunnelUrl $err 45
  Write-Ok "Tunnel ativo: $url"
  return @{ Url = $url; ProcessId = $process.Id; Log = $err }
}

function Test-TunnelHealth($url) {
  $healthUrl = "$url/api/viki-tv-automation/status?requestId=tunnel-health-check"
  $hostName = ([Uri]$url).Host
  $headers = @()
  $motorToken = ([string]$env:VIKI_MOTOR_TOKEN).Trim()
  if ($motorToken) {
    $headers += @("-H", "Authorization: Bearer $motorToken")
  }
  $resolvedIp = $null
  try {
    $resolvedIp = (
      Resolve-DnsName $hostName -Server 1.1.1.1 -Type A -ErrorAction Stop |
        Where-Object { $_.IPAddress } |
        Select-Object -First 1 -ExpandProperty IPAddress
    )
  } catch {
    $resolvedIp = $null
  }
  $deadline = (Get-Date).AddSeconds(30)
  do {
    $health = ""
    try {
      if ($resolvedIp) {
        $health = curl.exe -sS @headers --resolve "$hostName`:443`:$resolvedIp" $healthUrl 2>$null
      } else {
        $health = curl.exe -sS @headers $healthUrl 2>$null
      }
    } catch {
      $health = ""
    }
    $healthText = [string]($health -join "")
    if ($LASTEXITCODE -eq 0 -and $healthText.Contains("requestId")) {
      return $true
    }
    Start-Sleep -Seconds 2
  } while ((Get-Date) -lt $deadline)
  return $false
}

function Find-HealthyExistingTunnel() {
  $logs = Get-ChildItem -Path "artifacts" -Recurse -File -ErrorAction SilentlyContinue |
    Where-Object { $_.Name -match "cloudflared.*\.log$" }
  $urls = @()
  foreach ($log in $logs) {
    $matches = Select-String -Path $log.FullName -Pattern "https://[-a-z0-9]+\.trycloudflare\.com" -AllMatches -ErrorAction SilentlyContinue
    foreach ($match in $matches) {
      foreach ($item in $match.Matches) {
        $urls += $item.Value
      }
    }
  }

  $uniqueUrls = $urls | Select-Object -Unique
  foreach ($url in $uniqueUrls) {
    Write-Info "Verificando tunnel existente: $url"
    if (Test-TunnelHealth $url) {
      return @{ Url = $url; ProcessId = 0; Log = "" }
    }
  }

  return $null
}

function Sync-WorkerSecret($workerDir, $secretName, $secretValue) {
  if (-not (Test-Path $workerDir)) {
    throw "WorkerDir nao encontrado: $workerDir"
  }

  $tmp = New-TemporaryFile
  try {
    Set-Content -Path $tmp -Value $secretValue -NoNewline
    Push-Location $workerDir
    try {
      Get-Content -Raw -Path $tmp | npx wrangler secret put $secretName
    } finally {
      Pop-Location
    }
  } finally {
    Remove-Item -LiteralPath $tmp -Force -ErrorAction SilentlyContinue
  }
}

New-Item -ItemType Directory -Force -Path $LogDir | Out-Null

if (-not ([string]$env:VIKI_MOTOR_TOKEN).Trim()) {
  $env:VIKI_MOTOR_TOKEN = New-MotorToken
  Write-Info "Token do motor gerado para esta execucao."
}

Start-MotorIfNeeded $Port $LogDir $RestartMotor

$tunnel = Find-HealthyExistingTunnel
if ($tunnel) {
  Write-Ok "Reaproveitando tunnel saudavel: $($tunnel.Url)"
} else {
  for ($attempt = 1; $attempt -le 3; $attempt += 1) {
    $candidate = Start-QuickTunnel $Port $LogDir
    Write-Info "Testando motor pelo tunnel (tentativa $attempt/3)..."
    if (Test-TunnelHealth $candidate.Url) {
      $tunnel = $candidate
      break
    }

    Write-Info "Tunnel $($candidate.Url) ainda nao ficou saudavel; encerrando processo $($candidate.ProcessId) e tentando outro."
    Stop-Process -Id $candidate.ProcessId -Force -ErrorAction SilentlyContinue
  }
}

if (-not $tunnel) {
  throw "Nenhum quick tunnel respondeu ao health check."
}
Write-Ok "Motor respondeu pelo tunnel."

Write-Info "Atualizando secret VIKI_PATCHRIGHT_MOTOR_URL no Worker..."
Sync-WorkerSecret $WorkerDir "VIKI_PATCHRIGHT_MOTOR_URL" $tunnel.Url
Write-Ok "Worker apontado para o tunnel atual."

$motorToken = [string]$env:VIKI_MOTOR_TOKEN
if ($motorToken.Trim()) {
  Write-Info "Atualizando secret VIKI_PATCHRIGHT_MOTOR_TOKEN no Worker..."
  Sync-WorkerSecret $WorkerDir "VIKI_PATCHRIGHT_MOTOR_TOKEN" $motorToken.Trim()
  Write-Ok "Token do motor sincronizado."
}

Write-Ok "Fluxo pronto. Clientes continuam chamando o Worker Cloudflare; o Worker chama este motor Patchright pelo tunnel."
Write-Info "Logs: $LogDir"

if (-not $Once) {
  Write-Info "Mantenha esta janela aberta para preservar o tunnel. Pressione Ctrl+C para parar."
  while ($true) {
    Start-Sleep -Seconds 60
  }
}
