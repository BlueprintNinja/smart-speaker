# patch-ha-config.ps1
# Patches ha-config for Ray's Berry Farm smart speaker setup.
# Safe to run multiple times — checks before each patch.

$root       = "$PSScriptRoot\.."
$configPath = "$root\ha-config\configuration.yaml"
$lovelaceSrc = "$root\ha-config-templates\farm_lovelace.yaml"
$lovelaceDst = "$root\ha-config\farm_lovelace.yaml"

if (-not (Test-Path $configPath)) {
    Write-Host "ERROR: $configPath not found. Is HA running and ha-config initialized?" -ForegroundColor Red
    exit 1
}

# --- Patch 1: packages include ---
$content = Get-Content $configPath -Raw
if ($content -match "packages: !include_dir_named packages") {
    Write-Host "OK: packages include already present in configuration.yaml" -ForegroundColor Green
} else {
    $patch = @"
homeassistant:
  packages: !include_dir_named packages

"@
    $newContent = $patch + $content
    Set-Content $configPath $newContent -NoNewline
    Write-Host "PATCHED: Added packages include to configuration.yaml" -ForegroundColor Green
}

# --- Patch 2: farm_lovelace.yaml (always overwrite to pick up template updates) ---
Copy-Item $lovelaceSrc $lovelaceDst -Force
Write-Host "PATCHED: Copied farm_lovelace.yaml to ha-config" -ForegroundColor Green

# --- Patch 3: Copy ha-packages into ha-config/packages ---
$pkgSrc = "$root\ha-packages"
$pkgDst = "$root\ha-config\packages"
if (-not (Test-Path $pkgDst)) { New-Item -ItemType Directory -Path $pkgDst -Force | Out-Null }
Get-ChildItem $pkgSrc -Filter "*.yaml" | ForEach-Object {
    Copy-Item $_.FullName "$pkgDst\$($_.Name)" -Force
    Write-Host "PATCHED: Copied $($_.Name) to ha-config/packages" -ForegroundColor Green
}

Write-Host ""
Write-Host "Restart Home Assistant to apply all changes:" -ForegroundColor Yellow
Write-Host "  docker compose restart homeassistant" -ForegroundColor Cyan
