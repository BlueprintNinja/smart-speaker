# patch-ha-config.ps1
# Adds the homeassistant packages include to ha-config/configuration.yaml
# Safe to run multiple times — checks before patching.

$configPath = "$PSScriptRoot\..\ha-config\configuration.yaml"

if (-not (Test-Path $configPath)) {
    Write-Host "ERROR: $configPath not found. Is HA running and ha-config initialized?" -ForegroundColor Red
    exit 1
}

$content = Get-Content $configPath -Raw

if ($content -match "packages: !include_dir_named packages") {
    Write-Host "OK: packages include already present in configuration.yaml" -ForegroundColor Green
    exit 0
}

# Prepend the homeassistant: block before default_config
$patch = @"
homeassistant:
  packages: !include_dir_named packages

"@

$newContent = $patch + $content
Set-Content $configPath $newContent -NoNewline

Write-Host "PATCHED: Added packages include to configuration.yaml" -ForegroundColor Green
Write-Host "Restart Home Assistant to apply: docker compose restart homeassistant" -ForegroundColor Yellow
