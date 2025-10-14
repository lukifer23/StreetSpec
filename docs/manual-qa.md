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
