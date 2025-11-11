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
*   **Advanced Measurement Tools:**
    - Point-to-point height measurements
    - Polyline measurements for curved paths
    - Area measurements for 2D spaces
    - Volume measurements for 3D spaces
*   **Depth Estimation:** Dual-depth system with Google Street View + ONNX models
*   **Intelligent Calibration:**
    - Manual horizon calibration
    - Automatic horizon detection using depth data
    - Confidence scoring for all measurements
*   **Performance Optimized:**
    - Virtualized measurement lists for large datasets
    - Compressed depth caching with LRU eviction
    - Memory management with automatic cleanup
*   **Measurement Management:** View, rename, delete, and export measurements with confidence indicators
*   **CSV Export:** Export measurement data to spreadsheet format
*   **Cross-Platform:** Windows, macOS, and Linux support via Electron
*   **Settings Panel:** Unit preferences, theme selection, and calibration options
*   **Keyboard Shortcuts:** Quick access to common functions
*   **Theme Support:** Light, dark, and system theme options

## Development Status

PoleCheck Desktop is in active development with significant recent improvements:

*   **[Done] Performance Optimization:** Virtualized lists, compressed caching, and memory management are implemented.
*   **[Done] Accuracy Enhancement:** Auto-calibration, confidence scoring, and measurement validation are in place.
*   **[Done] Advanced Tools:** Polyline, area, and volume measurement tools are fully implemented.
*   **[In Progress] Core Features:** All measurement types function with confidence indicators, with refinements ongoing.
*   **[In Progress] Testing:** Unit test coverage is above 70%, and additional integration tests are underway.
*   **[Done] State Management:** Robust Zustand architecture with persistence is live.
*   **[In Progress] UI and UX:** Interface polish continues with improvements to tooltips, shortcuts, and responsiveness.

See [docs/roadmap.md](./docs/roadmap.md) for detailed development plans and remaining priorities.

## Setup and Installation

### Quick Start (Automated Scripts)

#### Windows
1. Clone the repository:
   ```bash
   git clone https://github.com/lukifer23/Street-Spec-Desktop.git
   cd PoleCheck-Desktop
   ```
2. Double-click `setup.bat`.
   - Verifies Node.js, npm, Git, and Git LFS are installed.
   - Installs npm dependencies.
   - Downloads model files via Git LFS.
   - Prompts for your Google Maps API key and creates a `.env` file.
   - Runs ESLint and TypeScript checks.
   - Launches the development environment.
3. To create an installer build, run `install-windows.bat`.
   - Re-validates prerequisites and installs dependencies.
   - Executes `npm run build:win` to produce an NSIS installer.
   - Launches the newest `PoleCheck-Desktop-Setup-*.exe` from the `release/` directory.

#### macOS/Linux
1. Clone the repository:
   ```bash
   git clone https://github.com/lukifer23/Street-Spec-Desktop.git
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
   git clone https://github.com/lukifer23/Street-Spec-Desktop.git
   cd PoleCheck-Desktop
   git lfs install       # Initializes Git LFS locally (once per machine)
   git lfs pull          # Downloads the depth model assets
   npm install
   ```

3. **Configure environment variables**
   Copy `.env.example` to `.env` in the project root and add a Google Maps API key that has the Maps JavaScript API, Places API, Street View Static API, and Street View depth access enabled. Provide the key for both the renderer `VITE_GOOGLE_MAPS_API_KEY` and Electron main process `GOOGLE_MAPS_API_KEY` so depth requests work everywhere:
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
This creates a Windows installer in the `release/` directory. The installer includes:
- ✅ All application files and dependencies
- ✅ ONNX depth estimation model (~94 MB)
- ✅ Runtime dependencies (bundled with Electron)
- ✅ Desktop and Start Menu shortcuts
- ✅ File association for `.ssp` project files

**Output files:**
- `PoleCheck-Desktop-Setup-{version}.exe` - NSIS installer (recommended)
- `PoleCheck-Desktop-Portable-{version}.exe` - Portable executable
- `PoleCheck-Desktop-{version}.zip` - ZIP archive

### All Platforms
```bash
npm run build
```
This command will:
1.  Build the React frontend (`dist/`).
2.  Build the Electron main and preload scripts (`dist-electron/`).
3.  Use `electron-builder` to package the application for your current platform into the `release/` directory.

### Installation Requirements
For end users installing the built application:
- **Operating System:** Windows 10 (1903+) or Windows 11
- **Architecture:** x64 (64-bit) only
- **RAM:** 4 GB minimum (8 GB recommended)
- **Storage:** 500 MB free disk space
- **Internet:** Required for Google Maps API access

**Note:** All runtime dependencies are bundled with the installer. No additional software installation is required.

See [INSTALLATION.md](./INSTALLATION.md) for detailed installation instructions.

## Usage Guide

