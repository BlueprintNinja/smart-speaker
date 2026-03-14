# set-default-model.ps1
# Updates OLLAMA_MODEL in .env to qwen3.5:4b with 4096 context
# Usage: .\scripts\set-default-model.ps1

$envFile = Join-Path $PSScriptRoot "..\\.env"

if (-Not (Test-Path $envFile)) {
    Write-Host "No .env file found at $envFile — copying from .env.example" -ForegroundColor Yellow
    Copy-Item (Join-Path $PSScriptRoot "..\\.env.example") $envFile
}

$content = Get-Content $envFile -Raw

if ($content -match "OLLAMA_MODEL=") {
    $content = $content -replace "OLLAMA_MODEL=.*", "OLLAMA_MODEL=qwen3.5:4b"
    Write-Host "Updated OLLAMA_MODEL to qwen3.5:4b" -ForegroundColor Green
} else {
    $content += "`nOLLAMA_MODEL=qwen3.5:4b`n"
    Write-Host "Added OLLAMA_MODEL=qwen3.5:4b" -ForegroundColor Green
}

Set-Content $envFile $content -NoNewline
Write-Host "Done. Run: docker compose up -d --build backend" -ForegroundColor Cyan
