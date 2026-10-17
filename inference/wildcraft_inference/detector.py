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

# Dummy camera position for the on-screen estimate. This is not a surveyed site.
CAMERA_LAT = 21.1458
CAMERA_LON = 79.0882
SMOKE_CONFIDENCE = 0.40
FIRE_CONFIDENCE = 0.20
MAX_DISTANCE_M = 50.0
MIN_DISTANCE_M = 1.0
METERS_PER_DEGREE = 111_320.0


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
        self._cuda_fallback_logged = False

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
        pairs = ", ".join(f"{index}={name}" for index, name in sorted(names.items())) or "unavailable"
        print(f"[wildcraft] Class ids: {pairs}", flush=True)
        print(f"[wildcraft] Device: {device}", flush=True)
        with self._lock:
            self._model = model
            self._path = str(weights)
            self._names = names
            self._device = device
            self._state = "ready"
            self._error = None
            self._cuda_fallback_logged = False
        return self.status()

    def infer(self, frame_bgr, confidence: float) -> tuple[list[Box], str | None]:
        with self._lock:
            ready = self._model is not None and self._path == self._requested and self._state == "ready"
            model = self._model if ready else None
            device = self._device or "cpu"
            error = None if ready else self._error
        if model is None:
            return [], error or "The YOLO model is not loaded."
        floor = model_confidence(confidence)
        try:
            results = _predict(model, frame_bgr, floor, device)
        except Exception as exc:
            if str(device).startswith("cuda"):
                try:
                    results = _predict(model, frame_bgr, floor, "cpu")
                except Exception as cpu_exc:
                    return [], f"Inference failed on {device}: {exc}. CPU fallback also failed: {cpu_exc}."
                with self._lock:
                    if self._model is model:
                        self._device = "cpu"
                    if not self._cuda_fallback_logged:
                        self._cuda_fallback_logged = True
                        print(f"[wildcraft] CUDA inference failed ({exc}). Continuing on CPU.", flush=True)
            else:
                return [], f"Inference failed: {exc}"
        if not results:
            return [], None
        result = results[0]
        names = _class_names(result) or self._names
        boxes_attr = getattr(result, "boxes", None)
        if boxes_attr is None:
            return [], None
        found: list[Box] = []
        frame_shape = getattr(frame_bgr, "shape", None)
        frame_height = int(frame_shape[0]) if frame_shape is not None and len(frame_shape) >= 2 else 1
        frame_width = int(frame_shape[1]) if frame_shape is not None and len(frame_shape) >= 2 else 1
        for box in boxes_attr:
            cls_id = int(box.cls[0])
            name = str(names.get(cls_id, cls_id))
            score = float(box.conf[0])
            if not keeps_class(name, score):
                continue
            x1, y1, x2, y2 = [int(round(value)) for value in box.xyxy[0].tolist()]
            found.append(annotate_detection(Box(class_name=name, confidence=score, bbox=(x1, y1, x2, y2)), frame_width, frame_height))
        return found, None


WINDOW_NAME = "Wildcraft fire and smoke"


def show_frame(frame_bgr) -> str | None:
    """Show the annotated camera frame. The image stays in memory."""

    import cv2

    try:
        cv2.imshow(WINDOW_NAME, frame_bgr)
        cv2.waitKey(1)
    except Exception as exc:
        return f"Could not open the detection window: {exc}"
    return None


def close_window() -> None:
    import cv2

    try:
        cv2.destroyWindow(WINDOW_NAME)
    except Exception:
        return


def model_confidence(requested: float) -> float:
    """Keep the YOLO confidence at or below the fire gate.

    A saved setting such as 0.35 must not drop a fire of 0.20 before the
    class check. A lower requested value still reaches that check. Smoke is
    filtered again by keeps_class.
    """

    floor = min(SMOKE_CONFIDENCE, FIRE_CONFIDENCE)
    if isinstance(requested, (int, float)) and requested > 0:
        floor = min(floor, float(requested))
    return floor


