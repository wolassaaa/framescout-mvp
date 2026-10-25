from pathlib import Path

import numpy as np
from PIL import Image, ImageFilter

from framescout.models import PersonDetection, Verdict
from framescout.pipeline import AnalysisSettings, analyze_paths
from framescout.xmp import write_xmp


class PresentPerson:
    def detect(self, path: str) -> PersonDetection:
        return PersonDetection(1, 0.2, 0.99, "test")


class EmptyScene:
    def detect(self, path: str) -> PersonDetection:
        return PersonDetection(0, 0.0, None, "test")


def _checkerboard(path: Path) -> None:
    cells = np.indices((120, 120)).sum(axis=0) % 2 * 255
    Image.fromarray(cells.astype(np.uint8), "L").save(path)


def test_soft_frame_is_rejected_and_tagged(tmp_path: Path) -> None:
    sharp = tmp_path / "sharp.jpg"
    soft = tmp_path / "soft.jpg"
    _checkerboard(sharp)
    with Image.open(sharp) as image:
        image.filter(ImageFilter.GaussianBlur(10)).save(soft)
    report = analyze_paths([sharp, soft], PresentPerson(), AnalysisSettings(minimum_sharpness=0.005))
    assert report.results[0].verdict == Verdict.KEEP
    assert report.results[1].verdict == Verdict.REJECT
    assert "reject:out_of_focus" in report.results[1].tags


def test_empty_frame_is_rejected_when_detector_is_confident(tmp_path: Path) -> None:
    image = tmp_path / "empty.jpg"
    _checkerboard(image)
    result = analyze_paths([image], EmptyScene()).results[0]
    assert result.verdict == Verdict.REJECT
    assert "reject:no_person" in result.tags


def test_xmp_keeps_existing_keywords(tmp_path: Path) -> None:
    image = tmp_path / "frame.jpg"
    _checkerboard(image)
    result = analyze_paths([image], PresentPerson()).results[0]
    xmp = image.with_suffix(".xmp")
    xmp.write_text('''<?xml version="1.0"?><x:xmpmeta xmlns:x="adobe:ns:meta/" xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#" xmlns:dc="http://purl.org/dc/elements/1.1/"><rdf:RDF><rdf:Description rdf:about=""><dc:subject><rdf:Bag><rdf:li>manual:finals</rdf:li></rdf:Bag></dc:subject></rdf:Description></rdf:RDF></x:xmpmeta>''')
    write_xmp(result)
    contents = xmp.read_text()
    assert "manual:finals" in contents
    assert "framescout:analyzed" in contents
