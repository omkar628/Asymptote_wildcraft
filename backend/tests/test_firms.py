"""FIRMS parsing and route tests. They do not call NASA or print a map key."""

from __future__ import annotations

import os
import sys
import unittest
from pathlib import Path
from tempfile import TemporaryDirectory

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from fastapi.testclient import TestClient

import firms
from config import load_local_env
from main import create_app
from tests.test_api import settings_for

CSV_HEADER = "latitude,longitude,bright_ti4,scan,track,acq_date,acq_time,satellite,instrument,confidence,version,bright_ti5,frp,daynight"
CSV_ROW = "20.2100,79.3400,320.1,0.4,0.4,2026-10-16,724,N,VIIRS,nominal,2.0,290.2,5.5,D"


class FirmsParseTests(unittest.TestCase):
    def test_csv_row_keeps_coordinates_confidence_and_frp(self) -> None:
        rows = firms.parse_hotspot_csv(CSV_HEADER + "\n" + CSV_ROW + "\n")
        self.assertEqual(len(rows), 1)
        self.assertEqual(rows[0]["latitude"], 20.21)
        self.assertEqual(rows[0]["longitude"], 79.34)
        self.assertEqual(rows[0]["acq_date"], "2026-10-16")
        self.assertEqual(rows[0]["acq_time"], "07:24 UTC")
        self.assertEqual(rows[0]["confidence"], "nominal")
        self.assertEqual(rows[0]["satellite"], "N")
        self.assertEqual(rows[0]["instrument"], "VIIRS")
        self.assertEqual(rows[0]["frp"], 5.5)

    def test_header_only_is_an_empty_result(self) -> None:
        self.assertEqual(firms.parse_hotspot_csv(CSV_HEADER + "\n"), [])

    def test_invalid_key_text_is_not_returned(self) -> None:
        with self.assertRaises(firms.FirmsError) as caught:
            firms.parse_hotspot_csv("Invalid MAP_KEY unit-test-secret\n")
        self.assertNotIn("unit-test-secret", caught.exception.message)
        self.assertIn("rejected", caught.exception.message)

    def test_scrub_removes_a_key(self) -> None:
        cleaned = firms.scrub("https://example.test/unit-test-secret/area", "unit-test-secret")
        self.assertNotIn("unit-test-secret", cleaned)

    def test_env_file_loads_the_key_name_without_overriding_the_shell(self) -> None:
        saved = os.environ.get("NASA_FIRMS_MAP_KEY")
        try:
            os.environ.pop("NASA_FIRMS_MAP_KEY", None)
            with TemporaryDirectory() as tmp:
                path = Path(tmp) / ".env"
                path.write_text("NASA_FIRMS_MAP_KEY=unit-test-map-key\n", encoding="utf-8")
                load_local_env(path)
                self.assertEqual(os.environ.get("NASA_FIRMS_MAP_KEY"), "unit-test-map-key")
                path.write_text("NASA_FIRMS_MAP_KEY=replaced\n", encoding="utf-8")
                load_local_env(path)
                self.assertEqual(os.environ.get("NASA_FIRMS_MAP_KEY"), "unit-test-map-key")
        finally:
            if saved is None:
                os.environ.pop("NASA_FIRMS_MAP_KEY", None)
            else:
                os.environ["NASA_FIRMS_MAP_KEY"] = saved


