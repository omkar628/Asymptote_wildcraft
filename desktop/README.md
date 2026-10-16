# Wildcraft desktop

Electron, React, and TypeScript interface for the existing forest sensor backend and the local YOLO service. The Expo app in `src/` is unchanged.

The desktop process does not open COM6. Live sensor values come from the FastAPI service on port 8000. Camera frames and `best.pt` stay in the Python service on port 8100.

## Run

From the project root:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\start-sensor-backend.ps1
powershell -NoProfile -ExecutionPolicy Bypass -File .\start-inference.ps1
powershell -NoProfile -ExecutionPolicy Bypass -File .\start-desktop.ps1
```

Each script uses its own window. The phone app and this desktop app can use the same sensor backend.

Default addresses:

- Sensor backend: `http://127.0.0.1:8000`
- Inference service: `http://127.0.0.1:8100`
- Camera stream: `http://10.236.143.236:81/stream`

Change those in Settings. The stream URL is separate from the camera IP. ESP32-CAM firmware often serves video at `http://CAMERA_IP:81/stream`, not at the root address.

The weights path defaults to `weights/best.pt` when that file exists. Pick another `.pt` file in Settings if needed. The app does not download or replace weights.

## Checks

```powershell
cd desktop
npm install
npm run typecheck
npm test
npm run smoke
```

## Windows installer

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\build-desktop.ps1
```

Electron Builder writes an NSIS installer under `desktop/release`. That installer contains the desktop UI and the small SQLite runtime used for alert history.

It does not contain Python, PyTorch, Ultralytics, OpenCV, or `best.pt`. Electron will not package those automatically. Install the inference environment with `start-inference.ps1` once while network access is available, keep `best.pt` on disk, and start the inference service before opening a packaged Wildcraft window. After that, normal operation stays on this PC and the local Wi-Fi camera.

Alert rows are stored in the Electron user-data folder (`wildcraft.sqlite`). AI events are also appended by the inference service to `inference/data/detections.sqlite`. Neither file is the sensor CSV.
