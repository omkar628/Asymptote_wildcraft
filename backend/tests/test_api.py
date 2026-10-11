"""API tests. Serial collection is disabled and synthetic rows never touch the CSV log."""

from __future__ import annotations

import sys
import unittest
from pathlib import Path
from tempfile import TemporaryDirectory

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from fastapi.testclient import TestClient

from config import Settings
from main import create_app
from tests.samples import make_reading

REAL_CSV = Path(__file__).resolve().parents[1] / "data" / "sensor_readings.csv"
SYNTHETIC_MARK = "11.11"


def settings_for(path: Path, *, allow_test_inject: bool) -> Settings:
    if path.resolve() == REAL_CSV.resolve():
        raise AssertionError("A test tried to use the real sensor CSV.")
    return Settings(
        serial_port="COM6",
        baud_rate=115200,
        serial_enabled=False,
        csv_path=path,
        host="127.0.0.1",
        port=8000,
        history_default_limit=120,
        history_max_limit=500,
        memory_limit=1000,
        allow_test_inject=allow_test_inject,
        temp_c_high=None,
        humidity_percent_low=None,
        mq135_raw_high=None,
        mq9_raw_high=None,
        rssi_dbm_low=None,
    )


class ApiTests(unittest.TestCase):
    def setUp(self) -> None:
        self.real_before = REAL_CSV.read_bytes() if REAL_CSV.exists() else None
        self.tmp = TemporaryDirectory()
        self.csv_path = Path(self.tmp.name) / "sensor_readings.csv"
        self.app = create_app(settings_for(self.csv_path, allow_test_inject=True))

    def tearDown(self) -> None:
        if self.real_before is None:
            if REAL_CSV.exists():
                # Importing the service can create a header-only log. Tests must not add rows to it.
                text = REAL_CSV.read_text(encoding="utf-8")
                self.assertNotIn(SYNTHETIC_MARK, text)
                self.assertNotIn("synthetic", text)
        else:
            self.assertEqual(REAL_CSV.read_bytes(), self.real_before)
        self.tmp.cleanup()

    def test_health(self) -> None:
        with TestClient(self.app) as client:
            response = client.get("/health")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json(), {"status": "ok", "api": "running"})

    def test_latest_is_empty_before_any_reading(self) -> None:
        with TestClient(self.app) as client:
            response = client.get("/api/sensors/latest")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json(), {"reading": None, "empty": True})

    def test_history_and_latest_return_only_real_ingested_rows(self) -> None:
        first = make_reading(timestamp="2026-10-11T18:00:00.100+05:30")
        second = make_reading(timestamp="2026-10-11T18:00:01.100+05:30", temp_text="30.00", temp_c=30.0)
        self.app.state.hub.ingest(first)
        self.app.state.hub.ingest(second)
        with TestClient(self.app) as client:
            latest = client.get("/api/sensors/latest")
            history = client.get("/api/sensors/history", params={"limit": 1})
            status = client.get("/api/status")
        self.assertEqual(latest.status_code, 200)
        self.assertFalse(latest.json()["empty"])
        self.assertEqual(latest.json()["reading"]["timestamp"], second.timestamp)
        self.assertEqual(latest.json()["reading"]["source"], "serial")
        self.assertEqual(history.status_code, 200)
        self.assertEqual(history.json()["count"], 1)
        self.assertEqual(history.json()["readings"][0]["timestamp"], second.timestamp)
        self.assertEqual(status.json()["api"], "running")
        self.assertEqual(status.json()["serial"]["state"], "disabled")
        self.assertFalse(status.json()["serial"]["connected"])
        self.assertEqual(status.json()["serial"]["port"], "COM6")
        self.assertEqual(status.json()["serial"]["baud_rate"], 115200)
        self.assertEqual(status.json()["latest_reading_at"], second.timestamp)
        self.assertEqual(status.json()["stored_readings"], 2)
        self.assertIsNone(status.json()["thresholds"]["temp_c_high"])
        self.assertIn(first.timestamp, self.csv_path.read_text(encoding="utf-8"))
        self.assertIn(second.timestamp, self.csv_path.read_text(encoding="utf-8"))

    def test_history_limit_is_rejected_outside_the_configured_range(self) -> None:
        with TestClient(self.app) as client:
            low = client.get("/api/sensors/history", params={"limit": 0})
            high = client.get("/api/sensors/history", params={"limit": 5000})
        self.assertEqual(low.status_code, 422)
        self.assertEqual(high.status_code, 422)

    def test_logging_works_with_no_mobile_client(self) -> None:
        reading = make_reading()
        self.app.state.hub.ingest(reading)
        text = self.csv_path.read_text(encoding="utf-8")
        self.assertIn(reading.timestamp, text)
        self.assertIn("31.70", text)
        self.assertNotIn("synthetic", text)

    def test_synthetic_http_inject_is_not_stored(self) -> None:
        self.app.state.hub.ingest(make_reading())
        before = self.csv_path.read_text(encoding="utf-8")
        with TestClient(self.app) as client:
            response = client.post(
                "/api/test/inject",
                json={
                    "confirm_synthetic": True,
                    "temp_c": 11.11,
                    "humidity_percent": 22.22,
                    "mq135_raw": 333,
                    "mq9_raw": 444,
                    "rssi_dbm": -55,
                },
            )
            latest = client.get("/api/sensors/latest")
        self.assertEqual(response.status_code, 200)
        body = response.json()
        self.assertTrue(body["synthetic"])
        self.assertFalse(body["persisted"])
        self.assertEqual(body["reading"]["source"], "test")
        self.assertEqual(body["reading"]["label"], "synthetic test data")
        self.assertEqual(body["reading"]["temp_c"], 11.11)
        self.assertEqual(self.csv_path.read_text(encoding="utf-8"), before)
        self.assertNotIn(SYNTHETIC_MARK, self.csv_path.read_text(encoding="utf-8"))
        self.assertEqual(latest.json()["reading"]["source"], "serial")
        self.assertNotEqual(latest.json()["reading"]["temp_c"], 11.11)

    def test_synthetic_inject_is_hidden_when_disabled(self) -> None:
        quiet = create_app(settings_for(self.csv_path.with_name("quiet.csv"), allow_test_inject=False))
        with TestClient(quiet) as client:
            response = client.post(
                "/api/test/inject",
                json={
                    "confirm_synthetic": True,
                    "temp_c": 11.11,
                    "humidity_percent": 22.22,
                    "mq135_raw": 333,
                    "mq9_raw": 444,
                    "rssi_dbm": -55,
                },
            )
        self.assertEqual(response.status_code, 404)

    def test_websocket_streams_labeled_synthetic_reading(self) -> None:
        before = self.csv_path.read_text(encoding="utf-8")
        with TestClient(self.app) as client:
            with client.websocket_connect("/ws/sensors") as socket:
                snapshot = socket.receive_json()
                self.assertEqual(snapshot["type"], "snapshot")
                self.assertIsNone(snapshot["latest"])
                self.assertFalse(snapshot["synthetic"])
                socket.send_json(
                    {
                        "type": "inject-synthetic",
                        "confirm_synthetic": True,
                        "temp_c": 11.11,
                        "humidity_percent": 22.22,
                        "mq135_raw": 333,
                        "mq9_raw": 444,
                        "rssi_dbm": -55,
                    }
                )
                message = socket.receive_json()
        self.assertEqual(message["type"], "reading")
        self.assertTrue(message["synthetic"])
        self.assertEqual(message["reading"]["source"], "test")
        self.assertEqual(message["reading"]["label"], "synthetic test data")
        self.assertEqual(message["reading"]["temp_c"], 11.11)
        self.assertEqual(message["reading"]["mq135_raw"], 333)
        self.assertEqual(self.csv_path.read_text(encoding="utf-8"), before)

    def test_existing_csv_history_is_loaded_and_not_duplicated(self) -> None:
        self.app.state.hub.ingest(make_reading(timestamp="2026-10-11T18:00:00.100+05:30"))
        reloaded = create_app(settings_for(self.csv_path, allow_test_inject=True))
        self.assertEqual(reloaded.state.hub.store.count(), 1)
        text = self.csv_path.read_text(encoding="utf-8")
        self.assertEqual(text.count("2026-10-11T18:00:00.100+05:30"), 1)


if __name__ == "__main__":
    unittest.main()
