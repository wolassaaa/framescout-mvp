from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path

from .detection import DisabledPersonDetector, PersonDetector
from .models import ImageResult, PersonDetection, ScanReport, Verdict
from .quality import measure_quality

SUPPORTED_EXTENSIONS = {".jpg", ".jpeg", ".png", ".tif", ".tiff"}


@dataclass(frozen=True)
class AnalysisSettings:
    # Calibrate these per camera/lens/ISO after collecting human decisions.
    minimum_sharpness: float = 0.00025
    extreme_shadow_clip_ratio: float = 0.55
    reject_empty_frames: bool = True
    empty_frame_min_confidence: float = 0.55


def classify(
    path: Path, quality, people: PersonDetection, settings: AnalysisSettings
) -> ImageResult:
    reasons: list[str] = []
    tags = ["framescout:analyzed"]
    verdict = Verdict.KEEP

    if quality.sharpness < settings.minimum_sharpness:
        reasons.append("out_of_focus")
        tags.extend(["quality:soft", "reject:out_of_focus"])
        verdict = Verdict.REJECT
    else:
        tags.append("quality:sharp")

    if quality.shadow_clip_ratio > settings.extreme_shadow_clip_ratio:
        reasons.append("extremely_underexposed")
        tags.extend(["exposure:very_dark", "review:underexposed"])
        if verdict != Verdict.REJECT:
            verdict = Verdict.REVIEW
    elif quality.highlight_clip_ratio > 0.20:
        tags.append("exposure:highlight_clipping")
    else:
        tags.append("exposure:usable")

    if not people.is_available:
        tags.append("people:unknown")
    elif people.count == 0:
        reasons.append("no_person_detected")
        tags.append("people:none")
        if settings.reject_empty_frames and verdict != Verdict.REJECT:
            verdict = Verdict.REJECT
            tags.append("reject:no_person")
        else:
            verdict = max(verdict, Verdict.REVIEW, key=lambda value: [Verdict.KEEP, Verdict.REVIEW, Verdict.REJECT].index(value))
            tags.append("review:no_person")
    else:
        tags.append("people:present")
        tags.append(f"people:count_{people.count}")
        if people.largest_area_ratio is not None:
            tags.append("subject:close" if people.largest_area_ratio >= 0.12 else "subject:distant")

    rating = {Verdict.REJECT: -1, Verdict.REVIEW: 1, Verdict.KEEP: 3}[verdict]
    label = {Verdict.REJECT: "AI Reject", Verdict.REVIEW: "AI Review", Verdict.KEEP: "AI Keep"}[verdict]
    return ImageResult(path, verdict, reasons, sorted(set(tags)), quality, people, rating, label)


def analyze_paths(
    paths: list[Path],
    detector: PersonDetector | None = None,
    settings: AnalysisSettings = AnalysisSettings(),
) -> ScanReport:
    detector = detector or DisabledPersonDetector()
    report = ScanReport()
    for path in paths:
        quality = measure_quality(str(path))
        report.results.append(classify(path, quality, detector.detect(str(path)), settings))
    return report


def discover_images(root: Path) -> list[Path]:
    return sorted(
        path for path in root.rglob("*") if path.is_file() and path.suffix.lower() in SUPPORTED_EXTENSIONS
    )
