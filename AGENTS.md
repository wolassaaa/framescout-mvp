# FrameScout delivery rules

Before implementing or modifying product code, read `docs/framescout-master-spec.md` in full. It is the source of truth for product scope, interaction design, architecture, model choices, test requirements, and acceptance criteria.

The proxy-first execution pack supplied with `framescout-mvp (1)` is the active delivery plan. Its sprint order and MVP boundary take precedence where they conflict with older phase documents. Record each sprint in `docs/execution-pack/STATUS.md`.

## Non-negotiables

- Keep originals immutable. All decisions are stored in the project database and written to XMP only after explicit user confirmation.
- Local-first is the default. Never transmit images, embeddings, EXIF, or tags unless the user explicitly enables a clearly labelled cloud feature.
- The primary review flow must be keyboard-first and feel instant. Do not add features that put a dashboard between the photographer and their images.
- AI must expose evidence and permit immediate reversal. Never silently delete, move, or overwrite a source image.
- Build vertical slices in the order prescribed by the master specification. Finish the test and acceptance criteria for a slice before starting the next one.
- JPEG/proxy assets are the display and analysis sources. RAW files are optional mapped masters for metadata handoff only; do not add RAW decoding before the proxy-first MVP gate passes.

## Existing prototype

`src/framescout/` is a Python feasibility prototype for deterministic quality scoring and XMP writing. It is reference code and a test oracle; it is not the intended production desktop architecture.
