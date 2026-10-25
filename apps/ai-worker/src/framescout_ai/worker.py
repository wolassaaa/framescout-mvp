from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path
from typing import Any

from . import __version__
from .detector import DetectorUnavailable, YoloxDetector
from .quality import load_proxy, measure_crop, measure_quality
from .strategy import evaluate_signals


DEFAULT_STRATEGY_ROOT = Path(__file__).resolve().parents[4] / "strategies"


def allowed_subject_labels(preset: str) -> set[str]:
    if preset == "motorsport":
        return {"person", "car", "motorcycle", "bus", "truck"}
    return {"person"}


class Analyzer:
    def __init__(self, model_path: str | None, backend: str) -> None:
        self.detector: YoloxDetector | None = None
        self.detector_error: str | None = None
        self.model_bundle_version = "framescout-quality-v1"
        if model_path:
            try:
                model_name = Path(model_path).stem.lower()
                input_size = (416, 416) if "nano" in model_name or "tiny" in model_name else (640, 640)
                self.detector = YoloxDetector(model_path, backend=backend, input_size=input_size)
                self.model_bundle_version += f"+{model_name}-0.1.1rc0"
            except DetectorUnavailable as error:
                self.detector_error = str(error)
        else:
            self.detector_error = "model path was not configured"

    @property
    def capabilities(self) -> dict[str, Any]:
        return {
            "version": __version__,
            "sourcePhotosMutable": False,
            "maxInputDimension": 1600,
            "detector": {
                "status": "ready" if self.detector else "unavailable",
                "provider": self.detector.provider if self.detector else None,
                "modelBundleVersion": self.model_bundle_version,
                "error": self.detector_error,
            },
        }

    def analyze(self, image_path: str, preset: str) -> dict[str, Any]:
        image = load_proxy(image_path)
        quality = measure_quality(image)
        detections = self.detector.detect(image) if self.detector else []
        allowed_labels = allowed_subject_labels(preset)
        subjects = [detection for detection in detections if detection.label in allowed_labels]
        focus_candidates = [measure_crop(image, detection.box) for detection in subjects[:6]]
        subject_focus = max(
            (candidate for candidate in focus_candidates if candidate is not None),
            key=lambda candidate: candidate.laplacian_variance,
            default=None,
        )
        signals = {
            "readable": True,
            "quality": quality.to_dict(),
            "subjectFocus": subject_focus.to_dict() if subject_focus else None,
            "detections": [detection.to_dict() for detection in detections],
            "allowedSubjectLabels": sorted(allowed_labels),
            "allowedSubjects": [detection.to_dict() for detection in subjects],
            "detectorStatus": "ready" if self.detector else "unavailable",
        }
        result = evaluate_signals(preset, signals, DEFAULT_STRATEGY_ROOT)
        return {
            "modelBundleVersion": self.model_bundle_version,
            "backend": self.detector.provider if self.detector else "cpu",
            **result,
            "signals": signals,
        }


def _emit(payload: dict[str, Any]) -> None:
    sys.stdout.write(json.dumps(payload, ensure_ascii=True, separators=(",", ":")) + "\n")
    sys.stdout.flush()


def _capabilities(analyzer: Analyzer | None) -> dict[str, Any]:
    if analyzer is not None:
        return analyzer.capabilities
    return {
        "version": __version__,
        "sourcePhotosMutable": False,
        "policyOnly": True,
        "detector": {"status": "not-initialized", "provider": None},
    }


def handle_request(request: dict[str, Any], analyzer: Analyzer | None = None) -> dict[str, Any]:
    command = request.get("command")
    if command == "capabilities":
        return _capabilities(analyzer)
    if command == "evaluate":
        preset = request.get("preset", "matchday-story")
        signals = request.get("signals")
        if not isinstance(preset, str) or not isinstance(signals, dict):
            raise ValueError("evaluate requires a preset and normalized signals")
        return evaluate_signals(preset, signals, DEFAULT_STRATEGY_ROOT)
    if command == "analyze":
        if analyzer is None:
            raise ValueError("analyze is unavailable in policy-only mode")
        return analyzer.analyze(request["imagePath"], request.get("preset", "matchday-story"))
    raise ValueError(f"unsupported command: {command}")


def serve(analyzer: Analyzer | None) -> int:
    _emit({"event": "ready", "capabilities": _capabilities(analyzer)})
    for line in sys.stdin:
        try:
            request = json.loads(line)
            request_id = request.get("id")
            result = handle_request(request, analyzer)
            _emit({"id": request_id, "ok": True, "result": result})
        except Exception as error:
            _emit({"id": request.get("id") if "request" in locals() else None, "ok": False, "error": str(error)})
    return 0


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="FrameScout local AI worker")
    parser.add_argument("--model", default=None)
    parser.add_argument("--backend", choices=["auto", "cpu", "gpu"], default="auto")
    parser.add_argument("--policy-only", action="store_true")
    subparsers = parser.add_subparsers(dest="command", required=True)
    subparsers.add_parser("capabilities")
    analyze_parser = subparsers.add_parser("analyze")
    analyze_parser.add_argument("image")
    analyze_parser.add_argument("--preset", default="matchday-story")
    subparsers.add_parser("serve")
    return parser


def main() -> int:
    args = build_parser().parse_args()
    analyzer = None if args.policy_only else Analyzer(args.model, args.backend)
    if args.command == "capabilities":
        _emit(_capabilities(analyzer))
        return 0
    if args.command == "analyze":
        if analyzer is None:
            raise ValueError("analyze is unavailable in policy-only mode")
        _emit(analyzer.analyze(args.image, args.preset))
        return 0
    return serve(analyzer)


if __name__ == "__main__":
    raise SystemExit(main())
