"""Parser and RSSI association tests. These use sample strings, not the serial port."""

from __future__ import annotations

import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from serial_collector import collect_lines

CLOCK = "2026-10-11T18:04:00.123+05:30"
SAMPLE = """Received packet: Temp:31.70,Hum:45.70,MQ135:418,MQ9:479
RSSI: -32
-----------------------------------
Received packet: Temp:31.70,Hum:45.70,MQ135:432,MQ9:473
RSSI: -32
-----------------------------------
"""


class ParserTests(unittest.TestCase):
    def test_sample_stream_associates_each_rssi_with_its_packet(self) -> None:
        readings = collect_lines(SAMPLE.splitlines(), clock=lambda: CLOCK)
        self.assertEqual(len(readings), 2)
        self.assertEqual(readings[0].temp_text, "31.70")
        self.assertEqual(readings[0].humidity_text, "45.70")
        self.assertEqual(readings[0].mq135_text, "418")
        self.assertEqual(readings[0].mq9_text, "479")
        self.assertEqual(readings[0].rssi_text, "-32")
        self.assertEqual(readings[0].rssi_dbm, -32.0)
        self.assertEqual(readings[1].mq135_text, "432")
        self.assertEqual(readings[1].mq9_text, "473")
        self.assertEqual(readings[1].rssi_dbm, -32.0)
        self.assertEqual(readings[0].timestamp, CLOCK)
        self.assertEqual(readings[1].timestamp, CLOCK)

    def test_rssi_stays_with_the_packet_that_preceded_it(self) -> None:
        readings = collect_lines(
            [
                "Received packet: Temp:1.0,Hum:2.0,MQ135:3,MQ9:4",
                "RSSI: -10",
                "Received packet: Temp:5.0,Hum:6.0,MQ135:7,MQ9:8",
                "RSSI: -20",
            ]
        )
        self.assertEqual([item.temp_text for item in readings], ["1.0", "5.0"])
        self.assertEqual([item.rssi_text for item in readings], ["-10", "-20"])

    def test_orphan_rssi_is_not_attached_to_the_next_packet(self) -> None:
        readings = collect_lines(
            [
                "RSSI: -99",
                "Received packet: Temp:1,Hum:2,MQ135:3,MQ9:4",
                "RSSI: -5",
            ]
        )
        self.assertEqual(len(readings), 1)
        self.assertEqual(readings[0].rssi_text, "-5")
        self.assertNotEqual(readings[0].rssi_text, "-99")

    def test_packet_without_rssi_is_kept_when_the_next_packet_arrives(self) -> None:
        readings = collect_lines(
            [
                "Received packet: Temp:1,Hum:2,MQ135:3,MQ9:4",
                "Received packet: Temp:9,Hum:8,MQ135:7,MQ9:6",
                "RSSI: -3",
            ]
        )
        self.assertEqual(len(readings), 2)
        self.assertIsNone(readings[0].rssi_dbm)
        self.assertEqual(readings[0].rssi_text, "")
        self.assertEqual(readings[0].temp_text, "1")
        self.assertEqual(readings[1].temp_text, "9")
        self.assertEqual(readings[1].rssi_text, "-3")

    def test_incomplete_packet_is_not_emitted(self) -> None:
        readings = collect_lines(["Received packet: Temp:31.70,Hum:45.70,MQ135:418,MQ9:479"])
        self.assertEqual(readings, [])

    def test_malformed_lines_do_not_create_readings(self) -> None:
        readings = collect_lines(
            [
                "hello",
                "Received packet: Temp:bad,Hum:1,MQ135:2,MQ9:3",
                "Received packet: Temp:1,Hum:2,MQ135:3",
                "",
                "------",
                "Received packet: Temp:10,Hum:20,MQ135:30,MQ9:40",
                "not rssi",
                "RSSI: -4",
            ]
        )
        self.assertEqual(len(readings), 1)
        self.assertEqual(readings[0].temp_text, "10")
        self.assertEqual(readings[0].humidity_text, "20")
        self.assertEqual(readings[0].mq135_text, "30")
        self.assertEqual(readings[0].mq9_text, "40")
        self.assertEqual(readings[0].rssi_text, "-4")

    def test_spaces_and_case_are_accepted(self) -> None:
        readings = collect_lines(
            [
                "received packet: temp: 31.70, hum: 45.70, mq135: 418, mq9: 479",
                "rssi:   -32",
            ]
        )
        self.assertEqual(len(readings), 1)
        self.assertEqual(readings[0].temp_c, 31.70)
        self.assertEqual(readings[0].rssi_dbm, -32.0)


if __name__ == "__main__":
    unittest.main()
