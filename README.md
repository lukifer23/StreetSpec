# PoleCheck Desktop Application

## Overview

PoleCheck Desktop is a cross-platform (Windows, macOS, Linux) application built with Electron, React, and TypeScript. It allows users to:

*   Search for locations using text or coordinates.
*   View Google Street View panoramas.
*   Perform height and 3D distance estimations of objects within Street View by clicking points on the image.
*   Utilize Machine Learning (currently Depth Anything V2) for depth estimation.
*   Visualize the relative depth map.
*   Manage and export measurements (CSV, JSON).

## Technology Stack

*   **Framework:** Electron
*   **Frontend:** React + TypeScript
*   **Build Tool:** Vite with `vite-plugin-electron`
*   **Mapping:** Google Maps JavaScript API (`@googlemaps/js-api-loader`)
*   **ML Inference (Main Process):** ONNX Runtime (`onnxruntime-node`)
*   **Depth Model:** Depth Anything V2 (VKITTI Metric Fine-tune). **Note:** Intended to provide metric depth, but current implementation shows inaccuracies requiring investigation.
*   **Image Processing (Main Process):** Sharp (`sharp`)
*   **Styling:** CSS Modules
*   **HTTP Requests:** `node-fetch`
*   **Persistent Storage:** `electron-store` (**Note:** Using v8 due to CJS/ESM interop issues with v9+)
*   **Native Node Module Handling:** Configured via `external` in `vite.config.ts`.

## Key Features

*   **Location Search:** Find locations via search bar (Places API) or direct coordinate input.
*   **Street View Integration:** Interactive Street View display.
*   **Metric Depth Estimation:** Uses an ONNX model (Depth Anything V2 - VKITTI Metric Fine-tune) running in the main Electron process. **Accuracy Warning:** Current results show significant inaccuracies; investigation needed.
*   **Height & 3D Distance Measurement Tool:** Click points to estimate geometry. Uses depth model output. **Accuracy depends on depth model accuracy and calculation logic.**
*   **Depth Map Visualization:** Toggleable overlay showing the depth map with a color scale.
*   **Measurement List:** View, name, delete measurements.
*   **Data Export:** Export measurements to CSV or JSON via main process file dialogs.
*   **Clear Measurements:** Option to clear all saved measurements.
*   **FOV Override:** Manually set Field of View for calculations.
*   **Cross-Platform:** Built with Electron for compatibility.

## Setup and Running

1.  **Prerequisites:**
    *   Node.js (v18 or later recommended)
    *   npm or yarn
    *   Git LFS (Large File Storage) - See step 6.

2.  **Clone the repository:**
    ```bash
    git clone <repository-url>
    cd polecheck-desktop
    ```

3.  **Initialize Git LFS (if not already done automatically on clone):**
    ```bash
    git lfs install
    git lfs pull # Download the large model file
    ```

4.  **Install dependencies:**
    ```bash
    npm install
    # or
    # yarn install
    ```

5.  **Set up Google Maps API Key:**
    *   Create a `.env` file in the project root.
    *   Add your Google Maps API key (with Maps JavaScript API, Places API, and Street View Static API enabled):
        ```env
        VITE_GOOGLE_MAPS_API_KEY=YOUR_API_KEY_HERE
        ```

6.  **ONNX Model:**
    *   The required ONNX model (`depth_anything.onnx`) is tracked using Git LFS and should be downloaded automatically during `git clone` or `git lfs pull`.
    *   It should reside in `src/assets/models/onnx_model/`.
    *   If you need to replace or update the model:
        *   Place the new `.onnx` file in `src/assets/models/onnx_model/`.
        *   Ensure the filename matches the one specified in `electron/main.ts` (currently `depth_anything.onnx`).
        *   Track the new model with Git LFS if it's large: `git lfs track "src/assets/models/onnx_model/YOUR_NEW_MODEL.onnx"` and commit the `.gitattributes` changes.

7.  **Run in Development Mode:**
    ```bash
    npm run dev
    ```
    This will start the Vite development server and the Electron application.

## Building for Production

```bash
npm run build
```
This command will:
1.  Build the React frontend (`dist/`).
2.  Build the Electron main and preload scripts (`dist-electron/`).
3.  Use `electron-builder` to package the application for your current platform into the `release/` directory. **Note:** Ensure the ONNX model is correctly included in the build (should be handled by default file copying).

## Project Structure

*   `electron/`: Electron main process (`main.ts`) and preload script (`preload.ts`).
*   `src/`: React frontend source code.
    *   `components/`: React components.
    *   `services/`: Logic for geometry, measurements, API interaction, etc.
    *   `types/`: TypeScript type definitions.
    *   `assets/`: Static assets.
        *   `models/onnx_model/`: Location for the ONNX depth model (tracked by Git LFS).
    *   `utils/`: Utility functions (e.g., color maps).
    *   `App.tsx`: Main application component.
    *   `main.tsx`: React entry point.
*   `public/`: Static assets copied to the build output.
*   `dist/`: Output directory for the Vite frontend build.
*   `dist-electron/`: Output directory for the Electron main/preload script builds.
*   `release/`: Output directory for packaged application builds.
*   `vite.config.ts`: Vite configuration.
*   `tsconfig.*.json`: TypeScript configurations.
*   `package.json`: Project dependencies and scripts.
*   `.env`: Environment variables (API Key).
*   `IMPROVEMENT_PLAN.md`: Development plan, progress tracking, and troubleshooting notes.
*   `.gitattributes`: Configures Git LFS.

## Known Issues & Important Notes

*   **Relative Depth:** The current ONNX model (`Depth Anything V2 - VKITTI Metric Fine-tune`) is *intended* to output **metric depth**. However, observed results are inaccurate, suggesting issues with output interpretation, calculation logic, or model limitations. Investigation is required. Scale calibration may still be necessary.
*   **`electron-store` Version:** Using `electron-store@8` due to CJS/ESM compatibility issues with v9+ in the Electron main process environment. Uses `require()` for initialization.
*   **Git LFS:** The ONNX model is large and managed via Git LFS. Ensure LFS is installed and run `git lfs pull` after cloning if the model file is missing.
*   **TypeScript Configuration:** `tsconfig.node.json` uses `module: CommonJS` and `moduleResolution: Node` for Electron's scripts.
