# Forest sensor setup

This connects the existing Tadoba Forest Watch Expo app to the ESP8266 NodeMCU receiver. The phone reads a laptop API. It does not open COM6.

The receiver firmware already on the board is left as it is. `ForestSensorFirmware/src` in this workspace has no `main.cpp`, and nothing here uploads new firmware.

## Architecture

```text
ESP8266 NodeMCU receiver
    USB serial COM6, 115200 baud
Windows laptop, Python collector
    append-only CSV
Local FastAPI server and WebSocket
    same Wi-Fi, not a public port
Existing Expo app
    Sensors tab
```

The collector keeps reading and writing the CSV when the phone is closed.

The serial text this parser accepts is:

```text
Received packet: Temp:31.70,Hum:45.70,MQ135:418,MQ9:479
RSSI: -32
-----------------------------------
```

Temperature is shown in °C and humidity as relative humidity, which is how those fields are labeled by the receiver. MQ135 and MQ9 stay raw. RSSI is shown as dBm because the ESP8266 RSSI value is in dBm and the printed numbers are negative. The firmware source is not in this workspace, so that unit is inferred from the ESP8266 scale and the printed field, not from a local firmware comment.

No gas concentration, map location, or battery reading is invented. A preliminary alert appears only after you set a threshold. It is not an AI fire detection and it is not a verified incident.

## Files created

Backend:

- `backend/main.py` — FastAPI app, WebSocket, and process startup
- `backend/serial_collector.py` — parser, CSV log, serial thread
- `backend/alerts.py` — optional threshold rules
- `backend/config.py` — environment settings
- `backend/requirements.txt`
- `backend/.env.example`
- `backend/README.md`
- `backend/data/.gitkeep`
- `backend/tests/` — parser, CSV, alert, and API tests

App:

- `src/app/live.tsx` — redirects `/live` to the Sensors tab
- `src/features/live/` — dashboard, charts, alerts, settings
- `src/services/sensors/` — HTTP client, WebSocket, thresholds, stored address
- `src/types/liveSensor.ts`
- `src/utils/sensorFormat.ts`
- `.env.example`

Startup:

- `start-sensor-backend.ps1`

## Files modified

- `src/app/(tabs)/sensors.tsx` — the Sensors tab now renders the live dashboard instead of the demonstration catalog.
- `src/features/sensors/SensorsScreen.tsx` — demonstration catalog kept in the project. It is not the Sensors tab.
- `src/components/Icon.tsx` — adds the signal icon.
- `package.json` and `package-lock.json` — `@react-native-async-storage/async-storage` at 2.2.0, used to remember the laptop address and phone thresholds.
- `.gitignore` — ignores `.env`, the Python virtual environment, and CSV logs.
- `backend/requirements.txt` — adds `websockets==16.0` so uvicorn can accept `/ws/sensors`.

Charts use `react-native-svg`, which the app already had. No second chart library was added.

The existing tabs, map, alerts, reports, and sensor catalog are still in place.

## Install

Backend, from the project root:

```powershell
cd F:\wildcraft_project\backend
python -m venv .venv
.\.venv\Scripts\python.exe -m pip install -r requirements.txt
```

The startup script creates the virtual environment and installs those packages when they are missing. Python 3.10 or newer is required. This machine has Python 3.10.8. The `py` launcher is not installed, so use `python`.

Mobile dependencies are already in the repo. After pulling these changes, from the project root:

```powershell
cd F:\wildcraft_project
npm install
```

## Start the backend

1. Plug in the NodeMCU receiver.
2. Close the Arduino IDE Serial Monitor. It keeps COM6 open, and the collector cannot share it.
3. Start the backend:

```powershell
cd F:\wildcraft_project
powershell -NoProfile -ExecutionPolicy Bypass -File .\start-sensor-backend.ps1
```

That one window runs the API and the serial collector. Leave it open. Press Ctrl+C to stop it. The script does not close other programs and does not change Windows Firewall.

