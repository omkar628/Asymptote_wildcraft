"""Shared reading builder for backend tests. Not used by the running service."""

from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from serial_collector import SensorReading


def make_reading(**overrides: object) -> SensorReading:
    values: dict[str, object] = {
        "timestamp": "2026-10-11T18:00:00.000+05:30",
        "temp_c": 31.7,
        "humidity_percent": 45.7,
        "mq135_raw": 418.0,
        "mq9_raw": 479.0,
        "rssi_dbm": -32.0,
        "temp_text": "31.70",
        "humidity_text": "45.70",
        "mq135_text": "418",
        "mq9_text": "479",
        "rssi_text": "-32",
    }
    values.update(overrides)
    return SensorReading(**values)  # type: ignore[arg-type]
