# Street Spec Desktop - Architecture Documentation

## Overview

Street Spec Desktop is an Electron-based desktop application for accurate measurements in Google Street View imagery. This document describes the technical architecture, code organization, and design patterns.

## Technology Stack

### Core Framework
- **Electron 31.x**: Cross-platform desktop application framework
- **React 18.x**: UI component library
- **TypeScript 5.x**: Type-safe JavaScript
- **Vite 5.x**: Build tool and development server

### Key Libraries
- **Zustand 5.x**: State management with Immer
- **ONNX Runtime Node**: Machine learning inference
- **Google Maps JavaScript API**: Mapping and Street View
- **Sharp**: Image processing
- **IndexedDB (idb-keyval)**: Client-side storage
- **Zod**: Runtime validation
- **lz-string**: Compression for caching

## Project Structure

```
Street Spec Desktop/
├── electron/              # Electron main process
│   ├── main.ts           # Main process entry point
│   └── preload.ts        # Preload script (IPC bridge)
├── src/                  # React frontend
│   ├── components/       # React UI components
│   ├── services/         # Business logic and services
│   ├── stores/           # Zustand state management
│   ├── hooks/            # React custom hooks
│   ├── utils/            # Utility functions
│   ├── types/            # TypeScript type definitions
│   └── tests/            # Test files
├── docs/                 # Documentation
├── assets/               # Static assets
└── build/                 # Build configuration

```

## Architecture Layers

### 1. Presentation Layer (`src/components/`)

React components for UI rendering:
- **Layout Components**: `AppLayout`, `AppHeader`
- **Map Components**: `MapView` (Street View integration)
- **Measurement Tools**: `MeasurementTool`, `PolylineTool`, `AreaTool`, `VolumeTool`
- **Sidebar Components**: `MeasurementSidebar`, `ProjectPanel`, `SettingsPanel`
- **UI Components**: `SearchBox`, `Notifications`, `ErrorDisplay`, `LoadingIndicator`

**Pattern**: CSS Modules for styling, props-based configuration, controlled components.

### 2. Business Logic Layer (`src/services/`)

Core services handling business logic:

#### Depth Services
- **`depth.ts`**: Depth map caching (IndexedDB + UnifiedCache)
- **`depthGeneration.ts`**: Depth map generation orchestration
- **`depthPrefetch.ts`**: Predictive depth map prefetching
- **`depthCalibration.ts`**: Calibration and bias management

#### Measurement Services
- **`measurement.ts`**: Measurement creation and validation
- **`measurementLogic.ts`**: Depth fusion and world point calculation
- **`geometry.ts`**: 3D geometry calculations and horizon detection

#### Infrastructure Services
- **`errorHandler.ts`**: Centralized error handling and recovery
- **`rateLimiter.ts`**: API rate limiting and circuit breaker

**Pattern**: Pure functions where possible, singleton services for stateful operations.

### 3. State Management Layer (`src/stores/`)

Zustand stores with Immer for immutable updates:
- **`rootStore.ts`**: Main application state (measurements, projects, settings, camera params)
- **`notificationStore.ts`**: Toast notification state

**Pattern**: Slice-based organization, persistent state where needed.

### 4. Utility Layer (`src/utils/`)

Reusable utility functions:
- **`errorUtils.ts`**: Error creation and conversion utilities
- **`validation.ts`**: Zod schemas for IPC validation
- **`cacheManager.ts`**: Unified cache system
- **`polygonValidation.ts`**: Polygon validation and plausibility checks
- **`cameraMath.ts`**: Camera mathematics utilities
- **`units.ts`**: Unit conversion utilities
- **`measurementDisplay.ts`**: Measurement formatting utilities

**Pattern**: Pure functions, no side effects, comprehensive type safety.

### 5. Type System (`src/types/`)

TypeScript type definitions:
- **`common.ts`**: Core types (Measurement, CameraParams, AppError, etc.)
- **`branded.ts`**: Branded types for type safety (PanoId, MeasurementId, etc.)
- **`electron.d.ts`**: Electron IPC type definitions
- **`strict.ts`**: Strict validation schemas

**Pattern**: Branded types for semantic safety, discriminated unions for variants.

## Key Design Patterns

### 1. Error Handling

**Centralized Error System**:
- All errors conform to `AppError` interface
- Error codes defined in `ERROR_CODES` constant
- Error handler service provides user-friendly messages and recovery strategies
- Windows-specific error detection and recovery

**Usage**:
```typescript
import { createAppError, errorToAppError } from '../utils/errorUtils';

// Create standardized error
throw createAppError('NETWORK_TIMEOUT', 'Request timed out', 'The request took too long', ...);

// Convert native error
catch (err) {
  const appError = errorToAppError(err, 'SYSTEM_UNKNOWN');
}
```

### 2. Caching Strategy

**Dual-Layer Caching**:
- **UnifiedCache**: In-memory LRU cache for fast access
- **IndexedDB**: Persistent storage with compression
- Predictive caching with TTL for prefetched entries
- Adaptive compression (UTF16 for large datasets, standard for small)

