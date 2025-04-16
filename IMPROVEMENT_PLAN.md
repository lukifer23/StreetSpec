# PoleCheck Desktop - Improvement Plan (Phase 2+)

This plan outlines features and optimizations beyond the initial core functionality.

## Phase 1: Foundational Improvements & Core Performance

*Goal: Stabilize core components, implement persistence, and gain initial performance wins.*

*   [x] **Refactor Model Path Handling:**
    *   [x] Modify `electron/main.ts` to use `app.isPackaged` and `process.resourcesPath` to locate the ONNX model reliably in both development and packaged builds.
    *   [x] Update `electron-builder` configuration (`package.json` or `electron-builder.yml`) to explicitly include the `src/assets/models/` directory. *(Verified in package.json scripts/build configuration implicitly handled)*
    *   [x] Update `README.md` setup instructions.
*   [x] **Remove `getRawDepthData` Function:**
    *   [x] Delete the `getRawDepthData` function and any related calls from `electron/main.ts`.
*   [x] **Implement Persistent Measurement Storage:**
    *   [x] Add `electron-store` as a dependency (`npm install electron-store@8`). **Note:** Downgraded to v8 due to persistent CJS/ESM interop issues with v9/v10+ in the Electron main process.
    *   [x] In `electron/main.ts`, initialize `electron-store` using `require()`.
    *   [x] Create new IPC handlers (`save-measurements`, `load-measurements`).
    *   [x] Modify `src/App.tsx`:
        *   [x] Call `load-measurements` on component mount (`useEffect`).
        *   [x] Call `save-measurements` whenever the `measurements` state changes (potentially debounced).
        *   [x] Update `handleMeasurementComplete`, `handleClearMeasurements`, `handleDeleteMeasurement`, `handleRenameMeasurement` to trigger the save.
    *   [x] Update `electron/preload.ts` to expose the new IPC channels.
*   [ ] **ONNX Model Quantization (Performance): (Paused)**
    *   Notes: Performance seems acceptable currently. May revisit later if needed. Less critical now that accuracy is the main focus.
*   [x] **Setup Git LFS for Large Model Files:**
    *   [x] Initialize Git LFS (`git lfs install`).
    *   [x] Track the `.onnx` model file (`git lfs track "src/assets/models/**/*.onnx"`).
    *   [x] Stage and commit `.gitattributes`.

## Phase 2: Measurement Accuracy & Core Functionality

*Goal: Achieve usable measurement accuracy and refine core tools.*

*   [x] **Integrate Metric Depth Model:**
    *   [x] Researched and converted Depth Anything V2 fine-tuned for VKITTI (Metric Outdoor) from SafeTensors to ONNX (`depth_anything.onnx`).
    *   [x] Replaced the previous relative depth model.
    *   [x] **Note:** Despite using a model intended for metric output, direct depth values exhibit significant inaccuracies, especially around thin objects or complex backgrounds, leading to incorrect measurements.
*   [x] **Refactor Measurement Calculation:**
    *   [x] Replaced trigonometric height estimation (`measurementLogic.ts`) with 3D unprojection (`geometry.ts::unprojectPointWithOnnxDepth`) and Y-coordinate difference calculation in `MeasurementTool.tsx`.
    *   [x] Confirmed core unprojection math appears correct, but results are sensitive to underlying depth map inaccuracies.
*   [x] **Implement Scale Calibration:**
    *   [x] Added UI mode (`MeasurementTool.tsx`, `App.tsx`) for user to measure a known distance.
    *   [x] Calculate scale factor based on known distance vs. distance calculated from depth map (`MeasurementTool.tsx`).
    *   [x] Store multiple calibration factors persistently (`electron-store` via `electron/main.ts`). Store as array `calibrationFactors`.
    *   [x] Load average scale factor on startup (`electron/main.ts`, `App.tsx`).
    *   [x] Append new factors on save, refresh average/count in UI (`MeasurementTool.tsx`, `App.tsx`).
    *   [x] Implement "Clear Calibration" functionality (`App.tsx`, `electron/main.ts`).
    *   [x] Implement sanity check during calibration application (`MeasurementTool.tsx`).
    *   [x] Apply average scale factor to all measurement results (Height, 3D Distance, Area) before display/save.
    *   [x] **Note:** Significantly improves results (~10% error observed in test cases), making measurements more plausible estimates, but still limited by source depth map quality.
*   [x] **3D Distance Measurement:**
    *   [x] Uses `unprojectPointWithOnnxDepth` and `calculateDistance3D`.
    *   [x] Now applies the average scale factor. Accuracy dependent on depth map quality and calibration.
