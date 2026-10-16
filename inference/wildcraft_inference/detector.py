"""Load best.pt once and run YOLO on camera frames.

Ultralytics is imported only after the weights file is confirmed on disk.
A missing path must not trigger a download of a different model.
"""

from __future__ import annotations

import os
import threading
from dataclasses import dataclass
from pathlib import Path

from wildcraft_inference.events import Box

os.environ.setdefault("YOLO_OFFLINE", "true")


@dataclass(frozen=True)
class ModelStatus:
    path: str
    loaded: bool
    state: str
    error: str | None
    class_names: list[str]
    device: str | None


class Detector:
    def __init__(self) -> None:
        self._lock = threading.Lock()
        self._model = None
        self._path = ""
        self._requested = ""
        self._names: dict[int, str] = {}
        self._device: str | None = None
        self._error: str | None = "The YOLO model is not loaded."
        self._state = "missing"

    def status(self) -> ModelStatus:
        with self._lock:
            loaded = self._model is not None and self._path == self._requested and self._state == "ready"
            return ModelStatus(
                path=self._requested,
                loaded=loaded,
                state="ready" if loaded else self._state,
                error=None if loaded else self._error,
                class_names=list(self._names.values()) if loaded else [],
                device=self._device if loaded else None,
            )

    def load(self, path: str) -> ModelStatus:
        weights = Path(path)
        with self._lock:
            self._requested = str(weights)
        if not weights.is_file():
            with self._lock:
                self._state = "missing"
                self._error = f"Model file not found: {weights}"
            return self.status()
        os.environ["YOLO_OFFLINE"] = "true"
        try:
            import torch
            from ultralytics import YOLO
        except Exception as exc:
            with self._lock:
                self._state = "error"
                self._error = f"Could not import the local YOLO runtime: {exc}"
            return self.status()
        device = "cuda:0" if torch.cuda.is_available() else "cpu"
        resolved = str(weights.resolve())
        print(f"[wildcraft] Loading YOLO({resolved!r})", flush=True)
        try:
            model = YOLO(resolved)
        except Exception as exc:
            with self._lock:
                self._state = "error"
                self._error = f"Could not load the YOLO weights: {exc}"
            return self.status()
        names = _class_names(model)
        with self._lock:
            self._model = model
            self._path = str(weights)
            self._names = names
            self._device = device
            self._state = "ready"
            self._error = None
        return self.status()

    def infer(self, frame_bgr, confidence: float) -> tuple[list[Box], str | None]:
        with self._lock:
            ready = self._model is not None and self._path == self._requested and self._state == "ready"
            model = self._model if ready else None
            device = self._device or "cpu"
            error = None if ready else self._error
        if model is None:
            return [], error or "The YOLO model is not loaded."
        try:
            results = model.predict(
                source=frame_bgr,
                conf=confidence,
                verbose=False,
                device=device,
                stream=False,
            )
        except Exception as exc:
            return [], f"Inference failed: {exc}"
        if not results:
            return [], None
        result = results[0]
        names = _class_names(result) or self._names
        boxes_attr = getattr(result, "boxes", None)
        if boxes_attr is None:
            return [], None
        found: list[Box] = []
        for box in boxes_attr:
            cls_id = int(box.cls[0])
            name = str(names.get(cls_id, cls_id))
            score = float(box.conf[0])
            x1, y1, x2, y2 = [int(round(value)) for value in box.xyxy[0].tolist()]
            found.append(Box(class_name=name, confidence=score, bbox=(x1, y1, x2, y2)))
        return found, None


def draw_boxes(frame_bgr, boxes: list[Box]):
    """Draw class, score, and a rectangle on a copy of the frame."""

    import cv2

    image = frame_bgr.copy()
    for box in boxes:
        x1, y1, x2, y2 = box.bbox
        color = (24, 35, 180) if box.class_name.strip().lower() == "fire" else (8, 99, 169)
        cv2.rectangle(image, (x1, y1), (x2, y2), color, 2)
        label = f"{box.class_name} {box.confidence:.2f}"
        font = cv2.FONT_HERSHEY_SIMPLEX
        scale = 0.5
        thickness = 1
        (text_width, text_height), baseline = cv2.getTextSize(label, font, scale, thickness)
        top = max(0, y1 - text_height - baseline - 4)
        cv2.rectangle(image, (x1, top), (x1 + text_width + 6, top + text_height + baseline + 4), color, -1)
        cv2.putText(image, label, (x1 + 3, top + text_height + 1), font, scale, (255, 255, 255), thickness, cv2.LINE_AA)
    return image


def encode_jpeg(frame_bgr, quality: int = 70) -> bytes | None:
    import cv2

    ok, encoded = cv2.imencode(".jpg", frame_bgr, [int(cv2.IMWRITE_JPEG_QUALITY), quality])
    if not ok:
        return None
    return encoded.tobytes()


def decode_jpeg(payload: bytes):
    import cv2
    import numpy as np

    array = np.frombuffer(payload, dtype=np.uint8)
    frame = cv2.imdecode(array, cv2.IMREAD_COLOR)
    return frame


def _class_names(model) -> dict[int, str]:
    raw = getattr(model, "names", None)
    if isinstance(raw, dict):
        return {int(key): str(value) for key, value in raw.items()}
    if isinstance(raw, list):
        return {index: str(name) for index, name in enumerate(raw)}
    return {}
