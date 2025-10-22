# Manual QA Scenarios

## GPU execution provider toggle (Windows)

These checks assume a Windows 10/11 device with DirectML-compatible hardware and drivers. Run the Electron shell with `npm run dev:electron` so the main-process console output is visible while testing.

1. **Baseline (GPU off)**
   - Delete the Electron Store config at `%APPDATA%/<AppName>/config.json` (or use the in-app reset) to ensure default settings.
   - Launch the desktop app and open the Settings panel. Confirm **Use GPU acceleration** is toggled off.
   - Trigger any depth measurement (e.g., load an image and request depth). In the terminal you should see `Execution providers in use: cpu`. Depth inference completes normally.
2. **Enable GPU**
   - From the Settings panel toggle **Use GPU acceleration** on. The UI should not freeze while the model reloads.
   - Observe the terminal logs: a `model-status` update is emitted followed by `Execution providers in use: dml, cpu`. Run another depth measurement to confirm results render correctly.
3. **Fallback path**
   - Temporarily disable the DirectML runtime (for example, run on a Windows VM without GPU support or start the app with `ORT_DML_DISABLE_DEVICE=1`).
   - Toggle **Use GPU acceleration** on again. The console should warn `Failed to initialize GPU providers, falling back to CPU` and `GPU initialization failed; running session on CPU execution providers.`
   - Depth inference remains functional and `Execution providers in use: cpu` is printed, confirming the automatic fallback.
4. **Toggle back to CPU**
   - Turn **Use GPU acceleration** off in Settings.
   - The main process reloads once more and logs `Execution providers in use: cpu`. Depth inference should continue to succeed with CPU execution.

Record pass/fail results for each step to ensure GPU preference changes behave safely on Windows hardware.

## Street View rate-limit and network failure behavior

1. With valid API key, quickly pan through 10+ panos and observe any `rate-limit` banners. Ensure app retries and continues using ONNX depth until SV depth returns.
2. Temporarily block network (e.g., disable adapter) while measuring. Verify graceful degradation, notifications, and stability.
3. Restore network; ensure recovery without restart.

## Depth prefetch behavior

1. Generate ONNX depth for current pano. Wait 1–2s; navigate to an adjacent pano.
2. Confirm faster availability indicated by status banner and cache logs.

## Golden-scene spot checks (manual)

Use a curated set of poles/edges with known heights at 5–30 m. For each:
- Generate depth, calibrate horizon, measure height twice.
- Accept if relative error ≤2%; flag otherwise and capture logs.

Golden fixture format (for automated tests in `src/tests/fixtures/golden/*.json`):

```
{
  "name": "fixture-identifier",
  "cameraParams": { "vFov": 60, "heading": 0, "pitch": 0 },
  "viewport": { "width": 1280, "height": 720 },
  "basePoint": { "x": 640, "y": 540 },
  "topPoint": { "x": 640, "y": 420 },
  "baseDistanceMeters": 15.0,
  "expectedHeightMeters": 6.5,
  "tolerancePercent": 2.0
}
```

## Compliance & Keys

1. Do not persist raw Street View imagery or depth payloads beyond transient processing/cache where permitted.
2. Store only derived measurements and anonymized logs (no PII).
3. Restrict API keys to required APIs (Maps JS, Places, Street View Static, Street View Depth); scope to Windows app.
4. Document key handling and rotation. Keys are read via env (`VITE_GOOGLE_MAPS_API_KEY`, `GOOGLE_MAPS_API_KEY`).