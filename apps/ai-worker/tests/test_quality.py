from pathlib import Path

import numpy as np
from PIL import Image

from framescout_ai.detector import _decode_yolox
from framescout_ai.policy import decide
from framescout_ai.quality import load_proxy, measure_quality
from framescout_ai.worker import Analyzer, allowed_subject_labels, handle_request


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


def test_analyzer_returns_strategy_provenance_and_standard_signals(tmp_path: Path) -> None:
    proxy = tmp_path / "proxy.jpg"
    Image.new("RGB", (120, 80), (128, 128, 128)).save(proxy)
    analyzer = Analyzer(model_path=None, backend="cpu")

    result = analyzer.analyze(str(proxy), "motorsport")

    assert result["strategyId"] == "motorsport"
    assert result["strategyVersion"] == 1
    assert "detections" in result["signals"]
    assert result["aiDisposition"] in {"keep", "review", "reject"}


def test_analyzer_does_not_turn_an_unavailable_detector_into_confirmed_empty(
    tmp_path: Path,
) -> None:
    proxy = tmp_path / "proxy.jpg"
    Image.new("RGB", (120, 80), (128, 128, 128)).save(proxy)

    result = Analyzer(model_path=None, backend="cpu").analyze(
        str(proxy), "action-coverage"
    )

    assert result["aiDisposition"] == "review"
    assert result["reasons"] == ["subject_detector_unavailable"]
    assert "no_allowed_subject" not in result["reasons"]


def test_policy_only_evaluate_uses_normalized_signals_without_initializing_detector(
    monkeypatch,
) -> None:
    detector_factory_calls = 0

    def detector_factory(*_args, **_kwargs):
        nonlocal detector_factory_calls
        detector_factory_calls += 1
        raise AssertionError("policy-only evaluation initialized a detector")

    monkeypatch.setattr("framescout_ai.worker.YoloxDetector", detector_factory)

    response = handle_request(
        {
            "command": "evaluate",
            "preset": "motorsport",
            "signals": {
                "readable": True,
                "detections": [{"label": "car", "confidence": 0.94}],
            },
        }
    )

    assert response["strategyId"] == "motorsport"
    assert response["strategyVersion"] == 1
    assert response["aiDisposition"] == "keep"
    assert response["tags"] == ["subject:car"]
    assert detector_factory_calls == 0
