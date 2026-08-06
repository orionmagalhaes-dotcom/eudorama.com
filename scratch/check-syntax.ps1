$scriptPath = Join-Path $env:USERPROFILE "Documents\Projetos\Eudorama\eudorama.com\scripts\start-viki-motor-tunnel.ps1"
Write-Host "Verificando: $scriptPath"

$errors = $null
$tokens = $null
$ast = [System.Management.Automation.Language.Parser]::ParseFile(
    $scriptPath,
    [ref]$tokens,
    [ref]$errors
)
if ($errors.Count -eq 0) {
    Write-Host "OK: sem erros de sintaxe"
} else {
    Write-Host "ERROS ($($errors.Count)):"
    foreach ($e in $errors) {
        Write-Host "  Linha $($e.Extent.StartLineNumber): $($e.Message)"
    }
}
