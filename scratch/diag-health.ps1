$repoRoot = Join-Path $env:USERPROFILE "Documents\Projetos\Eudorama\eudorama.com"
$tokenPath = Join-Path $repoRoot "artifacts\last-motor-token.txt"
$token = (Get-Content $tokenPath -Raw -ErrorAction SilentlyContinue)
if ($token) { $token = $token.Trim() }
Write-Host "Token (primeiros 15 chars): $($token.Substring(0, [Math]::Min(15, $token.Length)))..."
Write-Host "Token length: $($token.Length)"
Write-Host ""

# Teste local sem token
Write-Host "=== Teste local SEM token ==="
$r = curl.exe -sS --connect-timeout 5 --max-time 8 "http://localhost:3000/api/viki-tv-automation/status?requestId=diag-noauth" 2>&1
Write-Host "Resposta: $($r -join '')"
Write-Host ""

# Teste local COM token
Write-Host "=== Teste local COM token ==="
$r2 = curl.exe -sS --connect-timeout 5 --max-time 8 -H "Authorization: Bearer $token" "http://localhost:3000/api/viki-tv-automation/status?requestId=diag-auth" 2>&1
Write-Host "Resposta: $($r2 -join '')"
Write-Host ""

# Teste pelo tunnel (ultimo URL usado)
$tunnelUrl = "https://hello-syracuse-stable-allergy.trycloudflare.com"
Write-Host "=== Teste pelo tunnel $tunnelUrl ==="
$r3 = curl.exe -sS --connect-timeout 15 --max-time 20 -H "Authorization: Bearer $token" "$tunnelUrl/api/viki-tv-automation/status?requestId=diag-tunnel" 2>&1
Write-Host "Resposta: $($r3 -join '')"
