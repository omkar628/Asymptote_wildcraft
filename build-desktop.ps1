# Builds the Wildcraft Windows installer.
# The installer contains the Electron interface only.
# Python, PyTorch, Ultralytics, OpenCV, and best.pt stay outside the installer
# and are started with start-inference.ps1.

$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent $MyInvocation.MyCommand.Path
$Desktop = Join-Path $Root "desktop"
Set-Location -LiteralPath $Desktop

if (-not (Get-Command npm -ErrorAction SilentlyContinue)) {
  throw "npm was not found. Install Node.js, then reopen PowerShell."
}

Write-Host "Installing desktop dependencies"
npm install
if ($LASTEXITCODE -ne 0) {
  throw "Could not install desktop dependencies."
}

Write-Host "Typechecking, bundling, and packaging"
npm run dist
if ($LASTEXITCODE -ne 0) {
  throw "The desktop build failed."
}

Write-Host ""
Write-Host "Installer output: desktop\release"
Write-Host "The installer does not include the Python inference environment or best.pt."
Write-Host "On a machine without internet, install those first, then run start-inference.ps1 before opening Wildcraft."
exit 0
