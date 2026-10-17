"""A second API process must recognize the health payload and refuse to bind."""

from __future__ import annotations

import unittest

from main import sensor_health_payload


class BackendBindTests(unittest.TestCase):
    def test_health_payload_matches_only_the_sensor_api(self) -> None:
        self.assertTrue(sensor_health_payload({"status": "ok", "api": "running"}))
        self.assertFalse(sensor_health_payload({"status": "ok"}))
        self.assertFalse(sensor_health_payload({"status": "ok", "api": "inference"}))
        self.assertFalse(sensor_health_payload("ok"))
        self.assertFalse(sensor_health_payload(None))


if __name__ == "__main__":
    unittest.main()
