import asyncio
import subprocess
import sys
import unittest
from contextlib import asynccontextmanager
from pathlib import Path
from tempfile import TemporaryDirectory
from unittest.mock import patch

import httpx

from wildcraft_inference.config import TRAINED_WEIGHTS, Settings
from wildcraft_inference.detector import Detector
from wildcraft_inference.runtime import InferenceRuntime, coerce_model_path
from wildcraft_inference.server import create_app


class Boom:
    def __getattr__(self, name: str):
        raise AssertionError(f"unexpected use of {name}")


class DetectorTests(unittest.TestCase):
    def test_missing_weights_do_not_import_ultralytics(self) -> None:
        detector = Detector()
        with patch.dict(sys.modules, {"ultralytics": Boom(), "torch": Boom()}):
            status = detector.load(r"F:\wildcraft_project\best.pt")
        self.assertFalse(status.loaded)
        self.assertEqual(status.state, "missing")
        self.assertIn("not found", (status.error or "").lower())
        boxes, error = detector.infer(object(), 0.25)
        self.assertEqual(boxes, [])
        self.assertIn("not found", (error or "").lower())

    def test_draw_uses_the_real_frame(self) -> None:
        import numpy as np

        from wildcraft_inference.detector import draw_boxes, encode_jpeg
        from wildcraft_inference.events import Box

        frame = np.zeros((48, 64, 3), dtype=np.uint8)
        drawn = draw_boxes(
            frame,
            [Box("fire", 0.82, (4, 5, 30, 40)), Box("smoke", 0.41, (8, 9, 20, 24))],
        )
        encoded = encode_jpeg(drawn)
        self.assertIsNotNone(encoded)
        assert encoded is not None
        self.assertTrue(encoded.startswith(b"\xff\xd8"))
        self.assertEqual(int(frame.sum()), 0)
        self.assertGreater(int(drawn.sum()), 0)


class ClassThresholdTests(unittest.TestCase):
    def test_smoke_and_fire_use_separate_gates(self) -> None:
        from wildcraft_inference.detector import keeps_class

        self.assertFalse(keeps_class("smoke", 0.50))
        self.assertTrue(keeps_class("smoke", 0.51))
        self.assertFalse(keeps_class("fire", 0.20))
        self.assertTrue(keeps_class("fire", 0.21))
        self.assertFalse(keeps_class("person", 0.99))

    def test_box_area_maps_to_distance_and_a_dummy_offset(self) -> None:
        from wildcraft_inference.detector import CAMERA_LAT, CAMERA_LON, annotate_detection, estimate_distance_m
        from wildcraft_inference.events import Box

        full = estimate_distance_m((0, 0, 64, 48), 64, 48)
        tiny = estimate_distance_m((0, 0, 1, 1), 64, 48)
        self.assertAlmostEqual(full, 1.0)
        self.assertGreater(tiny, 49.0)
        self.assertLess(tiny, 50.0)
        near = annotate_detection(Box("fire", 0.31, (0, 0, 64, 48)), 64, 48)
        far = annotate_detection(Box("smoke", 0.41, (0, 0, 1, 1)), 64, 48)
        assert near.estimated_lat is not None and far.estimated_lat is not None
        assert near.estimated_lon is not None and far.estimated_lon is not None
        self.assertAlmostEqual(near.estimated_lat, CAMERA_LAT + 1.0 / 111_320.0)
        self.assertAlmostEqual(near.estimated_lon, CAMERA_LON + 1.0 / 111_320.0)
        self.assertGreater(far.estimated_lat, near.estimated_lat)
        self.assertIn("Not a measured location", str(far.as_dict()["location_note"]))


class ModelPathTests(unittest.TestCase):
    def test_missing_default_keeps_the_trained_file(self) -> None:
        if not TRAINED_WEIGHTS.is_file():
            self.skipTest("trained weights are not on this machine")
        kept = coerce_model_path(r"F:\wildcraft_project\best.pt")
        self.assertEqual(Path(kept).resolve(), TRAINED_WEIGHTS.resolve())
        custom = r"F:\wildcraft_project\weights\not-the-trained-model.pt"
        self.assertEqual(coerce_model_path(custom), custom)

    def test_settings_update_rejects_the_missing_default(self) -> None:
        if not TRAINED_WEIGHTS.is_file():
            self.skipTest("trained weights are not on this machine")
        with TemporaryDirectory() as folder:
            root = Path(folder)
            settings = Settings(
                host="127.0.0.1",
                port=8102,
                model_path=TRAINED_WEIGHTS,
                confidence=0.25,
                max_fps=4,
                data_dir=root,
                db_path=root / "detections.sqlite",
                settings_path=root / "service-settings.json",
            )
            runtime = InferenceRuntime(settings)
            try:
                status = runtime.update_settings(r"F:\wildcraft_project\best.pt", 0.25)
                self.assertEqual(Path(status["model"]["path"]).resolve(), TRAINED_WEIGHTS.resolve())
                self.assertTrue(status["model"]["exists"])
            finally:
                runtime.store.close()

    def test_diagnose_script_stops_before_loading_a_missing_file(self) -> None:
        script = Path(__file__).resolve().parents[1] / "diagnose_model.py"
        with TemporaryDirectory() as folder:
            root = Path(folder)
            completed = subprocess.run(
                [
                    sys.executable,
                    str(script),
                    "--weights",
                    str(root / "missing.pt"),
                    "--image",
                    str(root / "frame.jpg"),
                ],
                capture_output=True,
                text=True,
                check=False,
            )
        self.assertEqual(completed.returncode, 2)
        self.assertIn("Model file exists: False", completed.stdout)
        self.assertNotIn("Loading YOLO", completed.stdout)


