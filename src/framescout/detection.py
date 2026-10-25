"""Replaceable local person-detection backends.

The app must distinguish unavailable detection from a confident zero-person
result. A missing ML dependency must never silently reject images.
"""

from __future__ import annotations

from typing import Protocol

from .models import PersonDetection


class PersonDetector(Protocol):
    def detect(self, path: str) -> PersonDetection: ...


class DisabledPersonDetector:
    def detect(self, path: str) -> PersonDetection:
        return PersonDetection(None, None, None, "disabled")


class YoloPersonDetector:
    def __init__(self, model_name: str = "yolo11n.pt", confidence: float = 0.35) -> None:
        try:
            from ultralytics import YOLO
        except ImportError as exc:
            raise RuntimeError(
                "YOLO detection needs the optional dependency. Install with: "
                "python -m pip install -e '.[yolo]'"
            ) from exc
        self._model = YOLO(model_name)
        self._confidence = confidence

    def detect(self, path: str) -> PersonDetection:
        result = self._model(path, classes=[0], conf=self._confidence, verbose=False)[0]
        boxes = result.boxes
        if boxes is None or len(boxes) == 0:
            return PersonDetection(0, 0.0, None, "yolo")
        width, height = result.orig_shape[1], result.orig_shape[0]
        areas = []
        confidences = []
        for box, confidence in zip(boxes.xyxy.cpu().tolist(), boxes.conf.cpu().tolist()):
            x1, y1, x2, y2 = box
            areas.append(max(0.0, x2 - x1) * max(0.0, y2 - y1) / (width * height))
            confidences.append(float(confidence))
        return PersonDetection(len(areas), max(areas), max(confidences), "yolo")
