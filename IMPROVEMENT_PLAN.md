# PoleCheck Desktop Application: Development Plan

**Project:** PoleCheck Desktop Application (Street View Measurement)

**Goal:** Create a cross-platform (Windows, macOS, Linux) desktop application using Electron that allows users to search for locations, view Google Street View, and perform **highly accurate, robust, client-side measurements** of real-world objects by **deeply integrating and leveraging Google Maps Platform APIs** for precise depth, camera, and geospatial data.

**Technology Stack:**
*   **Runtime:** Electron
*   **Frontend:** React + TypeScript
*   **Build Tool:** Vite (for Renderer), TypeScript Compiler (`tsc`) (for Main/Preload in Dev)
*   **Dev Server:** `concurrently` orchestrating `vite`, `tsc --watch`, and `electron`
*   **Mapping:** Google Maps JavaScript API
*   **Packaging:** `electron-builder` (via `vite build`)

**Key Technical Aspects:**
*   No Chrome Extension APIs. Standard web APIs within Electron.
*   Leveraging Google Maps JavaScript API directly for core data (camera parameters, depth where available).
*   API Key loaded via `.env` file and Vite environment variables.
*   State management within React (e.g., Context, Zustand).
*   Persistence using `electron-store` or Node.js `fs` via IPC.
*   Development workflow uses `tsc --watch` for main/preload processes and `vite` dev server for the renderer.
*   Production build uses `vite build` (which incorporates `vite-plugin-electron`) and `electron-builder`.

---

## Phase 0: Project Setup & Basic Electron Shell (Completed)

**Goal:** Establish the project structure, dependencies, and a basic working Electron window displaying the React app.

1.  **[X] Initialize Project:** Vite + React + TS.
2.  **[X] Install Dependencies:** Electron, `electron-builder`, `concurrently`, `wait-on`, TypeScript, Node types, etc.
3.  **[X] Create Electron Files:** `electron/main.ts`, `electron/preload.ts`.
4.  **[X] Configure TS:** Updated `tsconfig.node.json` for CommonJS compilation of electron files.
5.  **[X] Configure Vite:** Set up `vite.config.ts`. `vite-plugin-electron` used only for production builds (`command === 'build'`). Environment variable handling added.
6.  **[X] Configure `package.json` Scripts:**
    *   `dev`: Uses `concurrently` to run `vite` (renderer dev server), `tsc --watch` (main/preload compilation), and `electron` (app host, waiting on Vite and compiled files).
    *   `build`: Uses `vite build` (which includes renderer, main, preload via `vite-plugin-electron`) and `electron-builder` for packaging.
7.  **[X] "Hello World" Test:** Verified Electron window opens and displays the default Vite + React content using `npm run dev`.

---

## Phase 1: Google Maps & Street View Integration

**Goal:** Load the Google Maps API, display Street View, allow basic location searching, and establish mechanisms to query detailed panorama and camera data from the API.