You should see the CSV path, then either `Connected to COM6` or a message that the port is busy and the collector will retry. A real packet looks like:

```text
[sensor] 2026-10-11T18:04:01.123+05:30 Temp=31.70 Hum=45.70 MQ135=418 MQ9=479 RSSI=-32
```

If you only want the API, with the virtual environment already installed:

```powershell
cd F:\wildcraft_project\backend
.\.venv\Scripts\python.exe main.py
```

## Start the mobile app

In a second PowerShell window:

```powershell
cd F:\wildcraft_project
npm start
```

Open the project in Expo Go on the phone, or press `a` for an Android emulator if you use one. Then open the **Sensors** tab.

The overview, map, alerts, and reports screens still use the demonstration catalog. The Sensors tab does not. It shows only readings returned by this backend. The laptop address field is on that screen. Overview status counts open this same Sensors tab. They no longer open a filtered demonstration list.

## Laptop address

`localhost` on the phone is the phone, not the laptop. Find the laptop's Wi-Fi IPv4 address:

```powershell
ipconfig
```

Use the **IPv4 Address** under the wireless adapter you are actually using. The addresses below are only examples of the shape. Do not assume they are your network.

If `ipconfig` showed `192.168.1.10` and the API is on port 8000:

- HTTP base: `http://192.168.1.10:8000`
- WebSocket: `ws://192.168.1.10:8000/ws/sensors`

Put the HTTP base in either place:

- The **Laptop address** field on the Sensors tab. Save it. The app remembers it on the phone.
- Or `F:\wildcraft_project\.env`, copied from `.env.example`:

```text
EXPO_PUBLIC_SENSOR_API_BASE=http://192.168.1.10:8000
```

Restart Expo after changing `.env`. A value typed in the app overrides the bundled value until you change it again.

The phone and laptop need a path to each other. On a normal home or office Wi-Fi, that means the same network. If the phone is on cellular data only, or the laptop is on a VPN that hides the LAN, the app cannot receive packets. There is no offline shortcut that invents readings.

Android emulator only: `http://10.0.2.2:8000` reaches the computer running the emulator. A physical phone cannot use `10.0.2.2`.

You can check the laptop side in a browser on the laptop:

```text
http://127.0.0.1:8000/health
http://127.0.0.1:8000/api/sensors/latest
```

`127.0.0.1` works in the laptop browser. It does not work as the phone's address.

## Windows Firewall

The server listens on port 8000 for the local network. Do not add a router port-forward.

If the phone cannot connect while the laptop browser can:

1. When Windows asks whether Python may communicate on private networks, allow private networks only.
2. Or open Windows Security, Firewall & network protection, Allow an app through firewall, and allow the virtual environment's `python.exe` on private networks.
3. Confirm the phone and laptop are on the same Wi-Fi and that the address is the Wi-Fi IPv4 address, not a VirtualBox, WSL, or Bluetooth adapter.

This setup does not change firewall rules for you.

## CSV log

Path:

```text
F:\wildcraft_project\backend\data\sensor_readings.csv
```

Columns: `timestamp,temp_c,humidity_percent,mq135_raw,mq9_raw,rssi_dbm`.

The file is append-only. Restarting the backend keeps existing rows. A file whose header does not match is left unchanged and the process stops, so an old spreadsheet is not overwritten. Do not open the file in Excel while the collector is running, because Windows can lock it. The API can still show a new packet if a write fails, and the backend window says the row was not saved.

A header-only file may already exist from a local test import. It has no sensor values in it.

## COM6 troubleshooting

The port list on this PC included `COM6` as `USB Serial Port (COM6)`. Opening it from the tests returned `PermissionError: Access is denied`. Another program, usually the Arduino Serial Monitor, already had the port. Close that monitor and start the backend again.

Other checks:

