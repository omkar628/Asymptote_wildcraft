"""Read the latest camera frame on one background thread.

The source is either a local USB webcam or an optional MJPEG URL.
Only one capture is open. Preview and inference share that frame.
"""

from __future__ import annotations

import threading
import time
import urllib.error
import urllib.request
from collections import deque
from datetime import datetime

from wildcraft_inference.mjpeg import (
    MjpegParser,
    boundary_from_content_type,
    response_problem,
    validate_camera_url,
)
from wildcraft_inference.webcam import forget_open, open_failure_message, open_stream


class CameraWorker:
    def __init__(self) -> None:
        self._lock = threading.Lock()
        self._stop = threading.Event()
        self._thread: threading.Thread | None = None
        self._generation = 0
        self._url = ""
        self._source = ""
        self._index: int | None = None
        self._device_name = ""
        self._device_id = ""
        self._backend = ""
        self._state = "idle"
        self._error: str | None = None
        self._last_frame_at: str | None = None
        self._frames_received = 0
        self._jpeg: bytes | None = None
        self._frame = None
        self._width: int | None = None
        self._height: int | None = None
        self._capture_fps = 0.0
        self._fps_times: deque[float] = deque(maxlen=30)
        self._response = None
        self._capture = None
        self._capture_token = ""

    def snapshot(self) -> dict[str, object]:
        with self._lock:
            return {
                "url": self._url,
                "source": self._source,
                "index": self._index,
                "device_name": self._device_name or None,
                "device_id": self._device_id,
                "backend": self._backend,
                "state": self._state,
                "last_error": self._error,
                "last_frame_at": self._last_frame_at,
                "frames_received": self._frames_received,
                "width": self._width,
                "height": self._height,
                "capture_fps": round(self._capture_fps, 2),
            }

    def latest_jpeg(self) -> bytes | None:
        with self._lock:
            return self._jpeg

    def latest_frame(self):
        with self._lock:
            return self._frame

    def start(self, url: str) -> None:
        cleaned = validate_camera_url(url)
        self.stop(join=True)
        self._stop = threading.Event()
        with self._lock:
            self._generation += 1
            generation = self._generation
            self._source = "mjpeg"
            self._index = None
            self._device_name = ""
            self._device_id = ""
            self._backend = "mjpeg"
            self._url = cleaned
            self._state = "connecting"
            self._error = None
            self._jpeg = None
            self._frame = None
            self._width = None
            self._height = None
            self._capture_fps = 0.0
            self._fps_times.clear()
        thread = threading.Thread(
            target=self._run,
            args=(cleaned, generation, self._stop),
            name="wildcraft-camera",
            daemon=True,
        )
        self._thread = thread
        thread.start()

    def start_webcam(self, *, index: int | None, name: str, device_id: str) -> None:
        cleaned = name.strip()
        if index is None and not cleaned:
            raise ValueError(open_failure_message(None, "", "Select a camera index or a camera name."))
        if index is not None and (index < 0 or index > 32):
            raise ValueError(open_failure_message(index, cleaned, "The camera index must be from 0 to 32."))
        self.stop(join=True)
        self._stop = threading.Event()
        identity = device_id.strip() or (f"name:{cleaned}" if cleaned else f"index:{index}")
        label = f"local-webcam:{identity}"
        with self._lock:
            self._generation += 1
            generation = self._generation
            self._source = "webcam"
            self._index = index
            self._device_name = cleaned
            self._device_id = identity
            self._url = label
            self._backend = ""
            self._state = "connecting"
            self._error = None
            self._frames_received = 0
            self._jpeg = None
            self._frame = None
            self._width = None
            self._height = None
            self._capture_fps = 0.0
            self._fps_times.clear()
        thread = threading.Thread(
            target=self._run_webcam,
            args=(index, cleaned, generation, self._stop),
            name="wildcraft-camera",
            daemon=True,
        )
        self._thread = thread
        thread.start()

    def stop(self, join: bool = True) -> None:
        with self._lock:
            self._generation += 1
            self._state = "idle"
            self._jpeg = None
            self._frame = None
            self._capture_fps = 0.0
            response = self._response
            self._response = None
            capture = self._capture
            self._capture = None
            token = self._capture_token
            self._capture_token = ""
        _close_response(response)
        _release_capture(capture)
        if token:
            forget_open(token)
        self._stop.set()
        thread = self._thread
        if join and thread is not None and thread is not threading.current_thread() and thread.is_alive():
            thread.join(timeout=2)
        if thread is self._thread and (thread is None or not thread.is_alive()):
            self._thread = None

    def _run_webcam(self, index: int | None, name: str, generation: int, stop: threading.Event) -> None:
        delay = 1.0
        while not stop.is_set() and self._is_current(generation):
            capture = None
            token = ""
            try:
                capture, backend, frame, token, error = open_stream(index, name)
                if capture is None or frame is None:
                    raise OSError(error or open_failure_message(index, name, "No frame was returned."))
                with self._lock:
                    if generation != self._generation:
                        _release_capture(capture)
                        forget_open(token)
                        return
                    self._capture = capture
                    self._capture_token = token
                    self._backend = backend
                self._accept_frame(frame, generation)
                failures = 0
                while not stop.is_set() and self._is_current(generation):
                    try:
                        ok, nxt = capture.read()
                    except Exception as exc:
                        raise OSError(f"The webcam read failed: {exc}") from exc
                    if not ok or nxt is None or getattr(nxt, "size", 0) == 0:
                        failures += 1
                        if failures >= 8:
                            raise OSError("The webcam stopped returning frames.")
                        if stop.wait(0.05):
                            return
                        continue
                    failures = 0
                    self._accept_frame(nxt.copy(), generation)
                return
            except Exception as exc:
                message = str(exc).strip() or exc.__class__.__name__
                if not message.startswith("Could not open the webcam"):
                    message = open_failure_message(index, name, message)
                self._set_state(generation, "reconnecting", message)
            finally:
                owned = False
                with self._lock:
                    if self._capture is capture:
                        self._capture = None
                        self._capture_token = ""
                        owned = True
                if owned:
                    _release_capture(capture)
                    if token:
                        forget_open(token)
            if stop.is_set() or not self._is_current(generation):
                return
            if stop.wait(delay):
                return
            delay = min(delay * 2, 10.0)

    def _accept_frame(self, frame, generation: int) -> None:
        if frame is None or not self._is_current(generation):
            return
        shape = getattr(frame, "shape", None)
        if not shape or len(shape) < 2:
            return
        timestamp = datetime.now().astimezone().isoformat(timespec="milliseconds")
        moment = time.monotonic()
        with self._lock:
            if generation != self._generation:
                return
            self._frame = frame
            self._height = int(shape[0])
            self._width = int(shape[1])
            self._frames_received += 1
            self._last_frame_at = timestamp
            self._state = "streaming"
            self._error = None
            self._fps_times.append(moment)
            self._capture_fps = _rate(self._fps_times)

    def _run(self, url: str, generation: int, stop: threading.Event) -> None:
        delay = 1.0
        while not stop.is_set() and self._is_current(generation):
            try:
                self._read_once(url, generation, stop)
                delay = 1.0
                if stop.is_set() or not self._is_current(generation):
                    return
                self._set_state(generation, "reconnecting", "The camera closed the stream.")
            except ValueError as exc:
                self._set_state(generation, "error", str(exc))
                return
            except (urllib.error.URLError, TimeoutError, OSError) as exc:
                self._set_state(generation, "reconnecting", _network_message(exc))
            except Exception as exc:
                self._set_state(generation, "reconnecting", f"Camera read failed: {exc}")
            if stop.wait(delay):
                return
            delay = min(delay * 2, 10.0)

    def _read_once(self, url: str, generation: int, stop: threading.Event) -> None:
        request = urllib.request.Request(
            url,
            headers={
                "User-Agent": "Wildcraft",
                "Accept": "multipart/x-mixed-replace, image/jpeg",
                "Cache-Control": "no-cache",
            },
        )
        try:
            response = urllib.request.urlopen(request, timeout=8)
        except urllib.error.HTTPError as exc:
            raise OSError(f"The camera returned HTTP {exc.code} for {url}.") from exc
        with self._lock:
            if generation != self._generation:
                _close_response(response)
                return
            self._response = response
        try:
            self._consume(response, generation, stop)
        finally:
            with self._lock:
                if self._response is response:
                    self._response = None

    def _consume(self, response, generation: int, stop: threading.Event) -> None:
        with response:
            content_type = response.headers.get("Content-Type", "")
            preview = response.read(4096)
            problem = response_problem(content_type, preview)
            if problem:
                raise ValueError(problem)
            self._set_state(generation, "streaming", None)
            parser = MjpegParser(boundary_from_content_type(content_type))
            self._accept_frames(parser.feed(preview), generation)
            _set_socket_timeout(response, 8)
            while not stop.is_set() and self._is_current(generation):
                chunk = response.read(16384)
                if not chunk:
                    return
                self._accept_frames(parser.feed(chunk), generation)

    def _accept_frames(self, frames: list[bytes], generation: int) -> None:
        if not frames or not self._is_current(generation):
            return
        latest = frames[-1]
        timestamp = datetime.now().astimezone().isoformat(timespec="milliseconds")
        with self._lock:
            if generation != self._generation:
                return
            self._jpeg = latest
            self._frames_received += len(frames)
            self._last_frame_at = timestamp
            self._state = "streaming"
            self._error = None

    def _set_state(self, generation: int, state: str, error: str | None) -> None:
        with self._lock:
            if generation != self._generation:
                return
            self._state = state
            self._error = error
            if state != "streaming":
                self._jpeg = None

    def _is_current(self, generation: int) -> bool:
        with self._lock:
            return generation == self._generation


