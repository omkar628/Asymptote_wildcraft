"""Turn frame boxes into stored AI events without repeating every frame."""

from __future__ import annotations

import uuid
from collections.abc import Callable
from dataclasses import dataclass

DISCLAIMER = (
    "AI detection from the local YOLO model. "
    "One detection does not prove an actual forest fire."
)


@dataclass(frozen=True)
class Box:
    class_name: str
    confidence: float
    bbox: tuple[int, int, int, int]
    distance_m: float | None = None
    estimated_lat: float | None = None
    estimated_lon: float | None = None

    def as_dict(self) -> dict[str, object]:
        payload: dict[str, object] = {
            "class_name": self.class_name,
            "confidence": round(float(self.confidence), 4),
            "bbox": [int(self.bbox[0]), int(self.bbox[1]), int(self.bbox[2]), int(self.bbox[3])],
        }
        if self.distance_m is not None:
            payload["distance_m"] = round(float(self.distance_m), 1)
        if self.estimated_lat is not None and self.estimated_lon is not None:
            payload["estimated_lat"] = round(float(self.estimated_lat), 5)
            payload["estimated_lon"] = round(float(self.estimated_lon), 5)
            payload["location_note"] = "Estimate from box size and a dummy camera point. Not a measured location."
        return payload


@dataclass(frozen=True)
class DetectionEvent:
    id: str
    created_at: str
    class_name: str
    confidence: float
    bbox: tuple[int, int, int, int]
    camera_url: str
    model_path: str
    frame_width: int
    frame_height: int
    disclaimer: str = DISCLAIMER

    def as_dict(self, acknowledged: bool = False) -> dict[str, object]:
        return {
            "id": self.id,
            "created_at": self.created_at,
            "class_name": self.class_name,
            "confidence": round(float(self.confidence), 4),
            "bbox": [int(self.bbox[0]), int(self.bbox[1]), int(self.bbox[2]), int(self.bbox[3])],
            "camera_url": self.camera_url,
            "model_path": self.model_path,
            "frame_width": self.frame_width,
            "frame_height": self.frame_height,
            "disclaimer": self.disclaimer,
            "acknowledged": acknowledged,
            "source": "local-yolo",
        }


def best_box_per_class(boxes: list[Box]) -> list[Box]:
    chosen: dict[str, Box] = {}
    for box in boxes:
        key = box.class_name.strip().lower()
        if not key:
            continue
        current = chosen.get(key)
        if current is None or box.confidence > current.confidence:
            chosen[key] = box
    return list(chosen.values())


class DetectionCoalescer:
    """Store at most one event per class inside the time window."""

    def __init__(self, window_s: float = 20.0, clock: Callable[[], float] | None = None) -> None:
        if window_s <= 0:
            raise ValueError("window_s must be positive")
        self.window_s = window_s
        self._clock = clock or _monotonic
        self._last: dict[str, float] = {}

    def consider(
        self,
        boxes: list[Box],
        *,
        created_at: str,
        camera_url: str,
        model_path: str,
        frame_width: int,
        frame_height: int,
    ) -> list[DetectionEvent]:
        now = self._clock()
        events: list[DetectionEvent] = []
        for box in best_box_per_class(boxes):
            key = box.class_name.strip().lower()
            previous = self._last.get(key)
            if previous is not None and now - previous < self.window_s:
                continue
            self._last[key] = now
            events.append(
                DetectionEvent(
                    id=str(uuid.uuid4()),
                    created_at=created_at,
                    class_name=box.class_name,
                    confidence=box.confidence,
                    bbox=box.bbox,
                    camera_url=camera_url,
                    model_path=model_path,
                    frame_width=frame_width,
                    frame_height=frame_height,
                )
            )
        return events


def _monotonic() -> float:
    import time

    return time.monotonic()
