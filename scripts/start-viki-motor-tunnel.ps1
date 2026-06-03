param(
  [int]$Port = 3000,
  [string]$WorkerDir = "viki-worker",
  [string]$LogDir = "artifacts\patchright-motor-tunnel",
  [string]$NamedTunnel = "eudorama-motor",
  [string]$PublicMotorUrl = "https://viki-motor.eudorama.com",
  [switch]$SkipMotor,
  [switch]$RestartMotor,
  [switch]$Once
)

$ErrorActionPreference = "Stop"

$RepoRoot = Split-Path -Parent (Split-Path -Parent $PSCommandPath)
Set-Location $RepoRoot

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

function Get-ProcessCommandLine($processId) {
  $process = Get-CimInstance Win32_Process -Filter "ProcessId = $processId" -ErrorAction SilentlyContinue
  if (-not $process) { return "" }
  return [string]$process.CommandLine
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

  $related = Get-CimInstance Win32_Process -ErrorAction SilentlyContinue |
    Where-Object {
      $cmd = [string]$_.CommandLine
      $cmd -match "automation-server\.ts" -or
      $cmd -match "tsx automation-server" -or
      $cmd -match "npx -y tsx" -or
      $cmd -match "run-viki-motor\.ps1"
    } |
    Sort-Object ProcessId -Descending

  foreach ($process in $related) {
    Stop-Process -Id $process.ProcessId -Force -ErrorAction SilentlyContinue
  }

  if ($related.Count -gt 0) {
    Write-Ok "Cadeia anterior do motor encerrada."
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
  Remove-Item -LiteralPath $out, $err -Force -ErrorAction SilentlyContinue
  Write-Info "Iniciando motor Patchright na porta $port..."
  $token = [string]$env:VIKI_MOTOR_TOKEN
  $safeToken = $token.Replace('"', '\"')
  $command = "set PORT=$port&& set VIKI_MOTOR_TOKEN=$safeToken&& npx -y tsx automation-server.ts"
  $process = Start-Process -WindowStyle Hidden -FilePath "cmd.exe" -WorkingDirectory (Get-Location) -ArgumentList @(
    "/d",
    "/s",
    "/c",
    $command
  ) -PassThru

  Start-Sleep -Seconds 2
  if ($process.HasExited) {
    Write-Info "Processo inicial do motor saiu cedo. ExitCode: $($process.ExitCode)."
  }

  $deadline = (Get-Date).AddSeconds(25)
  do {
    if (Test-LocalPort $port) { break }
    Start-Sleep -Seconds 1
  } while ((Get-Date) -lt $deadline)

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

function Start-NamedTunnelIfNeeded($tunnelName, $workerDir, $logDir) {
  $existing = Get-CimInstance Win32_Process -ErrorAction SilentlyContinue |
    Where-Object { ([string]$_.CommandLine) -match "wrangler tunnel run $([regex]::Escape($tunnelName))" } |
    Select-Object -First 1

  if ($existing) {
    Write-Ok "Tunnel nomeado '$tunnelName' ja esta rodando. PID $($existing.ProcessId)."
    return @{ ProcessId = $existing.ProcessId; Log = "" }
  }

  if (-not (Test-Path $workerDir)) {
    throw "WorkerDir nao encontrado para iniciar tunnel nomeado: $workerDir"
  }

  $out = Join-Path $logDir "named-tunnel.out.log"
  $err = Join-Path $logDir "named-tunnel.err.log"
  Remove-Item -LiteralPath $out, $err -Force -ErrorAction SilentlyContinue

  Write-Info "Iniciando Cloudflare tunnel nomeado '$tunnelName'..."
  $command = "npx wrangler tunnel run $tunnelName --log-level info"
  $process = Start-Process -WindowStyle Hidden -FilePath powershell.exe -WorkingDirectory $workerDir -ArgumentList @(
    "-NoProfile",
    "-ExecutionPolicy",
    "Bypass",
    "-Command",
    $command
  ) -RedirectStandardOutput $out -RedirectStandardError $err -PassThru

  Start-Sleep -Seconds 8
  $commandLine = Get-ProcessCommandLine $process.Id
  if (-not $commandLine) {
    throw "Tunnel nomeado '$tunnelName' nao permaneceu rodando. Confira $err"
  }

  Write-Ok "Tunnel nomeado '$tunnelName' iniciado. PID $($process.Id)."
  return @{ ProcessId = $process.Id; Log = $err }
}

function Test-PublicDns($url) {
  try {
    $hostName = ([Uri]$url).Host
    $resolved = Resolve-DnsName $hostName -Type A -ErrorAction Stop
    return [bool]($resolved | Where-Object { $_.IPAddress } | Select-Object -First 1)
  } catch {
    return $false
  }
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

$generatedMotorToken = $false
if (-not ([string]$env:VIKI_MOTOR_TOKEN).Trim()) {
  $env:VIKI_MOTOR_TOKEN = New-MotorToken
  $generatedMotorToken = $true
  Write-Info "Token do motor gerado para esta execucao."
}

if ($SkipMotor) {
  if (-not (Test-LocalPort $Port)) {
    throw "SkipMotor ativo, mas nada esta ouvindo na porta $Port. Inicie o motor antes do tunnel."
  }
  Write-Ok "Motor ja esta ouvindo na porta $Port neste PC."
} else {
  $shouldRestartMotor = $RestartMotor -or ($generatedMotorToken -and (Test-LocalPort $Port))
  if ($generatedMotorToken -and (Test-LocalPort $Port) -and -not $RestartMotor) {
    Write-Info "Motor existente sera reiniciado para usar o token gerado nesta execucao."
  }

  Start-MotorIfNeeded $Port $LogDir $shouldRestartMotor
}

$tunnel = $null

try {
  Start-NamedTunnelIfNeeded $NamedTunnel $WorkerDir $LogDir | Out-Null
  Write-Info "Tunnel nomeado '$NamedTunnel' esta configurado para encaminhar $PublicMotorUrl para este PC em http://localhost:$Port."
  if (Test-PublicDns $PublicMotorUrl) {
    Write-Info "Testando motor pelo tunnel nomeado: $PublicMotorUrl"
    if (Test-TunnelHealth $PublicMotorUrl) {
      $tunnel = @{ Url = $PublicMotorUrl; ProcessId = 0; Log = "" }
      Write-Ok "Tunnel nomeado respondeu pelo dominio fixo."
    } else {
      Write-Info "Dominio fixo existe, mas ainda nao respondeu ao health check."
    }
  } else {
    Write-Info "DNS do dominio fixo ainda nao existe: $PublicMotorUrl"
    $tunnel = @{ Url = $PublicMotorUrl; ProcessId = 0; Log = ""; PendingDns = $true }
  }
} catch {
  Write-Info "Nao foi possivel usar tunnel nomeado agora: $($_.Exception.Message)"
}

if (-not $tunnel) {
  $tunnel = Find-HealthyExistingTunnel
}

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
if ($tunnel.PendingDns) {
  Write-Info "Motor local e tunnel nomeado estao ligados. Falta apenas o DNS apontar para o tunnel."
} else {
  Write-Ok "Motor respondeu pelo tunnel."
}

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
