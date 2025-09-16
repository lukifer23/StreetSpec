# PoleCheck Desktop Application

## Overview

PoleCheck Desktop is a cross-platform (Windows, macOS, Linux) application built with Electron, React, and TypeScript. It allows users to:

*   Search for locations using text or coordinates.
*   View Google Street View panoramas.
*   Perform height estimations of objects within Street View by clicking points on the image.
*   Utilize Machine Learning (Depth Anything V2 Metric Depth model) for improved distance estimation accuracy.
*   Manage and export measurements with depth-map caching for improved performance.

## Technology Stack

*   **Framework:** Electron
*   **Frontend:** React + TypeScript
*   **Build Tool:** Vite with `vite-plugin-electron`
*   **Mapping:** Google Maps JavaScript API (`@googlemaps/js-api-loader`)
*   **ML Inference (Main Process):** ONNX Runtime (`onnxruntime-node`) with Depth Anything V2 Metric Depth model.
*   **Image Processing (Main Process):** Sharp (`sharp`)
*   **Styling:** CSS Modules with theme support (light/dark/system)
*   **HTTP Requests:** `node-fetch`
*   **Caching:** IndexedDB for depth map caching
*   **Native Node Module Handling:** Configured via `external` in `vite.config.ts`.

## Key Features

*   **Location Search:** Find locations via search bar (Places API) or direct coordinate input.
*   **Street View Integration:** Interactive Street View display with camera parameter tracking.
*   **Metric Depth Estimation:** Uses an ONNX model running in the main Electron process to estimate depth in meters.
*   **Height Measurement Tool:** Click base and top points on an object to estimate its height using camera parameters and ML depth data.
*   **Horizon Calibration:** Calibrate the horizon offset for accurate measurements by clicking on the flat horizontal line where sky meets ground.
*   **Measurement List:** View, name, delete, and export measurements with persistent storage.
*   **CSV Export:** Export measurements to a CSV file via main process file dialog.
*   **Cross-Platform:** Built with Electron for compatibility across Windows, macOS, and Linux.
*   **Settings Panel:** In-app modal for default unit, theme (light/dark/system), GPU toggle, and history limit.
*   **Depth-Map Caching:** IndexedDB cache dramatically reduces repeat latency and Google quota usage.
*   **Keyboard Shortcuts:** M for measurement, U for unit toggle, Ctrl+E for export, Ctrl+Shift+Delete for clear all.
*   **Theme Support:** Light, dark, and system theme modes with CSS variables.

## Setup and Installation

### Quick Start (Automated Scripts)

#### Windows
1. Clone the repository:
   ```bash
   git clone https://github.com/lukifer23/PoleCheck-Desktop.git
   cd PoleCheck-Desktop
   ```
2. Double-click `setup.bat`.
   - Verifies Node.js, npm, Git, and Git LFS are installed.
   - Installs npm dependencies.
   - Downloads model files via Git LFS.
   - Prompts for your Google Maps API key and creates a `.env` file.
   - Runs ESLint and TypeScript checks.
   - Launches the development environment.

#### macOS/Linux
1. Clone the repository:
   ```bash
   git clone https://github.com/lukifer23/PoleCheck-Desktop.git
   cd PoleCheck-Desktop
   ```
2. Make the setup script executable (first run only) and execute it:
   ```bash
   chmod +x setup.sh
   ./setup.sh
   ```
   The script performs the same dependency, model download, environment, and quality-check steps as the Windows script before starting the app.

### Manual Setup

