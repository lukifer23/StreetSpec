# PoleCheck Desktop - Improvement Plan (Phase 2+)

This plan outlines features and optimizations beyond the initial core functionality.

## Phase 1: Foundational Improvements & Core Performance

*Goal: Stabilize core components, implement persistence, and gain initial performance wins.*

*   [x] **Refactor Model Path Handling:**
    *   [x] Modify `electron/main.ts` to use `app.isPackaged` and `process.resourcesPath` to locate the ONNX model reliably in both development and packaged builds.
    *   [ ] Update `electron-builder` configuration (`package.json` or `electron-builder.yml`) to explicitly include the `src/assets/models/` directory (or just the model file) in the packaged application (e.g., using `extraResources` or `files`). *(Manual step needed)*
    *   [ ] Update `README.md` setup instructions if the model location for manual placement changes. *(Check needed)*
*   [x] **Remove `getRawDepthData` Function:**
    *   [x] Delete the `getRawDepthData` function and any related calls from `electron/main.ts` as it relies on unstable internal APIs.
*   [x] **Implement Persistent Measurement Storage:**
    *   [x] Add `electron-store` as a dependency (`npm install electron-store`).
    *   [x] In `electron/main.ts`, initialize `electron-store`.
    *   [x] Create new IPC handlers (`save-measurements`, `load-measurements`).
    *   [x] Modify `src/App.tsx`:
        *   [x] Call `load-measurements` on component mount (`useEffect`).
        *   [x] Call `save-measurements` whenever the `measurements` state changes (potentially debounced).
        *   [x] Update `handleMeasurementComplete`, `handleClearMeasurements`, `handleDeleteMeasurement`, `handleRenameMeasurement` to trigger the save.
    *   [x] Update `electron/preload.ts` to expose the new IPC channels.
*   [ ] **ONNX Model Quantization (Performance): (Paused)**
    *   [ ] **(External Step)** Use ONNX Runtime tools (Python scripts, likely) to convert the `depth_anything_v2_metric_vkitti_vits.onnx` (FP32) model to an INT8 quantized version (`..._quant.onnx`).
    *   [ ] Add the `_quant.onnx` model to the project (e.g., `src/assets/models/`).
    *   [ ] Modify `electron/main.ts` to load the `_quant.onnx` model instead of the original FP32 version.
    *   [ ] Update `electron-builder` config to include the new quantized model file.
    *   [ ] Benchmark inference time difference (optional but recommended).

## Phase 2: Enhanced Visualization & Basic Measurement

*Goal: Provide better visual feedback and extend core measurement capabilities.*

*   [x] **Depth Map Visualization:**
    *   [x] In `src/components/MapView.tsx` (or a new component):
        *   [x] Add a state variable for visibility toggle.
        *   [x] When `onnxDepthMap` is available and visualization is enabled, render the depth map onto a canvas element overlaid on the Street View container.
        *   [x] Normalize the depth values (min/max scaling from `onnxDepthMap.data`).
        *   [x] Apply a color map (e.g., grayscale, viridis) to the normalized depth values to create the visualization.
    *   [x] Add a UI toggle button (e.g., in `App.tsx` or `MeasurementTool.tsx`) to control the visualization state.
*   [x] **3D Distance Measurement:**
    *   [x] Create/Update geometry calculation service (`src/services/geometry.ts`?):
        *   [x] Add a function `calculate3DDistance(point1: Point, point2: Point, depthMap: OnnxDepthMap, cameraParams: CameraParams): number`. *(Actually, added `unprojectPointWithOnnxDepth` and used existing `calculateDistance3D`)*
        *   [x] This function will need to:
            *   [x] Unproject the 2D screen coordinates (`point1`, `point2`) to 3D view space using camera intrinsics (derived from FOV) and the depth value at those points from `depthMap`.
            *   [x] Calculate the Euclidean distance between the two 3D points.
    *   [x] Modify `src/components/MeasurementTool.tsx`:
        *   [x] Add a new measurement mode/type for "3D Distance".
        *   [x] When this mode is active, allow clicking two points.
        *   [x] Call the new `calculate3DDistance` function *(via unprojection)*.
        *   [x] Update the `Measurement` type to potentially store start/end 3D coordinates or just the calculated 3D distance.
    *   [x] Update `src/App.tsx` to handle and display this new measurement type.

## Phase 3: Accuracy & Robustness

*Goal: Improve measurement reliability and user control.*

*   [x] **Confidence Indication (Proxy):**
    *   [x] In the geometry service or `MeasurementTool.tsx`:
        *   [x] When a measurement point is selected, analyze a small neighborhood (e.g., 3x3 or 5x5 pixels) around the point in the `onnxDepthMap.data`.
        *   [x] Calculate the variance or standard deviation of depth values in this neighborhood.
        *   [x] Define thresholds to classify confidence (e.g., Low, Medium, High) based on variance.
    *   [x] In `src/components/MeasurementTool.tsx` or the measurement list:
        *   [x] Display a visual indicator (e.g., colored dot, icon) next to measurement points or the final measurement based on the calculated confidence.
