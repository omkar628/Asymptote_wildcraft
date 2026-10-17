"""MQ9 and MQ135 alarm together. Both must be strictly above 750 raw."""

from __future__ import annotations

import sys
import unittest
from datetime import datetime, timedelta, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from gas_alarm import GasAlarmEngine
from tests.samples import make_reading

ROOT = Path(__file__).resolve().parents[2]
ALARM_SOUND = ROOT / "sounds" / "u_inx5oo5fv3-alarm-327234.mp3"
NOW = datetime(2026, 10, 17, 12, 0, tzinfo=timezone(timedelta(hours=5, minutes=30)))


def engine() -> GasAlarmEngine:
    return GasAlarmEngine()


class GasAlarmTests(unittest.TestCase):
    def test_both_at_400_does_not_alarm(self) -> None:
        result = engine().observe_values(400, 400, at=NOW, fresh=True)
        self.assertEqual(result["state"], "NORMAL")
        self.assertIsNone(result["event_id"])
        self.assertEqual(result["triggered_sensors"], [])
        self.assertEqual(result["activation_threshold"], 750.0)
        self.assertTrue(result["safe_to_treat_as_normal"])

    def test_pairs_at_or_below_750_do_not_alarm(self) -> None:
        # Table order is MQ135, MQ9. observe_values takes MQ9, then MQ135.
        quiet = ((638, 653), (740, 751), (751, 740), (750, 750), (650, 500), (500, 650))
        for mq9, mq135 in quiet:
            result = engine().observe_values(mq9, mq135, at=NOW, fresh=True)
            self.assertEqual(result["state"], "NORMAL", (mq9, mq135))
            self.assertIsNone(result["event_id"], (mq9, mq135))
            self.assertFalse(result["mq9_above"] and result["mq135_above"], (mq9, mq135))
            self.assertTrue(result["safe_to_treat_as_normal"], (mq9, mq135))

    def test_one_sensor_above_750_does_not_alarm(self) -> None:
        only_mq9 = engine().observe_values(800, 400, at=NOW, fresh=True)
        only_mq135 = engine().observe_values(400, 800, at=NOW, fresh=True)
        self.assertEqual(only_mq9["state"], "NORMAL")
        self.assertTrue(only_mq9["mq9_above"])
        self.assertFalse(only_mq9["mq135_above"])
        self.assertEqual(only_mq135["state"], "NORMAL")
        self.assertFalse(only_mq135["mq9_above"])
        self.assertTrue(only_mq135["mq135_above"])
        self.assertIsNone(only_mq9["event_id"])
        self.assertIsNone(only_mq135["event_id"])

    def test_both_strictly_above_750_is_one_alarm(self) -> None:
        for mq9, mq135 in ((751, 751), (780, 800), (810, 900)):
            result = engine().observe_values(mq9, mq135, at=NOW, fresh=True)
            self.assertEqual(result["state"], "ALARM_ACTIVE", (mq9, mq135))
            self.assertEqual(result["event_id"], "gas-1", (mq9, mq135))
            self.assertEqual(result["triggered_sensors"], ["mq9", "mq135"], (mq9, mq135))
            self.assertTrue(result["mq9_above"] and result["mq135_above"])
            self.assertIn("BOTH GAS SENSORS ABOVE 750", str(result["detail"]))
            self.assertFalse(result["safe_to_treat_as_normal"])
            self.assertNotIn(" or ", str(result["detail"]).lower())

    def test_missing_reading_is_not_zero_and_not_normal(self) -> None:
        result = engine().observe_values(None, 400, at=NOW, fresh=True)
        self.assertEqual(result["state"], "INCOMPLETE")
        self.assertEqual(result["reading_status"], "incomplete")
        self.assertIsNone(result["mq9_raw"])
        self.assertNotEqual(result["mq9_raw"], 0)
        self.assertFalse(result["safe_to_treat_as_normal"])
        self.assertIsNone(result["event_id"])

    def test_invalid_number_is_incomplete(self) -> None:
        result = engine().observe_values(float("nan"), 400, at=NOW, fresh=True)
        self.assertEqual(result["state"], "INCOMPLETE")
        self.assertIsNone(result["mq9_raw"])
        self.assertFalse(result["safe_to_treat_as_normal"])

    def test_a_normal_reading_ages_into_a_stale_warning(self) -> None:
        alarm = GasAlarmEngine()
        alarm.observe_values(400, 400, at=NOW, fresh=True)
        stale = alarm.tick(NOW + timedelta(seconds=61), link_down=False)
        self.assertEqual(stale["state"], "SENSOR_DATA_STALE")
        self.assertFalse(stale["safe_to_treat_as_normal"])
        self.assertIsNone(stale["event_id"])
        self.assertIn("not treated as a normal condition", str(stale["detail"]))

    def test_stale_sample_is_not_normal(self) -> None:
        result = engine().observe_values(400, 410, at=NOW, fresh=False)
        self.assertEqual(result["state"], "SENSOR_DATA_STALE")
        self.assertEqual(result["reading_status"], "stale")
        self.assertFalse(result["safe_to_treat_as_normal"])
        self.assertIn("too old", str(result["detail"]))

    def test_repeated_updates_keep_one_event(self) -> None:
        alarm = GasAlarmEngine()
        first = alarm.observe_values(751, 751, at=NOW, fresh=True)
        second = alarm.observe_values(780, 800, at=NOW, fresh=True)
        third = alarm.observe_values(810, 900, at=NOW, fresh=True)
        self.assertEqual(first["event_id"], "gas-1")
        self.assertEqual(second["event_id"], "gas-1")
        self.assertEqual(third["event_id"], "gas-1")
        self.assertEqual(third["state"], "ALARM_ACTIVE")
        self.assertEqual(third["triggered_sensors"], ["mq9", "mq135"])

    def test_acknowledge_does_not_clear_a_high_reading(self) -> None:
        alarm = GasAlarmEngine()
        alarm.observe_values(751, 751, at=NOW, fresh=True)
        acked = alarm.acknowledge(NOW)
        self.assertEqual(acked["state"], "ACKNOWLEDGED")
        self.assertEqual(acked["mq9_raw"], 751)
        self.assertEqual(acked["mq135_raw"], 751)
        self.assertEqual(acked["event_id"], "gas-1")
        self.assertFalse(acked["safe_to_treat_as_normal"])
        still = alarm.observe_values(780, 800, at=NOW, fresh=True)
        self.assertEqual(still["state"], "ACKNOWLEDGED")
        self.assertEqual(still["event_id"], "gas-1")
        self.assertEqual(still["mq9_raw"], 780)
        self.assertEqual(still["mq135_raw"], 800)
        self.assertIn("BOTH GAS SENSORS ABOVE 750", str(still["detail"]))
        self.assertIn("not marked as normal", str(still["detail"]))

    def test_either_sensor_at_or_below_750_ends_the_episode(self) -> None:
        alarm = GasAlarmEngine()
        alarm.observe_values(751, 751, at=NOW, fresh=True)
        cleared = alarm.observe_values(751, 740, at=NOW, fresh=True)
        self.assertEqual(cleared["state"], "NORMAL")
        self.assertIsNone(cleared["event_id"])
        edge = alarm.observe_values(750, 750, at=NOW, fresh=True)
        self.assertEqual(edge["state"], "NORMAL")
        again = alarm.observe_values(780, 800, at=NOW, fresh=True)
        self.assertEqual(again["state"], "ALARM_ACTIVE")
        self.assertEqual(again["event_id"], "gas-2")
        self.assertEqual(again["triggered_sensors"], ["mq9", "mq135"])

    def test_missing_during_an_open_episode_is_not_safe(self) -> None:
        alarm = GasAlarmEngine()
        alarm.observe_values(751, 751, at=NOW, fresh=True)
        missing = alarm.observe_values(None, 800, at=NOW, fresh=True)
        self.assertEqual(missing["event_id"], "gas-1")
        self.assertNotEqual(missing["state"], "NORMAL")
        self.assertIsNone(missing["mq9_raw"])
        self.assertNotEqual(missing["mq9_raw"], 0)
        self.assertFalse(missing["safe_to_treat_as_normal"])
        self.assertIn("not treated as zero", str(missing["detail"]))

    def test_stale_gap_does_not_mark_the_episode_normal(self) -> None:
        alarm = GasAlarmEngine()
        alarm.observe_values(751, 751, at=NOW, fresh=True)
        stale = alarm.tick(NOW + timedelta(seconds=61), link_down=True)
        self.assertEqual(stale["state"], "SENSOR_DATA_STALE")
        self.assertEqual(stale["event_id"], "gas-1")
        self.assertFalse(stale["safe_to_treat_as_normal"])
        self.assertTrue(stale["link_down"])
        back = alarm.observe_values(780, 800, at=NOW + timedelta(seconds=70), fresh=True)
        self.assertEqual(back["state"], "ALARM_ACTIVE")
        self.assertEqual(back["event_id"], "gas-1")

    def test_copy_does_not_claim_ppm_or_a_detected_fire(self) -> None:
        samples = [
            engine().observe_values(400, 400, at=NOW, fresh=True),
            engine().observe_values(751, 751, at=NOW, fresh=True),
            engine().observe_values(None, 400, at=NOW, fresh=True),
            engine().observe_values(400, 400, at=NOW, fresh=False),
        ]
        for result in samples:
            detail = str(result["detail"]).lower()
            self.assertNotIn("ppm", detail)
            self.assertNotIn("fire detected", detail)
            self.assertNotIn("toxic", detail)

    def test_existing_alarm_file_is_an_mpeg_audio_frame(self) -> None:
        data = ALARM_SOUND.read_bytes()
        self.assertGreater(len(data), 1000)
        self.assertEqual(data[0], 0xFF)
        self.assertGreaterEqual(data[1] & 0xE0, 0xE0)
        self.assertEqual(ALARM_SOUND.name, "u_inx5oo5fv3-alarm-327234.mp3")

    def test_ingest_reports_one_alarm_and_still_writes_csv(self) -> None:
        from tempfile import TemporaryDirectory

        from config import Settings
        from main import create_app

        with TemporaryDirectory() as tmp:
            csv_path = Path(tmp) / "sensor_readings.csv"
            app = create_app(
                Settings(
                    serial_port="COM6",
                    baud_rate=115200,
                    serial_enabled=False,
                    csv_path=csv_path,
                    host="127.0.0.1",
                    port=8001,
                    history_default_limit=120,
                    history_max_limit=500,
                    memory_limit=1000,
                    allow_test_inject=False,
                    temp_c_high=None,
                    humidity_percent_low=None,
                    mq135_raw_high=None,
                    mq9_raw_high=None,
                    rssi_dbm_low=None,
                )
            )
            stamp = datetime.now().astimezone().isoformat(timespec="milliseconds")
            reading = make_reading(
                timestamp=stamp,
                mq9_raw=780.0,
                mq9_text="780",
                mq135_raw=800.0,
                mq135_text="800",
            )
            hub = app.state.hub
            hub.ingest(reading)
            message = hub.reading_message(reading, False)
            self.assertEqual(message["type"], "reading")
            self.assertEqual(message["reading"]["mq9_raw"], 780.0)
            self.assertEqual(message["reading"]["mq135_raw"], 800.0)
            self.assertEqual(message["gas_alarm"]["state"], "ALARM_ACTIVE")
            self.assertEqual(message["gas_alarm"]["event_id"], "gas-1")
            self.assertEqual(message["gas_alarm"]["triggered_sensors"], ["mq9", "mq135"])
            self.assertEqual(message["gas_alarm"]["activation_threshold"], 750.0)
            self.assertIn("BOTH GAS SENSORS ABOVE 750", message["gas_alarm"]["detail"])
            self.assertIn(stamp, csv_path.read_text(encoding="utf-8"))
            acked = hub.acknowledge_gas()
            self.assertEqual(acked["state"], "ACKNOWLEDGED")
            self.assertEqual(acked["mq9_raw"], 780.0)
            self.assertEqual(acked["mq135_raw"], 800.0)
            self.assertFalse(acked["safe_to_treat_as_normal"])
            self.assertIn("780", csv_path.read_text(encoding="utf-8"))


if __name__ == "__main__":
    unittest.main()