1. **Install prerequisites**
   - [Node.js](https://nodejs.org/) v18 or later (npm included).
   - [Git](https://git-scm.com/) and [Git LFS](https://git-lfs.com/).

2. **Clone the repository and install dependencies**
   ```bash
   git clone https://github.com/lukifer23/PoleCheck-Desktop.git
   cd PoleCheck-Desktop
   git lfs install       # Initializes Git LFS locally (once per machine)
   git lfs pull          # Downloads the depth model assets
   npm install
   ```

3. **Configure environment variables**
   Create a `.env` file in the project root and add a Google Maps API key that has the Maps JavaScript API, Places API, and Street View Static API enabled:
   ```env
   VITE_GOOGLE_MAPS_API_KEY=YOUR_API_KEY_HERE
   ```

4. **Run the application in development mode**
   ```bash
   npm run dev
   ```
   This starts the Vite development server and Electron shell.

5. **Model file reference**
   - `src/assets/models/depth_anything_v2_metric_vkitti_vits.onnx`
   - `models_temp/depth_anything_v2_metric_vkitti_vits.pth`
   If the automated download fails, you can fetch the models manually from [Hugging Face](https://huggingface.co/depth-anything/Depth-Anything-V2-Metric-VKITTI-Small) and place them in the paths above.

## Building for Production

### Windows Build
```bash
npm run build:win
```
This creates a Windows installer in the `release/` directory.

### All Platforms
```bash
npm run build
```
This command will:
1.  Build the React frontend (`dist/`).
2.  Build the Electron main and preload scripts (`dist-electron/`).
3.  Use `electron-builder` to package the application for your current platform into the `release/` directory.

## Usage Guide

### Basic Workflow
1. **Search for a location** using the search bar or enter coordinates directly
2. **Generate a depth map** for the current Street View location (required for measurements)
3. **Calibrate the horizon** by clicking on the flat horizontal line where sky meets ground
4. **Click "Estimate Height"** or press 'M' to start a measurement
5. **Click the base** of the object you want to measure
6. **Click the top** of the object to complete the measurement
7. **View results** in the sidebar and export as needed

### Keyboard Shortcuts
- **M**: Start height measurement
- **U**: Toggle between metric and imperial units
- **Ctrl+E**: Export measurements to CSV
- **Ctrl+Shift+Delete**: Clear all measurements
- **Escape**: Cancel current measurement or calibration

### Settings
Access settings via the gear icon (⚙️) in the header:
- **Theme**: Light, dark, or system preference
- **Default Unit**: Metric (meters) or Imperial (feet)
- **GPU Acceleration**: Toggle for ONNX inference
- **Measurement History Limit**: Maximum number of measurements to keep
- **Depth Scale / Bias**: Adjust calibration applied to depth maps

## Depth Calibration & Pixel-to-World Conversion

PoleCheck combines Street View camera metadata with the Depth Anything model to map on-screen pixels to real-world distances. Accurate calibration ensures the geometry used for height estimation reflects what the camera actually captured.

### Field of View & Camera Pose
- The Google Street View API supplies field-of-view, pitch, and heading information for each panorama. PoleCheck uses this metadata to reconstruct the virtual camera so that measurements align with the original perspective.
- Avoid forcing extreme zoom levels inside Street View—staying near the default perspective preserves the FOV assumptions baked into the calibration pipeline.
- When revisiting a saved measurement, confirm the panorama hasn't changed (e.g., a different capture date) because variations in camera pose can introduce error.

### Lens Distortion Considerations
- Street View imagery is delivered as an equirectangular panorama. The app renders a rectilinear view and accounts for the spherical distortion before projecting points into 3D space.
- Distortion rises toward the image edges. For highest accuracy, place measurement points near the center of the viewport and avoid leaning poles or objects that span heavily warped regions.

### Depth Scale & Bias
- Depth models can output values that are consistently scaled or offset. Default scale/bias parameters are derived from calibration scenes but can be customized in **Settings → Depth Scale / Bias**.
- To refine the values:
  1. Visit locations with known dimensions (buildings, survey markers, etc.).
  2. Record both the predicted depth and the ground-truth distance.
  3. Fit a line using `actual = scale * predicted + bias`.
  4. Enter the resulting scale and bias values in the settings panel.
- The adjusted parameters are applied to all future depth maps and cached results.

### Horizon Calibration
- Horizon calibration corrects small pitch offsets that accumulate from panorama stitching or tripod tilt.
- Click **Calibrate Horizon** and select a point where the sky meets the ground (or any long, flat reference line). The app shifts the virtual camera to make that line level, improving vertical height calculations.
- Re-run the calibration whenever you switch locations, move to a new panorama date, or notice that vertical lines do not appear plumb on screen.

## Project Structure

*   `electron/`: Electron main process (`main.ts`) and preload script (`preload.ts`).
*   `src/`: React frontend source code.
    *   `components/`: React components (MapView, MeasurementTool, SearchBox, SettingsPanel).
    *   `services/`: Logic for geometry, measurements, depth caching, etc.
    *   `types/`: TypeScript type definitions.
    *   `assets/`: Static assets (including the `models/` subdirectory).
    *   `App.tsx`: Main application component.
    *   `main.tsx`: React entry point.
*   `public/`: Static assets copied to the build output.
*   `dist/`: Output directory for the Vite frontend build.
*   `dist-electron/`: Output directory for the Electron main/preload script builds.
*   `release/`: Output directory for packaged application builds.
*   `setup.bat`: Windows automated setup script.
*   `setup.sh`: Cross-platform automated setup script.
*   `build-windows.bat`: Windows build automation script.

## Development

### Code Quality
- **ESLint**: Zero errors enforced with `npm run lint`
- **TypeScript**: Type checking with `npm run typecheck`
- **Prettier**: Code formatting (configured in ESLint)

### Testing
[![CI/CD Pipeline](https://github.com/lukifer23/PoleCheck-Desktop/actions/workflows/ci.yml/badge.svg)](https://github.com/lukifer23/PoleCheck-Desktop/actions/workflows/ci.yml)

Use the following commands to exercise the primary test suites locally:

```bash
npm run test:unit        # Unit tests
npm run test:integration # Integration tests
npm run test:e2e         # Playwright e2e tests
```

Run `npm run validate` to execute strict type-checking, linting, and the aggregated test suites in one step.

## Troubleshooting

### Environment & Setup
- **"Node.js not found"**: Install Node.js from [nodejs.org](https://nodejs.org/) and confirm it is on your PATH.
- **"Git not found"**: Install Git from [git-scm.com](https://git-scm.com/) and enable the “Add to PATH” option during installation (Windows).
- **"Git LFS not found"**: Install Git LFS from [git-lfs.com](https://git-lfs.com/) or run `git lfs install` after installing the extension.
- **"Permission denied" when running `setup.sh`**: Make the script executable with `chmod +x setup.sh` (use `sudo` if required by your environment).
- **Model files did not download**: Run `git lfs pull` manually or fetch them from [Hugging Face](https://huggingface.co/depth-anything/Depth-Anything-V2-Metric-VKITTI-Small) and place them in the paths listed above.
- **Google Maps API key missing or invalid**: Ensure your `.env` file includes `VITE_GOOGLE_MAPS_API_KEY` with the Maps JavaScript API, Places API, and Street View Static API enabled.

### Application Issues
1. **"ONNX model file not found"**: Confirm the ONNX file exists in `src/assets/models/` and that Git LFS completed successfully.
2. **"Failed to load Google Maps"**: Check browser dev tools for API quota or billing errors and verify required APIs are enabled.
3. **Measurements appear inaccurate**: Re-run horizon calibration and revisit the **Depth Calibration & Pixel-to-World Conversion** section above to validate scale/bias values.
4. **Measurement not working**: Ensure you've generated a depth map before starting a measurement.

### Performance Tips
- Depth maps are cached automatically to improve performance.
- Use GPU acceleration in settings if available on your system.
- Clear measurement history if the list becomes too long.

## Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Run `npm run lint` and `npm run typecheck`
5. Submit a pull request

## License

[Add your license information here]
