"""HTTP and WebSocket API for the local inference service."""

from __future__ import annotations

import asyncio
from contextlib import asynccontextmanager

from fastapi import FastAPI, HTTPException, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, ConfigDict, Field

from wildcraft_inference.config import Settings
from wildcraft_inference.runtime import InferenceRuntime


class CameraBody(BaseModel):
    url: str = Field(min_length=1, max_length=500)


class SettingsBody(BaseModel):
    model_config = ConfigDict(protected_namespaces=())

    model_path: str | None = None
    confidence: float | None = None
    max_fps: float | None = None
    event_window_s: float | None = None


class WebcamBody(BaseModel):
    index: int | None = None
    name: str | None = None
    id: str | None = None


class DetectionBody(BaseModel):
    enabled: bool


def create_app(settings: Settings | None = None, runtime: InferenceRuntime | None = None) -> FastAPI:
    resolved = settings if settings is not None else Settings.from_env()
    service = runtime if runtime is not None else InferenceRuntime(resolved)

    @asynccontextmanager
    async def lifespan(app: FastAPI):
        app.state.runtime.attach_loop(asyncio.get_running_loop())
        app.state.runtime.start()
        try:
            yield
        finally:
            app.state.runtime.stop()

    app = FastAPI(title="Wildcraft inference", lifespan=lifespan)
    app.state.settings = resolved
    app.state.runtime = service
    app.add_middleware(
        CORSMiddleware,
        allow_origins=["*"],
        allow_credentials=False,
        allow_methods=["*"],
        allow_headers=["*"],
    )

    @app.get("/health")
    def health() -> dict[str, str]:
        return {"status": "ok", "service": "wildcraft-inference"}

    @app.get("/api/status")
    def status() -> dict[str, object]:
        return app.state.runtime.status()

    @app.get("/api/settings")
    def get_settings() -> dict[str, object]:
        current = app.state.runtime.status()
        camera = current["camera"]
        model = current["model"]
        inference = current["inference"]
        return {
            "model_path": model["path"],
            "confidence": inference["confidence"],
            "max_fps": inference.get("max_fps"),
            "event_window_s": inference.get("event_window_s"),
            "camera_url": camera["url"],
            "camera_source": camera.get("source") or "",
            "camera_index": camera.get("index"),
            "camera_name": camera.get("device_name") or "",
        }

    @app.put("/api/settings")
    def put_settings(body: SettingsBody) -> dict[str, object]:
        try:
            return app.state.runtime.update_settings(
                body.model_path,
                body.confidence,
                body.max_fps,
                body.event_window_s,
            )
        except ValueError as exc:
            raise HTTPException(status_code=422, detail=str(exc)) from exc

    @app.get("/api/cameras")
    def cameras() -> dict[str, object]:
        return app.state.runtime.list_cameras()

    @app.post("/api/camera/connect")
    def connect_camera(body: CameraBody) -> dict[str, object]:
        try:
            return app.state.runtime.connect_camera(body.url)
        except ValueError as exc:
            raise HTTPException(status_code=422, detail=str(exc)) from exc

    @app.post("/api/camera/webcam")
    def connect_webcam(body: WebcamBody) -> dict[str, object]:
        try:
            return app.state.runtime.connect_webcam(index=body.index, name=body.name, device_id=body.id)
        except ValueError as exc:
            raise HTTPException(status_code=422, detail=str(exc)) from exc

    @app.post("/api/camera/detection")
    def set_detection(body: DetectionBody) -> dict[str, object]:
        return app.state.runtime.set_detection(body.enabled)

    @app.post("/api/camera/disconnect")
    def disconnect_camera() -> dict[str, object]:
        return app.state.runtime.disconnect_camera()

    @app.get("/api/detections")
    def detections(limit: int = 100) -> dict[str, object]:
        if limit < 1 or limit > 500:
            raise HTTPException(status_code=422, detail="limit must be from 1 to 500")
        rows = app.state.runtime.list_detections(limit)
        return {"detections": rows, "count": len(rows)}

    @app.post("/api/detections/{detection_id}/ack")
    def acknowledge(detection_id: str) -> dict[str, object]:
        row = app.state.runtime.acknowledge(detection_id)
        if row is None:
            raise HTTPException(status_code=404, detail="Detection not found")
        return row

    @app.get("/frame.jpg")
    def frame_jpeg():
        from fastapi.responses import Response

        jpeg = app.state.runtime.latest_annotated_jpeg()
        if not jpeg:
            raise HTTPException(status_code=404, detail="No camera frame is available yet.")
        return Response(content=jpeg, media_type="image/jpeg")

    @app.get("/stream")
    async def stream() -> StreamingResponse:
        runtime_service: InferenceRuntime = app.state.runtime

        async def frames():
            while True:
                jpeg = runtime_service.latest_annotated_jpeg()
                if jpeg:
                    header = (
                        b"--frame\r\n"
                        b"Content-Type: image/jpeg\r\nContent-Length: "
                        + str(len(jpeg)).encode("ascii")
                        + b"\r\n\r\n"
                    )
                    yield header + jpeg + b"\r\n"
                await asyncio.sleep(0.12)

        return StreamingResponse(frames(), media_type="multipart/x-mixed-replace; boundary=frame")

    @app.websocket("/ws/inference")
    async def inference_ws(websocket: WebSocket) -> None:
        runtime_service: InferenceRuntime = websocket.app.state.runtime
        await websocket.accept()
        queue: asyncio.Queue = asyncio.Queue(maxsize=8)
        runtime_service.add_listener(queue)
        sender = asyncio.create_task(_send_loop(websocket, queue))
        try:
            await websocket.send_json({"type": "status", "status": runtime_service.status()})
            while True:
                await websocket.receive_text()
        except WebSocketDisconnect:
            pass
        except Exception:
            pass
        finally:
            sender.cancel()
            runtime_service.remove_listener(queue)

    return app


async def _send_loop(websocket: WebSocket, queue: asyncio.Queue) -> None:
    try:
        while True:
            message = await queue.get()
            await websocket.send_json(message)
    except Exception:
        return


app = create_app()
