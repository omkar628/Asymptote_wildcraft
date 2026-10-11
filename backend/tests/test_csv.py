"""CSV header and append tests. They use a temporary file, never the live log."""

from __future__ import annotations

import csv
import sys
import unittest
from pathlib import Path
from tempfile import TemporaryDirectory

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from serial_collector import CSV_COLUMNS, CsvLog, load_recent
from tests.samples import make_reading


class CsvTests(unittest.TestCase):
    def test_append_preserves_existing_rows_and_writes_a_header_once(self) -> None:
        with TemporaryDirectory() as folder:
            path = Path(folder) / "sensor_readings.csv"
            log = CsvLog(path)
            first = make_reading(timestamp="2026-10-11T18:00:00.000+05:30")
            second = make_reading(
                timestamp="2026-10-11T18:00:01.000+05:30",
                temp_text="30.10",
                temp_c=30.10,
                mq135_text="432",
                mq135_raw=432,
            )
            log.append(first)
            log.append(second)
            reopened = CsvLog(path)
            reopened.append(
                make_reading(
                    timestamp="2026-10-11T18:00:02.000+05:30",
                    temp_text="29.00",
                    temp_c=29.0,
                )
            )
            with path.open(newline="", encoding="utf-8") as handle:
                rows = list(csv.reader(handle))
            self.assertEqual(rows[0], CSV_COLUMNS)
            self.assertEqual(rows[1][0], first.timestamp)
            self.assertEqual(rows[1][1], "31.70")
            self.assertEqual(rows[1][5], "-32")
            self.assertEqual(rows[2][0], second.timestamp)
            self.assertEqual(rows[2][3], "432")
            self.assertEqual(rows[3][0], "2026-10-11T18:00:02.000+05:30")
            self.assertEqual(sum(1 for row in rows if row == CSV_COLUMNS), 1)

    def test_mismatched_header_is_not_overwritten(self) -> None:
        with TemporaryDirectory() as folder:
            path = Path(folder) / "sensor_readings.csv"
            original = "not,the,header\n1,2,3\n"
            path.write_text(original, encoding="utf-8")
            with self.assertRaises(RuntimeError):
                CsvLog(path)
            self.assertEqual(path.read_text(encoding="utf-8"), original)

    def test_malformed_rows_are_skipped_and_blank_rssi_is_empty(self) -> None:
        with TemporaryDirectory() as folder:
            path = Path(folder) / "sensor_readings.csv"
            with path.open("w", newline="", encoding="utf-8") as handle:
                writer = csv.writer(handle, lineterminator="\n")
                writer.writerow(CSV_COLUMNS)
                writer.writerow(["2026-10-11T18:00:00+05:30", "31.70", "45.70", "418", "479", "-32"])
                writer.writerow(["bad", "x", "45.70", "418", "479", "-32"])
                writer.writerow(["2026-10-11T18:00:01+05:30", "30.00", "40.00", "100", "110", ""])
            loaded = load_recent(path, 10)
            self.assertEqual(len(loaded), 2)
            self.assertEqual(loaded[0].rssi_dbm, -32.0)
            self.assertIsNone(loaded[1].rssi_dbm)
            self.assertEqual(loaded[1].rssi_text, "")

    def test_empty_file_receives_only_a_header(self) -> None:
        with TemporaryDirectory() as folder:
            path = Path(folder) / "nested" / "sensor_readings.csv"
            CsvLog(path)
            self.assertEqual(load_recent(path, 10), [])
            self.assertEqual(path.read_text(encoding="utf-8").strip(), ",".join(CSV_COLUMNS))


if __name__ == "__main__":
    unittest.main()
