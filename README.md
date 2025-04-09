# PoleCheck Desktop Application

## Overview

PoleCheck Desktop is a cross-platform (Windows, macOS, Linux) application built with Electron, React, and TypeScript. It allows users to:

*   Search for locations using text or coordinates.
*   View Google Street View panoramas.
*   Perform height estimations of objects within Street View by clicking points on the image.
*   Utilize Machine Learning (Depth Anything V2 Metric Depth model) for improved distance estimation accuracy.
*   Manage and export measurements.

## Technology Stack

*   **Framework:** Electron
*   **Frontend:** React + TypeScript
*   **Build Tool:** Vite with `vite-plugin-electron`
*   **Mapping:** Google Maps JavaScript API (`@googlemaps/js-api-loader`)
*   **ML Inference (Main Process):** ONNX Runtime (`onnxruntime-node`) with Depth Anything V2 Metric Depth model.
*   **Image Processing (Main Process):** Sharp (`sharp`)
*   **Styling:** CSS Modules
*   **HTTP Requests:** `node-fetch`
*   **Native Node Module Handling:** Configured via `external` in `vite.config.ts`.

## Key Features

*   **Location Search:** Find locations via search bar (Places API) or direct coordinate input.
*   **Street View Integration:** Interactive Street View display.
*   **Metric Depth Estimation:** Uses an ONNX model running in the main Electron process to estimate depth in meters.
*   **Height Measurement Tool:** Click base and top points on an object to estimate its height using camera parameters and ML depth data.
*   **Measurement List:** View, name, delete, and export measurements.
*   **CSV Export:** Export measurements to a CSV file via main process file dialog.
*   **Cross-Platform:** Built with Electron for compatibility.

## Setup and Running

1.  **Prerequisites:**
    *   Node.js (v18 or later recommended)
    *   npm or yarn

2.  **Clone the repository:**
    ```bash
    git clone <repository-url>
    cd polecheck-desktop
    ```

3.  **Install dependencies:**
    ```bash
    npm install
    # or
    # yarn install
    ```

4.  **Set up Google Maps API Key:**
    *   Create a `.env` file in the project root.
    *   Add your Google Maps API key (with Maps JavaScript API, Places API, and Street View Static API enabled):
        ```env
        VITE_GOOGLE_MAPS_API_KEY=YOUR_API_KEY_HERE
        ```

5.  **Download and Place ONNX Model:**
    *   Download the **Depth Anything V2 Metric Depth VKITTI (Outdoor) Small** model.
        *   Get the `.pth` file from [Hugging Face](https://huggingface.co/depth-anything/Depth-Anything-V2-Metric-VKITTI-Small/resolve/main/depth%5Fanything%5Fv2%5Fmetric%5Fvkitti%5Fvits.pth?download=true).
    *   **Convert** the downloaded `.pth` file to the ONNX format.
        *   You may need to use Python and scripts provided by Depth Anything or ONNX conversion tools.
    *   Place the converted `.onnx` file in the `src/assets/models/` directory.
    *   Ensure the filename exactly matches the one specified in `electron/main.ts` (currently `depth_anything_v2_metric_vkitti_vits.onnx`).

6.  **Run in Development Mode:**
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
3.  Use `electron-builder` to package the application for your current platform into the `release/` directory.

## Project Structure

*   `electron/`: Electron main process (`main.ts`) and preload script (`preload.ts`).
*   `src/`: React frontend source code.
    *   `components/`: React components.
    *   `services/`: Logic for geometry, measurements, etc.
    *   `types/`: TypeScript type definitions.
    *   `assets/`: Static assets (including the `models/` subdirectory).
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
*   `IMPROVEMENT_PLAN.md`: Development plan and progress tracking.
