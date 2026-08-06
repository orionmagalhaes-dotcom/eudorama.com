$repoRoot = Join-Path $env:USERPROFILE "Documents\Projetos\Eudorama\eudorama.com"
$tokenPath = Join-Path $repoRoot "artifacts\last-motor-token.txt"
$token = (Get-Content $tokenPath -Raw -ErrorAction SilentlyContinue)
if ($token) { $token = $token.Trim() }

Write-Host "Token do arquivo: [$token]"
Write-Host ""

Write-Host "=== Sem token ==="
$r = curl.exe -sv --connect-timeout 5 --max-time 8 "http://localhost:3000/api/viki-tv-automation/status?requestId=diag-noauth" 2>&1
Write-Host ($r -join "`n")
Write-Host ""

Write-Host "=== Com token do arquivo ==="
$r2 = curl.exe -sv --connect-timeout 5 --max-time 8 -H "Authorization: Bearer $token" "http://localhost:3000/api/viki-tv-automation/status?requestId=diag-auth" 2>&1
Write-Host ($r2 -join "`n")