*   [x] **Height Measurement:**
    *   [x] Uses `unprojectPointWithOnnxDepth` for base/top points and calculates Y-difference.
    *   [x] Now applies the average scale factor. Accuracy dependent on depth map quality and calibration.
*   [ ] **Area/Polygon Measurement:**
    *   [ ] Uses `calculateAreaFromScreenPoints` which relies on `unprojectPointWithOnnxDepth`.
    *   [ ] Now applies the average scale factor (squared).
    *   [ ] **Note:** Accuracy highly dependent on depth map quality at *all* vertices and calibration. Further testing needed.

## Phase 3: UI/UX Refinements & Robustness

*Goal: Improve user workflow, feedback, and stability.*

*   [x] **Depth Map Visualization:**
    *   [x] In `src/components/MapView.tsx` (or a new component):
        *   [x] Add a state variable for visibility toggle.
        *   [x] When `onnxDepthMap` is available and visualization is enabled, render the depth map onto a canvas element overlaid on the Street View container.
        *   [x] Normalize the depth values (min/max scaling from `onnxDepthMap.data`).
        *   [x] Apply a color map (e.g., grayscale, viridis) to the normalized depth values to create the visualization.
    *   [x] Add a UI toggle button (e.g., in `App.tsx` or `MeasurementTool.tsx`) to control the visualization state.
*   [x] **Confidence Indication (Proxy):**
    *   [x] Implemented using variance calculation in `calculateConfidence` (`measurementLogic.ts`).
    *   [x] Displayed in `MeasurementTool.tsx`.
*   [x] **Manual FOV Override:**
    *   [x] Added settings panel (`SettingsPanel.tsx`) with FOV input.
    *   [x] Stored in `App.tsx` state.
    *   [x] Used in `measurementLogic.ts`.
*   [x] **Refined UI/UX:**
    *   [x] Modernized CSS styles (`App.module.css`).
    *   [x] Added Export CSV/JSON and Clear All functionality (`App.tsx`).
    *   [ ] Consider visual feedback for calibration status/factor more prominently.
    *   [ ] Improve display/editing of measurement list.
*   [ ] **Refactor Core Components (`App.tsx`, `MeasurementTool.tsx`):**
    *   [ ] Create custom hooks (`useMeasurements`, `useDepthMap`, `useMeasurementCanvas`) to improve state management and separation of concerns in `App.tsx` and `MeasurementTool.tsx`.
*   [ ] **Streamline Build Process:**
    *   [ ] Evaluate if `vite-plugin-electron` or `electron-vite` can fully manage the build, potentially removing `tsc-watch`, `concurrently`, `mv` commands.

## Phase 4: Advanced Features & Future Directions

*Goal: Add more complex capabilities and explore further accuracy improvements.*

*   [ ] **Measurement Point Snapping (Simple Edge Detection):**
    *   [ ] Uses `imageProcessing.ts` for basic version.
*   [ ] **GeoJSON/KML Export:**
    *   [ ] Current export includes basic metadata.
    *   [ ] Needs reliable geo-referenced 3D points for true geospatial export (Blocked by lack of absolute positioning).
*   [ ] **Preprocessing Optimization (Benchmarking):**
*   [ ] **Caching Static Images:**
*   [ ] **Measurement Grouping (Projects):**
*   [ ] **Advanced Accuracy Investigation:**
    *   [ ] **Segmentation:** Research integrating a semantic segmentation model to mask foreground/background during depth sampling. (Complexity High)
    *   [ ] **Alternative Models:** Investigate other pre-trained depth models. (Requires research/conversion)

## Troubleshooting Notes & Known Issues

*   **`electron-store` Compatibility:** Required `electron-store@8` due to CJS/ESM issues in main process. `require()` used for import.
*   **Depth Model Accuracy:** Using `Depth Anything V2 (VKITTI Metric Fine-tune)`. Provides plausible metric *range* but exhibits significant inaccuracies locally (e.g., depth bleeding from background to foreground), limiting measurement precision even *after* calibration. Calibration is essential but cannot fix underlying map flaws entirely.
*   **Git LFS:** Setup complete for managing the large `.onnx` model file. Remember to have Git LFS installed when cloning/pulling.
*   **`eval` Removal:** Removed from `electron/main.ts`.
*   **`tsconfig.node.json`:** Keep `module: "CommonJS"` and `moduleResolution: "Node"` for Electron main/preload scripts.

--- 