class FirmsRouteTests(unittest.TestCase):
    def setUp(self) -> None:
        self.tmp = TemporaryDirectory()
        self.app = create_app(settings_for(Path(self.tmp.name) / "sensor_readings.csv", allow_test_inject=False))
        self.saved_key = os.environ.get("NASA_FIRMS_MAP_KEY")
        firms._cache.clear()

    def tearDown(self) -> None:
        if self.saved_key is None:
            os.environ.pop("NASA_FIRMS_MAP_KEY", None)
        else:
            os.environ["NASA_FIRMS_MAP_KEY"] = self.saved_key
        self.tmp.cleanup()

    def test_status_does_not_include_the_key(self) -> None:
        os.environ["NASA_FIRMS_MAP_KEY"] = "unit-test-secret"
        with TestClient(self.app) as client:
            response = client.get("/api/firms/status")
        self.assertEqual(response.status_code, 200)
        body = response.json()
        self.assertTrue(body["configured"])
        self.assertNotIn("unit-test-secret", response.text)

    def test_missing_key_is_a_clear_error(self) -> None:
        os.environ.pop("NASA_FIRMS_MAP_KEY", None)
        with TestClient(self.app) as client:
            response = client.get("/api/firms/hotspots", params={"west": 79.1, "south": 19.9, "east": 79.7, "north": 20.5, "days": 1})
        self.assertEqual(response.status_code, 503)
        self.assertIn("not configured", response.json()["detail"])

    def test_route_returns_parsed_hotspots_without_calling_nasa(self) -> None:
        os.environ["NASA_FIRMS_MAP_KEY"] = "unit-test-secret"

        def fake_request(url: str, timeout_s: float = 45.0) -> tuple[int, str]:
            self.assertIn("/api/area/csv/", url)
            return 200, CSV_HEADER + "\n" + CSV_ROW + "\n"

        original = firms.request_csv
        firms.request_csv = fake_request
        try:
            with TestClient(self.app) as client:
                response = client.get(
                    "/api/firms/hotspots",
                    params={"west": 79.1, "south": 19.9, "east": 79.7, "north": 20.5, "days": 1, "product": "VIIRS_SNPP_NRT"},
                )
        finally:
            firms.request_csv = original
        self.assertEqual(response.status_code, 200, response.text)
        body = response.json()
        self.assertEqual(body["count"], 1)
        self.assertEqual(body["hotspots"][0]["frp"], 5.5)
        self.assertNotIn("unit-test-secret", response.text)

    def test_rate_limit_is_reported(self) -> None:
        os.environ["NASA_FIRMS_MAP_KEY"] = "unit-test-secret"

        def fake_request(url: str, timeout_s: float = 45.0) -> tuple[int, str]:
            return 429, "slow down"

        original = firms.request_csv
        firms.request_csv = fake_request
        try:
            with TestClient(self.app) as client:
                response = client.get(
                    "/api/firms/hotspots",
                    params={"west": 79.1, "south": 19.9, "east": 79.7, "north": 20.5, "days": 1},
                )
        finally:
            firms.request_csv = original
        self.assertEqual(response.status_code, 429)
        self.assertIn("rate limit", response.json()["detail"])

    def test_repeat_call_is_cached_until_refresh(self) -> None:
        os.environ["NASA_FIRMS_MAP_KEY"] = "unit-test-secret"
        calls = {"n": 0}

        def fake_request(url: str, timeout_s: float = 45.0) -> tuple[int, str]:
            calls["n"] += 1
            return 200, CSV_HEADER + "\n" + CSV_ROW + "\n"

        original = firms.request_csv
        firms.request_csv = fake_request
        params = {"west": 79.1, "south": 19.9, "east": 79.7, "north": 20.5, "days": 1}
        try:
            with TestClient(self.app) as client:
                first = client.get("/api/firms/hotspots", params=params)
                second = client.get("/api/firms/hotspots", params=params)
                third = client.get("/api/firms/hotspots", params={**params, "refresh": True})
        finally:
            firms.request_csv = original
        self.assertEqual(first.status_code, 200)
        self.assertFalse(first.json()["cached"])
        self.assertTrue(second.json()["cached"])
        self.assertFalse(third.json()["cached"])
        self.assertEqual(calls["n"], 2)

    def test_seven_day_window_uses_two_area_calls(self) -> None:
        os.environ["NASA_FIRMS_MAP_KEY"] = "unit-test-secret"
        calls = {"n": 0}

        def fake_request(url: str, timeout_s: float = 45.0) -> tuple[int, str]:
            calls["n"] += 1
            return 200, CSV_HEADER + "\n"

        original = firms.request_csv
        firms.request_csv = fake_request
        try:
            with TestClient(self.app) as client:
                response = client.get(
                    "/api/firms/hotspots",
                    params={"west": 79.1, "south": 19.9, "east": 79.7, "north": 20.5, "days": 7},
                )
        finally:
            firms.request_csv = original
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["requests"], 2)
        self.assertEqual(calls["n"], 2)
        self.assertNotIn("unit-test-secret", response.text)