def _close_response(response) -> None:
    if response is None:
        return
    try:
        response.close()
    except Exception:
        return


def _network_message(exc: Exception) -> str:
    text = str(exc).strip() or exc.__class__.__name__
    return (
        "Cannot reach the camera. Check that the ESP32-CAM is on this Wi-Fi and that the stream URL is correct. "
        f"{text}"
    )


def _set_socket_timeout(response, seconds: float) -> None:
    raw = getattr(getattr(response, "fp", None), "raw", None)
    sock = getattr(raw, "_sock", None) if raw is not None else None
    if sock is None:
        sock = getattr(raw, "_fp", None)
        sock = getattr(sock, "fp", None)
        sock = getattr(sock, "raw", None)
        sock = getattr(sock, "_sock", None) if sock is not None else None
    if sock is not None:
        try:
            sock.settimeout(seconds)
        except Exception:
            return


def sleep_backoff(stop: threading.Event, delay: float) -> bool:
    return stop.wait(delay)


def monotonic() -> float:
    return time.monotonic()


def _release_capture(capture) -> None:
    if capture is None:
        return
    try:
        capture.release()
    except Exception:
        return


def _rate(times: deque[float]) -> float:
    if len(times) < 2:
        return 0.0
    span = times[-1] - times[0]
    if span <= 0:
        return 0.0
    return (len(times) - 1) / span