### Basic Workflow
1. **Search for a location** using the search bar or enter coordinates directly
2. **Generate a depth map** for the current Street View location (required for measurements)
   - PoleCheck now requests Street View depth planes directly from Google's depth API. The app retries a limited number of times (configurable under **Settings -> Street View Depth Retries**) and surfaces a banner if the request is rate-limited or depth is unavailable, falling back to ONNX depth in the meantime.
3. **Calibrate the horizon** by clicking on the flat horizontal line where sky meets ground
4. **Click "Estimate Height"** or press 'M' to start a measurement
5. **Click the base** of the object you want to measure
6. **Click the top** of the object to complete the measurement
7. **View results** in the sidebar and export as needed

### Keyboard Shortcuts
- **M**: Start point-to-point height measurement
- **P**: Start polyline measurement tool
- **A**: Start area measurement tool
- **V**: Start volume measurement tool
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

PoleCheck Desktop uses multiple data sources and validation techniques for highly accurate measurements:

### Measurement Types
- **Point-to-Point**: Height measurements between two points
- **Polyline**: Path measurements along multiple connected points
- **Area**: 2D surface area calculations using polygon geometry
- **Volume**: 3D space calculations with adjustable height

### Data Sources (Priority Order)
1. **Google Street View Depth**: Direct depth planes from Google (highest accuracy)
2. **ONNX Depth Model**: ML-based depth estimation with calibration
3. **Ground Plane Intersection**: Geometric calculation using camera parameters

### Intelligent Calibration
- **Manual Horizon Calibration**: Click on true horizontal lines for correction
- **Automatic Horizon Detection**: RANSAC-based detection using depth data
- **Confidence Scoring**: Each measurement includes accuracy confidence (0-100%)
- **Validation Checks**: Automatic detection of unrealistic measurements

### Accuracy Factors
- **Camera Parameters**: FOV, pitch, heading from Street View metadata
- **Depth Caching**: Compressed LRU cache for consistent performance
- **Memory Management**: Optimized for stable long-term operation
- **Error Handling**: Graceful fallbacks and user feedback

### Best Practices
- Generate depth maps before measuring for highest accuracy
- Use auto-calibration when available for quick setup
- Check confidence scores for measurement reliability
- Place measurement points near viewport center for best results
- Re-calibrate when switching locations or noticing drift

## Project Structure

*   `electron/`: Electron main process and preload scripts
*   `src/`: React frontend source code
    *   `components/`: UI components (MapView, MeasurementTool, SearchBox, SettingsPanel, etc.)
    *   `stores/`: Zustand state management (rootStore.ts, notificationStore.ts)
    *   `services/`: Business logic (geometry, measurement, depth, error handling)
    *   `types/`: TypeScript type definitions
    *   `utils/`: Utility functions
    *   `hooks/`: React custom hooks
    *   `tests/`: Test files (unit, integration, e2e)
    *   `assets/models/`: ONNX model files
*   `docs/`: Documentation files
    *   `ARCHITECTURE.md`: Technical architecture and design patterns
    *   `API.md`: API documentation for services and IPC
    *   `roadmap.md`: Development roadmap and priorities
    *   `manual-qa.md`: Manual QA testing procedures
*   `dist/`: Vite build output
*   `dist-electron/`: Electron build output
*   `release/`: Packaged application builds

For detailed architecture and API documentation, see [docs/ARCHITECTURE.md](./docs/ARCHITECTURE.md) and [docs/API.md](./docs/API.md).

## Development

### Code Quality
- **ESLint**: Zero errors enforced with `npm run lint`
- **TypeScript**: Strict type checking with `npm run typecheck:strict`
- **Prettier**: Code formatting (configured in ESLint)

### Testing

Run tests using these commands:

```bash
npm run test             # Run all tests
npm run test:unit        # Unit tests only
npm run test:integration # Integration tests only
npm run test:performance # Performance tests
npm run test:e2e         # End-to-end tests (Playwright)
npm run test:all         # All test suites
npm run test:coverage    # Coverage report
npm run validate         # Type checking, linting, and tests
```

### Documentation

- **[ARCHITECTURE.md](./docs/ARCHITECTURE.md)**: Technical architecture, design patterns, and code organization
- **[API.md](./docs/API.md)**: API documentation for services and IPC channels
- **[DEVELOPMENT.md](./docs/DEVELOPMENT.md)**: Development guide, coding standards, and common patterns
- **[roadmap.md](./docs/roadmap.md)**: Development roadmap and priorities
- **[CONTRIBUTING.md](./CONTRIBUTING.md)**: Contribution guidelines

## Troubleshooting

### Environment & Setup
- **"Node.js not found"**: Install Node.js from [nodejs.org](https://nodejs.org/) and confirm it is on your PATH.
- **"Git not found"**: Install Git from [git-scm.com](https://git-scm.com/) and enable the "Add to PATH" option during installation (Windows).
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

See [CONTRIBUTING.md](./CONTRIBUTING.md) for detailed contribution guidelines.

Quick checklist:
1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Run `npm run validate` (type checking, linting, and tests)
5. Update documentation if needed
6. Submit a pull request

## License

This project is licensed under the MIT License.

