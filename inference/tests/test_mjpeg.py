import unittest

from wildcraft_inference.mjpeg import (
    MjpegParser,
    boundary_from_content_type,
    response_problem,
    validate_camera_url,
)

JPEG = b"\xff\xd8" + b"\x11" * 16 + b"\xff\xd9"
JPEG_B = b"\xff\xd8" + b"\x22" * 20 + b"\xff\xd9"


def multipart(boundary: str, frames: list[bytes], length: bool) -> bytes:
    chunks: list[bytes] = []
    for frame in frames:
        header = f"--{boundary}\r\nContent-Type: image/jpeg\r\n"
        if length:
            header += f"Content-Length: {len(frame)}\r\n"
        header += "\r\n"
        chunks.append(header.encode("ascii") + frame + b"\r\n")
    chunks.append(f"--{boundary}--\r\n".encode("ascii"))
    return b"".join(chunks)


class MjpegTests(unittest.TestCase):
    def test_content_length_frames_survive_small_reads(self) -> None:
        payload = multipart("frame", [JPEG, JPEG_B], True)
        parser = MjpegParser("frame")
        frames: list[bytes] = []
        for index in range(0, len(payload), 7):
            frames.extend(parser.feed(payload[index : index + 7]))
        self.assertEqual(frames, [JPEG, JPEG_B])

    def test_frames_without_content_length(self) -> None:
        payload = multipart("123456789000000000000987654321", [JPEG], False)
        parser = MjpegParser(boundary_from_content_type(
            'multipart/x-mixed-replace; boundary=123456789000000000000987654321'
        ))
        self.assertEqual(parser.feed(payload), [JPEG])

    def test_marker_scan_when_the_server_sends_raw_jpeg(self) -> None:
        parser = MjpegParser(None)
        self.assertEqual(parser.feed(b"junk" + JPEG + JPEG), [JPEG, JPEG])

    def test_html_page_is_not_a_stream(self) -> None:
        message = response_problem("text/html", b"<!DOCTYPE html>")
        self.assertIsNotNone(message)
        self.assertIn(":81/stream", message or "")

    def test_stream_url_rules(self) -> None:
        self.assertEqual(
            validate_camera_url("  http://10.236.143.236:81/stream "),
            "http://10.236.143.236:81/stream",
        )
        with self.assertRaises(ValueError):
            validate_camera_url("http://127.0.0.1:81/stream")
        with self.assertRaises(ValueError):
            validate_camera_url("file:///C:/video.jpg")
        with self.assertRaises(ValueError):
            validate_camera_url("http://user:pass@10.0.0.8/stream")


if __name__ == "__main__":
    unittest.main()
