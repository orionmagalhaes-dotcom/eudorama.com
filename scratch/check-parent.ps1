$targetPid = 16076
$current = $targetPid
for ($i = 0; $i -lt 10; $i++) {
    $proc = Get-CimInstance Win32_Process -Filter "ProcessId = $current" -ErrorAction SilentlyContinue
    if (-not $proc) { break }
    Write-Host ("  " * $i + "PID=$($proc.ProcessId) Name=$($proc.Name) ParentPID=$($proc.ParentProcessId) CMD=$($proc.CommandLine)")
    $current = $proc.ParentProcessId
    if ($current -le 4) { break }
}
