"""Parse an ESP32-CAM multipart JPEG stream without assuming the URL path."""

from __future__ import annotations

from urllib.parse import urlparse


class MjpegParser:
    """Pull complete JPEG frames out of a multipart/x-mixed-replace body."""

    def __init__(self, boundary: str | None, limit: int = 8_000_000) -> None:
        token = (boundary or "").strip().strip('"')
        self.boundary = f"--{token}".encode("ascii") if token else None
        self.limit = limit
        self._buffer = bytearray()

    def feed(self, chunk: bytes) -> list[bytes]:
        if not chunk:
            return []
        self._buffer.extend(chunk)
        if len(self._buffer) > self.limit:
            # Keep the tail so a frame that straddles the cap is not lost forever.
            del self._buffer[:- self.limit // 2]
        if self.boundary:
            return self._frames_from_boundary()
        return self._frames_from_markers()

    def _frames_from_boundary(self) -> list[bytes]:
        assert self.boundary is not None
        frames: list[bytes] = []
        while True:
            start = self._buffer.find(self.boundary)
            if start < 0:
                if len(self._buffer) > len(self.boundary):
                    del self._buffer[: len(self._buffer) - len(self.boundary)]
                return frames
            if start:
                del self._buffer[:start]
            marker_end = len(self.boundary)
            if len(self._buffer) < marker_end + 2:
                return frames
            if self._buffer[marker_end : marker_end + 2] == b"--":
                del self._buffer[: marker_end + 2]
                continue
            header_end, separator = _header_end(self._buffer, marker_end)
            if header_end < 0:
                return frames
            header = bytes(self._buffer[marker_end:header_end])
            body_start = header_end + separator
            length = _content_length(header)
            if length is not None:
                body_end = body_start + length
                if len(self._buffer) < body_end:
                    return frames
                frame = bytes(self._buffer[body_start:body_end])
                del self._buffer[:body_end]
            else:
                next_boundary = self._buffer.find(self.boundary, body_start)
                if next_boundary < 0:
                    return frames
                frame = bytes(self._buffer[body_start:next_boundary]).rstrip(b"\r\n")
                del self._buffer[:next_boundary]
            jpeg = _trim_jpeg(frame)
            if jpeg is not None:
                frames.append(jpeg)
        return frames

    def _frames_from_markers(self) -> list[bytes]:
        frames: list[bytes] = []
        while True:
            start = self._buffer.find(b"\xff\xd8")
            if start < 0:
                if len(self._buffer) > 1:
                    del self._buffer[:-1]
                return frames
            end = self._buffer.find(b"\xff\xd9", start + 2)
            if end < 0:
                if start:
                    del self._buffer[:start]
                return frames
            frames.append(bytes(self._buffer[start : end + 2]))
            del self._buffer[: end + 2]
        return frames


def boundary_from_content_type(content_type: str) -> str | None:
    for part in content_type.split(";"):
        item = part.strip()
        if item.lower().startswith("boundary="):
            return item.split("=", 1)[1].strip().strip('"')
    return None


def response_problem(content_type: str, preview: bytes) -> str | None:
    """Return a user-facing error when the body cannot be a camera stream."""

    lowered = content_type.lower()
    sample = preview.lstrip()[:64]
    if "text/html" in lowered or sample.startswith(b"<!") or sample.lower().startswith(b"<html"):
        return (
            "The camera returned a web page, not a video stream. "
            "Use the stream path, often http://CAMERA_IP:81/stream, not the camera's root address."
        )
    if sample.startswith(b"\xff\xd8") or "image/jpeg" in lowered or "multipart" in lowered:
        return None
    if sample.startswith(b"{") or sample.startswith(b"["):
        return "The camera URL returned JSON, not a JPEG stream."
    if content_type and "image/" not in lowered and "multipart" not in lowered and sample:
        return "The camera response was not a JPEG or MJPEG stream."
    return None


def validate_camera_url(url: str) -> str:
    trimmed = url.strip()
    parsed = urlparse(trimmed)
    if parsed.scheme not in {"http", "https"}:
        raise ValueError("Camera stream URL must start with http:// or https://.")
    if not parsed.hostname:
        raise ValueError("Camera stream URL needs a host.")
    if parsed.username or parsed.password:
        raise ValueError("Do not put a username or password in the camera URL.")
    if parsed.hostname.lower() in {"localhost", "127.0.0.1", "::1"}:
        raise ValueError("127.0.0.1 is this PC, not the ESP32-CAM. Enter the camera's Wi-Fi address.")
    return trimmed


def _header_end(buffer: bytearray, start: int) -> tuple[int, int]:
    for separator in (b"\r\n\r\n", b"\n\n"):
        found = buffer.find(separator, start)
        if found >= 0:
            return found, len(separator)
    return -1, 0


def _trim_jpeg(frame: bytes) -> bytes | None:
    if not frame.startswith(b"\xff\xd8"):
        return None
    end = frame.rfind(b"\xff\xd9")
    if end < 2:
        return None
    return frame[: end + 2]


def _content_length(header: bytes) -> int | None:
    for line in header.splitlines():
        if line.lower().startswith(b"content-length:"):
            raw = line.split(b":", 1)[1].strip()
            try:
                value = int(raw)
            except ValueError:
                return None
            if value < 0:
                return None
            return value
    return None
