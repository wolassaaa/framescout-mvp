# FrameScout Phase 0 Acceptance Record

Status: implemented against `docs/framescout-master-spec.md` Phase 0.

Date: 2026-07-11

## Scope

Phase 0 is limited to the foundation and visual system:

- Tauri 2 + React workspace shell.
- Midnight Pit Wall design tokens.
- In-memory fixture data only.
- Navigable Projects, Import, Review Desk and Grid screens.
- Keyboard-first review actions, AI Reject visibility, inspector, loupe and undo/redo.
- Screenshot regression tests at 1440x900 and 1280x800.

Out of scope by design: real filesystem ingest, SQLite persistence, RAW preview extraction, ML inference, XMP export and burst grouping.

## Evidence

Primary implementation:

- `apps/desktop/`
- `packages/contracts/`
- `packages/design-tokens/`

Visual regression baselines:

- `tests/e2e/review-desk.spec.ts-snapshots/review-desk-chromium-desktop-win32.png`
- `tests/e2e/review-desk.spec.ts-snapshots/review-desk-chromium-compact-win32.png`
- `tests/e2e/review-desk.spec.ts-snapshots/grid-chromium-desktop-win32.png`
- `tests/e2e/review-desk.spec.ts-snapshots/grid-chromium-compact-win32.png`

Verification commands:

```bash
npm run build
npm run test
npm run test:e2e
python -m pytest
```

Latest local result:

- TypeScript/Vite build: passed.
- Vitest reducer tests: 3 passed.
- Playwright visual/regression tests: 4 passed across 1440x900 and 1280x800 using system Chrome.
- Python prototype tests: 3 passed.

## Requirement Trace

| Master spec item | Phase 0 evidence |
| --- | --- |
| Tauri 2 + React workspace | `apps/desktop/src-tauri`, `apps/desktop/src` |
| Design token package implementing Midnight Pit Wall | `packages/design-tokens/src/tokens.css` |
| Fake in-memory project data | `apps/desktop/src/data/fixtures.ts` |
| Projects / Import / Review Desk / Grid screens | Feature folders under `apps/desktop/src/features` |
| Keyboard map and focus behaviour | `apps/desktop/src/App.tsx`, `reviewState.ts`, reducer tests |
| Screenshot tests | `tests/e2e/review-desk.spec.ts` and snapshot baselines |
| No production ML or filesystem ingest | Desktop shell uses fixture data and placeholder Tauri command only |

## Remaining Phase 1 Entry Point

The next unfinished phase is safe project and preview persistence:

- Folder project creation through typed Tauri commands.
- SQLite schema and migrations.
- JPEG plus Canon CR2 embedded preview path.
- Human decisions and undo/redo persisted across restart.
- No original file mutation.
