from __future__ import annotations

import argparse
import json
from pathlib import Path

from .detection import DisabledPersonDetector, YoloPersonDetector
from .pipeline import AnalysisSettings, analyze_paths, discover_images
from .xmp import write_xmp


def _parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Cull technical rejects and tag photo previews locally.")
    parser.add_argument("folder", type=Path, help="Folder of JPEG/PNG/TIFF previews")
    parser.add_argument("--detector", choices=["none", "yolo"], default="none")
    parser.add_argument("--report", type=Path, default=Path("framescout-report.json"))
    parser.add_argument("--write-xmp", action="store_true", help="Write filename.xmp sidecars after analysis")
    parser.add_argument("--keep-empty", action="store_true", help="Tag zero-person frames for review instead of rejecting them")
    parser.add_argument("--minimum-sharpness", type=float, default=AnalysisSettings.minimum_sharpness)
    return parser


def main() -> None:
    args = _parser().parse_args()
    if not args.folder.is_dir():
        raise SystemExit(f"Not a folder: {args.folder}")
    paths = discover_images(args.folder)
    if not paths:
        raise SystemExit("No supported previews found. RAW preview extraction is not included yet.")
    detector = YoloPersonDetector() if args.detector == "yolo" else DisabledPersonDetector()
    settings = AnalysisSettings(
        minimum_sharpness=args.minimum_sharpness,
        reject_empty_frames=not args.keep_empty,
    )
    report = analyze_paths(paths, detector, settings)
    args.report.write_text(json.dumps(report.to_dict(), indent=2), encoding="utf-8")
    if args.write_xmp:
        for result in report.results:
            write_xmp(result)
    print(json.dumps(report.to_dict()["summary"], indent=2))
    print(f"Report: {args.report.resolve()}")


if __name__ == "__main__":
    main()
