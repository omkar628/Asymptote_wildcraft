"""Parse the NodeMCU receiver stream, log it, and read COM port data on a thread.

Expected serial text. The "Received packet:" prefix may be absent or repeated,
and Flame is optional:

    Received packet: Temp:29.60,Hum:70.50,MQ135:377,MQ9:356,Flame:0
    Received packet: Temp:31.70,Hum:45.70,MQ135:418,MQ9:479
    RSSI: -32

RSSI is attached to the packet line that came before it. A packet that already
includes Flame is complete on its own. The API process does not invent readings
when the port is quiet.
"""

from __future__ import annotations

import csv
import math
import os
import re
import sys
import threading
from collections import deque
from collections.abc import Callable
from dataclasses import dataclass
from datetime import datetime
from pathlib import Path

CSV_COLUMNS = [
    "timestamp",
    "temp_c",
    "humidity_percent",
    "mq135_raw",
    "mq9_raw",
    "rssi_dbm",
]

_NUMBER = r"[+-]?(?:\d+(?:\.\d+)?|\.\d+)"
PACKET_RE = re.compile(
    rf"(?:Received\s+packet:\s*)*"
    rf"Temp:\s*(?P<temp>{_NUMBER})\s*,\s*"
    rf"Hum:\s*(?P<hum>{_NUMBER})\s*,\s*"
    rf"MQ135:\s*(?P<mq135>{_NUMBER})\s*,\s*"
    rf"MQ9:\s*(?P<mq9>{_NUMBER})"
    rf"(?:\s*,\s*Flame:\s*(?P<flame>{_NUMBER}))?",
    re.IGNORECASE,
)
RSSI_RE = re.compile(rf"^RSSI:\s*({_NUMBER})\s*$", re.IGNORECASE)
TRAILING_RSSI_RE = re.compile(rf"RSSI:\s*({_NUMBER})", re.IGNORECASE)
SEPARATOR_RE = re.compile(r"^-{3,}\s*$")


def open_receiver_port(port: str, baud_rate: int):
    """Open COM without pulsing DTR/RTS, so the ESP8266 is not reset."""
    import serial

    handle = serial.Serial()
    handle.port = port
    handle.baudrate = baud_rate
    handle.timeout = 1
    handle.write_timeout = 1
    handle.dsrdtr = False
    handle.rtscts = False
    handle.dtr = False
    handle.rts = False
    handle.open()
    handle.dtr = False
    handle.rts = False
    return handle


def log_line(message: str) -> None:
    text = " ".join(message.splitlines())
    try:
        print(text, flush=True)
    except UnicodeEncodeError:
        sys.stdout.buffer.write(text.encode("ascii", errors="replace") + b"\n")
        sys.stdout.flush()


def local_timestamp() -> str:
    return datetime.now().astimezone().isoformat(timespec="milliseconds")


def _finite(token: str) -> float | None:
    try:
        value = float(token)
    except ValueError:
        return None
    if not math.isfinite(value):
        return None
    return value


@dataclass(frozen=True)
class SensorReading:
    timestamp: str
    temp_c: float
    humidity_percent: float
    mq135_raw: float
    mq9_raw: float
    rssi_dbm: float | None
    temp_text: str
    humidity_text: str
    mq135_text: str
    mq9_text: str
    rssi_text: str
    flame_text: str = ""

    def as_dict(self) -> dict[str, object]:
        return {
            "timestamp": self.timestamp,
            "temp_c": self.temp_c,
            "humidity_percent": self.humidity_percent,
            "mq135_raw": self.mq135_raw,
            "mq9_raw": self.mq9_raw,
            "rssi_dbm": self.rssi_dbm,
            "source": "serial",
        }


def format_reading(reading: SensorReading) -> str:
    parts = [
        f"Temp: {reading.temp_text} \u00b0C",
        f"Humidity: {reading.humidity_text}%",
        f"MQ135: {reading.mq135_text}",
        f"MQ9: {reading.mq9_text}",
    ]
    if reading.flame_text:
        parts.append(f"Flame: {reading.flame_text}")
    return " | ".join(parts)


def _packet_tokens(match: re.Match[str]) -> dict[str, str] | None:
    tokens = {
        "temp_text": match.group("temp"),
        "humidity_text": match.group("hum"),
        "mq135_text": match.group("mq135"),
        "mq9_text": match.group("mq9"),
        "flame_text": match.group("flame") or "",
    }
    required = (tokens["temp_text"], tokens["humidity_text"], tokens["mq135_text"], tokens["mq9_text"])
    if any(_finite(value) is None for value in required):
        return None
    if tokens["flame_text"] and _finite(tokens["flame_text"]) is None:
        return None
    return tokens


