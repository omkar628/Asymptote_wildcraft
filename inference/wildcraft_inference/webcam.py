"""Find and open a local USB camera.

OpenCV index order is not a device name. A camera is listed only after a real
frame is read, then the capture is released. The inference service is the only
long-lived owner.
"""

from __future__ import annotations

import json
import os
import subprocess
import threading
import time
from typing import Callable

PREFERRED_WIDTH = 1280
PREFERRED_HEIGHT = 720
PROBE_INDEX_LIMIT = 6
OPEN_TIMEOUT_S = 3.0

_open_lock = threading.Lock()
_held: dict[str, object] | None = None


def choose_preferred(devices: list[dict[str, object]]) -> str | None:
    """Pick a Lenovo camera when one returns frames.

    A single readable camera is used when no Lenovo name is available.
    Several unnamed cameras are left for the user. Index 0 is not assumed.
    """

    readable = [device for device in devices if device.get("readable", True)]
    lenovo = [device for device in readable if "lenovo" in str(device.get("name") or "").lower()]
    if lenovo:
        return str(lenovo[0].get("id") or "")
    if len(readable) == 1:
        return str(readable[0].get("id") or "")
    return None


def assemble_devices(named: list[dict[str, object]], indexed: list[dict[str, object]]) -> list[dict[str, object]]:
    """Prefer named cameras so a working index is not listed twice.

    When exactly one named camera and one index both return frames, keep the
    name and attach that index. DirectShow order is not trusted beyond that.
    """

    if not named:
        return [dict(device) for device in indexed]
    if len(named) == 1 and len(indexed) == 1:
        merged = dict(named[0])
        merged["index"] = indexed[0].get("index")
        return [merged]
    return [dict(device) for device in named]


def attach_known_names(indexed: list[dict[str, object]], ok_names: list[str]) -> list[dict[str, object]]:
    """Label the only working index when Windows reports one working camera name.

    OpenCV on this machine cannot open a DirectShow camera by its name.
    A disabled camera that does not return a frame is not given that name.
    Several working indexes are left unlabeled because their order is not an identity.
    """

    devices = [dict(device) for device in indexed]
    if len(devices) == 1 and len(ok_names) == 1:
        name = ok_names[0]
        devices[0]["name"] = name
        devices[0]["id"] = f"name:{name}"
        devices[0]["preferred"] = "lenovo" in name.lower()
    return devices


def names_from_pnp_json(payload: str) -> list[str]:
    text = payload.strip().lstrip("\ufeff")
    if not text:
        return []
    try:
        data = json.loads(text)
    except json.JSONDecodeError:
        return []
    rows = data if isinstance(data, list) else [data]
    names: list[str] = []
    for row in rows:
        if not isinstance(row, dict):
            continue
        status = str(row.get("Status") or "").strip().lower()
        if status and status != "ok":
            continue
        name = str(row.get("Name") or "").strip()
        if name and name not in names:
            names.append(name)
    return names


def open_failure_message(index: int | None, name: str, detail: str) -> str:
    target = name.strip() or (f"index {index}" if index is not None else "the selected camera")
    reason = detail.strip() or "It did not return a frame."
    return (
        f"Could not open the webcam ({target}). "
        "Refresh the camera list and choose a camera that returns a frame. "
        "Close any other app that is using it. "
        f"{reason}"
    )


def pnp_camera_names() -> list[str]:
    if os.name != "nt":
        return []
    command = (
        "[Console]::OutputEncoding = [System.Text.Encoding]::UTF8; "
        "Get-CimInstance Win32_PnPEntity | "
        "Where-Object { $_.PNPClass -eq 'Camera' -or $_.Service -eq 'usbvideo' } | "
        "Select-Object Name, Status | ConvertTo-Json -Compress"
    )
    try:
        completed = subprocess.run(
            ["powershell", "-NoProfile", "-Command", command],
            capture_output=True,
            text=True,
            encoding="utf-8",
            errors="replace",
            timeout=8,
            check=False,
        )
    except (OSError, subprocess.TimeoutExpired):
        return []
    return names_from_pnp_json(completed.stdout or "")


def held_camera() -> dict[str, object] | None:
    with _open_lock:
        return dict(_held) if _held is not None else None


def remember_open(info: dict[str, object]) -> None:
    global _held
    with _open_lock:
        _held = dict(info)


def forget_open(token: str) -> None:
    global _held
    with _open_lock:
        if _held is not None and _held.get("token") == token:
            _held = None


def discover_cameras() -> list[dict[str, object]]:
    """Open each index with DirectShow, read one frame, and release it.

    The camera the inference service already holds is not opened again.
    Missing indexes return immediately. The default backend is not used here
    because it can block for a long time on an empty index.
    """

    held = held_camera()
    ok_names = pnp_camera_names()
    indexed: list[dict[str, object]] = []
    for index in range(PROBE_INDEX_LIMIT):
        if held and held.get("index") == index:
            continue
        found = _probe_dshow_index(index)
        if found is not None:
            indexed.append(found)
    label_names = [] if held and held.get("name") else ok_names
    devices = attach_known_names(indexed, label_names)
    if held:
        active = _device_from_hold(held)
        if not any(device.get("id") == active.get("id") or (active.get("index") is not None and device.get("index") == active.get("index")) for device in devices):
            devices.insert(0, active)
    return devices


