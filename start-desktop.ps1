# Starts the Wildcraft Electron desktop in development mode.
# It does not start the sensor backend or the YOLO service, and it does not open COM6.

$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent $MyInvocation.MyCommand.Path
$Desktop = Join-Path $Root "desktop"
Set-Location -LiteralPath $Desktop

if (-not (Get-Command npm -ErrorAction SilentlyContinue)) {
  throw "npm was not found. Install Node.js, then reopen PowerShell."
}

if (-not (Test-Path -LiteralPath (Join-Path $Desktop "node_modules"))) {
  Write-Host "Installing desktop dependencies"
  npm install
  if ($LASTEXITCODE -ne 0) {
    throw "Could not install desktop dependencies."
  }
}

Write-Host ""
Write-Host "Wildcraft desktop"
Write-Host "  Sensor backend:  http://127.0.0.1:8000  (start-sensor-backend.ps1)"
Write-Host "  Inference service: http://127.0.0.1:8100  (start-inference.ps1)"
Write-Host "  This window starts only the desktop app."
Write-Host ""

npm run dev
exit $LASTEXITCODE
