"""SQLite log of AI detection events.

This file is separate from the sensor CSV and from the sensor backend.
"""

from __future__ import annotations

import json
import sqlite3
import threading
from pathlib import Path

from wildcraft_inference.events import DetectionEvent


class DetectionStore:
    def __init__(self, path: Path) -> None:
        self.path = path
        self.path.parent.mkdir(parents=True, exist_ok=True)
        self._lock = threading.Lock()
        self._connection: sqlite3.Connection | None = sqlite3.connect(self.path, check_same_thread=False)
        self._connection.row_factory = sqlite3.Row
        with self._lock:
            self._connection.execute(
                """
                CREATE TABLE IF NOT EXISTS detections (
                    id TEXT PRIMARY KEY,
                    created_at TEXT NOT NULL,
                    class_name TEXT NOT NULL,
                    confidence REAL NOT NULL,
                    bbox_json TEXT NOT NULL,
                    camera_url TEXT NOT NULL,
                    model_path TEXT NOT NULL,
                    frame_width INTEGER NOT NULL,
                    frame_height INTEGER NOT NULL,
                    disclaimer TEXT NOT NULL,
                    acknowledged INTEGER NOT NULL DEFAULT 0
                )
                """
            )
            self._connection.execute(
                "CREATE INDEX IF NOT EXISTS idx_detections_created ON detections(created_at)"
            )
            self._connection.commit()

    def insert(self, event: DetectionEvent) -> None:
        with self._lock:
            if self._connection is None:
                return
            existing = self._connection.execute(
                "SELECT acknowledged FROM detections WHERE id = ?",
                (event.id,),
            ).fetchone()
            acknowledged = 0 if existing is None else int(existing["acknowledged"])
            self._connection.execute(
                """
                INSERT OR REPLACE INTO detections (
                    id, created_at, class_name, confidence, bbox_json, camera_url,
                    model_path, frame_width, frame_height, disclaimer, acknowledged
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    event.id,
                    event.created_at,
                    event.class_name,
                    float(event.confidence),
                    json.dumps(list(event.bbox)),
                    event.camera_url,
                    event.model_path,
                    event.frame_width,
                    event.frame_height,
                    event.disclaimer,
                    acknowledged,
                ),
            )
            self._connection.commit()

    def list_recent(self, limit: int) -> list[dict[str, object]]:
        bounded = max(1, min(int(limit), 500))
        with self._lock:
            if self._connection is None:
                return []
            rows = self._connection.execute(
                """
                SELECT id, created_at, class_name, confidence, bbox_json, camera_url,
                       model_path, frame_width, frame_height, disclaimer, acknowledged
                FROM detections
                ORDER BY created_at DESC
                LIMIT ?
                """,
                (bounded,),
            ).fetchall()
        return [self._row_to_dict(row) for row in rows]

    def acknowledge(self, detection_id: str) -> dict[str, object] | None:
        with self._lock:
            if self._connection is None:
                return None
            current = self._connection.execute(
                "SELECT id FROM detections WHERE id = ?",
                (detection_id,),
            ).fetchone()
            if current is None:
                return None
            self._connection.execute(
                "UPDATE detections SET acknowledged = 1 WHERE id = ?",
                (detection_id,),
            )
            self._connection.commit()
            row = self._connection.execute(
                """
                SELECT id, created_at, class_name, confidence, bbox_json, camera_url,
                       model_path, frame_width, frame_height, disclaimer, acknowledged
                FROM detections WHERE id = ?
                """,
                (detection_id,),
            ).fetchone()
        if row is None:
            return None
        return self._row_to_dict(row)

    def close(self) -> None:
        with self._lock:
            if self._connection is None:
                return
            self._connection.close()
            self._connection = None

    @staticmethod
    def _row_to_dict(row: sqlite3.Row) -> dict[str, object]:
        try:
            bbox = json.loads(row["bbox_json"])
        except json.JSONDecodeError:
            bbox = []
        return {
            "id": row["id"],
            "created_at": row["created_at"],
            "class_name": row["class_name"],
            "confidence": row["confidence"],
            "bbox": bbox,
            "camera_url": row["camera_url"],
            "model_path": row["model_path"],
            "frame_width": row["frame_width"],
            "frame_height": row["frame_height"],
            "disclaimer": row["disclaimer"],
            "acknowledged": bool(row["acknowledged"]),
            "source": "local-yolo",
        }
