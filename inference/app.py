"""Start the Wildcraft inference service.

This process reads the ESP32-CAM and runs the local YOLO weights.
It does not open COM6. The sensor backend owns that serial port.
"""

from __future__ import annotations

import os
import socket

os.environ.setdefault("YOLO_OFFLINE", "true")


def port_is_open(host: str, port: int) -> bool:
    target = "127.0.0.1" if host in {"0.0.0.0", "::"} else host
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as sock:
        sock.settimeout(0.4)
        return sock.connect_ex((target, port)) == 0


def main() -> None:
    import uvicorn

    from wildcraft_inference.config import Settings

    settings = Settings.from_env()
    if port_is_open(settings.host, settings.port):
        raise SystemExit(
            f"[wildcraft] Port {settings.port} is already in use. "
            "An inference service is probably already running, so this process will not start another one."
        )
    print(f"[wildcraft] Inference http://{settings.host}:{settings.port}", flush=True)
    print(f"[wildcraft] Model path: {settings.model_path}", flush=True)
    print("[wildcraft] YOLO_OFFLINE is set. This process will not download weights.", flush=True)
    print("[wildcraft] COM6 is not opened by this service.", flush=True)
    uvicorn.run(
        "wildcraft_inference.server:app",
        host=settings.host,
        port=settings.port,
        log_level="info",
    )


if __name__ == "__main__":
    main()
