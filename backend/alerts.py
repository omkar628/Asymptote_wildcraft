"""Preliminary threshold alerts.

These rules compare a reading with numbers supplied by configuration.
They do not confirm a fire, and they are not a detection model.
A future model can emit its own alert records beside these ones.
"""

from __future__ import annotations

from dataclasses import dataclass

from serial_collector import SensorReading

ALERT_COPY: dict[str, dict[str, str]] = {
    "temp_c_high": {
        "title": "Temperature threshold",
        "detail": (
            "Temperature is at or above the threshold configured on the laptop. "
            "Preliminary sensor alert. This does not confirm a fire."
        ),
    },
    "humidity_percent_low": {
        "title": "Humidity threshold",
        "detail": (
            "Relative humidity is at or below the threshold configured on the laptop. "
            "Preliminary sensor alert. This does not confirm a fire."
        ),
    },
    "mq135_raw_high": {
        "title": "MQ135 raw threshold",
        "detail": (
            "MQ135 raw reading is at or above the threshold configured on the laptop. "
            "The value is raw sensor units, not a calibrated gas concentration. "
            "Preliminary sensor alert. This does not confirm a fire."
        ),
    },
    "mq9_raw_high": {
        "title": "MQ9 raw threshold",
        "detail": (
            "MQ9 raw reading is at or above the threshold configured on the laptop. "
            "The value is raw sensor units, not a calibrated gas concentration. "
            "Preliminary sensor alert. This does not confirm a fire."
        ),
    },
    "rssi_dbm_low": {
        "title": "Signal threshold",
        "detail": (
            "RSSI is at or below the threshold configured on the laptop. "
            "This compares the receiver's reported signal value. "
            "It is a link-quality notice, not a fire alert."
        ),
    },
}


@dataclass(frozen=True)
class Thresholds:
    temp_c_high: float | None = None
    humidity_percent_low: float | None = None
    mq135_raw_high: float | None = None
    mq9_raw_high: float | None = None
    rssi_dbm_low: float | None = None

    def as_dict(self) -> dict[str, float | None]:
        return {
            "temp_c_high": self.temp_c_high,
            "humidity_percent_low": self.humidity_percent_low,
            "mq135_raw_high": self.mq135_raw_high,
            "mq9_raw_high": self.mq9_raw_high,
            "rssi_dbm_low": self.rssi_dbm_low,
        }

    def any_configured(self) -> bool:
        return any(value is not None for value in self.as_dict().values())


def describe_alert(rule_id: str) -> dict[str, str]:
    copy = ALERT_COPY[rule_id]
    return {
        "id": rule_id,
        "source": "threshold",
        "scope": "laptop",
        "title": copy["title"],
        "detail": copy["detail"],
        "severity": "warning",
    }


class AlertEngine:
    """Keep the current set of matched rules and report when that set changes."""

    def __init__(self, thresholds: Thresholds) -> None:
        self.thresholds = thresholds
        self._active: set[str] = set()

    def observe(self, reading: SensorReading) -> dict[str, object]:
        current = self.matching(reading)
        changed = current != self._active
        self._active = current
        return {"changed": changed, "active": self.payload()}

    def matching(self, reading: SensorReading) -> set[str]:
        found: set[str] = set()
        rules = self.thresholds
        if rules.temp_c_high is not None and reading.temp_c >= rules.temp_c_high:
            found.add("temp_c_high")
        if rules.humidity_percent_low is not None and reading.humidity_percent <= rules.humidity_percent_low:
            found.add("humidity_percent_low")
        if rules.mq135_raw_high is not None and reading.mq135_raw >= rules.mq135_raw_high:
            found.add("mq135_raw_high")
        if rules.mq9_raw_high is not None and reading.mq9_raw >= rules.mq9_raw_high:
            found.add("mq9_raw_high")
        if (
            rules.rssi_dbm_low is not None
            and reading.rssi_dbm is not None
            and reading.rssi_dbm <= rules.rssi_dbm_low
        ):
            found.add("rssi_dbm_low")
        return found

    def payload(self) -> list[dict[str, str]]:
        return [describe_alert(rule_id) for rule_id in sorted(self._active)]
