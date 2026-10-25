# FrameScout AI runtime

## Boundary

FrameScout keeps inference outside the browser renderer:

1. React sends `analysis_enqueue` to the localhost Rust service.
2. Rust creates one durable `analysis_runs` row and starts one long-lived Python worker per project.
3. The worker reads only the proxy/display-cache path, downsizes it to at most 1600 pixels, and returns JSON.
4. Rust writes AI disposition, machine-readable reasons, and evidence into SQLite.
5. React polls the existing command contract and renders the persisted evidence.

The worker never writes image files. Human decisions are stored separately and re-analysis cannot overwrite them.

The topbar analysis-lane switch selects one of three local profiles or an explicitly configured cloud profile. The non-secret selection is stored in `%APPDATA%/com.framescout.desktop/analysis-profile.json`.

## Signal gates

The first bundle uses deterministic image metrics before the detector:

- readability and dimensions;
- global Laplacian variance and Tenengrad edge energy;
- luminance, contrast, shadow clipping, and highlight clipping;
- YOLOX COCO person/vehicle detection;
- subject-crop focus metrics when a person box exists;
- a conservative policy that sends uncertain failures to Review.

Until event-level calibration is complete, only an unreadable preview may become an automatic hard reject. A missing detector is recorded as unavailable and never becomes `no_allowed_subject`.

## Runtime

The isolated development environment lives at `apps/ai-worker/.venv`. The default model is `models/yolox_s.onnx`; model binaries are ignored by Git and verified against `models/manifest.json`.

```powershell
uv venv apps/ai-worker/.venv --python 3.14
uv pip install --python apps/ai-worker/.venv/Scripts/python.exe -e "apps/ai-worker[test,onnx-gpu]"
npm run ai:capabilities
npm run test:ai
```

The localhost service accepts these overrides:

- `FRAMESCOUT_AI_PYTHON`
- `FRAMESCOUT_AI_MODEL`
- `FRAMESCOUT_AI_FAST_MODEL`

## Cloud profiles

Cloud inference is opt-in. It never falls back to `source_path` or a mapped RAW master: only a generated display or thumbnail cache is accepted, re-encoded as JPEG, and bounded to 2.56 megapixels and 12 MiB before Base64 transport.

Secrets are read by the localhost service from its terminal environment and are never returned to React or written to the profile file:

- Qwen: `DASHSCOPE_API_KEY`
- Custom OpenAI-compatible endpoint: `FRAMESCOUT_CLOUD_API_KEY`
- Optional custom defaults: `FRAMESCOUT_CLOUD_BASE_URL` and `FRAMESCOUT_CLOUD_MODEL`

The built-in Qwen profile uses `qwen3-vl-plus` through the OpenAI-compatible chat-completions endpoint. A custom endpoint must use HTTPS; HTTP is accepted only for `localhost` test servers.

CUDA sessions are limited to a 2GB arena and fall back to CPU only when `auto` is selected. The service processes assets sequentially so image decode, inference, and persistence remain bounded.

## Model release gate

YOLOX source code is Apache-2.0. The downloaded official pretrained weights are development-only in this repository until redistribution rights have been reviewed and recorded as approved in `models/manifest.json`. A release must not bundle a model whose manifest permission is still pending.
