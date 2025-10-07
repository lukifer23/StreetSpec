# PoleCheck Desktop

## Overview

PoleCheck Desktop is a cross-platform application for measuring objects in Google Street View imagery. Built with Electron, React, and TypeScript, it provides:

*   Location search using text or coordinates
*   Google Street View panorama integration
*   Height measurement tools using camera geometry and depth estimation
*   Machine learning depth analysis using Depth Anything V2 model
*   Measurement management and CSV export capabilities

## Technology Stack

*   **Framework:** Electron
*   **Frontend:** React + TypeScript
*   **Build Tool:** Vite with `vite-plugin-electron`
*   **Mapping:** Google Maps JavaScript API
*   **ML Inference:** ONNX Runtime with Depth Anything V2 model
*   **Image Processing:** Sharp for image manipulation
*   **Styling:** CSS Modules with theme support
*   **State Management:** Zustand with Immer
*   **HTTP Requests:** node-fetch
*   **Caching:** IndexedDB for depth map caching

## Key Features

*   **Location Search:** Text search or coordinate input for target locations
*   **Street View Integration:** Interactive panorama display with camera tracking
*   **Depth Estimation:** ONNX-based depth analysis for distance calculations
*   **Height Measurements:** Point-to-point height estimation using camera geometry
*   **Horizon Calibration:** Manual horizon offset correction for accuracy
*   **Measurement Management:** View, rename, delete, and export measurements
*   **CSV Export:** Export measurement data to spreadsheet format
*   **Cross-Platform:** Windows, macOS, and Linux support via Electron
*   **Settings Panel:** Unit preferences, theme selection, and calibration options
*   **Depth Caching:** IndexedDB caching for improved performance
*   **Keyboard Shortcuts:** Quick access to common functions
*   **Theme Support:** Light, dark, and system theme options

## Development Status

PoleCheck is in active development with focus on measurement accuracy and user experience:

*   **Core Features:** Height measurement, depth estimation, and data export are functional
*   **Testing:** Unit and integration test coverage is being expanded
*   **State Management:** Centralized state management with Zustand is implemented
*   **Performance:** Depth map caching and optimization features are in place

See [docs/roadmap.md](./docs/roadmap.md) for detailed development plans and priorities.

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
   Create a `.env` file in the project root and add a Google Maps API key that has the Maps JavaScript API, Places API, Street View Static API, and Street View depth access enabled. Provide the key for both the renderer (`VITE_…`) and Electron main process (`GOOGLE_…`) so depth requests work everywhere:
   ```env
   VITE_GOOGLE_MAPS_API_KEY=YOUR_API_KEY_HERE
   GOOGLE_MAPS_API_KEY=YOUR_API_KEY_HERE
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
   - PoleCheck now requests Street View depth planes directly from Google's depth API. The app retries a limited number of times (configurable under **Settings → Street View Depth Retries**) and surfaces a banner if the request is rate-limited or depth is unavailable, falling back to ONNX depth in the meantime.
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
Access settings via the gear icon in the header:
- **Theme**: Light, dark, or system preference
- **Default Unit**: Metric (meters) or Imperial (feet)
- **GPU Acceleration**: Toggle for ONNX inference
- **Measurement History Limit**: Maximum number of measurements to keep
- **Depth Calibration**: Scale and bias adjustments for depth maps
- **Debug Options**: Overlay and sampling controls for development

## Measurement Accuracy

PoleCheck uses multiple data sources for accurate measurements:

### Camera Parameters
- Street View provides field-of-view, pitch, and heading data for each panorama
- These parameters are used to reconstruct the camera perspective for 3D calculations
- Avoid extreme zoom levels to maintain calibration accuracy

### Depth Estimation
- Primary: Google Street View depth planes (when available)
- Secondary: ONNX depth model with calibration
- Fallback: Ground plane intersection using camera geometry

### Calibration
- **Depth Scale/Bias**: Adjustable parameters to correct depth model output
- **Horizon Calibration**: Manual correction for camera tilt and panorama stitching
- **Auto-calibration**: Automatic refinement based on measurement samples

### Best Practices
- Place measurement points near the center of the viewport for best accuracy
- Use horizon calibration when switching locations or noticing measurement drift
- Verify panorama date consistency when revisiting saved measurements

## Project Structure

*   `electron/`: Electron main process and preload scripts
*   `src/`: React frontend source code
    *   `components/`: UI components (MapView, MeasurementTool, SearchBox, SettingsPanel, etc.)
    *   `stores/`: Zustand state management (rootStore.ts, projectStore.ts, settingsStore.ts)
    *   `services/`: Business logic (geometry, measurement, depth, error handling)
    *   `types/`: TypeScript type definitions
    *   `utils/`: Utility functions
    *   `tests/`: Test files (unit, integration, e2e)
    *   `assets/models/`: ONNX model files
*   `docs/`: Documentation files
*   `dist/`: Vite build output
*   `dist-electron/`: Electron build output
*   `release/`: Packaged application builds

## Development

### Code Quality
- **ESLint**: Zero errors enforced with `npm run lint`
- **TypeScript**: Type checking with `npm run typecheck`
- **Prettier**: Code formatting (configured in ESLint)

### Testing

Run tests using these commands:

```bash
npm run test:unit        # Unit tests
npm run test:integration # Integration tests
npm run test:e2e         # End-to-end tests
npm run test:all         # All test suites
npm run validate         # Type checking, linting, and tests
```

## Troubleshooting

### Environment & Setup
- **"Node.js not found"**: Install Node.js from [nodejs.org](https://nodejs.org/) and confirm it is on your PATH.
- **"Git not found"**: Install Git from [git-scm.com](https://git-scm.com/) and enable the “Add to PATH” option during installation (Windows).
- **"Git LFS not found"**: Install Git LFS from [git-lfs.com](https://git-lfs.com/) or run `git lfs install` after installing the extension.
- **"Permission denied" when running `setup.sh`**: Make the script executable with `chmod +x setup.sh` (use `sudo` if required by your environment).
- **Model files did not download**: Run `git lfs pull` manually or fetch them from [Hugging Face](https://huggingface.co/depth-anything/Depth-Anything-V2-Metric-VKITTI-Small) and place them in the paths listed above.
- **Google Maps API key missing or invalid**: Ensure your `.env` file includes both `VITE_GOOGLE_MAPS_API_KEY` and `GOOGLE_MAPS_API_KEY` with the Maps JavaScript, Places, Street View Static, and Street View Depth APIs enabled.
- **Street View depth rate limits**: If you see a "Street View depth API rate limit" banner, wait for the indicated time or increase the retry interval sparingly. Measurements will continue using ONNX depth until a fresh Street View depth response is available.

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

This project is licensed under the MIT License.
