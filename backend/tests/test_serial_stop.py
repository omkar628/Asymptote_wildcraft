"""Shutdown of the serial thread must not hide threading.Thread._stop()."""

from __future__ import annotations

import threading
import unittest

from serial_collector import SerialCollector


class SerialStopTests(unittest.TestCase):
    def test_stop_event_does_not_replace_thread_stop(self) -> None:
        collector = SerialCollector("COM199", 115200, lambda _reading: None, lambda *_args: None)
        self.assertIsInstance(collector._stop_event, threading.Event)
        self.assertTrue(callable(collector._stop))
        self.assertNotIsInstance(collector._stop, threading.Event)

    def test_stop_joins_a_collector_that_cannot_open_the_port(self) -> None:
        statuses: list[tuple[str, bool, str | None]] = []
        collector = SerialCollector(
            "COM199",
            115200,
            lambda _reading: None,
            lambda *args: statuses.append(args),
        )
        collector.start()
        try:
            started = collector._stop_event.wait(0)
            self.assertFalse(started)
        finally:
            collector.stop()
        self.assertFalse(collector.is_alive())
        self.assertTrue(collector._stop_event.is_set())
        self.assertTrue(statuses)
        self.assertEqual(statuses[-1][0], "disconnected")


if __name__ == "__main__":
    unittest.main()
