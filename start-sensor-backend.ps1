# Starts the forest sensor API and the COM6 serial collector in one window.
# If port 8000 already answers /health as this API, the script leaves that process running.
# Pass -Restart to stop the verified Wildcraft sensor process and start one replacement.
# A listener that is not this backend is never stopped.
# Close the Arduino Serial Monitor and PlatformIO device monitor before running this script.
# Those programs own COM6. This collector cannot read the receiver while either one is open.
# Ctrl+C stops the service.

param(
  [switch]$Restart
)

$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent $MyInvocation.MyCommand.Path
$Backend = Join-Path $Root "backend"
Set-Location -LiteralPath $Backend

function Test-SensorBackendCommandLine([string]$CommandLine) {
  if ([string]::IsNullOrWhiteSpace($CommandLine)) {
    return $false
  }
  if ($CommandLine -match '(?i)wildcraft_inference|\\inference\\app\.py|/inference/app\.py') {
    return $false
  }
  $isMain = $CommandLine -match '(?i)(^|[\s\"])main\.py([\s\"]|$)'
  if (-not $isMain) {
    return $false
  }
  return $CommandLine -match '(?i)wildcraft_project\\backend|wildcraft_project/backend|\\backend\\.venv\\|/backend/\.venv/'
}

function Get-SensorBackendProcess([int]$ProcessId) {
  if ($ProcessId -le 0) {
    return $null
  }
  return Get-CimInstance Win32_Process -Filter "ProcessId=$ProcessId" -ErrorAction SilentlyContinue
}

function Test-SensorBackendProcess($Process) {
  if (-not $Process) {
    return $false
  }
  $commandLine = [string]$Process.CommandLine
  if (Test-SensorBackendCommandLine $commandLine) {
    return $true
  }
  if ($commandLine -notmatch '(?i)(^|[\s\"])main\.py([\s\"]|$)') {
    return $false
  }
  if ($commandLine -match '(?i)wildcraft_inference|\\inference\\app\.py|/inference/app\.py') {
    return $false
  }
  $parent = Get-SensorBackendProcess ([int]$Process.ParentProcessId)
  return (Test-SensorBackendCommandLine ([string]$parent.CommandLine))
}

function Get-Port8000Listeners {
  @(Get-NetTCPConnection -LocalPort 8000 -State Listen -ErrorAction SilentlyContinue |
    Where-Object { $_.OwningProcess -gt 0 })
}

function Test-SensorBackendHealth {
  try {
    $health = Invoke-WebRequest -Uri "http://127.0.0.1:8000/health" -UseBasicParsing -TimeoutSec 2
    if ($health.StatusCode -ne 200) {
      return $false
    }
    $body = $health.Content | ConvertFrom-Json
    return ($body.status -eq "ok" -and $body.api -eq "running")
  } catch {
    return $false
  }
}

function Stop-VerifiedSensorBackend {
  $listeners = @(Get-Port8000Listeners)
  $ownerIds = @($listeners | Select-Object -ExpandProperty OwningProcess -Unique)
  $stopped = @()
  foreach ($procId in $ownerIds) {
    $proc = Get-SensorBackendProcess ([int]$procId)
    $commandLine = [string]$proc.CommandLine
    if (-not (Test-SensorBackendProcess $proc)) {
      throw "Port 8000 is used by PID $procId, which is not the Wildcraft sensor backend. Not stopping it. Command: $commandLine"
    }
    $parent = Get-SensorBackendProcess ([int]$proc.ParentProcessId)
    if ($parent -and (Test-SensorBackendCommandLine ([string]$parent.CommandLine))) {
      $parentId = [int]$parent.ProcessId
      if ($stopped -notcontains $parentId) {
        Write-Host "Stopping the Wildcraft sensor backend parent on port 8000 (PID $parentId)."
        Stop-Process -Id $parentId -Force -ErrorAction SilentlyContinue
        $stopped += $parentId
      }
    }
    if ($stopped -notcontains ([int]$procId)) {
      Write-Host "Stopping the Wildcraft sensor backend on port 8000 (PID $procId)."
      Stop-Process -Id $procId -Force -ErrorAction SilentlyContinue
      $stopped += [int]$procId
    }
  }
  if ($ownerIds.Count -eq 0) {
    return
  }
  $deadline = (Get-Date).AddSeconds(8)
  do {
    $still = @(Get-Port8000Listeners)
    if ($still.Count -eq 0) {
      return
    }
    Start-Sleep -Milliseconds 300
  } while ((Get-Date) -lt $deadline)
  $remaining = @(Get-Port8000Listeners | Select-Object -ExpandProperty OwningProcess -Unique)
  throw "Port 8000 is still in use after stopping the verified Wildcraft sensor backend. PID: $($remaining -join ', ')"
}

if ($Restart) {
  Stop-VerifiedSensorBackend
}

if (Test-SensorBackendHealth) {
  Write-Host "Sensor backend is already running on port 8000. Not starting another one."
  Write-Host "Run start-sensor-backend.ps1 -Restart to replace that Wildcraft process after a code change."
  exit 0
}

$listeners = @(Get-Port8000Listeners)
if ($listeners.Count -gt 0) {
  $ownerIds = @($listeners | Select-Object -ExpandProperty OwningProcess -Unique)
  $descriptions = @()
  $verified = $true
  foreach ($procId in $ownerIds) {
    $proc = Get-SensorBackendProcess ([int]$procId)
    $commandLine = [string]$proc.CommandLine
    $descriptions += "PID $procId $commandLine"
    if (-not (Test-SensorBackendProcess $proc)) {
      $verified = $false
    }
  }
  $detail = $descriptions -join "; "
  if (-not $verified) {
    throw "Port 8000 is already in use by a process that is not the Wildcraft sensor backend. Not starting a second copy and not stopping it. $detail"
  }
  throw "The Wildcraft sensor backend on port 8000 did not answer /health. Not starting a second copy. Run start-sensor-backend.ps1 -Restart to stop that verified process and start its replacement. $detail"
}

$PythonCommand = $null
$PythonArgs = @()
if (Get-Command python -ErrorAction SilentlyContinue) {
  $PythonCommand = "python"
} elseif (Get-Command py -ErrorAction SilentlyContinue) {
  $PythonArgs = @("-3")
  $PythonCommand = "py"
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
