"""Local settings for the forest sensor API.

Environment variables and an optional backend/.env file override the defaults.
Existing process environment variables win over the file.
"""

from __future__ import annotations

import math
import os
from dataclasses import dataclass
from pathlib import Path

BACKEND_DIR = Path(__file__).resolve().parent
ENV_FILE = BACKEND_DIR / ".env"


def load_local_env(path: Path = ENV_FILE) -> None:
    """Load local keys from backend/.env without overriding the shell.

    NASA_FIRMS_MAP_KEY is read for server-side requests only. Do not log it.
    """
    if not path.exists():
        return
    for raw_line in path.read_text(encoding="utf-8").splitlines():
        line = raw_line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        key = key.strip()
        if key in os.environ:
            continue
        if not key.startswith("SENSOR_") and key != "NASA_FIRMS_MAP_KEY":
            continue
        os.environ[key] = value.strip().strip('"').strip("'")


def _require_int(name: str, default: int, minimum: int) -> int:
    raw = os.environ.get(name, "").strip()
    if not raw:
        value = default
    else:
        try:
            value = int(raw)
        except ValueError as exc:
            raise SystemExit(f"[sensor] {name} must be an integer. Got {raw!r}.") from exc
    if value < minimum:
        raise SystemExit(f"[sensor] {name} must be at least {minimum}. Got {value}.")
    return value


def _optional_float(name: str) -> float | None:
    raw = os.environ.get(name)
    if raw is None or raw.strip() == "":
        return None
    try:
        value = float(raw.strip())
    except ValueError as exc:
        raise SystemExit(f"[sensor] {name} must be a number. Got {raw!r}.") from exc
    if not math.isfinite(value):
        raise SystemExit(f"[sensor] {name} must be a finite number.")
    return value


def _bool_env(name: str, default: bool) -> bool:
    raw = os.environ.get(name)
    if raw is None or raw.strip() == "":
        return default
    value = raw.strip().lower()
    if value in {"1", "true", "yes", "on"}:
        return True
    if value in {"0", "false", "no", "off"}:
        return False
    raise SystemExit(f"[sensor] {name} must be true or false. Got {raw!r}.")


@dataclass(frozen=True)
class Settings:
    serial_port: str
    baud_rate: int
    serial_enabled: bool
    csv_path: Path
    host: str
    port: int
    history_default_limit: int
    history_max_limit: int
    memory_limit: int
    allow_test_inject: bool
    temp_c_high: float | None
    humidity_percent_low: float | None
    mq135_raw_high: float | None
    mq9_raw_high: float | None
    rssi_dbm_low: float | None

    @classmethod
    def from_env(cls, *, load_file: bool = True) -> Settings:
        if load_file:
            load_local_env()
        port_name = os.environ.get("SENSOR_SERIAL_PORT", "COM6").strip() or "COM6"
        csv_raw = os.environ.get("SENSOR_CSV_PATH", "").strip()
        csv_path = Path(csv_raw) if csv_raw else BACKEND_DIR / "data" / "sensor_readings.csv"
        if not csv_path.is_absolute():
            csv_path = (BACKEND_DIR / csv_path).resolve()
        host = os.environ.get("SENSOR_API_HOST", "0.0.0.0").strip() or "0.0.0.0"
        history_default = _require_int("SENSOR_HISTORY_DEFAULT_LIMIT", 120, 1)
        history_max = _require_int("SENSOR_HISTORY_MAX_LIMIT", 500, 1)
        memory_limit = _require_int("SENSOR_MEMORY_LIMIT", 1000, 1)
        if history_default > history_max:
            raise SystemExit(
                "[sensor] SENSOR_HISTORY_DEFAULT_LIMIT cannot be greater than SENSOR_HISTORY_MAX_LIMIT."
            )
        if memory_limit < history_max:
            memory_limit = history_max
        return cls(
            serial_port=port_name,
            baud_rate=_require_int("SENSOR_BAUD_RATE", 115200, 1),
            serial_enabled=_bool_env("SENSOR_SERIAL_ENABLED", True),
            csv_path=csv_path,
            host=host,
            port=_require_int("SENSOR_API_PORT", 8000, 1),
            history_default_limit=history_default,
            history_max_limit=history_max,
            memory_limit=memory_limit,
            allow_test_inject=_bool_env("SENSOR_ALLOW_TEST_INJECT", False),
            temp_c_high=_optional_float("SENSOR_ALERT_TEMP_C_HIGH"),
            humidity_percent_low=_optional_float("SENSOR_ALERT_HUMIDITY_LOW"),
            mq135_raw_high=_optional_float("SENSOR_ALERT_MQ135_RAW_HIGH"),
            mq9_raw_high=_optional_float("SENSOR_ALERT_MQ9_RAW_HIGH"),
            rssi_dbm_low=_optional_float("SENSOR_ALERT_RSSI_DBM_LOW"),
        )
