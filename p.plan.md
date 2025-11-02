### PoleCheck Desktop – Commercial-Grade P0/P1 Plan (Windows 11 x64)

#### Assumptions

- Primary imagery: Google Street View (JS API + `streetviewpixels.googleapis.com` depth).  
- Measurement target: 1–2% relative error at 5–30 m.  
- Platform: Windows 11 x64 only.  

#### P0 — Accuracy, Robustness, Security

- Depth fusion and calibration
- Fuse Street View planes with ONNX depth per-pixel: prefer planes; fall back to ONNX with confidence from Sobel gradients and plane boundary proximity. Implement in `src/services/measurementLogic.ts` and `src/services/geometry.ts` (augment `screenToWorldWithDepth`, add fusion util). Persist per-model scale/bias in Electron store; keep per-pano session deltas.
- Strengthen ONNX sampling: extend kernel sizes (3/5/7/9) with percentile filter; stabilize mapping using `transform` fields from main process; expand tests under `src/tests/unit/services/measurementLogic.test.ts`.
- Auto-calibration: promote current RANSAC-based horizon detection; add per-zoom bias table; write to settings via IPC (`electron/main.ts` save-settings) and surface confidence in UI.

- Geometry and measurement hardening
- Validate plane normals/sign convention once; add fast reject when |n·v|<ε; clamp t to physical bounds; unit tests in `geometry.test.ts`.
- Height estimation: when planes available for start+top, use ΔY directly; else angle method; expose final “method” and confidence in `Measurement` objects and sidebar.
- Polyline/Area/Volume: ensure world conversion uses same fusion path; unify confidence scoring; add perimeter/area plausibility checks (self-intersection guard) in `AreaTool.tsx`, `utils/volumeBase.ts`.

- Prefetch and latency
- Add Street View depth prefetch of adjacent panos (existing ONNX prefetch exists): new method in `src/services/depthPrefetch.ts` calling `fetch-depth-data` IPC; throttle via `maxConcurrent`.
- Cache ONNX depth keyed by pano+zoom+heading+pitch+FOV; already in `src/services/depth.ts` — extend key to include `transform` signature.

- Electron security and Windows hardening
- Keep `contextIsolation` and strict preload channel allowlist (`electron/preload.ts`). Add CSP meta to `index.html` and block remote eval. Disable `nodeIntegration` (already off).
- Package ONNX under `asarUnpack` (already configured) and verify path resolution in `electron/main.ts` search. Add graceful fallback to tiny model if primary missing.
- Ship signed Windows installer (NSIS) and Portable; integrate vendor code signing later; keep `requestedExecutionLevel: asInvoker`.

- Compliance and keys
- Centralize API key usage (renderer + main) and add rate-limit banners (already surfaced). Document Street View ToS constraints; no local persistence of raw SV imagery; only store derived measurements.

#### P1 — UX, Observability, Tooling

- UI polish for measurement flows
- Sidebar: show source (planes/onnx/ground), confidence, and calibration state; allow rename; compact list with virtualization.
- In-overlay guidance: dynamic prompts for calibration and “generate depth map”.

- Observability
- Expand `log-error` to structured JSONL and add anonymized measurement stats (turnkey opt-in). Expose diagnostics panel.

- Test/QA and benchmarks
- Golden-scenes harness: curated panos with known dimensions; assert <2% error at 5–30 m (E2E + unit). Manual QA checklists (GPU toggle, depth prefetch, rate-limit behavior).

#### Files to change (most impactful)

- `src/services/measurementLogic.ts`: depth fusion, robust samplers, tests.
- `src/services/geometry.ts`: fused world conversion, plane guards, cache keys.
- `src/services/depthPrefetch.ts`: Street View depth prefetch.
- `src/components/MeasurementTool.tsx`, `AreaTool.tsx`, `PolylineTool.tsx`, `VolumeTool.tsx`: wire confidence/source and fused world points.
- `electron/main.ts`: confirm model loading, DirectML provider, depth fetch rate-limiting; persist scale/bias per model.
- `index.html`: add strict CSP.

#### Acceptance criteria (P0)

- Measured error ≤2% on golden set (5–30 m).  
- No crashes in 60 min continuous use; RSS < 500 MB on Win11 x64.  
- Rate-limit and network failures degrade gracefully; UI signals state.  
- Electron security checks pass (no dynamic eval, strict preload channels).

### To-dos (updated)

- [x] Implement plane+ONNX depth fusion and confidence in measurementLogic/geometry
- [x] Harden ONNX sampling (percentile, larger kernels, transform mapping)
- [x] Upgrade auto-calibration; persist per-zoom bias; expose confidence
- [x] Add plane normal/t intersection guards and tests in geometry
- [x] Use fused conversion in Polyline/Area/Volume; unify confidence
- [x] Prefetch Street View depth for adjacent panos with throttling
- [x] Extend depth cache key to include transform signature
- [x] Show method, confidence, calibration state in measurement sidebar
- [x] Add strict CSP in index.html; audit preload allowlist (dev CSP relaxed for HMR; keep tighter CSP for prod)
- [x] Verify ONNX model resolution and tiny-model fallback on Windows
- [x] Add golden-scenes tests; assert ≤2% error at 5–30 m (fixtures-driven)
- [x] QA scripts for rate-limit/network; banners and fallbacks verified
- [x] Enhance main-process JSONL logging; diagnostics panel (opt-in ready)
- [x] Document API key handling and Street View ToS constraints
