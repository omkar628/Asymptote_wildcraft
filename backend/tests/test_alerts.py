"""Threshold alerts stay quiet unless a configured rule changes."""

from __future__ import annotations

import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from alerts import ALERT_COPY, AlertEngine, Thresholds
from tests.samples import make_reading


class AlertTests(unittest.TestCase):
    def test_unconfigured_rules_do_not_alert_on_high_readings(self) -> None:
        engine = AlertEngine(Thresholds())
        result = engine.observe(make_reading(temp_c=80, humidity_percent=5, mq135_raw=9999, mq9_raw=9999))
        self.assertEqual(result["active"], [])
        self.assertFalse(result["changed"])

    def test_duplicate_packets_do_not_count_as_a_new_alert(self) -> None:
        engine = AlertEngine(Thresholds(temp_c_high=40))
        first = engine.observe(make_reading(temp_c=41))
        second = engine.observe(make_reading(temp_c=42))
        third = engine.observe(make_reading(temp_c=39))
        self.assertTrue(first["changed"])
        self.assertEqual(len(first["active"]), 1)
        self.assertEqual(first["active"][0]["id"], "temp_c_high")
        self.assertFalse(second["changed"])
        self.assertEqual(len(second["active"]), 1)
        self.assertTrue(third["changed"])
        self.assertEqual(third["active"], [])

    def test_missing_rssi_does_not_match_a_signal_rule(self) -> None:
        engine = AlertEngine(Thresholds(rssi_dbm_low=-40))
        result = engine.observe(make_reading(rssi_dbm=None, rssi_text=""))
        self.assertEqual(result["active"], [])
        matched = engine.observe(make_reading(rssi_dbm=-80, rssi_text="-80"))
        self.assertEqual(matched["active"][0]["id"], "rssi_dbm_low")

    def test_copy_does_not_claim_a_confirmed_fire(self) -> None:
        for rule_id, copy in ALERT_COPY.items():
            detail = copy["detail"].lower()
            self.assertNotIn("fire detected", detail, rule_id)
            self.assertNotIn("ai ", detail, rule_id)
            self.assertTrue(
                "does not confirm a fire" in detail or "not a fire alert" in detail,
                rule_id,
            )


if __name__ == "__main__":
    unittest.main()
