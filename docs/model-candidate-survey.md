# FrameScout model candidate survey

Research date: 2026-07-13. This is a development shortlist, not a redistribution approval.

## Selection principle

FrameScout should combine small specialist models instead of asking one vision-language model to make every decision. Each model must contribute a persisted, inspectable signal. Human labels remain authoritative.

| Lane | Candidate | Expected contribution | Runtime fit | License/release gate | Priority |
| --- | --- | --- | --- | --- | --- |
| Object/subject detection | [RT-DETRv2-S](https://github.com/lyuwenyu/RT-DETR) | Better small-person and vehicle recall than the current YOLOX baseline | ONNX Runtime or TensorRT on RTX; sequential inference | Official repository is Apache-2.0; exact checkpoint provenance and redistribution still require manifest review | P0 evaluation |
| Face and eye state | [MediaPipe Face Landmarker](https://github.com/google-ai-edge/mediapipe) | Face landmarks, eye-blink coefficients, face-region crops | CPU-friendly; GPU optional | Code is Apache-2.0; exact task-model terms and artifact hash must be recorded | P0 evaluation |
| Technical image quality | [MUSIQ](https://research.google/blog/musiq-assessing-image-aesthetic-and-technical-quality-with-multi-scale-transformers/) | Learned blur/noise/exposure/compression quality across multiple scales | RTX preferred; sample full frame and subject crop | Google Research code is Apache-2.0; checkpoint redistribution needs verification | P1 evaluation |
| Lightweight quality baseline | [NIMA MobileNet](https://github.com/idealo/image-quality-assessment) | Separate aesthetic and technical score distributions | CPU-capable, old TensorFlow stack may need ONNX conversion | Apache-2.0 implementation; verify included checkpoint provenance | P1 baseline |
| Aesthetic ranking | [LAION Aesthetic Predictor](https://github.com/LAION-AI/aesthetic-predictor) | Relative visual-appeal ranking inside a burst or event | Small linear head plus CLIP/OpenCLIP embedding | Predictor is MIT; embedding model and weights need their own manifest entries | P1 ranking only |
| Cloud semantic reasoning | [Qwen3-VL Flash / Plus](https://docs.qwencloud.com/developer-guides/getting-started/vision-models) | Scene intent, storytelling, unusual failure explanation, optional tags | Proxy-only cloud API; Flash for cost/latency, Plus for adjudication | Service terms and regional data handling apply; no local weight bundling | P1 opt-in |
| Face detection research control | [InsightFace SCRFD](https://github.com/deepinsight/insightface) | Strong face detection and alignment baseline | ONNX Runtime CPU/GPU | Code is MIT, but official pretrained models are non-commercial research only; do not ship | Research only |

## First local baseline

Dataset: a deterministic, path-spaced sample of 12 decodable JPG files from `G:\F1` (18,919 JPG files total). Source files were read only and SHA-256 hashes were identical before and after inference.

| Model | Input | Mean seconds/image | Notes |
| --- | --- | ---: | --- |
| YOLOX-Nano | 416 x 416 | 0.670 including first-image warm-up; about 0.586 after it | Missed several small/distant people |
| YOLOX-S | 640 x 640 | 0.589 | No meaningful throughput penalty on the RTX 5080 in this small run |

The two models disagreed on person count in 5/12 frames and on the final Keep/Review suggestion in 2/12. Visual inspection of the two decision disagreements confirmed that YOLOX-S found real distant people that Nano missed. This is not an accuracy score because the sample has not been exhaustively annotated.

The run also exposed two pipeline requirements:

1. Files named `._*.JPG` are macOS AppleDouble metadata, not decodable photos, and must be rejected during discovery.
2. A Motorsport project must treat detected vehicles as allowed subjects. The baseline detector already found the race car, but the original policy discarded non-person detections.

## Evaluation order

1. Keep YOLOX-S as the local default; do not promote Nano as a faster profile until a larger throughput test proves a benefit.
2. Add RT-DETRv2-S beside YOLOX-S and compare small-subject recall on 100 manually reviewed proxies.
3. Add MediaPipe face/eye signals. Measure face recall and closed-eye precision only on frames where faces are large enough to judge.
4. Add one technical IQA model, starting with MUSIQ and using NIMA as a cheaper control.
5. Add aesthetic scoring only as within-group ranking. It must never hard-reject a frame.
6. Compare Qwen Flash and Plus on the same 30 proxy images with a fixed JSON prompt, recording latency, cost, schema failures and human usefulness.

## Required report fields

Every candidate run records model/hash, provider, input size, VRAM peak, warm and steady latency, subject recall, false-reject rate, JSON/schema failure rate, license status, and source-hash verification. Results must be split by event and day to avoid near-duplicate leakage.