def box_label(class_name: str, confidence: float) -> str:
    """Fire shows a percentage. Smoke keeps the decimal score."""

    if class_name.strip().lower() == "fire":
        return f"fire {confidence * 100:.0f}%"
    return f"{class_name} {confidence:.2f}"


def keeps_class(class_name: str, score: float) -> bool:
    """Smoke stays at 0.40 or higher. Fire stays at 0.20 or higher. Other names are dropped."""

    key = class_name.strip().lower()
    if key == "smoke":
        return score >= SMOKE_CONFIDENCE
    if key == "fire":
        return score >= FIRE_CONFIDENCE
    return False


def estimate_distance_m(bbox: tuple[int, int, int, int], frame_width: int, frame_height: int) -> float:
    """Map box area to meters. A full frame is 1 m. A tiny box is 50 m."""

    x1, y1, x2, y2 = bbox
    area = max(0, x2 - x1) * max(0, y2 - y1)
    frame_area = max(1, int(frame_width) * int(frame_height))
    ratio = min(1.0, area / frame_area)
    return MAX_DISTANCE_M - ratio * (MAX_DISTANCE_M - MIN_DISTANCE_M)


def estimate_gps(distance_m: float) -> tuple[float, float]:
    """Shift the dummy camera point by the estimated distance. This is not a ground fix."""

    offset = float(distance_m) / METERS_PER_DEGREE
    return CAMERA_LAT + offset, CAMERA_LON + offset


def annotate_detection(box: Box, frame_width: int, frame_height: int) -> Box:
    distance_m = estimate_distance_m(box.bbox, frame_width, frame_height)
    latitude, longitude = estimate_gps(distance_m)
    return Box(
        class_name=box.class_name,
        confidence=box.confidence,
        bbox=box.bbox,
        distance_m=distance_m,
        estimated_lat=latitude,
        estimated_lon=longitude,
    )


def draw_boxes(frame_bgr, boxes: list[Box]):
    """Draw class, score, estimated distance, and estimated GPS on a copy of the frame."""

    import cv2

    image = frame_bgr.copy()
    frame_height, frame_width = image.shape[:2]
    font = cv2.FONT_HERSHEY_SIMPLEX
    scale = 0.5
    thickness = 1
    for box in boxes:
        annotated = box if box.distance_m is not None else annotate_detection(box, frame_width, frame_height)
        x1, y1, x2, y2 = annotated.bbox
        color = (24, 35, 180) if annotated.class_name.strip().lower() == "fire" else (8, 99, 169)
        cv2.rectangle(image, (x1, y1), (x2, y2), color, 2)
        lines = [
            box_label(annotated.class_name, annotated.confidence),
            f"est {annotated.distance_m:.1f} m",
            f"est {annotated.estimated_lat:.4f}, {annotated.estimated_lon:.4f}",
        ]
        sizes = [cv2.getTextSize(line, font, scale, thickness) for line in lines]
        text_width = max(size[0][0] for size in sizes)
        line_height = max(size[0][1] + size[1] for size in sizes) + 4
        block_height = line_height * len(lines)
        top = y1 - block_height - 4
        if top < 0:
            top = min(frame_height - block_height, y2 + 4)
            top = max(0, top)
        left = max(0, min(x1, frame_width - text_width - 8))
        cv2.rectangle(image, (left, top), (left + text_width + 8, top + block_height), color, -1)
        for index, line in enumerate(lines):
            text_height = sizes[index][0][1]
            baseline = sizes[index][1]
            y = top + index * line_height + text_height + max(0, (line_height - text_height - baseline) // 2)
            cv2.putText(image, line, (left + 4, y), font, scale, (255, 255, 255), thickness, cv2.LINE_AA)
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


def _predict(model, frame_bgr, confidence: float, device: str):
    return model.predict(
        source=frame_bgr,
        conf=confidence,
        verbose=False,
        device=device,
        stream=False,
    )


def _class_names(model) -> dict[int, str]:
    raw = getattr(model, "names", None)
    if isinstance(raw, dict):
        return {int(key): str(value) for key, value in raw.items()}
    if isinstance(raw, list):
        return {index: str(name) for index, name in enumerate(raw)}
    return {}
