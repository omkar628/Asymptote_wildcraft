# Forest sensor backend

Local API and USB serial collector for the ESP8266 NodeMCU receiver. The phone does not open the serial port. The full phone and Windows setup is in `FOREST_SENSOR_SETUP.md` at the project root.

## Data flow

The receiver prints lines like:

```text
Received packet: Temp:31.70,Hum:45.70,MQ135:418,MQ9:479
RSSI: -32
-----------------------------------
```

`serial_collector.py` attaches each `RSSI` line to the packet line before it, adds a local timestamp, and appends the row to `data/sensor_readings.csv`. `main.py` serves that data over HTTP and WebSocket. Logging continues when no phone is connected.

MQ135 and MQ9 are stored as raw receiver numbers. This service does not convert them to gas concentrations and does not declare a fire.

## Run

Close the Arduino Serial Monitor first. From the project root:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\start-sensor-backend.ps1
```

Or from this folder, after the virtual environment exists:

```powershell
.\.venv\Scripts\python.exe main.py
```

Use that virtual environment. A system Python with an older uvicorn can answer the HTTP routes and still reject `/ws/sensors`. `requirements.txt` includes `websockets` so this environment can accept the phone's live connection.

Defaults are `COM6` at `115200` baud, bound to `0.0.0.0:8000` for the local network. Do not forward that port on a router.

Stop the service with Ctrl+C in its window.

## Settings

Copy `.env.example` to `.env`, or set the variables in PowerShell before starting. Shell variables override the file.

| Variable | Default | Purpose |
| --- | --- | --- |
| `SENSOR_SERIAL_PORT` | `COM6` | Serial port |
| `SENSOR_BAUD_RATE` | `115200` | Serial baud |
| `SENSOR_SERIAL_ENABLED` | `1` | Set `0` to run the API without opening a port |
| `SENSOR_API_HOST` | `0.0.0.0` | Local bind address |
| `SENSOR_API_PORT` | `8000` | HTTP and WebSocket port |
| `SENSOR_CSV_PATH` | `backend/data/sensor_readings.csv` | Append-only log |
| `SENSOR_ALERT_TEMP_C_HIGH` | unset | Optional temperature rule |
| `SENSOR_ALERT_HUMIDITY_LOW` | unset | Optional humidity rule |
| `SENSOR_ALERT_MQ135_RAW_HIGH` | unset | Optional raw MQ135 rule |
| `SENSOR_ALERT_MQ9_RAW_HIGH` | unset | Optional raw MQ9 rule |
| `SENSOR_ALERT_RSSI_DBM_LOW` | unset | Optional link-quality rule |
| `SENSOR_ALLOW_TEST_INJECT` | `0` | Keep off. Allows labeled synthetic WebSocket traffic that is not saved |

Leave every `SENSOR_ALERT_*` value unset until you choose the number. Empty rules produce no alerts. An alert is a threshold comparison, not a confirmed fire.

## Endpoints

- `GET /health`
- `GET /api/sensors/latest`
- `GET /api/sensors/history?limit=120`
- `GET /api/status`
- `WS /ws/sensors`

History returns the newest rows kept in memory, oldest first inside that window. The CSV file is the longer log. The default history limit is 120 and the maximum is 500.

## Tests

From this folder:

```powershell
.\.venv\Scripts\python.exe -m unittest discover -s tests -t . -v
```

Tests use temporary CSV files and do not open COM6. Synthetic WebSocket rows are labeled `source: test` and are not written to the log.
