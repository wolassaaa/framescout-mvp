from __future__ import annotations

from dataclasses import asdict, dataclass, field
from enum import StrEnum
from pathlib import Path


class Verdict(StrEnum):
    KEEP = "keep"
    REVIEW = "review"
    REJECT = "reject"


@dataclass(frozen=True)
class QualityMetrics:
    sharpness: float
    shadow_clip_ratio: float
    highlight_clip_ratio: float
    mean_luminance: float


@dataclass(frozen=True)
class PersonDetection:
    count: int | None
    largest_area_ratio: float | None
    confidence: float | None
    backend: str

    @property
    def is_available(self) -> bool:
        return self.count is not None


@dataclass
class ImageResult:
    path: Path
    verdict: Verdict
    reasons: list[str]
    tags: list[str]
    quality: QualityMetrics
    people: PersonDetection
    rating: int
    label: str

    def to_dict(self) -> dict:
        result = asdict(self)
        result["path"] = str(self.path)
        result["verdict"] = self.verdict.value
        return result


@dataclass
class ScanReport:
    results: list[ImageResult] = field(default_factory=list)

    def to_dict(self) -> dict:
        return {
            "summary": {
                "total": len(self.results),
                "keep": sum(r.verdict == Verdict.KEEP for r in self.results),
                "review": sum(r.verdict == Verdict.REVIEW for r in self.results),
                "reject": sum(r.verdict == Verdict.REJECT for r in self.results),
            },
            "images": [result.to_dict() for result in self.results],
        }
