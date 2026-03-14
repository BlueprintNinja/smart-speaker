# set-default-model.ps1
# Updates OLLAMA_MODEL in .env to qwen3.5:4b
# Usage: .\scripts\set-default-model.ps1

$envFile = Join-Path $PSScriptRoot "..\.env"
$exampleFile = Join-Path $PSScriptRoot "..\.env.example"

if (-Not (Test-Path $envFile)) {
    Write-Host "No .env found, copying from .env.example" -ForegroundColor Yellow
    Copy-Item $exampleFile $envFile
}

$lines = Get-Content $envFile
$found = $false
$output = @()

foreach ($line in $lines) {
    if ($line -match "^OLLAMA_MODEL=") {
        $output += "OLLAMA_MODEL=qwen3.5:4b"
        $found = $true
    } else {
        $output += $line
    }
}

if (-not $found) {
    $output += "OLLAMA_MODEL=qwen3.5:4b"
}

$output | Set-Content $envFile
Write-Host "OLLAMA_MODEL set to qwen3.5:4b" -ForegroundColor Green
Write-Host "Now run: docker compose up -d --build backend" -ForegroundColor Cyan
