"""Rule checks for sensitivity and the illustrative spread scenario."""

from __future__ import annotations

import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from fastapi.testclient import TestClient

import fire_model
from main import create_app
from tests.test_api import settings_for
from tempfile import TemporaryDirectory


class SensitivityTests(unittest.TestCase):
    def test_full_inputs_score_100_and_confidence_stays_below_one(self) -> None:
        result = fire_model.sensitivity_score(
            temperature_c=42,
            humidity_pct=25,
            precipitation_mm=0,
            wind_kmh=40,
            soil_moisture=0.10,
            firms_known=True,
            hotspot_count=1,
            firms_distance_m=0,
            sensor_located=True,
            sensor_fresh=True,
            sensor_alert=True,
            rain_window_mm=10,
        )
        self.assertEqual(result["score"], 100)
        self.assertAlmostEqual(result["confidence"], 0.722, places=3)
        self.assertIn("Very high", result["band"])
        self.assertTrue(any("Vegetation" in item for item in result["missing"]))

    def test_missing_inputs_are_not_scored_as_high_or_safe(self) -> None:
        empty = fire_model.sensitivity_score()
        self.assertIsNone(empty["score"])
        self.assertEqual(empty["confidence"], 0.0)
        partial = fire_model.sensitivity_score(temperature_c=42)
        self.assertEqual(partial["score"], 16)
        self.assertLess(partial["confidence"], 0.45)
        self.assertIn("incomplete", partial["band"])
        self.assertIn("Relative humidity", partial["missing"])

    def test_sensor_threshold_requires_a_location_and_a_strict_crossing(self) -> None:
        unlocated = fire_model.sensor_alert_points(False, True, True)
        stale = fire_model.sensor_alert_points(True, False, True)
        exact = fire_model.sensor_alert_points(True, True, False)
        crossed = fire_model.sensor_alert_points(True, True, True)
        self.assertIsNone(unlocated)
        self.assertIsNone(stale)
        self.assertEqual(exact, 0.0)
        self.assertEqual(crossed, 8.0)

    def test_firms_absence_is_not_a_missing_response(self) -> None:
        self.assertIsNone(fire_model.firms_proximity_points(None, False, 0))
        self.assertEqual(fire_model.firms_proximity_points(None, True, 0), 0.0)
        self.assertEqual(fire_model.firms_proximity_points(9000, True, 2), 0.0)


class SpreadTests(unittest.TestCase):
    def test_forecast_steps_follow_the_requested_horizon(self) -> None:
        self.assertEqual(fire_model.forecast_steps(6), [0, 1, 3, 6])
        self.assertEqual(fire_model.forecast_steps(24), [0, 1, 3, 6, 12, 24])
        self.assertEqual(fire_model.forecast_steps(0), [0])

    def test_unknown_ignition_does_not_invent_a_polygon(self) -> None:
        scenario = fire_model.build_scenario({"forecast_hours": 6, "samples": [{"hour_offset": 1, "wind_kmh": 20, "wind_from_deg": 0}]})
        self.assertIsNone(scenario["ignition"])
        self.assertEqual(scenario["steps"], [])
        self.assertIn("not invented", scenario["message"])

    def test_wind_direction_changes_the_long_axis(self) -> None:
        samples = [{"hour_offset": 3, "wind_kmh": 20, "wind_from_deg": 0, "humidity_pct": 50, "precip_mm": 0.2, "temperature_c": 32}]
        north = fire_model.build_scenario(
            {"forecast_hours": 3, "ignition": {"lat": 20.25, "lon": 79.40, "kind": "hypothetical"}, "samples": samples}
        )
        samples[0]["wind_from_deg"] = 90
        east = fire_model.build_scenario(
            {"forecast_hours": 3, "ignition": {"lat": 20.25, "lon": 79.40, "kind": "hypothetical"}, "samples": samples}
        )
        north_step = north["steps"][-1]
        east_step = east["steps"][-1]
        self.assertEqual(north_step["hour"], 3)
        self.assertEqual(north_step["bearing_deg"], 180)
        self.assertEqual(east_step["bearing_deg"], 270)
        self.assertGreater(north_step["axes_km"]["downwind_km"], north_step["axes_km"]["crosswind_km"])
        self.assertNotEqual(north_step["polygon"]["coordinates"][0][0], east_step["polygon"]["coordinates"][0][0])
        south_point = fire_model.point_in_ellipse(20.25 - 0.008, 79.40, 20.25, 79.40, 180, north_step["axes_km"]["downwind_km"], north_step["axes_km"]["upwind_km"], north_step["axes_km"]["crosswind_km"])
        north_point = fire_model.point_in_ellipse(20.25 + 0.008, 79.40, 20.25, 79.40, 180, north_step["axes_km"]["downwind_km"], north_step["axes_km"]["upwind_km"], north_step["axes_km"]["crosswind_km"])
        self.assertTrue(south_point)
        self.assertFalse(north_point)
        self.assertEqual(north["label"], fire_model.SPREAD_LABEL)
        self.assertIsNone(north["steps"][0]["polygon"])

    def test_calm_wind_is_not_a_constant_circle(self) -> None:
        rated = fire_model.spread_rate({"wind_kmh": 2, "humidity_pct": 40, "precip_mm": 0, "temperature_c": 30})
        axes = fire_model.ellipse_axes(rated["rate_kmh"], 6, rated["directional"])
        self.assertIsNotNone(axes)
        assert axes is not None
        self.assertNotAlmostEqual(axes["downwind_km"], axes["crosswind_km"])
        self.assertFalse(rated["directional"])

    def test_route_returns_the_scenario(self) -> None:
        with TemporaryDirectory() as tmp:
            app = create_app(settings_for(Path(tmp) / "sensor_readings.csv", allow_test_inject=False))
            with TestClient(app) as client:
                response = client.post(
                    "/api/fire/scenario",
                    json={
                        "forecast_hours": 1,
                        "ignition": {"lat": 20.2, "lon": 79.4, "kind": "hypothetical"},
                        "samples": [{"hour_offset": 1, "wind_kmh": 18, "wind_from_deg": 270, "humidity_pct": 40, "precip_mm": 0, "temperature_c": 33}],
                    },
                )
        self.assertEqual(response.status_code, 200, response.text)
        body = response.json()
        self.assertEqual(body["steps"][1]["bearing_deg"], 90)
        self.assertEqual(body["steps"][1]["polygon"]["type"], "Polygon")
        self.assertIn("Illustrative", body["label"])