*   [x] **Manual FOV Override:**
    *   [x] Add a settings panel/modal component to the UI.
    *   [x] Include an input field for FOV in the settings panel.
    *   [x] Store the user-defined FOV (if any) in `App.tsx` state or persistent storage (`electron-store`). *(Stored in App state)*
    *   [x] When calculating measurements (`geometry.ts`), prioritize the user-defined FOV over `cameraParams.fov` if it exists.
    *   [x] Ensure the Static Image API call (`App.tsx handleGenerateDepthMap`) still uses the API-provided FOV (`cameraParams.fov`) for fetching, as this affects the underlying image projection, but use the override for *interpreting* the depth map.

## Phase 4: Advanced Measurement & Export

*Goal: Add more complex measurement types and standard export formats.*

*   [ ] **Measurement Point Snapping (Simple Edge Detection):**
    *   [ ] Integrate a lightweight image processing step (can be done in the renderer if simple enough, or main process if more complex).
    *   [ ] When generating the depth map or fetching the static image, also perform edge detection (e.g., Sobel filter) on the grayscale version of the image. Store the edge map.
    *   [ ] In `MeasurementTool.tsx`, when the user hovers/clicks:
        *   Check nearby pixels on the edge map.
        *   If a strong edge is detected near the cursor, snap the click coordinates to the edge pixel.
    *   [ ] Provide visual feedback for snapping.
*   [ ] **Area/Polygon Measurement:**
    *   [ ] Add a new measurement mode for "Area".
    *   [ ] Allow the user to click 3+ points to define a polygon.
    *   [ ] In `geometry.ts`, create `calculatePolygonArea(points: Point[], depthMap: OnnxDepthMap, cameraParams: CameraParams): number`.
    *   [ ] Unproject each polygon vertex to 3D space (similar to 3D distance).
    *   [ ] Calculate the area of the 3D polygon (e.g., using vector cross products - Shoelace formula adapted for 3D).
    *   [ ] Update `Measurement` type and UI to handle polygon measurements.
*   [ ] **GeoJSON/KML Export:**
    *   [ ] Add new export buttons/options in `App.tsx`.
    *   [ ] Create new functions (`exportToGeoJSON`, `exportToKML`) triggered by these buttons.
    *   [ ] These functions will need to:
        *   Iterate through `measurements`.
        *   For each measurement, determine the world coordinates (Latitude, Longitude, Altitude) of the start/end points. This requires:
            *   The panorama's origin coordinates (`cameraParams.lat`, `cameraParams.lng`).
            *   The 3D points relative to the camera (from unprojection).
            *   Transforming these relative 3D points into world coordinates based on camera heading/pitch and panorama location (requires spherical geometry calculations or using a library if available).
        *   Format the data according to GeoJSON (Point, LineString features) or KML specifications.
        *   Use the existing `export-to-csv` IPC mechanism (perhaps generalized to `export-file`) to save the generated GeoJSON/KML content.

## Phase 5: Performance & Workflow Refinements

*Goal: Optimize remaining areas and improve user organization.*

*   [ ] **Preprocessing Optimization (Benchmarking):**
    *   [ ] In `electron/main.ts`'s `infer-depth` handler:
        *   Use `console.time` / `console.timeEnd` to benchmark the `sharp(...)` chain.
        *   Experiment with different `resize` options (interpolators like `nearest`).
        *   Confirm if `.removeAlpha()` is strictly necessary (inspect `metadata.channels`).
        *   Apply changes that yield speedups without significant quality degradation.
*   [ ] **Caching Static Images:**
    *   [ ] Add a simple caching mechanism (e.g., an in-memory `Map` keyed by `panoId` or `lat,lng,heading,pitch,fov`) in `App.tsx`.
    *   [ ] Before calling `fetch` in `handleGenerateDepthMap`, check the cache.
    *   [ ] If cached, use the stored `base64data` directly.
    *   [ ] If not cached, fetch, store in cache, then proceed.
    *   [ ] Consider cache size limits or eviction strategy if memory becomes a concern.
*   [ ] **Measurement Grouping (Projects):**
    *   [ ] Update the data structure (e.g., add a `projectId` to `Measurement`, maintain a list of `Projects` in `electron-store`).
    *   [ ] Add UI elements (sidebar panel, dropdowns) in `App.tsx` to:
        *   Create/rename/delete projects.
        *   Assign measurements to projects.
        *   Filter the displayed measurement list by the selected project.
    *   [ ] Update saving/loading logic to handle projects.

--- 