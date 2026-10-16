# Wildcraft inference

Local camera reader and YOLO runtime for the desktop app. One process loads `best.pt` once, reads the ESP32-CAM stream, and publishes annotated JPEG frames plus detection events.

It binds to `127.0.0.1:8100` and does not open COM6.

`YOLO_OFFLINE=true` is set before Ultralytics is imported. A missing weights file is reported. The service does not download a replacement model.

## Run

From the project root:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\start-inference.ps1
```

The script creates `inference/.venv` when needed, installs `requirements.txt` only when those packages do not already import, and exits if port 8100 is already healthy so a second process is not started.

The first install needs network access because PyTorch, Ultralytics, and OpenCV are large. Later launches use the virtual environment and the local weights file and do not contact a package index.

## API

- `GET /health`
- `GET /api/status`
- `GET /api/settings` and `PUT /api/settings`
- `POST /api/camera/connect` with `{ "url": "http://CAMERA_IP:81/stream" }`
- `POST /api/camera/disconnect`
- `GET /stream` annotated MJPEG
- `GET /api/detections`
- `WS /ws/inference`

Detections are stored in `inference/data/detections.sqlite`. That database is separate from `backend/data/sensor_readings.csv`.

Inference is capped around 4 frames per second so one CPU process does not queue frames. Only the latest camera frame is kept.

## Tests

```powershell
cd inference
python -m unittest discover -s tests -t . -v
```

## Packaging

This service is not inside the Electron installer. Ship or install it beside the app:

1. Create `inference/.venv` with `start-inference.ps1` on a machine that can download the Python packages.
2. Keep that virtual environment, or copy it with the project, for offline use.
3. Point Wildcraft Settings at the real `best.pt` path.
4. Start this process before connecting the camera.

A future PyInstaller build would still be a separate executable. Do not expect `electron-builder` to include this environment.
