"""Non-destructive Lightroom-readable XMP sidecar writer."""

from __future__ import annotations

import xml.etree.ElementTree as ET
from pathlib import Path

from .models import ImageResult

X = "adobe:ns:meta/"
RDF = "http://www.w3.org/1999/02/22-rdf-syntax-ns#"
XMP = "http://ns.adobe.com/xap/1.0/"
DC = "http://purl.org/dc/elements/1.1/"

ET.register_namespace("x", X)
ET.register_namespace("rdf", RDF)
ET.register_namespace("xmp", XMP)
ET.register_namespace("dc", DC)


def _sidecar_path(image_path: Path) -> Path:
    return image_path.with_suffix(".xmp")


def _new_tree() -> tuple[ET.ElementTree, ET.Element]:
    root = ET.Element(f"{{{X}}}xmpmeta")
    rdf = ET.SubElement(root, f"{{{RDF}}}RDF")
    description = ET.SubElement(rdf, f"{{{RDF}}}Description", {f"{{{RDF}}}about": ""})
    return ET.ElementTree(root), description


def _load_or_create(path: Path) -> tuple[ET.ElementTree, ET.Element]:
    if not path.exists():
        return _new_tree()
    tree = ET.parse(path)
    description = tree.find(f".//{{{RDF}}}Description")
    if description is None:
        raise ValueError(f"Existing XMP has no rdf:Description: {path}")
    return tree, description


def write_xmp(result: ImageResult) -> Path:
    """Merge FrameScout metadata into a regular filename.xmp sidecar.

    Existing non-FrameScout keywords are retained. FrameScout's own old tags are
    replaced so repeated runs are idempotent.
    """
    sidecar = _sidecar_path(result.path)
    tree, description = _load_or_create(sidecar)
    description.set(f"{{{XMP}}}Rating", str(result.rating))
    description.set(f"{{{XMP}}}Label", result.label)

    subject = description.find(f"{{{DC}}}subject")
    if subject is None:
        subject = ET.SubElement(description, f"{{{DC}}}subject")
        bag = ET.SubElement(subject, f"{{{RDF}}}Bag")
    else:
        bag = subject.find(f"{{{RDF}}}Bag")
        if bag is None:
            bag = ET.SubElement(subject, f"{{{RDF}}}Bag")
    existing = [node.text for node in bag.findall(f"{{{RDF}}}li") if node.text]
    retained = [tag for tag in existing if not tag.startswith(("framescout:", "quality:", "people:", "subject:", "exposure:", "reject:", "review:"))]
    bag[:] = []
    for tag in sorted(set(retained + result.tags)):
        li = ET.SubElement(bag, f"{{{RDF}}}li")
        li.text = tag
    ET.indent(tree, space="  ")
    tree.write(sidecar, encoding="utf-8", xml_declaration=True)
    return sidecar
