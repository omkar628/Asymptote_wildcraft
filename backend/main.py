"""Forest sensor API.

The serial collector runs on a background thread. CSV logging continues when
no phone is connected. Synthetic test traffic is accepted only when
SENSOR_ALLOW_TEST_INJECT is enabled, and it is never written to the CSV log.
"""

from __future__ import annotations

import asyncio
import json
import logging
import math
import threading
from contextlib import asynccontextmanager
from typing import Literal

import uvicorn
from fastapi import FastAPI, HTTPException, Request, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, field_validator, model_validator

from alerts import AlertEngine, Thresholds
from config import Settings
from serial_collector import (
    CsvLog,
    ReadingStore,
    SensorReading,
    SerialCollector,
    format_reading,
    load_recent,
    local_timestamp,
    log_line,
)

SerialState = Literal["connecting", "connected", "reconnecting", "disconnected", "disabled"]


class ReadingOut(BaseModel):
    timestamp: str
    temp_c: float
    humidity_percent: float
    mq135_raw: float
    mq9_raw: float
    rssi_dbm: float | None
    source: Literal["serial"]

    @field_validator("temp_c", "humidity_percent", "mq135_raw", "mq9_raw")
    @classmethod
    def finite_number(cls, value: float) -> float:
        if not math.isfinite(value):
            raise ValueError("Reading values must be finite")
        return value

    @field_validator("rssi_dbm")
    @classmethod
    def finite_rssi(cls, value: float | None) -> float | None:
        if value is not None and not math.isfinite(value):
            raise ValueError("RSSI must be finite")
        return value


class SyntheticReadingOut(BaseModel):
    timestamp: str
    temp_c: float
    humidity_percent: float
    mq135_raw: float
    mq9_raw: float
    rssi_dbm: float | None
    source: Literal["test"]
    label: Literal["synthetic test data"]

    @field_validator("temp_c", "humidity_percent", "mq135_raw", "mq9_raw")
    @classmethod
    def finite_number(cls, value: float) -> float:
        if not math.isfinite(value):
            raise ValueError("Test values must be finite")
        return value

    @field_validator("rssi_dbm")
    @classmethod
    def finite_rssi(cls, value: float | None) -> float | None:
        if value is not None and not math.isfinite(value):
            raise ValueError("RSSI must be finite")
        return value


class LatestOut(BaseModel):
    reading: ReadingOut | None
    empty: bool

    @model_validator(mode="after")
    def empty_matches_reading(self) -> LatestOut:
        if self.empty != (self.reading is None):
            raise ValueError("empty flag does not match reading")
        return self


class HistoryOut(BaseModel):
    readings: list[ReadingOut]
    count: int

    @model_validator(mode="after")
    def count_matches(self) -> HistoryOut:
        if self.count != len(self.readings):
            raise ValueError("count does not match readings")
        return self


class SerialStatusOut(BaseModel):
    state: SerialState
    connected: bool
    port: str
    baud_rate: int
    last_error: str | None


class ThresholdsOut(BaseModel):
    temp_c_high: float | None
    humidity_percent_low: float | None
    mq135_raw_high: float | None
    mq9_raw_high: float | None
    rssi_dbm_low: float | None


class AlertOut(BaseModel):
    id: str
    source: Literal["threshold"]
    scope: Literal["laptop"]
    title: str
    detail: str
    severity: Literal["warning"]


class HealthOut(BaseModel):
    status: Literal["ok"]
    api: Literal["running"]


class StatusOut(BaseModel):
    api: Literal["running"]
    serial: SerialStatusOut
    latest_reading_at: str | None
    stored_readings: int
    thresholds: ThresholdsOut
    preliminary_alerts: list[AlertOut]


class TestInjectBody(BaseModel):
    confirm_synthetic: Literal[True]
    temp_c: float
    humidity_percent: float
    mq135_raw: float
    mq9_raw: float
    rssi_dbm: float | None = None

    @field_validator("temp_c", "humidity_percent", "mq135_raw", "mq9_raw")
    @classmethod
    def finite_number(cls, value: float) -> float:
        if not math.isfinite(value):
            raise ValueError("Test values must be finite")
        return value

    @field_validator("rssi_dbm")
    @classmethod
    def finite_rssi(cls, value: float | None) -> float | None:
        if value is not None and not math.isfinite(value):
            raise ValueError("RSSI must be finite")
        return value


class TestInjectOut(BaseModel):
    accepted: Literal[True]
    persisted: Literal[False]
    synthetic: Literal[True]
    reading: SyntheticReadingOut


class ConnectionManager:
    def __init__(self) -> None:
        self._clients: set[WebSocket] = set()
        self._lock = asyncio.Lock()

    async def connect(self, websocket: WebSocket) -> None:
        await websocket.accept()
        async with self._lock:
            self._clients.add(websocket)

    def disconnect(self, websocket: WebSocket) -> None:
        self._clients.discard(websocket)

    async def broadcast(self, message: dict) -> None:
        async with self._lock:
            clients = list(self._clients)
        stale: list[WebSocket] = []
        for websocket in clients:
            try:
                await websocket.send_json(message)
            except Exception:
                stale.append(websocket)
        if stale:
            async with self._lock:
                for websocket in stale:
                    self._clients.discard(websocket)


