from pathlib import Path

import numpy as np
from PIL import Image

from framescout_ai.detector import _decode_yolox
from framescout_ai.policy import decide
from framescout_ai.quality import load_proxy, measure_quality
from framescout_ai.worker import allowed_subject_labels


def test_quality_pipeline_reads_without_mutating_source(tmp_path: Path) -> None:
    path = tmp_path / "proxy.jpg"
    Image.new("RGB", (120, 80), (128, 128, 128)).save(path)
    before = path.read_bytes()

    quality = measure_quality(load_proxy(path))

    assert quality.width == 120
    assert quality.height == 80
    assert path.read_bytes() == before


def test_missing_detector_never_infers_empty_frame() -> None:
    quality = measure_quality(Image.new("RGB", (120, 80), (128, 128, 128)))
    disposition, reasons, evidence = decide(
        quality,
        subjects=None,
        subject_focus=None,
        preset="action-coverage",
        detector_status="unavailable",
    )

    assert "no_allowed_subject" not in reasons
    assert "subject_detector_unavailable" in reasons
    assert disposition in {"keep", "review"}
    assert any(item["value"] == "detector unavailable" for item in evidence)


def test_ready_detector_with_missing_subject_result_remains_unknown() -> None:
    quality = measure_quality(Image.new("RGB", (120, 80), (128, 128, 128)))

    disposition, reasons, evidence = decide(
        quality,
        subjects=None,
        subject_focus=None,
        preset="action-coverage",
        detector_status="ready",
    )

    assert disposition == "review"
    assert reasons == ["allowed_subject_signal_unavailable"]
    assert evidence == [
        {
            "label": "Allowed subjects",
            "value": "signal unavailable",
            "confidence": None,
            "tone": "neutral",
        }
    ]


def test_motorsport_allows_vehicles_as_subjects() -> None:
    assert allowed_subject_labels("motorsport") == {"person", "car", "motorcycle", "bus", "truck"}
    assert allowed_subject_labels("matchday-story") == {"person"}
    assert allowed_subject_labels("portrait") == {"person"}


def test_yolox_output_is_decoded_to_input_pixel_coordinates() -> None:
    prediction = np.zeros((3549, 85), dtype=np.float32)
    decoded = _decode_yolox(prediction, (416, 416))

    assert decoded.shape == prediction.shape
    assert decoded[1, 0] == 8
    assert decoded[0, 2] == 8
