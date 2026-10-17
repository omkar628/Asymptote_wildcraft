"""Default settings stay on COM6 at 115200 unless the environment says otherwise."""

from __future__ import annotations

import os
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from config import Settings

SETTING_KEYS = [
    "SENSOR_SERIAL_PORT",
    "SENSOR_BAUD_RATE",
    "SENSOR_SERIAL_ENABLED",
    "SENSOR_CSV_PATH",
    "SENSOR_API_HOST",
    "SENSOR_API_PORT",
    "SENSOR_HISTORY_DEFAULT_LIMIT",
    "SENSOR_HISTORY_MAX_LIMIT",
    "SENSOR_MEMORY_LIMIT",
    "SENSOR_ALLOW_TEST_INJECT",
    "SENSOR_ALERT_TEMP_C_HIGH",
    "SENSOR_ALERT_HUMIDITY_LOW",
    "SENSOR_ALERT_MQ135_RAW_HIGH",
    "SENSOR_ALERT_MQ9_RAW_HIGH",
    "SENSOR_ALERT_RSSI_DBM_LOW",
    "SENSOR_GAS_ALARM_ACTIVATION",
    "SENSOR_GAS_ALARM_RECOVERY",
    "SENSOR_GAS_ALARM_STALE_SECONDS",
]


class ConfigTests(unittest.TestCase):
    def test_defaults(self) -> None:
        saved = {key: os.environ.get(key) for key in SETTING_KEYS}
        try:
            for key in SETTING_KEYS:
                os.environ.pop(key, None)
            settings = Settings.from_env(load_file=False)
        finally:
            for key, value in saved.items():
                if value is None:
                    os.environ.pop(key, None)
                else:
                    os.environ[key] = value
        self.assertEqual(settings.serial_port, "COM6")
        self.assertEqual(settings.baud_rate, 115200)
        self.assertTrue(settings.serial_enabled)
        self.assertEqual(settings.port, 8000)
        self.assertFalse(settings.allow_test_inject)
        self.assertIsNone(settings.temp_c_high)
        self.assertIsNone(settings.humidity_percent_low)
        self.assertIsNone(settings.mq135_raw_high)
        self.assertIsNone(settings.mq9_raw_high)
        self.assertIsNone(settings.rssi_dbm_low)
        self.assertEqual(settings.gas_activation, 750.0)
        self.assertEqual(settings.gas_recovery, 750.0)
        self.assertEqual(settings.gas_stale_s, 60.0)

    def test_invalid_threshold_is_rejected(self) -> None:
        saved = os.environ.get("SENSOR_ALERT_TEMP_C_HIGH")
        os.environ["SENSOR_ALERT_TEMP_C_HIGH"] = "hot"
        try:
            with self.assertRaises(SystemExit):
                Settings.from_env(load_file=False)
        finally:
            if saved is None:
                os.environ.pop("SENSOR_ALERT_TEMP_C_HIGH", None)
            else:
                os.environ["SENSOR_ALERT_TEMP_C_HIGH"] = saved


if __name__ == "__main__":
    unittest.main()
