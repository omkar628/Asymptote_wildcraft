# Starts the forest sensor API and the COM6 serial collector in one window.
# Close the Arduino Serial Monitor and PlatformIO device monitor before running this script.
# Those programs own COM6. This collector cannot read the receiver while either one is open.
# Ctrl+C stops the service. This script does not stop other programs.

$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent $MyInvocation.MyCommand.Path
$Backend = Join-Path $Root "backend"
Set-Location -LiteralPath $Backend

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

$VenvPython = Join-Path $Backend ".venv\Scripts\python.exe"
if (-not (Test-Path -LiteralPath $VenvPython)) {
  Write-Host "Creating a virtual environment in backend\.venv"
  & $PythonCommand @PythonArgs -m venv .venv
  if ($LASTEXITCODE -ne 0) {
    throw "Could not create the virtual environment."
  }
}

Write-Host "Checking Python packages"
& $VenvPython -m pip install -r requirements.txt
if ($LASTEXITCODE -ne 0) {
  throw "Could not install backend requirements."
}

$wifi = Get-NetIPAddress -AddressFamily IPv4 -InterfaceAlias "Wi-Fi" -ErrorAction SilentlyContinue |
  Where-Object { $_.IPAddress -notlike "169.254.*" } |
  Select-Object -First 1

Write-Host ""
Write-Host "Forest sensor backend"
Write-Host "  Close PlatformIO device monitor and the Arduino Serial Monitor if either one is using COM6."
Write-Host "  Default serial port: COM6 at 115200 baud."
Write-Host "  Logging continues while the phone is disconnected."
if ($wifi) {
  Write-Host "  Phone URL: http://$($wifi.IPAddress):8000"
  Write-Host "  Phone WebSocket: ws://$($wifi.IPAddress):8000/ws/sensors"
} else {
  Write-Host "  Phone URL: run ipconfig and use the Wi-Fi IPv4 address with port 8000."
}
Write-Host "  Press Ctrl+C to stop."
Write-Host ""

& $VenvPython main.py
exit $LASTEXITCODE
