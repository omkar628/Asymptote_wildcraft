# Starts one local YOLO inference service on 127.0.0.1:8100.
# It reads the selected USB webcam, or an optional MJPEG URL, and weights\best.pt.
# It does not open COM6. A local webcam does not need an ESP32-CAM address.
# If port 8100 is already serving /health, this script does not start a second process.
# Pass -Restart to stop the existing inference process and start one replacement.

param(
  [switch]$Restart
)

$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent $MyInvocation.MyCommand.Path
$Inference = Join-Path $Root "inference"
Set-Location -LiteralPath $Inference

function Test-InferenceCommandLine([string]$CommandLine) {
  if ($CommandLine -match 'backend\\main\.py|backend/main\.py|\bmain\.py\b') {
    return $false
  }
  $trimmed = $CommandLine.Trim()
  return $trimmed -match 'wildcraft_inference|\\inference\\app\.py|/inference/app\.py|\\inference\\.venv\\|app\.py$'
}

if ($Restart) {
  $listeners = @(Get-NetTCPConnection -LocalPort 8100 -State Listen -ErrorAction SilentlyContinue)
  $ownerIds = @($listeners | Select-Object -ExpandProperty OwningProcess -Unique)
  foreach ($procId in $ownerIds) {
    $proc = Get-CimInstance Win32_Process -Filter "ProcessId=$procId" -ErrorAction SilentlyContinue
    $commandLine = [string]($proc.CommandLine)
    if (-not (Test-InferenceCommandLine $commandLine)) {
      throw "Port 8100 is used by PID $procId, which is not the Wildcraft inference service. Not stopping it. Command: $commandLine"
    }
    Write-Host "Stopping the inference process on port 8100 (PID $procId)."
    Stop-Process -Id $procId -Force
  }
  if ($ownerIds.Count -gt 0) {
    Start-Sleep -Seconds 1
  }
}

try {
  $health = Invoke-WebRequest -Uri "http://127.0.0.1:8100/health" -UseBasicParsing -TimeoutSec 2
  if ($health.StatusCode -eq 200) {
    Write-Host "Inference service is already running on port 8100. Not starting another one."
    Write-Host "Run start-inference.ps1 -Restart to replace that single process after a configuration change."
    exit 0
  }
} catch {
  # Port is free or the listener is not the inference service.
}

$PythonCommand = $null
$PythonArgs = @()
if (Get-Command python -ErrorAction SilentlyContinue) {
  $PythonCommand = "python"
} elseif (Get-Command py -ErrorAction SilentlyContinue) {
  $PythonCommand = "py"
  $PythonArgs = @("-3")
} else {
  throw "Python was not found. Install Python 3.10 or newer, then reopen PowerShell."
}

$VenvPython = Join-Path $Inference ".venv\Scripts\python.exe"
if (-not (Test-Path -LiteralPath $VenvPython)) {
  Write-Host "Creating a virtual environment in inference\.venv"
  & $PythonCommand @PythonArgs -m venv .venv
  if ($LASTEXITCODE -ne 0) {
    throw "Could not create the virtual environment."
  }
}

& $VenvPython -c "import fastapi, uvicorn, cv2, ultralytics, torch"
if ($LASTEXITCODE -eq 0) {
  Write-Host "Inference packages are already installed. Skipping pip."
} else {
  Write-Host "Checking Python packages. The first install downloads PyTorch and can take a long time."
  & $VenvPython -m pip install -r requirements.txt
  if ($LASTEXITCODE -ne 0) {
    throw "Could not install inference requirements."
  }
}

$env:YOLO_OFFLINE = "true"
$env:WILDCRAFT_INFERENCE_HOST = "127.0.0.1"
if (-not $env:WILDCRAFT_INFERENCE_PORT) {
  $env:WILDCRAFT_INFERENCE_PORT = "8100"
}

Write-Host ""
Write-Host "Wildcraft inference"
Write-Host "  http://127.0.0.1:8100"
Write-Host "  Model default: $Root\weights\best.pt"
Write-Host "  YOLO_OFFLINE=true. Weights are loaded from disk and are not downloaded."
Write-Host "  Local webcam mode does not need an ESP32-CAM address."
Write-Host "  COM6 is not opened. The sensor backend owns that port."
Write-Host "  Press Ctrl+C to stop."
Write-Host ""

& $VenvPython app.py
exit $LASTEXITCODE
