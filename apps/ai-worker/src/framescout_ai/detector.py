from __future__ import annotations

import os
import sys
from dataclasses import asdict, dataclass
from pathlib import Path
from typing import Any

import numpy as np
from PIL import Image


COCO_CLASSES = {
    0: "person",
    1: "bicycle",
    2: "car",
    3: "motorcycle",
    5: "bus",
    7: "truck",
}

_DLL_DIRECTORY_HANDLES: list[Any] = []


def _register_bundled_nvidia_dlls() -> None:
    if sys.platform != "win32" or not hasattr(os, "add_dll_directory"):
        return
    nvidia_root = Path(sys.prefix) / "Lib" / "site-packages" / "nvidia"
    if not nvidia_root.is_dir():
        return
    bin_paths = [path for path in nvidia_root.glob("*/bin") if path.is_dir()]
    current_path = os.environ.get("PATH", "")
    os.environ["PATH"] = os.pathsep.join([*(str(path) for path in bin_paths), current_path])
    for bin_path in bin_paths:
        _DLL_DIRECTORY_HANDLES.append(os.add_dll_directory(str(bin_path)))


@dataclass(frozen=True)
class Detection:
    class_id: int
    label: str
    confidence: float
    box: tuple[float, float, float, float]

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)


class DetectorUnavailable(RuntimeError):
    pass


def _nms(boxes: np.ndarray, scores: np.ndarray, threshold: float) -> list[int]:
    if len(boxes) == 0:
        return []
    x1, y1, x2, y2 = boxes.T
    areas = np.maximum(0.0, x2 - x1) * np.maximum(0.0, y2 - y1)
    order = scores.argsort()[::-1]
    keep: list[int] = []
    while order.size:
        index = int(order[0])
        keep.append(index)
        if order.size == 1:
            break
        rest = order[1:]
        xx1 = np.maximum(x1[index], x1[rest])
        yy1 = np.maximum(y1[index], y1[rest])
        xx2 = np.minimum(x2[index], x2[rest])
        yy2 = np.minimum(y2[index], y2[rest])
        intersection = np.maximum(0.0, xx2 - xx1) * np.maximum(0.0, yy2 - yy1)
        union = areas[index] + areas[rest] - intersection
        iou = np.divide(intersection, union, out=np.zeros_like(intersection), where=union > 0)
        order = rest[iou <= threshold]
    return keep


def _decode_yolox(prediction: np.ndarray, input_size: tuple[int, int]) -> np.ndarray:
    grids: list[np.ndarray] = []
    expanded_strides: list[np.ndarray] = []
    for stride in (8, 16, 32):
        height, width = input_size[0] // stride, input_size[1] // stride
        y_grid, x_grid = np.meshgrid(np.arange(height), np.arange(width), indexing="ij")
        grid = np.stack((x_grid, y_grid), axis=-1).reshape(1, -1, 2)
        grids.append(grid)
        expanded_strides.append(np.full((*grid.shape[:2], 1), stride))
    grid = np.concatenate(grids, axis=1)
    strides = np.concatenate(expanded_strides, axis=1)
    if prediction.shape[0] != grid.shape[1]:
        raise RuntimeError(f"YOLOX output rows {prediction.shape[0]} do not match input {input_size}")
    decoded = prediction.copy()
    decoded[:, :2] = (decoded[:, :2] + grid[0]) * strides[0]
    decoded[:, 2:4] = np.exp(np.clip(decoded[:, 2:4], -12.0, 12.0)) * strides[0]
    return decoded


