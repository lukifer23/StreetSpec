# PoleCheck Desktop Application: Development Plan

**Project:** PoleCheck Desktop Application (Street View Measurement)

**Goal:** Create a cross-platform (Windows, macOS, Linux) desktop application using Electron that allows users to search for locations, view Google Street View, and perform measurements of real-world objects by clicking points on the Street View image, using ML-based metric depth estimation for improved accuracy.

**Technology Stack:**
*   **Runtime:** Electron
*   **Frontend:** React + TypeScript
*   **Build Tool:** Vite
*   **Mapping:** Google Maps JavaScript API (`@googlemaps/js-api-loader`)
*   **ML Inference (Main):** ONNX Runtime (`onnxruntime-node`)
*   **Image Processing (Main):** Sharp (`sharp`)
*   **Styling:** CSS Modules
*   **UI:** Standard HTML/CSS/React components
*   **UUID Generation:** `uuid` library
*   **HTTP Requests (Main):** `node-fetch` (for Static Street View API)
*   **Decompression (Main/Renderer):** `pako` (No longer used for primary depth)

**Key Technical Aspects:**
*   API Key loaded via `.env` file and Vite environment variables.
*   State management primarily via React Hooks (`useState`, `useCallback`, `useEffect`), with key state lifted to `App.tsx`.
*   IPC (Inter-Process Communication) using `contextBridge` and `ipcRenderer.invoke` for secure communication (e.g., triggering inference, exporting CSV).
*   **Metric Depth Estimation Pipeline:**
    *   Frontend fetches Static Street View image based on camera parameters.
    *   Frontend sends image data (Base64) to Main process via IPC (`infer-depth`).
    *   Main process decodes image, preprocesses (resize, normalize) using `sharp`.
    *   Main process runs inference using a metric depth ONNX model (Depth Anything V2 Metric Outdoor) via `onnxruntime-node`.
    *   Main process sends resulting metric depth map (meters) back to Frontend.
    *   Frontend measurement logic samples depth from the received map to estimate distance.
*   Build configured to handle native Node modules (`onnxruntime-node`, `sharp`) via `external` in `vite.config.ts`.

---

## Plan Overview

1.  **Setup & Maps Integration (Complete):** Initialize project, set up Electron/Vite build, integrate Google Maps API, display Street View, implement location search.
2.  **Core Measurement Logic (Complete):** Implement UI for placing points, calculate 3D direction vectors, estimate world points (basic geometry initially), calculate 3D distance.
3.  **Depth Data Integration & Refinement (Complete):** 
    *   ~~Integrate fetching, parsing, and utilizing Street View depth data.~~ (Replaced with ML approach)
    *   Implement ML-based metric depth estimation using ONNX Runtime in the main process.
    *   Establish IPC for triggering inference and receiving depth maps.
    *   Integrate depth map sampling into measurement logic.
    *   Debug and resolve build issues related to native modules (`onnxruntime-node`, `sharp`).
    *   Resolve issues with model output interpretation (relative vs. metric depth).
4.  **Accuracy Validation & UI Polish (Current Focus):** 
    *   Thoroughly test measurement accuracy using the metric depth model.
    *   Refine UI components (measurement list, controls, status indicators).
    *   Implement persistence for measurements.
    *   Implement CSV export.
5.  **Build & Packaging:** Configure `electron-builder` for distributable packages.

---

## Current State (End of Session: 2025-04-09)

*   **Project Setup:** Complete (Electron, Vite, React, TS).
*   **Maps Integration:** Complete (API load, Street View display, Search, Camera param tracking).
*   **Measurement UI:**
    *   `MeasurementTool` overlay canvas implemented.
    *   User can place start/end points for height estimation.
    *   Measurements displayed on canvas and in sidebar list.
    *   Button exists to trigger depth map generation.
    *   Status indicator shows depth map generation state.
*   **Measurement Logic:**
    *   Core geometric calculations (`calculateFov`, `calculateEstimatedHeight`) implemented.
    *   `estimateDistanceToPoint` now samples the received ONNX depth map.
*   **ML Depth Pipeline:**
    *   State lifted to `App.tsx` (camera params, depth map state, generation logic).
    *   Static Street View image fetch implemented in `App.tsx`.
    *   IPC channel `infer-depth` established and working.
    *   Main process handler decodes image, preprocesses with `sharp`, runs inference with `onnxruntime-node` using a configured metric model (`depth_anything_v2_metric_vkitti_vits.onnx`), and returns the depth map.
    *   Vite build configured to handle native dependencies (`onnxruntime-node`, `sharp`).
    *   Type definitions updated (`IElectronAPI`, `OnnxDepthMap`).
*   **CSV Export:** Basic framework implemented via IPC.

## Current Focus / Next Steps

*   **Verify Metric Depth Accuracy:** 
    *   Confirm the correct metric ONNX model (`depth_anything_v2_metric_vkitti_vits.onnx`) is downloaded, converted, and placed correctly.
    *   Run tests: Generate depth map, perform measurements, check console logs for `[estimateDistanceToPoint] Sampled depth...` and final `Est Height`. Evaluate if the sampled depth and final height are reasonable.
*   **Implement Persistence:** Save/load measurements using `electron-store` or similar.
*   **Refine Measurement List:** Add delete/rename functionality (frontend logic exists, needs backend persistence integration).
*   **UI/UX Polish:** Improve styling, add better loading/error states, potentially visualize the depth map on the overlay.

## Future Implementation / Backlog

*   **Measurement Accuracy Validation:** More rigorous testing against known dimensions/locations.
*   **Alternative Measurement Types:** Implement horizontal distance, area, etc.
*   **Units:** Allow switching between metric/imperial.
*   **Build/Packaging:** Finalize `electron-builder` configuration.

--- 