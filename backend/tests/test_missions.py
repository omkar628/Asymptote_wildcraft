"""Mission log tests. They must not write the sensor CSV or open a serial port."""

from __future__ import annotations

import sys
import unittest
from pathlib import Path
from tempfile import TemporaryDirectory

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from fastapi.testclient import TestClient

from tests.test_api import REAL_CSV, settings_for
from main import create_app

REAL_LOG = Path(__file__).resolve().parents[1] / "data" / "mission_records.jsonl"


def _mission(incident: str = "inc-1", mission: str = "msn-1") -> dict:
    return {
        "incident_id": incident,
        "mission_id": mission,
        "launch_lat": 20.2,
        "launch_lon": 79.4,
        "destination_lat": 20.25,
        "destination_lon": 79.45,
        "destination_kind": "real_node",
        "destination_node_id": "real-lora-1",
        "state": "TAKEOFF_SIMULATED",
        "summary": "Straight-line simulation",
        "simulation": True,
        "kind": "mission_event",
        "evidence_class": "observed",
        "payload": {},
    }


class MissionApiTests(unittest.TestCase):
    def setUp(self) -> None:
        self.csv_before = REAL_CSV.read_bytes() if REAL_CSV.exists() else None
        self.log_before = REAL_LOG.read_bytes() if REAL_LOG.exists() else None
        self.tmp = TemporaryDirectory()
        self.csv_path = Path(self.tmp.name) / "sensor_readings.csv"
        self.app = create_app(settings_for(self.csv_path, allow_test_inject=False))

    def tearDown(self) -> None:
        if self.csv_before is None:
            self.assertFalse(self.csv_path.exists() and "SIMULATED-MARKER" in self.csv_path.read_text(encoding="utf-8"))
        else:
            self.assertEqual(REAL_CSV.read_bytes(), self.csv_before)
        if self.log_before is None:
            self.assertFalse(REAL_LOG.exists())
        else:
            self.assertEqual(REAL_LOG.read_bytes(), self.log_before)
        self.tmp.cleanup()

    def test_missing_coordinates_and_duplicate_mission_are_rejected(self) -> None:
        with TestClient(self.app) as client:
            missing = client.post("/api/missions", json={**_mission(), "launch_lat": None})
            self.assertEqual(missing.status_code, 422)
            created = client.post("/api/missions", json=_mission())
            self.assertEqual(created.status_code, 200, created.text)
            self.assertTrue(created.json()["simulation"])
            duplicate = client.post("/api/missions", json=_mission(mission="msn-2"))
            self.assertEqual(duplicate.status_code, 409)
            self.assertNotIn("SIMULATED-MARKER", self.csv_path.read_text(encoding="utf-8") if self.csv_path.exists() else "")

    def test_cancel_position_history_and_nodes_stay_out_of_the_sensor_log(self) -> None:
        with TestClient(self.app) as client:
            created = client.post("/api/missions", json=_mission())
            self.assertEqual(created.status_code, 200, created.text)
            moved = client.post(
                "/api/missions/msn-1/position",
                json={"lat": 20.21, "lon": 79.41, "heading_deg": 12, "distance_remaining_m": 900, "state": "EN_ROUTE", "simulation": True, "persist": True},
            )
            self.assertEqual(moved.status_code, 200, moved.text)
            incident = client.post(
                "/api/incidents",
                json={
                    "kind": "simulated_test",
                    "incident_id": "inc-demo",
                    "summary": "SIMULATED-MARKER demo post",
                    "evidence_class": "simulated_test",
                    "category": "confirmed_multi",
                },
            )
            self.assertEqual(incident.status_code, 200, incident.text)
            denied = client.post(
                "/api/incidents",
                json={"kind": "confirmed_field", "incident_id": "inc-field", "summary": "operator guess", "evidence_class": "observed"},
            )
            self.assertEqual(denied.status_code, 422)
            mixed = client.post(
                "/api/incidents",
                json={"kind": "observed", "incident_id": "inc-mix", "summary": "SIMULATED-MARKER mixed", "evidence_class": "simulated_test"},
            )
            self.assertEqual(mixed.status_code, 422)
            cancelled = client.post("/api/missions/msn-1/cancel", json={"state": "EN_ROUTE", "summary": "stop", "simulation": True})
            self.assertEqual(cancelled.status_code, 200, cancelled.text)
            self.assertEqual(cancelled.json()["state"], "MISSION_CANCELLED")
            nodes = client.get("/api/nodes")
            self.assertEqual(nodes.status_code, 200)
            body = nodes.json()
            self.assertIsNone(body["real"]["latitude"])
            self.assertEqual(body["real"]["badge"], "REAL HARDWARE")
            self.assertEqual(len(body["simulated"]), 10)
            self.assertTrue(all(item["badge"] == "SIMULATED" for item in body["simulated"]))
            history = client.get("/api/incidents")
            self.assertEqual(history.status_code, 200)
            self.assertIn("SIMULATED-MARKER", history.text)
            log_text = (self.csv_path.parent / "mission_records.jsonl").read_text(encoding="utf-8")
            self.assertIn("simulated_test", log_text)
            csv_text = self.csv_path.read_text(encoding="utf-8") if self.csv_path.exists() else ""
            self.assertNotIn("SIMULATED-MARKER", csv_text)

    def test_aircraft_command_is_rejected(self) -> None:
        with TestClient(self.app) as client:
            rejected = client.post("/api/missions", json={**_mission(), "simulation": False})
            self.assertEqual(rejected.status_code, 422)
