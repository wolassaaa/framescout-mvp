# FrameScout

FrameScout is a local-first assistant for sports and esports photographers. Its first job is deliberately narrow: identify technical rejects (especially out-of-focus frames and frames without a person) and attach useful, portable tags to the rest of a shoot.

It does **not** decide whether a frame is an emotionally important play or the photographer's best composition. That remains a fast human second pass.

## MVP workflow

1. Point FrameScout at a folder of JPEG/PNG previews (or exported embedded previews from RAW files).
2. It computes sharpness and exposure metrics, optionally detects people with a local YOLO model, and gives every image a verdict plus tags.
3. Review `report.json`; then write standard XMP sidecars. Lightroom Classic can read ratings, labels and keywords from these sidecars.

```bash
python -m pip install -e .
framescout /path/to/previews --detector yolo --report report.json
# Inspect the report, then intentionally write sidecars:
framescout /path/to/previews --detector yolo --write-xmp
```

The current Web-first build uses a bounded local ONNX worker behind the Rust terminal service. See [Local AI runtime](docs/ai-runtime.md) for setup, model provenance, GPU limits, and safety behavior.

## Project status

This repository now keeps two layers side by side:

- `apps/ai-worker/` is the isolated Pillow/NumPy/ONNX Runtime inference worker.
- `apps/local-service/` owns localhost commands, bounded analysis queues, terminal progress, and SQLite persistence.
- `apps/desktop/` is the React Web UI served on localhost; Tauri is no longer the primary interface path.

Local model inference and SQLite evidence persistence are now implemented. Web-native import parity, RAW embedded-preview extraction, model calibration, and XMP commit remain later work.

The source of truth for the production product is [FrameScout Master Specification](docs/framescout-master-spec.md). It is written as a local-Codex handoff: read it before changing the prototype.

See [product-plan.md](docs/product-plan.md) for the original product decision record and roadmap.

## Desktop Phase 0

```bash
npm install
npm run dev
npm run test
```

For the native shell:

```bash
cd apps/desktop
npm run tauri dev
```

The Phase 0 shell must stay local-first and fixture-driven until Phase 1 wires project persistence and previews through typed Tauri commands.
