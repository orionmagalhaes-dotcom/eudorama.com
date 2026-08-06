$hostName = "mysimon-clara-affecting-usb.trycloudflare.com"
$healthUrl = "https://$hostName/api/viki-tv-automation/status?requestId=dns-test"

Write-Host "=== Resolve via 1.1.1.1 ==="
$resolved = Resolve-DnsName $hostName -Server 1.1.1.1 -Type A -ErrorAction SilentlyContinue |
    Where-Object { $_.IPAddress } |
    Select-Object -First 1 -ExpandProperty IPAddress
Write-Host "IP resolvido: $resolved"
Write-Host ""

Write-Host "=== Curl com --resolve ==="
$resolveFlag = "${hostName}:443:${resolved}"
Write-Host "Flag: --resolve $resolveFlag"
$r = curl.exe -v --connect-timeout 10 --max-time 20 --resolve $resolveFlag $healthUrl 2>&1
Write-Host ($r -join "`n")
Write-Host ""

Write-Host "=== Curl com --dns-servers 1.1.1.1 ==="
$r2 = curl.exe -v --connect-timeout 10 --max-time 20 --dns-servers 1.1.1.1 $healthUrl 2>&1
Write-Host ($r2 -join "`n")
