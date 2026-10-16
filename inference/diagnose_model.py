"""Load the trained Wildcraft weights and run them on one image.

The weights path is explicit. A missing file stops the script before Ultralytics
is imported, so this command cannot download a different model.

Example:
  python diagnose_model.py --image C:\\path\\to\\fire.jpg
"""

from __future__ import annotations

import argparse
import os
import sys
import time
from pathlib import Path

DEFAULT_WEIGHTS = Path(r"F:\wildcraft_project\weights\best.pt")


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Test the Wildcraft smoke/fire weights on one image.")
    parser.add_argument("--weights", default=str(DEFAULT_WEIGHTS), help="Absolute path to best.pt")
    parser.add_argument("--image", required=True, help="Image file to run through the model")
    parser.add_argument("--conf", type=float, default=0.25, help="Confidence threshold used for the saved image")
    parser.add_argument("--output", default="", help="Annotated JPEG path. Defaults beside the input image.")
    args = parser.parse_args(argv)

    os.environ["YOLO_OFFLINE"] = "true"
    weights = Path(args.weights)
    image_path = Path(args.image)
    print(f"Model path: {weights}")
    print(f"Model file exists: {weights.is_file()}")
    if not weights.is_file():
        print(f"Model load: failed: Model file not found: {weights}")
        print("Class names: unavailable")
        return 2
    if not 0.01 <= args.conf <= 0.99:
        print("Confidence must be from 0.01 to 0.99.")
        return 2

    resolved = str(weights.resolve())
    print(f"Loading YOLO({resolved!r})")
    from ultralytics import YOLO

    model = YOLO(resolved)
    names = getattr(model, "names", {})
    if isinstance(names, dict):
        shown = ", ".join(f"{index}={name}" for index, name in sorted(names.items()))
    elif isinstance(names, list):
        shown = ", ".join(f"{index}={name}" for index, name in enumerate(names))
    else:
        shown = "unavailable"
    print(f"Loaded model path: {getattr(model, 'pt_path', resolved)}")
    print(f"Class names: {shown}")

    if not image_path.is_file():
        print(f"Image file not found: {image_path}")
        return 2

    import cv2

    frame = cv2.imread(str(image_path), cv2.IMREAD_COLOR)
    if frame is None:
        print(f"OpenCV could not decode the image: {image_path}")
        return 2
    height, width = frame.shape[:2]
    print(f"Image: {image_path}")
    print(f"Frame: {width}x{height}")

    root = Path(__file__).resolve().parent
    if str(root) not in sys.path:
        sys.path.insert(0, str(root))
    from wildcraft_inference.detector import draw_boxes

    boxes = _predict(model, frame, args.conf)
    print(f"Detections at confidence {args.conf:.2f}: {len(boxes)}")
    if boxes:
        for box in boxes:
            _print_box(box)
    else:
        print(f"No detections at confidence {args.conf:.2f}.")

    if args.conf > 0.01:
        low = _predict(model, frame, 0.01)
        print(f"Detections at confidence 0.01: {len(low)}")
        if low:
            for box in low:
                _print_box(box)
        else:
            print("No detections at confidence 0.01.")

    output = Path(args.output) if args.output else image_path.with_name(f"{image_path.stem}-annotated.jpg")
    drawn = draw_boxes(frame, boxes) if boxes else frame
    if not cv2.imwrite(str(output), drawn):
        print(f"Could not write the annotated image: {output}")
        return 2
    print(f"Annotated image: {output}")
    return 0


def _predict(model, frame, confidence: float) -> list:
    from wildcraft_inference.events import Box

    started = time.perf_counter()
    results = model.predict(source=frame, conf=confidence, verbose=False, device="cpu", stream=False)
    duration_ms = (time.perf_counter() - started) * 1000.0
    print(f"Inference duration at {confidence:.2f}: {duration_ms:.0f} ms")
    if not results or results[0].boxes is None:
        return []
    names = getattr(model, "names", {})
    found = []
    for box in results[0].boxes:
        class_id = int(box.cls[0])
        if isinstance(names, dict):
            class_name = str(names.get(class_id, class_id))
        elif isinstance(names, list) and 0 <= class_id < len(names):
            class_name = str(names[class_id])
        else:
            class_name = str(class_id)
        x1, y1, x2, y2 = [int(round(value)) for value in box.xyxy[0].tolist()]
        found.append(Box(class_name, float(box.conf[0]), (x1, y1, x2, y2)))
    return found


def _print_box(box) -> None:
    x1, y1, x2, y2 = box.bbox
    print(f"  class={box.class_name} confidence={box.confidence:.4f} bbox={x1},{y1},{x2},{y2}")


if __name__ == "__main__":
    raise SystemExit(main())