- Device Manager should show the NodeMCU as a USB serial port. If Windows gives it a new number, set `SENSOR_SERIAL_PORT` in `backend/.env` or in the shell before startup.
- The baud rate must stay `115200`.
- Unplug and replug the board only after the backend is stopped.
- Malformed lines are ignored and counted in the backend window. They are not stored.
- A packet that arrives without a following RSSI line is stored only when the next packet starts, and its RSSI cell is empty.

## WebSocket process

`/ws/sensors` needs the backend virtual environment. `requirements.txt` installs `websockets` with uvicorn 0.54. Start the API with `start-sensor-backend.ps1` or `backend\.venv\Scripts\python.exe main.py`.

A server started with the system `python` can still serve `/health` and `/api/sensors/*` while rejecting the WebSocket upgrade. If the phone stays on Disconnected or Retry, check which Python is running `main.py`, stop that window with Ctrl+C, and start it again from the virtual environment. Do that only when you can close the current collector. The serial port cannot be opened by two programs.

## Thresholds

No danger numbers are built in. To arm a laptop rule, set one of the `SENSOR_ALERT_*` variables in `backend/.env` and restart the backend. The Sensors tab can also store optional thresholds on the phone. Blank fields stay off.

While a rule matches, one preliminary card stays on screen. A new packet does not add another copy of the same card. Clearing the condition removes it.

These cards are separate from the demonstration alerts already in the app.

## Verify a real reading

1. Backend window shows `Connected to COM6`.
2. A `[sensor]` line shows Temp, Hum, MQ135, MQ9, and RSSI from the board.
3. `backend\data\sensor_readings.csv` gains that row.
4. `http://127.0.0.1:8000/api/sensors/latest` returns `"empty": false` and `"source": "serial"`.
5. The phone shows the same numbers without a manual refresh.

Until those steps succeed, the dashboard's empty state is the honest state.

## Stop

- Backend: Ctrl+C in the window running `start-sensor-backend.ps1` or `main.py`. The serial port is closed on the way out.
- Expo: Ctrl+C in the `npm start` window.

## What was tested

Tested on this PC:

- Python compile check.
- 26 unit tests: sample packet parsing, RSSI association, malformed lines, CSV append and header protection, health, latest, history limits, status, logging with no WebSocket client, and a WebSocket message marked `synthetic: true` / `source: test`. That synthetic message was not written to the CSV.
- `npx tsc --noEmit` passed after the Sensors tab was switched to the live dashboard.
- Android JS bundle succeeded: `npx expo export --platform android` completed and wrote the bundle outside the repo.
- PowerShell parsed `start-sensor-backend.ps1` without syntax errors.
- On 11 Oct 2026 a collector was already running (`python main.py`, system Python, pid 38816, started 17:33 local). It reported serial `connected` on `COM6` at `115200`. `GET /health`, `GET /api/sensors/latest`, `GET /api/sensors/history`, and `GET /api/status` on `http://127.0.0.1:8000` returned real `source: serial` readings. `backend\data\sensor_readings.csv` had those rows. That process was left running.
- The same process returned HTTP 404 for `/ws/sensors`. Its uvicorn is 0.27.1. The project virtual environment is uvicorn 0.54.0 and did not have a WebSocket library. `websockets==16.0` was added to `backend/requirements.txt` and installed in `backend\.venv`.
- A second process was started from the virtual environment on port 8001 with serial disabled, so it did not open COM6. `ws://127.0.0.1:8001/ws/sensors` returned one snapshot with `"type": "snapshot"` and `"synthetic": false`. The latest object in that snapshot had `"source": "serial"`. The CSV bytes were unchanged by that probe. That process was stopped.

Not tested here:

- A phone or emulator connecting over Wi-Fi. The Sensors screen was not opened in Expo Go.
- Windows Firewall behavior.
- A web bundle. `npx expo export --platform web` stopped because `react-native-web` is not installed. It was not added. This app is the existing native Expo app.
- Uploading firmware. That was intentionally not done.
