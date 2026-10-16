import json
import unittest
from pathlib import Path
from tempfile import TemporaryDirectory
from unittest.mock import patch

from wildcraft_inference.config import Settings
from wildcraft_inference.camera import CameraWorker
from wildcraft_inference.runtime import InferenceRuntime
from wildcraft_inference.webcam import (
    assemble_devices,
    attach_known_names,
    choose_preferred,
    names_from_pnp_json,
    open_failure_message,
)


class WebcamSelectionTests(unittest.TestCase):
    def test_disabled_camera_names_are_skipped(self) -> None:
        payload = json.dumps(
            [
                {"Name": "Integrated Camera", "Status": "Error"},
                {"Name": "Lenovo FHD Webcam", "Status": "OK"},
            ]
        )
        self.assertEqual(names_from_pnp_json(payload), ["Lenovo FHD Webcam"])

    def test_lenovo_is_preferred_over_index_zero(self) -> None:
        devices = [
            {"id": "index:0", "name": "Camera index 0", "readable": True},
            {"id": "name:Lenovo FHD Webcam", "name": "Lenovo FHD Webcam", "readable": True},
        ]
        self.assertEqual(choose_preferred(devices), "name:Lenovo FHD Webcam")

    def test_one_readable_camera_is_selected_when_it_has_no_lenovo_name(self) -> None:
        devices = [{"id": "index:2", "name": "Camera index 2", "readable": True}]
        self.assertEqual(choose_preferred(devices), "index:2")

    def test_several_unnamed_cameras_are_left_for_the_user(self) -> None:
        devices = [
            {"id": "index:0", "name": "Camera index 0", "readable": True},
            {"id": "index:1", "name": "Camera index 1", "readable": True},
        ]
        self.assertIsNone(choose_preferred(devices))

    def test_one_named_camera_keeps_the_only_working_index(self) -> None:
        named = [{"id": "name:Lenovo FHD Webcam", "name": "Lenovo FHD Webcam", "index": None}]
        indexed = [{"id": "index:1", "name": "Camera index 1", "index": 1}]
        merged = assemble_devices(named, indexed)
        self.assertEqual(merged[0]["id"], "name:Lenovo FHD Webcam")
        self.assertEqual(merged[0]["index"], 1)

    def test_extra_indexes_are_not_paired_by_guesswork(self) -> None:
        named = [{"id": "name:Lenovo FHD Webcam", "name": "Lenovo FHD Webcam", "index": None}]
        indexed = [
            {"id": "index:0", "name": "Camera index 0", "index": 0},
            {"id": "index:1", "name": "Camera index 1", "index": 1},
        ]
        self.assertEqual(len(assemble_devices(named, indexed)), 1)
        self.assertIsNone(assemble_devices(named, indexed)[0]["index"])

    def test_the_only_working_index_keeps_the_only_ok_camera_name(self) -> None:
        indexed = [{"id": "index:0", "index": 0, "name": "Camera index 0", "preferred": False}]
        labeled = attach_known_names(indexed, ["Lenovo FHD Webcam"])
        self.assertEqual(labeled[0]["name"], "Lenovo FHD Webcam")
        self.assertEqual(labeled[0]["index"], 0)
        self.assertTrue(labeled[0]["preferred"])

    def test_two_working_indexes_are_not_named_by_guesswork(self) -> None:
        indexed = [
            {"id": "index:0", "index": 0, "name": "Camera index 0"},
            {"id": "index:1", "index": 1, "name": "Camera index 1"},
        ]
        labeled = attach_known_names(indexed, ["Lenovo FHD Webcam", "Integrated Camera"])
        self.assertEqual(labeled[0]["name"], "Camera index 0")
        self.assertEqual(labeled[1]["name"], "Camera index 1")

    def test_open_failure_does_not_ask_for_an_esp32_address(self) -> None:
        text = open_failure_message(1, "Lenovo FHD Webcam", "read failed")
        self.assertIn("Lenovo FHD Webcam", text)
        self.assertIn("Refresh", text)
        self.assertNotIn("ESP32", text)


class WebcamSettingsTests(unittest.TestCase):
    def test_legacy_stream_url_is_not_opened_automatically(self) -> None:
        with TemporaryDirectory() as folder:
            root = Path(folder)
            settings_path = root / "service-settings.json"
            settings_path.write_text(
                json.dumps(
                    {
                        "model_path": str(root / "missing.pt"),
                        "confidence": 0.25,
                        "camera_url": "http://10.241.226.236:81/stream",
                    }
                ),
                encoding="utf-8",
            )
            runtime = InferenceRuntime(self._settings(root, settings_path))
            try:
                self.assertEqual(runtime._pending_camera_url, "")
                self.assertIsNone(runtime._pending_webcam)
                self.assertEqual(runtime.confidence, 0.25)
            finally:
                runtime.store.close()

    def test_saved_webcam_does_not_need_a_stream_url(self) -> None:
        with TemporaryDirectory() as folder:
            root = Path(folder)
            settings_path = root / "service-settings.json"
            settings_path.write_text(
                json.dumps(
                    {
                        "camera_source": "webcam",
                        "camera_index": 1,
                        "camera_name": "Lenovo FHD Webcam",
                        "camera_id": "name:Lenovo FHD Webcam",
                        "confidence": 0.35,
                    }
                ),
                encoding="utf-8",
            )
            runtime = InferenceRuntime(self._settings(root, settings_path))
            try:
                self.assertEqual(runtime._pending_camera_url, "")
                assert runtime._pending_webcam is not None
                self.assertEqual(runtime._pending_webcam["index"], 1)
                self.assertEqual(runtime._pending_webcam["name"], "Lenovo FHD Webcam")

                def fake_start(camera: CameraWorker, *, index: int | None, name: str, device_id: str) -> None:
                    with camera._lock:
                        camera._source = "webcam"
                        camera._index = index
                        camera._device_name = name
                        camera._device_id = device_id
                        camera._url = f"local-webcam:{device_id}"
                        camera._state = "streaming"
                        camera._error = None
                        camera._width = 1280
                        camera._height = 720

                with patch.object(CameraWorker, "start_webcam", fake_start):
                    status = runtime.connect_webcam(index=1, name="Lenovo FHD Webcam", device_id="name:Lenovo FHD Webcam")
                self.assertEqual(status["camera"]["state"], "streaming")
                self.assertEqual(status["camera"]["width"], 1280)
                saved = json.loads(settings_path.read_text(encoding="utf-8"))
                self.assertEqual(saved["camera_source"], "webcam")
                self.assertEqual(saved["camera_name"], "Lenovo FHD Webcam")
                self.assertNotIn("10.241.226.236", str(saved.get("camera_url")))
            finally:
                runtime.store.close()

    def test_runtime_keeps_detections_in_memory(self) -> None:
        with TemporaryDirectory() as folder:
            root = Path(folder)
            settings_path = root / "service-settings.json"
            runtime = InferenceRuntime(self._settings(root, settings_path))
            try:
                self.assertFalse((root / "detections.sqlite").exists())
                self.assertEqual(runtime.store.list_recent(20), [])
                runtime.store.insert(None)
                self.assertEqual(runtime.store.list_recent(20), [])
                self.assertFalse((root / "detections.sqlite").exists())
            finally:
                runtime.store.close()

    def _settings(self, root: Path, settings_path: Path) -> Settings:
        return Settings(
            host="127.0.0.1",
            port=8103,
            model_path=root / "missing.pt",
            confidence=0.35,
            max_fps=4,
            data_dir=root,
            db_path=root / "detections.sqlite",
            settings_path=settings_path,
        )