class Hub:
    def __init__(self, settings: Settings) -> None:
        self.settings = settings
        self.csv = CsvLog(settings.csv_path)
        self.store = ReadingStore(settings.memory_limit)
        self.alerts = AlertEngine(
            Thresholds(
                temp_c_high=settings.temp_c_high,
                humidity_percent_low=settings.humidity_percent_low,
                mq135_raw_high=settings.mq135_raw_high,
                mq9_raw_high=settings.mq9_raw_high,
                rssi_dbm_low=settings.rssi_dbm_low,
            )
        )
        self.manager = ConnectionManager()
        self.loop: asyncio.AbstractEventLoop | None = None
        self.collector: SerialCollector | None = None
        self.serial_state: SerialState = "disconnected"
        self.serial_connected = False
        self.serial_error: str | None = None
        self._status_lock = threading.Lock()
        for reading in load_recent(settings.csv_path, settings.memory_limit):
            self.store.add(reading)
        if self.store.latest is not None:
            self.alerts.observe(self.store.latest)

    def serial_status(self) -> dict[str, object]:
        with self._status_lock:
            return {
                "state": self.serial_state,
                "connected": self.serial_connected,
                "port": self.settings.serial_port,
                "baud_rate": self.settings.baud_rate,
                "last_error": self.serial_error,
            }

    def set_serial_status(self, state: SerialState, connected: bool, error: str | None) -> None:
        with self._status_lock:
            unchanged = (
                state == self.serial_state
                and connected == self.serial_connected
                and error == self.serial_error
            )
            self.serial_state = state
            self.serial_connected = connected
            self.serial_error = error
            current = {
                "state": self.serial_state,
                "connected": self.serial_connected,
                "port": self.settings.serial_port,
                "baud_rate": self.settings.baud_rate,
                "last_error": self.serial_error,
            }
        if unchanged:
            return
        message = {
            "type": "status",
            "serial": SerialStatusOut(**current).model_dump(),
            "synthetic": False,
        }
        self.publish(message)

    def snapshot_message(self) -> dict:
        latest = None
        if self.store.latest is not None:
            latest = ReadingOut(**self.store.latest.as_dict()).model_dump()
        return {
            "type": "snapshot",
            "latest": latest,
            "serial": SerialStatusOut(**self.serial_status()).model_dump(),
            "preliminary_alerts": [AlertOut(**item).model_dump() for item in self.alerts.payload()],
            "synthetic": False,
        }

    def reading_message(self, reading: SensorReading, changed: bool) -> dict:
        return {
            "type": "reading",
            "reading": ReadingOut(**reading.as_dict()).model_dump(),
            "preliminary_alerts": [AlertOut(**item).model_dump() for item in self.alerts.payload()],
            "alerts_changed": changed,
            "synthetic": False,
        }

    def ingest(self, reading: SensorReading) -> None:
        saved = True
        try:
            self.csv.append(reading)
        except Exception as exc:
            saved = False
            log_line(f"[sensor] CSV write failed. The reading was not saved: {exc}")
        self.store.add(reading)
        observed = self.alerts.observe(reading)
        if not saved:
            log_line("[sensor] Reading is in memory only and was not written to the CSV log.")
        log_line(format_reading(reading))
        try:
            message = self.reading_message(reading, bool(observed["changed"]))
        except Exception as exc:
            log_line(f"[sensor] Reading failed validation and was not broadcast: {exc}")
            return
        self.publish(message)

    def publish(self, message: dict) -> None:
        loop = self.loop
        if loop is None or not loop.is_running():
            return
        future = asyncio.run_coroutine_threadsafe(self.manager.broadcast(message), loop)

        def _done(done: asyncio.Future) -> None:
            try:
                done.result()
            except Exception as exc:
                log_line(f"[sensor] Broadcast failed: {exc}")

        future.add_done_callback(_done)

    def synthetic_reading(self, body: TestInjectBody) -> SyntheticReadingOut:
        return SyntheticReadingOut(
            timestamp=local_timestamp(),
            temp_c=body.temp_c,
            humidity_percent=body.humidity_percent,
            mq135_raw=body.mq135_raw,
            mq9_raw=body.mq9_raw,
            rssi_dbm=body.rssi_dbm,
            source="test",
            label="synthetic test data",
        )

    def synthetic_message(self, reading: SyntheticReadingOut) -> dict:
        return {
            "type": "reading",
            "reading": reading.model_dump(),
            "preliminary_alerts": [],
            "alerts_changed": False,
            "synthetic": True,
        }

    async def broadcast_synthetic(self, body: TestInjectBody) -> SyntheticReadingOut:
        reading = self.synthetic_reading(body)
        await self.manager.broadcast(self.synthetic_message(reading))
        return reading