**Usage**:
```typescript
import { getCachedDepthMap, cacheDepthMap } from '../services/depth';

// Check cache
const cached = await getCachedDepthMap(cameraParams);

// Store in cache
await cacheDepthMap(cameraParams, depthMap, { isPredictive: true, ttl: 300000 });
```

### 3. IPC Communication

**Type-Safe IPC**:
- Zod schemas for runtime validation
- Branded types for channel names
- Preload script exposes secure API
- Main process validates all inputs

**Pattern**:
```typescript
// Preload exposes secure API
window.electronAPI.invoke('fetch-depth-data', { panoId });

// Main process validates with Zod
const payload = validateIPCInvoke('fetch-depth-data', data);
```

### 4. Depth Fusion

**Multi-Source Depth Fusion**:
- Priority: Street View planes > ONNX depth > Ground plane
- Confidence scoring based on gradient analysis, proximity, and agreement
- 3D spatial agreement checks for fusion validation
- Weighted averaging of agreeing sources

**Usage**:
```typescript
import { fusedWorldPoint } from '../services/measurementLogic';

const worldPoint = fusedWorldPoint(
  screenPoint,
  cameraParams,
  depthData,
  onnxDepthMap,
  settings
);
```

### 5. Measurement Validation

**Comprehensive Validation**:
- Polygon validation (degenerate detection, self-intersection, convexity)
- Plausibility checks (physical constraints, camera parameters)
- Confidence scoring based on validation results
- Real-time feedback during measurement creation

**Usage**:
```typescript
import { validatePolygon, validateMeasurementPlausibility } from '../utils/polygonValidation';

const validation = validatePolygon(worldPoints);
const plausibility = validateMeasurementPlausibility(area, worldPoints, cameraParams);
```

## Data Flow

### Depth Map Generation Flow

```
User Action
  ↓
MapView Component
  ↓
useAppLogic Hook
  ↓
depthGeneration Service
  ├─→ Check Cache (depth.ts)
  ├─→ Fetch Image (rateLimiter.ts)
  ├─→ IPC to Main Process (infer-depth)
  └─→ Cache Result (depth.ts)
  ↓
Update State (rootStore)
  ↓
Render Depth Map
```

### Measurement Flow

```
User Clicks
  ↓
MeasurementTool Component
  ↓
fusedWorldPoint (measurementLogic.ts)
  ├─→ screenToWorldWithDepth (geometry.ts)
  ├─→ ONNX Depth Lookup
  └─→ Ground Plane Intersection
  ↓
validatePolygon (polygonValidation.ts)
  ↓
createMeasurement (measurement.ts)
  ↓
Update State (rootStore)
  ↓
Render Measurement
```

## State Management

### Root Store Structure

```typescript
interface RootState {
  // Measurements
  measurements: Measurement[];
  
  // Projects
  projects: Record<string, Project>;
  currentProjectId: string | null;
  
  // Settings
  settings: AppSettings;
  
  // Camera State
  currentCameraParams: CameraParams | null;
  
  // Depth Data
  depthData: DecodedDepthData | null;
  onnxDepthMap: OnnxDepthMap | null;
  
  // UI State
  activeTool: 'measurement' | 'polyline' | 'area' | 'volume' | null;
  isGeneratingMap: boolean;
}
```

### State Persistence

- Settings persisted via Electron Store
- Projects saved to disk
- Cache persisted in IndexedDB
- Measurements stored in projects

## Performance Optimizations

### 1. Caching
- Dual-layer depth map caching
- Geometry calculation caching
- Trigonometry value caching
- FOV calculation caching

### 2. Virtualization
- Virtualized measurement lists (`react-window`)
- Viewport culling for large datasets

### 3. Memory Management
- LRU eviction for caches
- Memory pressure detection
- Automatic cleanup of expired entries
- Garbage collection triggers

### 4. Network Optimization
- Rate limiting with circuit breaker
- Request deduplication
- Progressive loading support
- Predictive prefetching

## Security Considerations

### 1. IPC Security
- Preload script exposes minimal API
- Input validation on main process
- Type-safe IPC channels
- No `nodeIntegration` in renderer

### 2. API Key Protection
- Environment variables only
- Never exposed in client code
- Secure storage in Electron Store

### 3. Error Handling
- No sensitive data in error messages
- User-friendly error messages
- Detailed logging in development only

## Testing Strategy

### Unit Tests
- Service functions
- Utility functions
- Component logic

### Integration Tests
- Golden scene tests
- Performance benchmarks
- End-to-end workflows

### E2E Tests
- Playwright for full application flows
- Cross-browser testing
- User interaction simulation

## Build and Deployment

### Development
```bash
npm run dev          # Start Vite dev server + Electron
npm run typecheck    # Type checking
npm run lint         # Linting
npm run test         # Run tests
```

### Production Build
```bash
npm run build:win    # Windows build
npm run build        # Platform-specific build
```

### Output Structure
- `dist/`: Vite build output (React app)
- `dist-electron/`: Electron main/preload scripts
- `release/`: Packaged application (installer, portable, zip)

## Future Improvements

See [docs/roadmap.md](./roadmap.md) for planned improvements including:
- Expanded test coverage
- Enhanced accessibility
- Performance optimizations
- Advanced features


