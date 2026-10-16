"""One camera reader and one YOLO loop for the desktop app."""

from __future__ import annotations

import asyncio
import json
import threading
import time
from collections import deque
from datetime import datetime
from pathlib import Path

from wildcraft_inference.camera import CameraWorker
from wildcraft_inference.config import Settings
from wildcraft_inference.detector import Detector, decode_jpeg, draw_boxes, encode_jpeg
from wildcraft_inference.events import DetectionCoalescer
from wildcraft_inference.store import DetectionStore


class InferenceRuntime:
    def __init__(self, settings: Settings) -> None:
        self.settings = settings
        self.camera = CameraWorker()
        self.detector = Detector()
        self.store = DetectionStore(settings.db_path)
        self.coalescer = DetectionCoalescer(window_s=20.0)
        self.model_path = str(settings.model_path)
        self.confidence = settings.confidence
        self._pending_camera_url = ""
        self._load_saved_settings()
        self._lock = threading.Lock()
        self._load_lock = threading.Lock()
        self._stop = threading.Event()
        self._thread: threading.Thread | None = None
        self._loading = False
        self._running = False
        self._jpeg: bytes | None = None
        self._boxes: list = []
        self._processed = 0
        self._last_inference_at: str | None = None
        self._last_error: str | None = None
        self._fps = 0.0
        self._times: deque[float] = deque(maxlen=20)
        self._frame_width: int | None = None
        self._frame_height: int | None = None
        self._last_duration_ms: float | None = None
        self._last_diag = 0.0
        self._last_wait_log = 0.0
        self._listeners: set[asyncio.Queue] = set()
        self._listener_lock = threading.Lock()
        self.loop: asyncio.AbstractEventLoop | None = None

    def attach_loop(self, loop: asyncio.AbstractEventLoop) -> None:
        self.loop = loop

    def add_listener(self, queue: asyncio.Queue) -> None:
        with self._listener_lock:
            self._listeners.add(queue)

    def remove_listener(self, queue: asyncio.Queue) -> None:
        with self._listener_lock:
            self._listeners.discard(queue)

    def start(self) -> None:
        if self._running:
            return
        self._stop.clear()
        self._running = True
        self._thread = threading.Thread(target=self._loop, name="wildcraft-infer", daemon=True)
        self._thread.start()
        threading.Thread(target=self._load_model, name="wildcraft-model", daemon=True).start()
        if self._pending_camera_url:
            try:
                self.camera.start(self._pending_camera_url)
                print(f"[wildcraft] Camera URL: {self._pending_camera_url}", flush=True)
            except ValueError as exc:
                print(f"[wildcraft] Saved camera URL was not opened: {exc}", flush=True)

    def stop(self) -> None:
        self._stop.set()
        self.camera.stop()
        thread = self._thread
        if thread is not None and thread.is_alive():
            thread.join(timeout=2)
        self._thread = None
        self._running = False
        with self._lock:
            self._jpeg = None
            self._boxes = []
        self.store.close()

    def connect_camera(self, url: str) -> dict[str, object]:
        self.camera.start(url)
        self._save_settings()
        status = self.status()
        self.publish({"type": "status", "status": status})
        return status

    def disconnect_camera(self) -> dict[str, object]:
        self.camera.stop()
        with self._lock:
            self._jpeg = None
            self._boxes = []
        status = self.status()
        self.publish({"type": "status", "status": status})
        return status

    def update_settings(self, model_path: str | None, confidence: float | None) -> dict[str, object]:
        reload_model = False
        if confidence is not None:
            value = float(confidence)
            if not 0.01 <= value <= 0.99:
                raise ValueError("Confidence must be from 0.01 to 0.99.")
            self.confidence = value
        if model_path is not None:
            cleaned = coerce_model_path(model_path)
            if not cleaned.lower().endswith(".pt"):
                raise ValueError("The model path must be a .pt weights file.")
            if Path(cleaned).resolve() != Path(self.model_path).resolve():
                self.model_path = cleaned
                reload_model = True
            elif cleaned != self.model_path:
                self.model_path = cleaned
        self._save_settings()
        if reload_model:
            threading.Thread(target=self._load_model, name="wildcraft-model", daemon=True).start()
        status = self.status()
        self.publish({"type": "status", "status": status})
        return status

    def list_detections(self, limit: int) -> list[dict[str, object]]:
        return self.store.list_recent(limit)

    def acknowledge(self, detection_id: str) -> dict[str, object] | None:
        return self.store.acknowledge(detection_id)

    def latest_annotated_jpeg(self) -> bytes | None:
        with self._lock:
            annotated = self._jpeg
        if annotated is not None:
            return annotated
        return self.camera.latest_jpeg()

    def status(self) -> dict[str, object]:
        model = self.detector.status()
        state = "loading" if self._loading else model.state
        with self._lock:
            inference = {
                "running": self._running,
                "confidence": self.confidence,
                "processed_fps": round(self._fps, 2),
                "last_inference_at": self._last_inference_at,
                "last_error": self._last_error,
                "frames_processed": self._processed,
                "frame_width": self._frame_width,
                "frame_height": self._frame_height,
                "last_duration_ms": self._last_duration_ms,
            }
            boxes = [box.as_dict() for box in self._boxes]
        return {
            "service": "running",
            "model": {
                "path": self.model_path,
                "exists": Path(self.model_path).is_file(),
                "loaded": model.loaded and not self._loading,
                "state": state,
                "error": None if state == "loading" else model.error,
                "class_names": model.class_names,
                "device": model.device,
            },
            "camera": self.camera.snapshot(),
            "inference": inference,
            "recent_boxes": boxes,
            "recent_events": self.store.list_recent(20),
        }

    def publish(self, message: dict) -> None:
        loop = self.loop
        if loop is None or not loop.is_running():
            return

        def _put() -> None:
            with self._listener_lock:
                queues = list(self._listeners)
            for queue in queues:
                if queue.full():
                    try:
                        queue.get_nowait()
                    except asyncio.QueueEmpty:
                        pass
                try:
                    queue.put_nowait(message)
                except asyncio.QueueFull:
                    continue

        loop.call_soon_threadsafe(_put)

    def _load_model(self) -> None:
        with self._load_lock:
            self._loading = True
            try:
                status = self.detector.load(self.model_path)
            finally:
                self._loading = False
        _log_model_status(self.model_path, status)
        self.publish({"type": "status", "status": self.status()})

    def _loop(self) -> None:
        last_publish = 0.0
        while not self._stop.is_set():
            started = time.perf_counter()
            jpeg = self.camera.latest_jpeg()
            if jpeg is None:
                now = time.monotonic()
                if now - self._last_wait_log >= 5.0:
                    self._last_wait_log = now
                    print("[wildcraft] Waiting for a camera frame.", flush=True)
                if now - last_publish >= 1.0:
                    self.publish({"type": "status", "status": self.status()})
                    last_publish = now
                self._stop.wait(0.05)
                continue
            try:
                frame = decode_jpeg(jpeg)
            except Exception as exc:
                self._mark_error(f"OpenCV could not decode a frame: {exc}")
                self._stop.wait(0.2)
                continue
            if frame is None:
                self._mark_error("A camera frame could not be decoded as JPEG.")
                self._stop.wait(0.05)
                continue
            height, width = frame.shape[:2]
            infer_started = time.perf_counter()
            boxes, error = self.detector.infer(frame, self.confidence)
            duration_ms = (time.perf_counter() - infer_started) * 1000.0
            self._log_inference(int(width), int(height), duration_ms, boxes, error)
            try:
                image = draw_boxes(frame, boxes) if boxes else frame
                encoded = encode_jpeg(image)
            except Exception as exc:
                self._mark_error(f"Could not draw detections: {exc}")
                self._stop.wait(0.2)
                continue
            if encoded is None:
                self._mark_error("Could not encode the camera frame.")
                self._stop.wait(0.05)
                continue
            timestamp = _local_timestamp()
            with self._lock:
                self._jpeg = encoded
                self._boxes = boxes
                self._processed += 1
                self._last_inference_at = timestamp
                self._last_error = error
                self._frame_width = int(width)
                self._frame_height = int(height)
                self._last_duration_ms = round(duration_ms, 1)
                self._times.append(time.monotonic())
                self._fps = _fps(self._times)
            events = []
            if boxes and error is None:
                events = self.coalescer.consider(
                    boxes,
                    created_at=timestamp,
                    camera_url=str(self.camera.snapshot()["url"]),
                    model_path=self.model_path,
                    frame_width=int(width),
                    frame_height=int(height),
                )
                for event in events:
                    self.store.insert(event)
            self.publish({"type": "status", "status": self.status()})
            last_publish = time.monotonic()
            for event in events:
                self.publish({"type": "event", "event": event.as_dict()})
            elapsed = time.perf_counter() - started
            remaining = max(0.0, (1.0 / self.settings.max_fps) - elapsed)
            self._stop.wait(remaining)

    def _mark_error(self, message: str) -> None:
        with self._lock:
            self._last_error = message

    def _log_inference(self, width: int, height: int, duration_ms: float, boxes, error: str | None) -> None:
        now = time.monotonic()
        if now - self._last_diag < 5.0:
            return
        self._last_diag = now
        if error:
            print(
                f"[wildcraft] Frame {width}x{height} inference {duration_ms:.0f} ms failed: {error}",
                flush=True,
            )
            return
        names = ", ".join(sorted({box.class_name for box in boxes})) or "none"
        print(
            f"[wildcraft] Frame {width}x{height} inference {duration_ms:.0f} ms "
            f"detections {len(boxes)} [{names}] threshold {self.confidence:.2f}",
            flush=True,
        )

    def _load_saved_settings(self) -> None:
        path = self.settings.settings_path
        if not path.is_file():
            return
        try:
            data = json.loads(path.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError):
            return
        if not isinstance(data, dict):
            return
        # An explicit environment path wins over the last saved path.
        if not os_model_override():
            model_path = data.get("model_path")
            if isinstance(model_path, str) and model_path.strip():
                candidate = Path(model_path.strip())
                if candidate.is_file() or not _is_stale_missing_weights(candidate):
                    self.model_path = str(candidate.resolve()) if candidate.is_file() else str(candidate)
        camera_url = data.get("camera_url")
        if isinstance(camera_url, str) and camera_url.strip():
            self._pending_camera_url = camera_url.strip()
        if not os_confidence_override():
            confidence = data.get("confidence")
            if isinstance(confidence, (int, float)) and 0.01 <= float(confidence) <= 0.99:
                self.confidence = float(confidence)

    def _save_settings(self) -> None:
        payload = {
            "model_path": self.model_path,
            "confidence": self.confidence,
            "camera_url": self.camera.snapshot()["url"],
        }
        try:
            self.settings.settings_path.parent.mkdir(parents=True, exist_ok=True)
            self.settings.settings_path.write_text(json.dumps(payload, indent=2), encoding="utf-8")
        except OSError:
            return


