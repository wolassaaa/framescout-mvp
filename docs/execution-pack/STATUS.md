# FrameScout Execution Status

> This file records delivery stabilization against the Web-first, proxy-first plan. Source photos remain read-only.

## Current Release

- Milestone: browser delivery stabilization
- State: technical delivery gates passed
- User path: system browser Web UI with a visible localhost terminal service
- Desktop path: Tauri retained for compatibility, excluded from this release entry point
- Release blocker: model weights remain excluded while redistribution review is pending

## Product Baseline

- The browser connects only to the real localhost service in normal use. An unavailable service shows an offline recovery screen and never substitutes fixture projects.
- Import returns a project before background indexing completes. The browser polls compact index and analysis status responses.
- Browsing uses 512 px thumbnails and up to 2560 px review previews. Missing derived images are regenerated on demand without changing their source files.
- Review, Grid and Tags share filters and selection. `Select all` always selects the whole project/session; `Ctrl+A` has the same meaning in Review and Grid.
- Undo history stores field patches with a 100-operation cap. Decision and tag writes use recoverable batch queues.
- Chinese is the default interface and English can be switched at runtime.

## Verification

Verified on 2026-07-28:

```text
cargo fmt --all -- --check
cargo test -p framescout-local-service
cargo check -p framescout-desktop
npm run build
npm test
npm run test:ai
npm run test:service-smoke
npm run test:e2e
```

- Frontend and contract tests: 150 passed.
- Local service: 32 passed, with the real-model integration test run separately and passed.
- Python AI: 149 passed.
- Browser E2E: 36 passed at desktop and compact viewports.
- Service smoke: 20 sampled images loaded, no broken images, failed requests or console errors.
- CUDA capability check: `CUDAExecutionProvider` ready with the local YOLOX-S development model.
- Real CUDA integration: proxy image analyzed, evidence persisted, source hash unchanged.

## Read-Only Pressure Test

The source corpus was `G:\F1`. Tests read files only and wrote all databases, logs and derived images into isolated FrameScout test cache directories.

| Import | Result | First preview | Completion | Browser heap | Service working set |
| --- | --- | ---: | ---: | ---: | ---: |
| 500 photos | 500 indexed, 500 ready, 0 failed | 539 ms | 288.6 s | sampled in 1000-photo run | 17.6 MB peak |
| 1000 photos | 1000 indexed, 1000 ready, 0 failed | 554 ms | 555 s | 23.4 MB used | 19.9 MB after completion |

Additional 1000-photo checks:

- 40 sampled previews loaded and none were broken.
- Tags-to-Review navigation completed in 118 ms.
- Whole-system GPU memory observed at 1942 MB, below the configured 2 GB ceiling.
- The source directory timestamp was unchanged.

## Delivery Decision

The Web-first application, localhost service, recovery states, large-import flow, thumbnail regeneration, AI progress, shared selection, responsive layout and automated tests meet the technical delivery gate.

`models/manifest.json` still marks bundled weights as `development-only-pending-review`. Release packaging must therefore omit those weights until redistribution approval is documented. The app may use a separately installed local development model or the configured cloud provider.
