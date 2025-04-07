# PoleCheck Desktop Application: Development Plan

**Project:** PoleCheck Desktop Application (Street View Measurement)

**Goal:** Create a cross-platform (Windows, macOS, Linux) desktop application using Electron that allows users to search for locations, view Google Street View, and perform measurements of real-world objects by clicking points on the Street View image. Accuracy is key, leveraging available camera parameters and geometric calculations.

**Technology Stack:**
*   **Runtime:** Electron
*   **Frontend:** React + TypeScript
*   **Build Tool:** Vite
*   **Mapping:** Google Maps JavaScript API (`@googlemaps/js-api-loader`)
*   **Styling:** CSS Modules
*   **UI:** Standard HTML/CSS/React components
*   **UUID Generation:** `uuid` library

**Key Technical Aspects:**
*   API Key loaded via `.env` file and Vite environment variables.
*   State management primarily via React Hooks (`useState`, `useCallback`, `useEffect`).
*   Measurement calculations performed client-side in JavaScript/TypeScript.
*   Utilizes basic perspective projection math (screen-to-world) and geometry (ground plane intersection, 3D distance).

---

## Plan Overview

1.  **Setup & Maps Integration (Complete):** Initialize project, set up Electron/Vite build, integrate Google Maps API, display Street View, implement location search.
2.  **Core Measurement Logic (Current Focus):** Implement UI for placing points, calculate 3D direction vectors from screen coordinates, estimate world points (ground plane intersection with fallback), calculate 3D distance.
3.  **Accuracy Refinement & UI Polish:** Debug and improve measurement accuracy, refine UI components (measurement list, controls), add persistence, potentially add CSV export.
4.  **Build & Packaging:** Configure `electron-builder` for distributable packages.

---

## Current State (End of Session: 2024-06-29)

*   **Project Setup:** Complete (Electron, Vite, React, TS).
*   **Maps Integration:**
    *   Google Maps API loaded successfully.
    *   Street View panorama displays and updates based on search.
    *   Location search (text and coordinates) implemented via `SearchBox` component.
    *   `MapView` component captures and reports camera parameters (heading, pitch, zoom, FOV).
*   **Measurement UI:**
    *   `MeasurementTool` component provides an overlay canvas.
    *   Users can click "Start Measuring" and place two points on the overlay.
    *   Completed measurements (points, line, distance text) are drawn persistently on the canvas.
    *   Measurements are added to a list in the `App` component sidebar.
*   **Measurement Logic:**
    *   `calculateFov` function implemented based on zoom.
    *   `screenToWorld` function implemented to convert screen points + camera params -> 3D direction vector.
    *   `estimateGroundPlaneIntersection` function implemented (assumes 2.5m camera height).
    *   `calculateDistance3D` function implemented.
    *   `createMeasurement` service uses the full pipeline: screen points -> direction vectors -> estimate world points (ground plane with fixed distance fallback) -> 3D distance.
    *   Fallback mechanism prevents errors when clicking above horizon.

## Current Focus / Next Steps

*   **Diagnose Measurement Inaccuracy:**
    *   **Log and Analyze:** Add `console.log` to output the final `worldPoint1` and `worldPoint2` values used in `calculateDistance3D` (within `measurement.ts`).
    *   **Test Known Dimensions:** Measure objects with known dimensions (e.g., standard sidewalk width, door height) to establish a baseline.
    *   **Review Geometry Math:** Re-examine the `screenToWorld` and `estimateGroundPlaneIntersection` functions for potential coordinate system mismatches, sign errors, or incorrect assumptions.
    *   **Investigate Fallback Impact:** Determine how often the fixed-distance fallback is being used and its effect on results.
    *   **Camera Height:** Consider if the assumed 2.5m camera height is a significant source of error and if it can be refined or made configurable.

## Future Implementation / Backlog

*   **Measurement Accuracy Enhancements:**
    *   Explore using Google's Depth API if available/feasible within this context.
    *   Allow user configuration of camera height.
    *   Consider alternative projection methods (e.g., projecting onto a sphere).
*   **Persistence:** Save/load measurements using `electron-store` or similar.
*   **Measurement List Refinement:** Create a dedicated `MeasurementList` component, add delete functionality.
*   **Controls:** Add buttons for clearing measurements, potentially changing units.
*   **CSV Export:** Implement functionality to export measurements.
*   **UI/UX Polish:** Improve styling, layout, loading states, error messages.
*   **Build/Packaging:** Configure `electron-builder` for distribution.

--- 