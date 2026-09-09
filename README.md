# StreetSpec Desktop

StreetSpec measures distances, heights, paths, ground footprints and extruded volumes in Google Street View imagery. It combines camera geometry, available panorama depth and an optional local Depth Anything V2 metric model in an Electron/React desktop application.

## From private project to public release

This project was previously private and was sold. The NDA restrictions associated with that sale have expired, allowing the code to become public. Certain custom-tuned checkpoints, proprietary datasets, customer data and private deployment details remain confidential and are excluded. The public baseline does not reproduce all aspects of the former commercial system. See [public release and provenance](docs/PUBLIC_RELEASE.md).

The repository had been inactive. The September 2026 repair pass addresses launch failures, dependencies, model conversion, measurement math, persistence and interface usability. See [the review and validation limits](docs/REVIEW.md); this is not a claim of survey-grade accuracy or a certified commercial release.

## Setup

Use Node **22.16+ in the 22.x series**, npm and Git LFS. On macOS with Homebrew, install `node@22` and `git-lfs`, then put `/opt/homebrew/opt/node@22/bin` on PATH (Apple Silicon). An `.nvmrc` is included for nvm users.

```bash
git clone https://github.com/lukifer23/StreetSpec.git
cd StreetSpec
git lfs install --local
git lfs pull
npm ci
cp .env.example .env
npm run dev
```

`./setup.sh` or `setup.bat` installs locked dependencies, creates a blank `.env` if absent, runs validation and builds the application. Setup does not launch automatically. `npm run dev` launches Vite and Electron together. To launch compiled code, run `npm run build:vite` then `npm run dev:electron`.

An API key is optional for opening the workspace, viewing saved measurements and managing projects. Configure your own key in **Settings** for online imagery/search. Enable Maps JavaScript, Places and Street View Static APIs; Solar API is used for building insights. Restrict your key appropriately in Google Cloud. Keys saved in Settings are local configuration, not encrypted secret storage. Never commit keys or private project data. Build-time `VITE_` values are embedded in renderer assets; build public packages with a blank `.env`.

There is no separately provisioned official “Street View Depth API” in this app: panorama depth uses an undocumented endpoint which may fail or change. Do not rely on its availability. See [installation/troubleshooting](INSTALLATION.md).

## Models and measurements

The bundled public baseline is **Depth Anything V2 Metric VKITTI Small**. Its tracked PyTorch weights match the [upstream SHA-256](https://huggingface.co/depth-anything/Depth-Anything-V2-Metric-VKITTI-Small/blob/main/depth_anything_v2_metric_vkitti_vits.pth). They are not confidential custom tuning. The ONNX file has been rebuilt from those weights with the correct metric head, normalization and fixed 518×518 input. [Model provenance](src/assets/models/depth_anything_v2_metric_vkitti_vits.json) records hashes and conversion checks; [development instructions](docs/DEVELOPMENT.md) explain reproduction.

Canonical measurements are stored in meters, square meters and cubic meters. Display/export converts units using the international foot (exactly 0.3048 m). Learned axial depth is converted to ray distance before constructing 3D points. Horizon calibration and camera height affect ground/height estimates. Area is a ground projection; volume extrudes that footprint by a user-specified height, not a reconstruction of arbitrary 3D objects. Confidence values are heuristics, not calibrated error bounds.

Accuracy was verified privately for the original system. Results from this public repository may vary because custom-tuned checkpoints and private data are excluded, and results depend on imagery, camera assumptions and model domain. The private validation data and detailed results are not published here. The included conversion checks and synthetic mathematical tests verify public implementation consistency; they do not establish that it matches the privately verified configuration.

## Saving and projects

Measurements and settings live in Electron's per-user application data. Auto-save waits for startup hydration; **Projects → Save Measurements** offers an explicit save. Projects store measurement snapshots and up to 100 named-project revisions. Opening a project or restarting the app preserves archived measurements even when the active history setting is lower. Failed project writes are reported; failed creation/deletion/restoration does not pretend to succeed. Undo/redo is session-local. Measurement templates are also session-local.

The active workspace history limit applies when adding new measurements; the oldest active entries are removed with a notification. Save a project/revision or export before exceeding that limit. Switching projects replaces the active workspace; save pending changes first. The active project selection is not restored across restarts, but workspace measurements are. CSV exports include canonical values and display units. `.ssp` file import/open is not implemented.

## Validation and packaging

```bash
npm run validate       # Renderer + Electron types, zero-warning lint, Jest suites
npm run test:e2e       # Actual Electron UI, IPC, restart persistence and ONNX execution
npm audit              # Locked dependency advisory scan
npm run build          # Native package for the current platform, under release/
```

Native macOS launch, UI and ONNX execution are exercised locally. Local DMG/ZIP packaging is supported, but signing/notarization requires release credentials and remains a separate gate. Do not bypass macOS malware protections to repair a dependency: install the supported locked dependencies and investigate the identified binary. Windows/Linux build configurations are retained; native behavior on those platforms needs its own validation.

## Project structure

- `electron/`: application lifecycle, model inference, validated IPC, local storage and exports.
- `src/components/`, `src/hooks/`, `src/stores/`: UI, asynchronous dataflow and workspace state.
- `src/services/`, `src/utils/`: depth generation/cache, geometry, measurements and conversions.
- `src/tests/` and colocated tests: mathematical, component, persistence and native desktop checks.
- `docs/`: [architecture](docs/ARCHITECTURE.md), [IPC/API](docs/API.md), [development](docs/DEVELOPMENT.md), [manual QA](docs/manual-qa.md), [changelog](docs/CHANGELOG.md).

The upstream repository uses a single maintained branch, `main`. Automated dependency alerts remain enabled; automatic security-update branches are disabled to preserve that policy. See [contributing](CONTRIBUTING.md).

## Licensing

Earlier documentation described the application as MIT, but this checkout contains no standalone application LICENSE grant. Public access and expired NDAs should not be treated as a substitute for that grant. Third-party dependencies and public model weights retain their own licenses; the upstream metric model card declares Apache-2.0. Confidential assets are not licensed by this public code release.