def open_stream(index: int | None, name: str | None):
    """Open a capture and leave it open after one valid frame.

    Returns (capture, backend, frame, token, error). The caller releases it.
    """

    global _held
    token = f"{time.monotonic():.6f}"
    with _open_lock:
        capture, backend, frame, error = _open_attempts(index, name, allow_fallback=True)
        if capture is None or frame is None:
            return None, "", None, "", error or open_failure_message(index, name or "", "No frame was returned.")
        height, width = frame.shape[:2]
        _held = {
            "token": token,
            "index": index,
            "name": name or "",
            "id": f"name:{name}" if name else f"index:{index}",
            "backend": backend,
            "width": int(width),
            "height": int(height),
        }
        return capture, backend, frame, token, ""


def _device_from_hold(held: dict[str, object]) -> dict[str, object]:
    name = str(held.get("name") or "")
    index = held.get("index")
    label = name or (f"Camera index {index}" if isinstance(index, int) else "Open camera")
    identity = str(held.get("id") or (f"name:{name}" if name else f"index:{index}"))
    width = held.get("width")
    height = held.get("height")
    return {
        "id": identity,
        "index": index if isinstance(index, int) else None,
        "name": label,
        "backend": str(held.get("backend") or "active"),
        "width": int(width) if isinstance(width, int) else 0,
        "height": int(height) if isinstance(height, int) else 0,
        "readable": True,
        "preferred": "lenovo" in label.lower(),
    }


def _probe_dshow_index(index: int) -> dict[str, object] | None:
    with _open_lock:
        if _held is not None and _held.get("index") == index:
            return None
        capture, backend, frame, _error = _open_attempts(index, None, allow_fallback=False)
        if capture is not None:
            _release(capture)
        if frame is None:
            return None
        height, width = frame.shape[:2]
    return {
        "id": f"index:{index}",
        "index": index,
        "name": f"Camera index {index}",
        "backend": backend,
        "width": int(width),
        "height": int(height),
        "readable": True,
        "preferred": False,
    }


def _open_attempts(index: int | None, name: str | None, allow_fallback: bool = False):
    import cv2

    attempts: list[tuple[str, Callable[[], object]]] = []
    if index is not None:
        attempts.append(("dshow-index", lambda: cv2.VideoCapture(int(index), cv2.CAP_DSHOW)))
    if name and (index is None or allow_fallback):
        attempts.append(("dshow-name", lambda: cv2.VideoCapture(f"video={name}", cv2.CAP_DSHOW)))
    if allow_fallback and index is not None:
        attempts.append(("msmf-index", lambda: cv2.VideoCapture(int(index), cv2.CAP_MSMF)))
    if not attempts:
        return None, "", None, open_failure_message(index, name or "", "No camera index or name was provided.")
    reasons: list[str] = []
    for label, factory in attempts:
        capture, frame, reason = _open_one(factory)
        if capture is not None and frame is not None:
            return capture, label, frame, ""
        if reason:
            reasons.append(f"{label}: {reason}")
    return None, "", None, open_failure_message(index, name or "", "; ".join(reasons))


def _open_one(factory: Callable[[], object]):
    capture = None
    try:
        capture = factory()
        if not _is_open(capture):
            _release(capture)
            return None, None, "did not open"
        _configure(capture, request_resolution=True)
        frame = _read_valid(capture)
        if frame is not None:
            return capture, frame, ""
        _release(capture)
        capture = factory()
        if not _is_open(capture):
            _release(capture)
            return None, None, "opened, then failed to return a frame"
        _configure(capture, request_resolution=False)
        frame = _read_valid(capture)
        if frame is None:
            _release(capture)
            return None, None, "did not return a frame"
        return capture, frame, ""
    except Exception as exc:
        _release(capture)
        return None, None, str(exc).strip() or exc.__class__.__name__


def _configure(capture, request_resolution: bool) -> None:
    import cv2

    try:
        capture.set(cv2.CAP_PROP_BUFFERSIZE, 1)
    except Exception:
        pass
    if not request_resolution:
        return
    try:
        capture.set(cv2.CAP_PROP_FRAME_WIDTH, PREFERRED_WIDTH)
        capture.set(cv2.CAP_PROP_FRAME_HEIGHT, PREFERRED_HEIGHT)
    except Exception:
        return


def _read_valid(capture):
    try:
        ok, frame = capture.read()
    except Exception:
        return None
    if not ok or not _valid_frame(frame):
        return None
    return frame.copy()


def _valid_frame(frame) -> bool:
    if frame is None:
        return False
    shape = getattr(frame, "shape", None)
    if not shape or len(shape) < 2:
        return False
    if int(shape[0]) < 16 or int(shape[1]) < 16:
        return False
    size = getattr(frame, "size", 0)
    return bool(size)


def _is_open(capture) -> bool:
    if capture is None:
        return False
    try:
        return bool(capture.isOpened())
    except Exception:
        return False


def _release(capture) -> None:
    if capture is None:
        return
    try:
        capture.release()
    except Exception:
        return
