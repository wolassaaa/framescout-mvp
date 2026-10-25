from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path
from typing import Any

from . import __version__
from .detector import DetectorUnavailable, YoloxDetector
from .policy import decide
from .quality import load_proxy, measure_crop, measure_quality


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
        disposition, reasons, evidence = decide(
            quality,
            [detection.to_dict() for detection in subjects] if self.detector else None,
            subject_focus,
            preset,
            "ready" if self.detector else "unavailable",
        )
        return {
            "modelBundleVersion": self.model_bundle_version,
            "backend": self.detector.provider if self.detector else "cpu",
            "aiDisposition": disposition,
            "reasons": reasons,
            "evidence": evidence,
            "signals": {
                "quality": quality.to_dict(),
                "subjectFocus": subject_focus.to_dict() if subject_focus else None,
                "detections": [detection.to_dict() for detection in detections],
                "allowedSubjectLabels": sorted(allowed_labels),
                "allowedSubjects": [detection.to_dict() for detection in subjects],
                "detectorStatus": "ready" if self.detector else "unavailable",
            },
        }


def _emit(payload: dict[str, Any]) -> None:
    sys.stdout.write(json.dumps(payload, ensure_ascii=True, separators=(",", ":")) + "\n")
    sys.stdout.flush()


def serve(analyzer: Analyzer) -> int:
    _emit({"event": "ready", "capabilities": analyzer.capabilities})
    for line in sys.stdin:
        try:
            request = json.loads(line)
            request_id = request.get("id")
            command = request.get("command")
            if command == "capabilities":
                result = analyzer.capabilities
            elif command == "analyze":
                result = analyzer.analyze(request["imagePath"], request.get("preset", "matchday-story"))
            else:
                raise ValueError(f"unsupported command: {command}")
            _emit({"id": request_id, "ok": True, "result": result})
        except Exception as error:
            _emit({"id": request.get("id") if "request" in locals() else None, "ok": False, "error": str(error)})
    return 0


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="FrameScout local AI worker")
    parser.add_argument("--model", default=None)
    parser.add_argument("--backend", choices=["auto", "cpu", "gpu"], default="auto")
    subparsers = parser.add_subparsers(dest="command", required=True)
    subparsers.add_parser("capabilities")
    analyze_parser = subparsers.add_parser("analyze")
    analyze_parser.add_argument("image")
    analyze_parser.add_argument("--preset", default="matchday-story")
    subparsers.add_parser("serve")
    return parser


def main() -> int:
    args = build_parser().parse_args()
    analyzer = Analyzer(args.model, args.backend)
    if args.command == "capabilities":
        _emit(analyzer.capabilities)
        return 0
    if args.command == "analyze":
        _emit(analyzer.analyze(args.image, args.preset))
        return 0
    return serve(analyzer)


if __name__ == "__main__":
    raise SystemExit(main())