def parse_packets(line: str) -> list[tuple[dict[str, str], int]]:
    found: list[tuple[dict[str, str], int]] = []
    for match in PACKET_RE.finditer(line):
        tokens = _packet_tokens(match)
        if tokens is not None:
            found.append((tokens, match.end()))
    return found


def parse_rssi(line: str) -> str | None:
    match = RSSI_RE.match(line.strip())
    if match is None:
        return None
    token = match.group(1)
    if _finite(token) is None:
        return None
    return token


class PacketAssembler:
    """Associate each RSSI line with the packet line that preceded it."""

    def __init__(self, clock: Callable[[], str] | None = None) -> None:
        self._clock = clock or local_timestamp
        self._pending: dict[str, str] | None = None
        self.last_event = "ignored"

    def feed(self, line: str) -> list[SensorReading]:
        stripped = line.replace("\r", " ").strip()
        if not stripped:
            self.last_event = "ignored"
            return []
        if SEPARATOR_RE.match(stripped):
            self.last_event = "separator"
            return []
        packets = parse_packets(stripped)
        if packets:
            return self._consume_packets(stripped, packets)
        rssi = parse_rssi(stripped)
        if rssi is not None:
            if self._pending is None:
                self.last_event = "rssi_orphan"
                return []
            pending = self._pending
            self._pending = None
            self.last_event = "rssi"
            return [self._to_reading(pending, rssi)]
        self.last_event = "unrecognized"
        return []

    def _consume_packets(self, text: str, packets: list[tuple[dict[str, str], int]]) -> list[SensorReading]:
        readings: list[SensorReading] = []
        if self._pending is not None:
            readings.append(self._to_reading(self._pending, None))
            self._pending = None
        last_index = len(packets) - 1
        for index, (packet, end) in enumerate(packets):
            pending = {**packet, "timestamp": self._clock()}
            last = index == last_index
            rssi = _last_rssi(text, end) if last else None
            complete = bool(packet["flame_text"]) or rssi is not None or not last
            if complete:
                readings.append(self._to_reading(pending, rssi))
            else:
                self._pending = pending
        self.last_event = "packet"
        return readings

    def _to_reading(self, pending: dict[str, str], rssi_text: str | None) -> SensorReading:
        rssi_value = None if rssi_text is None else float(rssi_text)
        return SensorReading(
            timestamp=pending["timestamp"],
            temp_c=float(pending["temp_text"]),
            humidity_percent=float(pending["humidity_text"]),
            mq135_raw=float(pending["mq135_text"]),
            mq9_raw=float(pending["mq9_text"]),
            rssi_dbm=rssi_value,
            temp_text=pending["temp_text"],
            humidity_text=pending["humidity_text"],
            mq135_text=pending["mq135_text"],
            mq9_text=pending["mq9_text"],
            rssi_text="" if rssi_text is None else rssi_text,
            flame_text=pending.get("flame_text", ""),
        )


def _last_rssi(text: str, start: int) -> str | None:
    match = TRAILING_RSSI_RE.search(text, start)
    if match is None:
        return None
    token = match.group(1)
    if _finite(token) is None:
        return None
    return token


def collect_lines(lines: list[str], clock: Callable[[], str] | None = None) -> list[SensorReading]:
    assembler = PacketAssembler(clock=clock)
    readings: list[SensorReading] = []
    for line in lines:
        readings.extend(assembler.feed(line))
    return readings


def reading_from_csv_row(row: dict[str, str | None]) -> SensorReading | None:
    try:
        timestamp = (row.get("timestamp") or "").strip()
        temp_text = (row.get("temp_c") or "").strip()
        humidity_text = (row.get("humidity_percent") or "").strip()
        mq135_text = (row.get("mq135_raw") or "").strip()
        mq9_text = (row.get("mq9_raw") or "").strip()
        rssi_text = (row.get("rssi_dbm") or "").strip()
        if not timestamp or not temp_text or not humidity_text or not mq135_text or not mq9_text:
            return None
        numbers = [
            float(temp_text),
            float(humidity_text),
            float(mq135_text),
            float(mq9_text),
        ]
        rssi_value = float(rssi_text) if rssi_text else None
        if rssi_value is not None:
            numbers.append(rssi_value)
        if not all(math.isfinite(value) for value in numbers):
            return None
    except (TypeError, ValueError):
        return None
    return SensorReading(
        timestamp=timestamp,
        temp_c=float(temp_text),
        humidity_percent=float(humidity_text),
        mq135_raw=float(mq135_text),
        mq9_raw=float(mq9_text),
        rssi_dbm=rssi_value,
        temp_text=temp_text,
        humidity_text=humidity_text,
        mq135_text=mq135_text,
        mq9_text=mq9_text,
        rssi_text=rssi_text,
    )