def coerce_model_path(requested: str) -> str:
    """Keep the trained weights when a client sends a known missing default path."""

    cleaned = requested.strip()
    candidate = Path(cleaned)
    if not _is_stale_missing_weights(candidate):
        return cleaned
    from wildcraft_inference.config import TRAINED_WEIGHTS

    if not TRAINED_WEIGHTS.is_file():
        return cleaned
    trained = str(TRAINED_WEIGHTS.resolve())
    print(
        f"[wildcraft] Ignoring missing model path {candidate} and keeping {trained}",
        flush=True,
    )
    return trained


def _log_model_status(path: str, status) -> None:
    weights = Path(path)
    try:
        resolved = weights.resolve()
        exists = resolved.is_file()
        size = resolved.stat().st_size if exists else 0
    except OSError:
        resolved = weights
        exists = False
        size = 0
    names = ", ".join(f"{index}={name}" for index, name in enumerate(status.class_names)) or "unavailable"
    outcome = "succeeded" if status.loaded else f"failed: {status.error}"
    print(f"[wildcraft] Model path: {resolved}", flush=True)
    if exists:
        print(f"[wildcraft] Model file exists: True ({size} bytes)", flush=True)
    else:
        print("[wildcraft] Model file exists: False", flush=True)
    print(f"[wildcraft] Model load: {outcome}", flush=True)
    print(f"[wildcraft] Class names: {names}", flush=True)


def _is_stale_missing_weights(candidate: Path) -> bool:
    """Old defaults named best.pt outside weights/. A missing copy must not hide the trained file."""

    if candidate.is_file():
        return False
    from wildcraft_inference.config import PROJECT_ROOT

    stale = {
        (PROJECT_ROOT / "best.pt").resolve(),
        Path(r"F:\edit\best.pt").resolve(),
        Path(r"F:\wildcraft_project\best.pt").resolve(),
    }
    try:
        return candidate.resolve() in stale
    except OSError:
        return False


def os_model_override() -> bool:
    import os

    return bool(os.environ.get("WILDCRAFT_MODEL_PATH", "").strip())


def os_confidence_override() -> bool:
    import os

    return bool(os.environ.get("WILDCRAFT_CONFIDENCE", "").strip())


def _local_timestamp() -> str:
    return datetime.now().astimezone().isoformat(timespec="milliseconds")


def _fps(times: deque[float]) -> float:
    if len(times) < 2:
        return 0.0
    span = times[-1] - times[0]
    if span <= 0:
        return 0.0
    return (len(times) - 1) / span
