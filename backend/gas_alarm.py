"""Raw MQ9 / MQ135 high-level alarm.

The alarm starts only when MQ9 and MQ135 are both strictly above the activation
threshold on the same fresh packet. The default is 750 raw, so 750 itself does
not count, and one high sensor does not start an alarm. The episode stays open
while that combined condition remains true. It ends when both readings are
present and at least one is at or below the threshold. A later combined crossing
can open a new episode.

Missing, non-finite, and stale values are never coerced to zero and never
count as a normal condition. The numbers are raw sensor units. This module
does not convert them to ppm and does not confirm a fire.
"""

from __future__ import annotations

import math
import threading
from datetime import datetime, timezone

ACTIVATION_THRESHOLD = 750.0
RECOVERY_THRESHOLD = 750.0
STALE_AFTER_S = 60.0

STATES = ("NORMAL", "ALARM_ACTIVE", "ACKNOWLEDGED", "SENSOR_DATA_STALE", "INCOMPLETE")
SENSOR_ORDER = ("mq9", "mq135")


def finite_raw(value: object) -> float | None:
    """Return a finite raw reading, or None when the value cannot be used."""
    if isinstance(value, bool) or value is None:
        return None
    if isinstance(value, str):
        text = value.strip()
        if not text:
            return None
        try:
            number = float(text)
        except ValueError:
            return None
    elif isinstance(value, (int, float)):
        number = float(value)
    else:
        return None
    if not math.isfinite(number):
        return None
    return number


def format_raw(value: float | None) -> str:
    if value is None:
        return "missing"
    if value == math.trunc(value):
        return str(int(value))
    return f"{value:.2f}".rstrip("0").rstrip(".")


def parse_timestamp(value: str) -> datetime | None:
    text = value.strip()
    if not text:
        return None
    if text.endswith("Z"):
        text = text[:-1] + "+00:00"
    try:
        parsed = datetime.fromisoformat(text)
    except ValueError:
        return None
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=datetime.now().astimezone().tzinfo)
    return parsed