class ApiTests(unittest.TestCase):
    def test_health_missing_model_and_rejected_camera_url(self) -> None:
        with TemporaryDirectory() as folder:
            root = Path(folder)
            settings = Settings(
                host="127.0.0.1",
                port=8101,
                model_path=root / "missing.pt",
                confidence=0.25,
                max_fps=4,
                data_dir=root,
                db_path=root / "detections.sqlite",
                settings_path=root / "service-settings.json",
            )
            app = create_app(settings)
            asyncio.run(self._exercise(app, root))

    async def _exercise(self, app, root: Path) -> None:
        async with _lifespan(app):
            transport = httpx.ASGITransport(app=app)
            async with httpx.AsyncClient(transport=transport, base_url="http://test") as client:
                health = await client.get("/health")
                self.assertEqual(health.json()["status"], "ok")
                status = (await client.get("/api/status")).json()
                self.assertEqual(status["service"], "running")
                self.assertFalse(status["model"]["loaded"])
                self.assertIn("not found", status["model"]["error"].lower())
                self.assertEqual(status["camera"]["state"], "idle")
                self.assertEqual(status["inference"]["confidence"], 0.25)
                rejected = await client.post("/api/camera/connect", json={"url": "http://127.0.0.1/stream"})
                self.assertEqual(rejected.status_code, 422)
                rejected_webcam = await client.post("/api/camera/webcam", json={})
                self.assertEqual(rejected_webcam.status_code, 422)
                self.assertIn("does not need an ESP32-CAM", rejected_webcam.json()["detail"])
                updated = await client.put(
                    "/api/settings",
                    json={"model_path": str(root / "other.pt"), "confidence": 0.4},
                )
                self.assertEqual(updated.status_code, 200)
                self.assertEqual(updated.json()["inference"]["confidence"], 0.4)
                self.assertEqual((await client.get("/api/detections")).json()["count"], 0)
                snapshot = await _websocket_snapshot(app)
                self.assertEqual(snapshot["type"], "status")
                self.assertIn("model", snapshot["status"])


async def _lifespan(app):
    started = asyncio.Event()
    shutdown = asyncio.Event()
    finished = asyncio.Event()

    async def receive():
        if not started.is_set():
            return {"type": "lifespan.startup"}
        await shutdown.wait()
        return {"type": "lifespan.shutdown"}

    async def send(message):
        kind = message.get("type")
        if kind == "lifespan.startup.complete":
            started.set()
        elif kind == "lifespan.startup.failed":
            started.set()
            finished.set()
        elif kind == "lifespan.shutdown.complete":
            finished.set()

    task = asyncio.create_task(
        app({"type": "lifespan", "asgi": {"version": "3.0"}, "state": {}}, receive, send)
    )
    await asyncio.wait_for(started.wait(), timeout=5)
    try:
        yield
    finally:
        shutdown.set()
        await asyncio.wait_for(finished.wait(), timeout=5)
        await task


_lifespan = asynccontextmanager(_lifespan)


async def _websocket_snapshot(app) -> dict:
    import json

    incoming: asyncio.Queue = asyncio.Queue()
    outgoing: list[dict] = []
    await incoming.put({"type": "websocket.connect"})

    async def receive():
        return await incoming.get()

    async def send(message):
        outgoing.append(message)

    scope = {
        "type": "websocket",
        "asgi": {"version": "3.0"},
        "http_version": "1.1",
        "scheme": "ws",
        "path": "/ws/inference",
        "raw_path": b"/ws/inference",
        "query_string": b"",
        "headers": [],
        "client": ("127.0.0.1", 123),
        "server": ("127.0.0.1", 8100),
        "subprotocols": [],
        "state": {},
    }
    task = asyncio.create_task(app(scope, receive, send))
    try:
        for _ in range(40):
            for message in outgoing:
                if message.get("type") == "websocket.send":
                    return json.loads(message["text"])
            await asyncio.sleep(0.05)
        raise AssertionError(f"No websocket snapshot. Messages: {outgoing}")
    finally:
        await incoming.put({"type": "websocket.disconnect"})
        try:
            await asyncio.wait_for(task, timeout=2)
        except Exception:
            task.cancel()


if __name__ == "__main__":
    unittest.main()