def load_recent(path: Path, limit: int) -> list[SensorReading]:
    if limit <= 0 or not path.exists() or path.stat().st_size == 0:
        return []
    kept: deque[SensorReading] = deque(maxlen=limit)
    with path.open(newline="", encoding="utf-8") as handle:
        reader = csv.DictReader(handle)
        if reader.fieldnames is None:
            return []
        fields = {name.strip() for name in reader.fieldnames if name}
        if not set(CSV_COLUMNS).issubset(fields):
            return []
        for row in reader:
            parsed = reading_from_csv_row(row)
            if parsed is not None:
                kept.append(parsed)
    return list(kept)


class CsvLog:
    """Append-only log. An existing file with history is never rewritten."""

    def __init__(self, path: Path) -> None:
        self.path = path
        self._lock = threading.Lock()
        self.path.parent.mkdir(parents=True, exist_ok=True)
        self._ensure_header()

    def _ensure_header(self) -> None:
        if not self.path.exists() or self.path.stat().st_size == 0:
            with self.path.open("w", newline="", encoding="utf-8") as handle:
                writer = csv.writer(handle, lineterminator="\n")
                writer.writerow(CSV_COLUMNS)
                handle.flush()
                os.fsync(handle.fileno())
            return
        with self.path.open("r", encoding="utf-8", newline="") as handle:
            header = handle.readline().strip()
        expected = ",".join(CSV_COLUMNS)
        if header != expected:
            raise RuntimeError(
                f"CSV header in {self.path} does not match the sensor log. The existing file was left unchanged."
            )

    def append(self, reading: SensorReading) -> None:
        row = [
            reading.timestamp,
            reading.temp_text,
            reading.humidity_text,
            reading.mq135_text,
            reading.mq9_text,
            reading.rssi_text,
        ]
        with self._lock:
            with self.path.open("a", newline="", encoding="utf-8") as handle:
                writer = csv.writer(handle, lineterminator="\n")
                writer.writerow(row)
                handle.flush()
                os.fsync(handle.fileno())


class ReadingStore:
    def __init__(self, maxlen: int) -> None:
        self._items: deque[SensorReading] = deque(maxlen=max(1, maxlen))
        self.latest: SensorReading | None = None
        self._lock = threading.Lock()

    def add(self, reading: SensorReading) -> None:
        with self._lock:
            self._items.append(reading)
            self.latest = reading

    def history(self, limit: int) -> list[SensorReading]:
        with self._lock:
            items = list(self._items)
        if limit <= 0:
            return []
        return items[-limit:]

    def count(self) -> int:
        with self._lock:
            return len(self._items)


class SerialCollector(threading.Thread):
    """Read the serial port without blocking the API event loop."""

    def __init__(
        self,
        port: str,
        baud_rate: int,
        on_reading: Callable[[SensorReading], None],
        on_status: Callable[[str, bool, str | None], None],
    ) -> None:
        super().__init__(name="sensor-serial", daemon=True)
        self.port = port
        self.baud_rate = baud_rate
        self._on_reading = on_reading
        self._on_status = on_status
        self._stop = threading.Event()

    def stop(self) -> None:
        self._stop.set()
        self.join(timeout=5)

    def run(self) -> None:
        try:
            import serial
            from serial import SerialException
        except ImportError:
            self._on_status("disconnected", False, "pyserial is not installed")
            log_line("[sensor] pyserial is not installed. The API will keep running without serial collection.")
            return

        reported_error: str | None = None
        while not self._stop.is_set():
            self._on_status("connecting", False, None)
            try:
                # DTR/RTS stay off. The NodeMCU reset circuit uses those lines, and
                # the default open pulse restarts a receiver that is already running.
                with open_receiver_port(self.port, self.baud_rate) as handle:
                    self._on_status("connected", True, None)
                    reported_error = None
                    assembler = PacketAssembler()
                    while not self._stop.is_set():
                        raw = handle.readline()
                        if not raw:
                            continue
                        text = raw.decode("utf-8", errors="replace").replace("\r", "\n")
                        for line in text.split("\n"):
                            for reading in assembler.feed(line):
                                try:
                                    self._on_reading(reading)
                                except Exception as exc:
                                    log_line(f"[sensor] Could not store a reading: {exc}")
            except (SerialException, OSError) as exc:
                self._on_status("reconnecting", False, str(exc))
                message = str(exc)
                if message != reported_error:
                    log_line(
                        f"[sensor] Could not read {self.port}: {exc}. "
                        "Close any other program using this port."
                    )
                    reported_error = message
                if self._stop.wait(2):
                    break
            except Exception as exc:
                self._on_status("reconnecting", False, str(exc))
                message = str(exc)
                if message != reported_error:
                    log_line(f"[sensor] Serial collector error: {exc}")
                    reported_error = message
                if self._stop.wait(2):
                    break
        self._on_status("disconnected", False, None)
