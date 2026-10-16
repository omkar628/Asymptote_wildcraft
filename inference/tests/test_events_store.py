import unittest
from pathlib import Path
from tempfile import TemporaryDirectory

from wildcraft_inference.events import Box, DetectionCoalescer
from wildcraft_inference.store import DetectionStore


class EventTests(unittest.TestCase):
    def test_same_class_is_stored_once_inside_the_window(self) -> None:
        clock = {"now": 10.0}
        coalescer = DetectionCoalescer(window_s=20.0, clock=lambda: clock["now"])
        boxes = [Box("fire", 0.42, (1, 2, 8, 9)), Box("Fire", 0.91, (2, 3, 10, 11)), Box("smoke", 0.3, (4, 5, 6, 7))]
        kwargs = {
            "created_at": "2026-10-16T10:00:00+05:30",
            "camera_url": "http://10.236.143.236:81/stream",
            "model_path": r"F:\edit\best.pt",
            "frame_width": 320,
            "frame_height": 240,
        }
        first = coalescer.consider(boxes, **kwargs)
        self.assertEqual(sorted(event.class_name.lower() for event in first), ["fire", "smoke"])
        fire = next(event for event in first if event.class_name.lower() == "fire")
        self.assertEqual(fire.confidence, 0.91)
        self.assertIn("does not prove", fire.disclaimer)
        clock["now"] = 15.0
        self.assertEqual(coalescer.consider(boxes, **kwargs), [])
        clock["now"] = 31.0
        again = coalescer.consider([Box("smoke", 0.55, (1, 1, 2, 2))], **kwargs)
        self.assertEqual([event.class_name for event in again], ["smoke"])

    def test_sqlite_round_trip_does_not_use_the_sensor_csv(self) -> None:
        with TemporaryDirectory() as folder:
            path = Path(folder) / "detections.sqlite"
            store = DetectionStore(path)
            coalescer = DetectionCoalescer(window_s=20.0, clock=lambda: 1.0)
            event = coalescer.consider(
                [Box("smoke", 0.33, (8, 9, 20, 21))],
                created_at="2026-10-16T10:00:00.000+05:30",
                camera_url="http://10.236.143.236:81/stream",
                model_path=r"F:\edit\best.pt",
                frame_width=640,
                frame_height=480,
            )[0]
            store.insert(event)
            rows = store.list_recent(10)
            self.assertEqual(rows[0]["id"], event.id)
            self.assertEqual(rows[0]["class_name"], "smoke")
            self.assertFalse(rows[0]["acknowledged"])
            acked = store.acknowledge(event.id)
            self.assertIsNotNone(acked)
            assert acked is not None
            self.assertTrue(acked["acknowledged"])
            self.assertIsNone(store.acknowledge("missing"))
            store.close()
            self.assertFalse(path.with_suffix(".csv").exists())


if __name__ == "__main__":
    unittest.main()
