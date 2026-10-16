"""Local settings for the Wildcraft inference service."""

from __future__ import annotations

import math
import os
from dataclasses import dataclass
from pathlib import Path

PACKAGE_DIR = Path(__file__).resolve().parent
INFERENCE_DIR = PACKAGE_DIR.parent
PROJECT_ROOT = INFERENCE_DIR.parent
DATA_DIR = INFERENCE_DIR / "data"

# Trained fire/smoke weights. Do not substitute another checkpoint.
TRAINED_WEIGHTS = PROJECT_ROOT / "weights" / "best.pt"


def _optional_float(name: str, default: float) -> float:
    raw = os.environ.get(name, "").strip()
    if not raw:
        return default
    try:
        value = float(raw)
    except ValueError as exc:
        raise SystemExit(f"[wildcraft] {name} must be a number. Got {raw!r}.") from exc
    if not math.isfinite(value):
        raise SystemExit(f"[wildcraft] {name} must be a finite number.")
    return value


def _require_int(name: str, default: int, minimum: int, maximum: int) -> int:
    raw = os.environ.get(name, "").strip()
    value = default if not raw else None
    if raw:
        try:
            value = int(raw)
        except ValueError as exc:
            raise SystemExit(f"[wildcraft] {name} must be an integer. Got {raw!r}.") from exc
    if value is None or value < minimum or value > maximum:
        raise SystemExit(f"[wildcraft] {name} must be from {minimum} to {maximum}.")
    return value


def resolve_model_path(explicit: str | None = None) -> Path:
    """Pick a weights file without downloading one.

    An explicit path or WILDCRAFT_MODEL_PATH is used even when the file is missing,
    so the service can report that path. Otherwise the first existing candidate wins.
    """

    chosen = (explicit if explicit is not None else os.environ.get("WILDCRAFT_MODEL_PATH", "")).strip()
    if chosen:
        return Path(chosen)
    candidates = [
        TRAINED_WEIGHTS,
        PROJECT_ROOT / "models" / "best.pt",
        PROJECT_ROOT / "best.pt",
    ]
    for candidate in candidates:
        if candidate.is_file():
            return candidate
    return TRAINED_WEIGHTS


@dataclass(frozen=True)
class Settings:
    host: str
    port: int
    model_path: Path
    confidence: float
    max_fps: float
    data_dir: Path
    db_path: Path
    settings_path: Path

    @classmethod
    def from_env(cls) -> Settings:
        host = os.environ.get("WILDCRAFT_INFERENCE_HOST", "127.0.0.1").strip() or "127.0.0.1"
        if host in {"0.0.0.0", "::"}:
            raise SystemExit(
                "[wildcraft] Refusing to bind the inference service on every interface. "
                "Use 127.0.0.1 so only this PC can reach it."
            )
        confidence = _optional_float("WILDCRAFT_CONFIDENCE", 0.35)
        if not 0.01 <= confidence <= 0.99:
            raise SystemExit("[wildcraft] WILDCRAFT_CONFIDENCE must be from 0.01 to 0.99.")
        max_fps = _optional_float("WILDCRAFT_MAX_FPS", 4.0)
        if not 0.5 <= max_fps <= 12:
            raise SystemExit("[wildcraft] WILDCRAFT_MAX_FPS must be from 0.5 to 12.")
        data_dir = DATA_DIR
        return cls(
            host=host,
            port=_require_int("WILDCRAFT_INFERENCE_PORT", 8100, 1, 65535),
            model_path=resolve_model_path(),
            confidence=confidence,
            max_fps=max_fps,
            data_dir=data_dir,
            db_path=data_dir / "detections.sqlite",
            settings_path=data_dir / "service-settings.json",
        )