def create_app(settings: Settings | None = None) -> FastAPI:
    resolved = settings if settings is not None else Settings.from_env()
    hub = Hub(resolved)

    @asynccontextmanager
    async def lifespan(app: FastAPI):
        app.state.hub.loop = asyncio.get_running_loop()
        current: Settings = app.state.settings
        if current.serial_enabled:
            app.state.hub.collector = SerialCollector(
                current.serial_port,
                current.baud_rate,
                app.state.hub.ingest,
                app.state.hub.set_serial_status,
            )
            app.state.hub.collector.start()
        else:
            app.state.hub.set_serial_status("disabled", False, None)
        try:
            yield
        finally:
            collector = app.state.hub.collector
            app.state.hub.collector = None
            if collector is not None:
                collector.stop()

    app = FastAPI(title="Forest sensor API", lifespan=lifespan)
    app.state.settings = resolved
    app.state.hub = hub
    app.add_middleware(
        CORSMiddleware,
        allow_origins=["*"],
        allow_credentials=False,
        allow_methods=["GET", "POST", "OPTIONS"],
        allow_headers=["*"],
    )

    @app.get("/health", response_model=HealthOut)
    def health() -> HealthOut:
        return HealthOut(status="ok", api="running")

    @app.get("/api/sensors/latest", response_model=LatestOut)
    def latest() -> LatestOut:
        current_reading = app.state.hub.store.latest
        if current_reading is None:
            return LatestOut(reading=None, empty=True)
        return LatestOut(reading=ReadingOut(**current_reading.as_dict()), empty=False)

    @app.get("/api/sensors/history", response_model=HistoryOut)
    def history(limit: int | None = None) -> HistoryOut:
        current_settings: Settings = app.state.settings
        resolved_limit = current_settings.history_default_limit if limit is None else limit
        if resolved_limit < 1 or resolved_limit > current_settings.history_max_limit:
            raise HTTPException(
                status_code=422,
                detail=f"limit must be from 1 to {current_settings.history_max_limit}",
            )
        rows = [ReadingOut(**item.as_dict()) for item in app.state.hub.store.history(resolved_limit)]
        return HistoryOut(readings=rows, count=len(rows))

    @app.get("/api/status", response_model=StatusOut)
    def status() -> StatusOut:
        current_hub: Hub = app.state.hub
        latest_reading = current_hub.store.latest
        return StatusOut(
            api="running",
            serial=SerialStatusOut(**current_hub.serial_status()),
            latest_reading_at=None if latest_reading is None else latest_reading.timestamp,
            stored_readings=current_hub.store.count(),
            thresholds=ThresholdsOut(**current_hub.alerts.thresholds.as_dict()),
            preliminary_alerts=[AlertOut(**item) for item in current_hub.alerts.payload()],
        )

    @app.post("/api/test/inject", response_model=TestInjectOut)
    async def inject_test(body: TestInjectBody, request: Request) -> TestInjectOut:
        current_settings: Settings = request.app.state.settings
        if not current_settings.allow_test_inject:
            raise HTTPException(status_code=404, detail="Not found")
        reading = await request.app.state.hub.broadcast_synthetic(body)
        return TestInjectOut(accepted=True, persisted=False, synthetic=True, reading=reading)

    @app.websocket("/ws/sensors")
    async def sensors_ws(websocket: WebSocket) -> None:
        current_hub: Hub = websocket.app.state.hub
        current_settings: Settings = websocket.app.state.settings
        await current_hub.manager.connect(websocket)
        try:
            await websocket.send_json(current_hub.snapshot_message())
            while True:
                incoming = await websocket.receive_text()
                if not current_settings.allow_test_inject:
                    continue
                await _maybe_inject_from_socket(current_hub, incoming)
        except WebSocketDisconnect:
            pass
        except Exception as exc:
            log_line(f"[sensor] WebSocket closed: {exc}")
        finally:
            current_hub.manager.disconnect(websocket)

    return app


async def _maybe_inject_from_socket(hub: Hub, incoming: str) -> None:
    try:
        payload = json.loads(incoming)
    except json.JSONDecodeError:
        return
    if not isinstance(payload, dict) or payload.get("type") != "inject-synthetic":
        return
    try:
        body = TestInjectBody(
            confirm_synthetic=payload.get("confirm_synthetic"),
            temp_c=payload.get("temp_c"),
            humidity_percent=payload.get("humidity_percent"),
            mq135_raw=payload.get("mq135_raw"),
            mq9_raw=payload.get("mq9_raw"),
            rssi_dbm=payload.get("rssi_dbm"),
        )
    except Exception:
        return
    await hub.broadcast_synthetic(body)


app = create_app()


def main() -> None:
    settings: Settings = app.state.settings
    for logger_name in ("uvicorn", "uvicorn.error", "uvicorn.access"):
        logging.getLogger(logger_name).setLevel(logging.WARNING)
    uvicorn.run(
        app,
        host=settings.host,
        port=settings.port,
        log_level="warning",
        access_log=False,
    )


if __name__ == "__main__":
    main()