class GasAlarmEngine:
    """One alarm episode at a time, shared by every client of this process."""

    def __init__(
        self,
        activation: float = ACTIVATION_THRESHOLD,
        recovery: float = RECOVERY_THRESHOLD,
        stale_s: float = STALE_AFTER_S,
    ) -> None:
        if not math.isfinite(activation) or activation <= 0:
            raise ValueError("activation threshold must be a finite number above 0")
        if not math.isfinite(recovery) or recovery < 0 or recovery > activation:
            raise ValueError("recovery threshold must be from 0 through the activation threshold")
        if not math.isfinite(stale_s) or stale_s < 1:
            raise ValueError("stale window must be at least 1 second")
        self.activation = float(activation)
        self.recovery = float(recovery)
        self.stale_s = float(stale_s)
        self._lock = threading.RLock()
        self._state = "INCOMPLETE"
        self._reading_status = "missing"
        self._event_n = 0
        self._event_id: str | None = None
        self._started_at: str | None = None
        self._acked_at: str | None = None
        self._triggered: set[str] = set()
        self._mq9: float | None = None
        self._mq135: float | None = None
        self._last_at: datetime | None = None
        self._saw_packet = False
        self._link_down = False
        self._detail = (
            "No MQ9 or MQ135 reading has arrived. Missing data is not treated as zero "
            "or as a normal condition."
        )

    @property
    def event_id(self) -> str | None:
        with self._lock:
            return self._event_id

    def observe_values(
        self,
        mq9: object,
        mq135: object,
        *,
        at: datetime,
        fresh: bool,
        link_down: bool = False,
    ) -> dict[str, object]:
        with self._lock:
            self._mq9 = finite_raw(mq9)
            self._mq135 = finite_raw(mq135)
            self._last_at = at if at.tzinfo is not None else at.replace(tzinfo=timezone.utc)
            self._saw_packet = True
            self._link_down = link_down
            self._reduce(fresh=fresh, at=self._last_at)
            return self._payload()

    def tick(self, now: datetime, *, link_down: bool) -> dict[str, object]:
        with self._lock:
            self._link_down = link_down
            if self._last_at is None:
                self._state = "INCOMPLETE"
                self._reading_status = "missing"
                self._detail = self._with_link(
                    "No MQ9 or MQ135 reading has arrived. Missing data is not treated as zero "
                    "or as a normal condition."
                )
                return self._payload()
            moment = now if now.tzinfo is not None else now.replace(tzinfo=timezone.utc)
            age = (moment - self._last_at).total_seconds()
            self._reduce(fresh=age <= self.stale_s, at=self._last_at)
            return self._payload()

    def acknowledge(self, at: datetime) -> dict[str, object]:
        with self._lock:
            if self._event_id is None or self._acked_at is not None:
                return self._payload()
            if self._state not in {"ALARM_ACTIVE", "SENSOR_DATA_STALE"}:
                return self._payload()
            moment = at if at.tzinfo is not None else at.replace(tzinfo=timezone.utc)
            self._acked_at = moment.isoformat(timespec="milliseconds")
            if self._state == "ALARM_ACTIVE":
                self._state = "ACKNOWLEDGED"
                self._detail = self._with_link(self._condition_detail())
            else:
                self._detail = self._with_link(self._stale_detail())
            return self._payload()

    def payload(self) -> dict[str, object]:
        with self._lock:
            return self._payload()

    def signature(self) -> tuple[object, ...]:
        with self._lock:
            return (
                self._state,
                self._event_id,
                tuple(name for name in SENSOR_ORDER if name in self._triggered),
                self._reading_status,
                self._acked_at,
                self._link_down,
                self._mq9,
                self._mq135,
            )

    def _reduce(self, *, fresh: bool, at: datetime) -> None:
        if not fresh:
            self._state = "SENSOR_DATA_STALE"
            self._reading_status = "stale"
            self._detail = self._with_link(self._stale_detail())
            return

        mq9_above = self._mq9 is not None and self._mq9 > self.activation
        mq135_above = self._mq135 is not None and self._mq135 > self.activation
        both_valid = self._mq9 is not None and self._mq135 is not None
        both_above = mq9_above and mq135_above
        self._reading_status = "valid" if both_valid else "incomplete"
        # One sensor at or below the threshold ends the episode. Missing data does not.
        recovered = both_valid and not both_above

        if self._event_id is not None:
            if recovered:
                self._clear_episode()
                self._state = "NORMAL"
            else:
                if both_above:
                    self._triggered.update(("mq9", "mq135"))
                self._state = "ACKNOWLEDGED" if self._acked_at else "ALARM_ACTIVE"
        elif both_above:
            self._event_n += 1
            self._event_id = f"gas-{self._event_n}"
            self._started_at = at.isoformat(timespec="milliseconds")
            self._acked_at = None
            self._triggered = {"mq9", "mq135"}
            self._state = "ALARM_ACTIVE"
        elif both_valid:
            self._state = "NORMAL"
        else:
            self._state = "INCOMPLETE"

        if self._state == "INCOMPLETE":
            self._detail = self._with_link(self._incomplete_detail())
        elif self._state == "NORMAL":
            self._detail = self._with_link(self._normal_detail())
        else:
            self._detail = self._with_link(self._condition_detail())

    def _clear_episode(self) -> None:
        self._event_id = None
        self._started_at = None
        self._acked_at = None
        self._triggered.clear()

    def _with_link(self, text: str) -> str:
        if not self._link_down:
            return text
        return text + " The receiver link is down."

    def _normal_detail(self) -> str:
        limit = format_raw(self.activation)
        return (
            f"MQ9 raw {format_raw(self._mq9)} and MQ135 raw {format_raw(self._mq135)}. "
            f"The alarm needs both sensors strictly above {limit} at the same time. "
            "That condition is inactive. "
            "Readings are raw sensor units, not a calibrated gas concentration. "
            "This does not confirm a fire."
        )

    def _incomplete_detail(self) -> str:
        mq9 = "MQ9 was not reported" if self._mq9 is None else f"MQ9 raw {format_raw(self._mq9)}"
        mq135 = "MQ135 was not reported" if self._mq135 is None else f"MQ135 raw {format_raw(self._mq135)}"
        return (
            f"{mq9}. {mq135}. Missing or invalid data is not treated as zero and is not evidence "
            f"that the reading is at or below {format_raw(self.activation)}."
        )

    def _stale_detail(self) -> str:
        text = (
            "Sensor data is too old to decide whether MQ9 or MQ135 is above "
            f"{format_raw(self.activation)}. This is not treated as a normal condition. "
            f"Last MQ9 raw {format_raw(self._mq9)}, last MQ135 raw {format_raw(self._mq135)}."
        )
        if self._acked_at:
            text += " The earlier alarm was acknowledged and is not marked as normal."
        elif self._event_id:
            text += " The last alarm episode is still remembered and is not marked as normal."
        return text

    def _condition_detail(self) -> str:
        limit = format_raw(self.activation)
        above: list[str] = []
        if self._mq9 is not None and self._mq9 > self.activation:
            above.append(f"MQ9 raw {format_raw(self._mq9)}")
        if self._mq135 is not None and self._mq135 > self.activation:
            above.append(f"MQ135 raw {format_raw(self._mq135)}")
        if len(above) == 2:
            sentence = (
                f"BOTH GAS SENSORS ABOVE {limit}. {above[0]} and {above[1]} "
                "are above the threshold together. This is one alarm."
            )
        elif len(above) == 1:
            if above[0].startswith("MQ9"):
                other = (
                    "MQ135 was not reported"
                    if self._mq135 is None
                    else f"MQ135 raw {format_raw(self._mq135)} is not above {limit}"
                )
            else:
                other = (
                    "MQ9 was not reported"
                    if self._mq9 is None
                    else f"MQ9 raw {format_raw(self._mq9)} is not above {limit}"
                )
            sentence = f"{above[0]} is above {limit}. {other}. The alarm stays open and is not marked as normal."
        else:
            sentence = (
                "The alarm stays open because a reading is missing. "
                f"Current MQ9 raw {format_raw(self._mq9)}, MQ135 raw {format_raw(self._mq135)}. "
                "A missing sensor is not treated as zero or as normal."
            )
        if self._reading_status == "incomplete" and len(above) > 0:
            sentence += " A missing sensor is not treated as zero or as normal."
        if self._state == "ACKNOWLEDGED":
            sentence += " Acknowledged. The high reading is not marked as normal."
        sentence += (
            " Readings are raw sensor units, not a calibrated gas concentration. This does not confirm a fire."
        )
        return sentence

    def _payload(self) -> dict[str, object]:
        return {
            "state": self._state,
            "activation_threshold": self.activation,
            "recovery_threshold": self.recovery,
            "units": "raw",
            "mq9_raw": self._mq9,
            "mq135_raw": self._mq135,
            "mq9_above": self._mq9 is not None and self._mq9 > self.activation,
            "mq135_above": self._mq135 is not None and self._mq135 > self.activation,
            "triggered_sensors": [name for name in SENSOR_ORDER if name in self._triggered],
            "event_id": self._event_id,
            "started_at": self._started_at,
            "acknowledged_at": self._acked_at,
            "reading_status": self._reading_status,
            "safe_to_treat_as_normal": self._state == "NORMAL",
            "detail": self._detail,
            "link_down": self._link_down,
        }