class YoloxDetector:
    def __init__(
        self,
        model_path: str | Path,
        backend: str = "auto",
        input_size: tuple[int, int] = (416, 416),
        gpu_memory_limit_mb: int = 2048,
    ) -> None:
        _register_bundled_nvidia_dlls()
        try:
            import onnxruntime as ort
        except ImportError as error:
            raise DetectorUnavailable("onnxruntime is not installed") from error

        model = Path(model_path)
        if not model.is_file():
            raise DetectorUnavailable(f"model is not installed: {model}")
        if hasattr(ort, "preload_dlls"):
            try:
                ort.preload_dlls(directory="")
            except Exception:
                pass

        available = set(ort.get_available_providers())
        providers: list[Any] = []
        if backend in {"auto", "gpu"} and "CUDAExecutionProvider" in available:
            providers.append(("CUDAExecutionProvider", {
                "device_id": 0,
                "gpu_mem_limit": gpu_memory_limit_mb * 1024 * 1024,
                "arena_extend_strategy": "kSameAsRequested",
            }))
        if backend == "gpu" and not providers:
            raise DetectorUnavailable("CUDAExecutionProvider is unavailable")
        providers.append("CPUExecutionProvider")
        self.session = ort.InferenceSession(str(model), providers=providers)
        if backend == "gpu" and hasattr(self.session, "disable_fallback"):
            self.session.disable_fallback()
        self.provider = self.session.get_providers()[0]
        self.input_name = self.session.get_inputs()[0].name
        self.input_size = input_size

    def detect(
        self,
        image: Image.Image,
        confidence_threshold: float = 0.30,
        nms_threshold: float = 0.45,
    ) -> list[Detection]:
        input_height, input_width = self.input_size
        ratio = min(input_width / image.width, input_height / image.height)
        resized = image.resize(
            (max(1, round(image.width * ratio)), max(1, round(image.height * ratio))),
            Image.Resampling.BILINEAR,
        )
        canvas = np.full((input_height, input_width, 3), 114, dtype=np.uint8)
        pixels = np.asarray(resized)
        canvas[: pixels.shape[0], : pixels.shape[1]] = pixels[..., ::-1]
        tensor = np.ascontiguousarray(canvas.transpose(2, 0, 1)[None], dtype=np.float32)
        prediction = np.asarray(self.session.run(None, {self.input_name: tensor})[0])[0]
        self.provider = self.session.get_providers()[0]
        if prediction.ndim != 2 or prediction.shape[1] < 6:
            raise RuntimeError(f"unexpected YOLOX output shape: {prediction.shape}")
        prediction = _decode_yolox(prediction, self.input_size)

        class_scores = prediction[:, 5:]
        class_ids = np.argmax(class_scores, axis=1)
        scores = prediction[:, 4] * class_scores[np.arange(len(prediction)), class_ids]
        allowed = np.isin(class_ids, np.fromiter(COCO_CLASSES, dtype=np.int64))
        selected = (scores >= confidence_threshold) & allowed
        if not np.any(selected):
            return []

        centers = prediction[selected, :4]
        selected_scores = scores[selected]
        selected_classes = class_ids[selected]
        boxes = np.empty_like(centers)
        boxes[:, 0] = centers[:, 0] - centers[:, 2] / 2
        boxes[:, 1] = centers[:, 1] - centers[:, 3] / 2
        boxes[:, 2] = centers[:, 0] + centers[:, 2] / 2
        boxes[:, 3] = centers[:, 1] + centers[:, 3] / 2
        boxes /= ratio
        boxes[:, [0, 2]] = np.clip(boxes[:, [0, 2]], 0, image.width)
        boxes[:, [1, 3]] = np.clip(boxes[:, [1, 3]], 0, image.height)

        detections: list[Detection] = []
        for class_id in np.unique(selected_classes):
            indices = np.flatnonzero(selected_classes == class_id)
            for relative_index in _nms(boxes[indices], selected_scores[indices], nms_threshold):
                index = int(indices[relative_index])
                detections.append(Detection(
                    class_id=int(class_id),
                    label=COCO_CLASSES[int(class_id)],
                    confidence=float(selected_scores[index]),
                    box=tuple(float(value) for value in boxes[index]),
                ))
        return sorted(detections, key=lambda detection: detection.confidence, reverse=True)
