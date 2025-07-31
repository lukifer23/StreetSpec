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

## Setup and Running

### Quick Start (For Collaborators)

#### Option 1: Automated Setup (Recommended)
**Windows Users:**
1. Clone the repository: `git clone https://github.com/lukifer23/PoleCheck-Desktop.git`
2. Navigate to the folder: `cd PoleCheck-Desktop`
3. **Double-click `setup.bat`** - This will automatically:
   - Check prerequisites (Node.js, npm, Git, Git LFS)
   - Install dependencies
   - Download model files
   - Create .env file (prompts for API key)
   - Run quality checks
   - Launch the application

**macOS/Linux Users:**
1. Clone the repository: `git clone https://github.com/lukifer23/PoleCheck-Desktop.git`
2. Navigate to the folder: `cd PoleCheck-Desktop`
3. **Run the setup script:**
   ```bash
   chmod +x setup.sh  # Make executable (first time only)
   ./setup.sh         # Run the setup script
   ```

#### Option 2: Manual Setup
```bash
git clone https://github.com/lukifer23/PoleCheck-Desktop.git
cd PoleCheck-Desktop
git lfs pull  # Downloads the model files
npm install
# Create .env file with your Google Maps API key
npm run dev
```

### Detailed Setup

1.  **Prerequisites:**
    *   Node.js (v18 or later recommended)
    *   npm or yarn

2.  **Clone the repository:**
    ```bash
    git clone https://github.com/lukifer23/PoleCheck-Desktop.git
    cd PoleCheck-Desktop
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

5.  **Model Files (Included with Git LFS):**
    *   The required model files are included in the repository and tracked with Git LFS.
    *   When you clone the repository, run `git lfs pull` to download the model files:
        ```bash
        git clone https://github.com/lukifer23/PoleCheck-Desktop.git
        cd PoleCheck-Desktop
        git lfs pull  # Downloads the model files automatically
        ```
    *   The models will be placed in:
        *   `src/assets/models/depth_anything_v2_metric_vkitti_vits.onnx` (ONNX format for the app)
        *   `models_temp/depth_anything_v2_metric_vkitti_vits.pth` (PyTorch format for reference)
    *   If you need to download the models manually, get them from [Hugging Face](https://huggingface.co/depth-anything/Depth-Anything-V2-Metric-VKITTI-Small).

6.  **Run in Development Mode:**
    ```bash
    npm run dev
    ```
    This will start the Vite development server and the Electron application.

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
```bash
npm run lint        # Run ESLint
npm run typecheck   # Run TypeScript type checking
```

## Troubleshooting

### Common Issues
1. **"ONNX model file not found"**: Ensure the model file is in `src/assets/models/` with the correct filename
2. **"Google Maps API Key is missing"**: Check your `.env` file and API key permissions
3. **"Failed to load Google Maps"**: Verify your API key has the required APIs enabled
4. **Measurement not working**: Ensure you've generated a depth map first

### Performance Tips
- Depth maps are cached automatically to improve performance
- Use GPU acceleration in settings if available on your system
- Clear measurement history if the list becomes too long

## Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Run `npm run lint` and `npm run typecheck`
5. Submit a pull request

## License

[Add your license information here]