1.  **[ ] Secure API Key:**
    *   Create a `.env` file at the project root (ensure it's in `.gitignore`).
    *   Add `VITE_GOOGLE_MAPS_API_KEY=YOUR_API_KEY_HERE`.
    *   Ensure `vite.config.ts` correctly exposes this via `define: { 'import.meta.env.VITE_GOOGLE_MAPS_API_KEY': ... }`.
2.  **[ ] Load Maps JavaScript API:**
    *   Add the Maps JS API script tag to `index.html`.
    *   Use the API key from the environment variable (`import.meta.env.VITE_GOOGLE_MAPS_API_KEY`).
    *   Include necessary libraries (`geometry`, `places`, potentially others).
    *   Define a global callback function (`initMap` or similar) or use the `Loader` utility from `@googlemaps/js-api-loader`.
3.  **[ ] Create Map/StreetView Component:**
    *   Create a React component (e.g., `src/components/MapView.tsx`).
    *   Include a `div` element with an ID (e.g., `#map-container`) to hold the panorama.
    *   Use `useEffect` to initialize:
        *   A `google.maps.StreetViewPanorama` instance attached to the `#map-container` div.
        *   Investigate and implement methods to retrieve the most accurate camera parameters (FOV, lens characteristics, precise position/orientation) and available depth data directly from the initialized panorama and related Maps services. Store this in React state.
4.  **[ ] Implement Location Search:**
    *   Add an input field component (e.g., `src/components/SearchBox.tsx`).
    *   Use the `google.maps.places.Autocomplete` service OR `google.maps.Geocoder` service.
    *   On place selection/geocode result, get `lat/lng` coordinates and update state.
5.  **[ ] Update StreetView Location:**
    *   When new coordinates are obtained from search state change, call `streetViewPanorama.setPosition({ lat, lng })` within the `MapView` component.
6.  **[ ] Get Current Panorama Data:**
    *   Add event listeners within the `MapView` component (`useEffect`):
        *   `pano_changed`: Get pano ID (`getPano()`). Trigger retrieval/update of detailed camera/depth data.
        *   `position_changed`: Get Lat/Lng (`getPosition()`).
        *   `pov_changed`: Get Point of View (`getPov()`). Update derived camera parameters.
        *   `zoom_changed`: Get zoom (`getZoom()`). Update derived camera parameters (FOV).
    *   Store this dynamic data (panoId, position, pov, zoom, detailed camera parameters, depth availability) in React state.

---

## Phase 2: Re-integrate Measurement Logic & UI

**Goal:** Adapt the core measurement services and UI components to use the high-fidelity data obtained directly from the Google Maps Platform APIs.

1.  **[ ] Port/Refactor Core Services:**
    *   Move relevant calculation logic (e.g., `geometry.ts`, `measurement.ts`) into the new project structure (e.g., `src/services/`).
    *   Refactor services to primarily consume camera parameters and depth information sourced directly from the Maps API state (Phase 1). Remove/minimize reliance on fallback mechanisms.
    *   Update or create necessary type definitions (`src/types/`).
    *   Adapt any worker communication if needed (use standard `postMessage`).
2.  **[ ] Adapt/Create `MeasurementTool.tsx` Component:**
    *   Integrate into the React app structure (likely overlaying `MapView`).
    *   Get Inputs: Pass the detailed `cameraParams` and `depthData` from the Maps API state as props.
    *   Canvas: Render a `<canvas>` overlay using standard CSS positioning for drawing.
    *   Measurement: Ensure measurement calculations use the accurate API-sourced data.
    *   Controls: Implement UI controls for starting/stopping/saving measurements.
3.  **[ ] Adapt/Create `ControlPanel.tsx` Component:**
    *   Integrate into the main UI layout (e.g., a sidebar).
    *   Include controls for unit selection (Metric/Imperial).
    *   Add buttons/actions like "Clear Measurements".
4.  **[ ] Adapt/Create `MeasurementList.tsx` Component:**
    *   Integrate into the main UI layout.
    *   Display saved measurements from application state.
    *   Allow deleting individual measurements.

---

## Phase 3: Feature Parity & Polish

**Goal:** Re-implement remaining features and refine the user experience.

1.  **[ ] Implement Persistence:**
    *   Choose storage mechanism (`electron-store` recommended). Install it (`npm install electron-store`).
    *   Use `electron-store` in the main process (via IPC) or renderer process (check compatibility) to save/load measurements and user settings (like units).
2.  **[ ] Implement CSV Export:**
    *   Use Electron's `ipcRenderer` (exposed via `preload.ts`) and `ipcMain`.
    *   Frontend: Send measurement data via `electronAPI.invoke('csv-export', data)`.
    *   Main Process (`electron/main.ts`): Handle the IPC message (`ipcMain.handle('csv-export', ...)`). Use Node.js `fs` and Electron's `dialog.showSaveDialog` to save the CSV.
3.  **[ ] UI Layout & Styling:**
    *   Refine the overall application layout (search, map, panels) using CSS (e.g., Flexbox/Grid, CSS Modules, Tailwind).
    *   Ensure consistent styling.
4.  **[ ] Error Handling & User Feedback:**
    *   Implement user feedback for API errors, measurement issues, etc.
    *   Refine logging.
5.  **[ ] Cross-Platform Testing:** Test core features on Windows, macOS, and Linux.

---

## Phase 4: Build & Packaging

**Goal:** Configure the build process to create distributable application packages.

1.  **[ ] Configure `electron-builder` (`package.json` or `electron-builder.yml`):**
    *   Set `appId`, `productName`, version, author, etc.
    *   Configure target platforms (`win`, `mac`, `linux`) and formats (`nsis`, `dmg`, `AppImage`, etc.).
    *   Configure icons.
    *   Set up code signing (requires certificates).
2.  **[ ] Refine Build Scripts:** Ensure `npm run build` correctly triggers all steps (`typecheck`, `vite build`, `electron-builder`).
3.  **[ ] Test Builds:** Create and test installers/packages on target platforms.

--- 