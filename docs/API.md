# PoleCheck Desktop - API Documentation

## Service APIs

### Depth Services

#### `depth.ts`

**`getCachedDepthMap(params: CameraParams, transform?: Transform): Promise<OnnxDepthMap | null>`**
- Retrieves cached depth map from IndexedDB or unified cache
- Returns null if not cached or expired
- Updates last used timestamp

**`cacheDepthMap(params: CameraParams, depthMap: OnnxDepthMap, options?: CacheOptions): Promise<void>`**
- Stores depth map in both IndexedDB and unified cache
- Applies adaptive compression
- Enforces cache size limits

**`prefetchDepthMap(params: CameraParams, depthMap: OnnxDepthMap, ttl?: number): Promise<void>`**
- Caches depth map as predictive entry with TTL
- Used for prefetching adjacent panoramas

**`clearDepthCache(): Promise<void>`**
- Clears all cached depth maps
- Removes from both IndexedDB and unified cache

**`getCacheStats(): Promise<CacheStats>`**
- Returns cache statistics including compression metrics

#### `depthGeneration.ts`

**`generateDepthMap(params: CameraParams, apiKey: string, deps: DepthGenerationDeps, options?: DepthGenerationOptions): Promise<DepthGenerationResult>`**
- Generates depth map for given camera parameters
- Checks cache first if enabled
- Supports progressive loading (low → high quality)
- Returns `{ depthMap: OnnxDepthMap, fromCache: boolean }`

**`createDepthMapFetcher(): FetchFunction`**
- Creates rate-limited fetch function for Street View images

#### `depthCalibration.ts`

**`CalibrationManager`**
- **`learnFromMeasurement(measurement: Measurement, actualDistance?: number): void`**
  - Learns calibration from measurement
  - Updates scale/bias estimates
  
- **`computeScaleBias(context?: Context): { scale: number; bias: number } | null`**
  - Computes calibrated scale and bias
  - Considers zoom level and confidence
  
- **`getEffectiveCalibrationPitchOffset(zoom: number): { offset: number; confidence: number }`**
  - Returns pitch offset with confidence

### Measurement Services

#### `measurement.ts`

**`createMeasurement(startPoint: Point, endPoint: Point, cameraParams: CameraParams, viewWidth: number, viewHeight: number, depthData: DecodedDepthData | null, unit: 'metric' | 'imperial'): Measurement`**
- Creates a point-to-point measurement
- Validates inputs
- Calculates 3D distance with confidence scoring
- Returns Measurement object with error handling

#### `measurementLogic.ts`

**`fusedWorldPoint(screenPoint: Point, cameraParams: CameraParams, depthData: DecodedDepthData | null, onnxDepthMap: OnnxDepthMap | null, settings: AppSettings): FusedWorldPointResult`**
- Fuses multiple depth sources for robust world point estimation
- Returns `{ point: Vector3, confidence: number, method: string }`

**`analyzeDepthGradients(depthMap: OnnxDepthMap, x: number, y: number): GradientAnalysis`**
- Analyzes depth gradients for confidence scoring
- Returns normalized gradient, edge strength, consistency metrics

**`computeOnnxDepthConfidence(depthMap: OnnxDepthMap, x: number, y: number, settings: AppSettings): number`**
- Computes confidence score for ONNX depth at point
- Returns 0-1 confidence value

**`computePlaneDepthConfidence(depthData: DecodedDepthData, x: number, y: number): number`**
- Computes confidence score for Street View plane depth
- Returns 0-1 confidence value

### Geometry Services

#### `geometry.ts`

**`screenToWorldWithDepth(screenPoint: Point, cameraParams: CameraParams, viewWidth: number, viewHeight: number, depthData: DecodedDepthData): Vector3 | null`**
- Converts screen point to 3D world point using depth data
- Uses bilinear sampling for sub-pixel accuracy
- Returns null if no valid intersection

**`estimateGroundPlaneIntersection(directionVector: Vector3, cameraParams?: CameraParams): Vector3 | null`**
- Estimates ground plane intersection using camera geometry
- Fallback when depth data unavailable

**`detectHorizonFromDepth(depthData: DecodedDepthData | null, cameraParams: CameraParams, viewWidth: number, viewHeight: number, onnxDepthMap?: OnnxDepthMap | null, useTemporalSmoothing?: boolean): HorizonDetectionResult`**
- Detects horizon using RANSAC and Hough transform
- Returns `{ pitchOffset: number, confidence: number, method: string, detected: boolean }`

**`calculateDistance3D(point1: Vector3, point2: Vector3): number`**
- Calculates Euclidean distance between 3D points

**`getEffectiveCalibrationPitchOffset(zoom: number): { offset: number; confidence: number }`**
- Returns calibration pitch offset with confidence
- Integrates zoom-level bias table

### Error Handling

#### `errorHandler.ts`

**`ErrorHandlerService`**
- **`handleError(error: AppError, context: ErrorContext): Promise<void>`**
  - Centralized error handling
  - Logs error, displays user message, attempts recovery
  
- **`getUserFriendlyMessage(error: AppError): string`**
  - Converts technical error to user-friendly message
  
- **`getRecoveryStrategy(error: AppError): RecoveryStrategy`**
  - Returns recovery strategy for error
  
- **`detectWindowsError(error: Error | AppError): AppError | null`**
  - Detects Windows-specific errors
  
- **`handleWindowsErrorRecovery(error: AppError, strategy: RecoveryStrategy): Promise<boolean>`**
  - Performs Windows-specific recovery actions

#### `errorUtils.ts`

**`createAppError(code: ErrorCode, message: string, userFriendlyMessage?: string, severity?: ErrorSeverity, category?: ErrorCategory, details?: unknown, recoverable?: boolean, maxRetries?: number): AppError`**
- Creates standardized AppError object

**`errorToAppError(error: unknown, defaultCode?: ErrorCode, ...): AppError`**
- Converts native Error to AppError

**`withErrorHandling<T>(operation: Function, context: ErrorContext, ...): Function`**
- Wraps async operation with error handling

**Category-specific creators**:
- `createNetworkError()`
- `createModelInferenceError()`
- `createGeometryError()`
- `createMeasurementError()`
- `createStorageError()`
- `createUIError()`
- `createValidationError()`

### Validation Utilities

#### `validation.ts`

**`validateIPCInvoke<T>(channel: IPCChannel, data: unknown): IPCRequest<T>`**
- Validates IPC request data using Zod schemas
- Throws if validation fails

**`validatePoint(point: unknown): Point`**
- Validates point coordinates

**`validateCameraParams(params: unknown): CameraParams`**
- Validates camera parameters

**`validateMeasurement(measurement: unknown): Measurement`**
- Validates measurement object

**`sanitizeString(input: unknown, maxLength?: number): string`**
- Sanitizes string input to prevent XSS

#### `polygonValidation.ts`

**`validatePolygon(worldPoints: Vector3[]): PolygonValidationResult`**
- Validates polygon for degeneracy, self-intersection, convexity
- Returns `{ isValid: boolean, warnings: string[], confidence: number, area: number, perimeter: number, properties: {...} }`

**`validateMeasurementPlausibility(value: number, worldPoints: Vector3[], cameraParams?: CameraParams): PlausibilityValidationResult`**
- Validates measurement plausibility based on physical constraints
- Returns `{ isValid: boolean, warnings: string[], confidenceMultiplier: number }`

### Cache Management

#### `cacheManager.ts`

**`UnifiedCache<T>`**
- **`get(key: string): T | null`**
  - Retrieves cached value
  
- **`set(key: string, value: T): void`**
  - Stores value in cache
  
- **`delete(key: string): boolean`**
  - Removes entry from cache
  
- **`clear(): void`**
  - Clears all entries
  
- **`size(): number`**
  - Returns cache size
  
- **`getStats(): CacheStats`**
  - Returns cache statistics
  
- **`static generateKey(prefix: string, params: Record<string, unknown>, precision?: number): string`**
  - Generates normalized cache key

**`cacheRegistry`**
- **`register(name: string, cache: UnifiedCache<any>): void`**
  - Registers cache with global registry
  
- **`get(name: string): UnifiedCache<any> | undefined`**
  - Retrieves registered cache
  
- **`clearAll(): void`**
  - Clears all registered caches
  
- **`getGlobalStats(): GlobalCacheStats`**
  - Returns global cache statistics

## IPC Channels

### Renderer → Main Process

**`fetch-depth-data`**
- Fetches Street View depth data
- Payload: `{ panoId: string, maxRetries?: number, retryDelayMs?: number } | string`
- Returns: `DepthDataFetchResult`

**`infer-depth`**
- Runs ONNX depth inference
- Payload: `string` (base64 image data URL)
- Returns: `OnnxDepthMap | null`

**`save-measurements`**
- Saves measurements to disk
- Payload: `Measurement[]`
- Returns: `void`

**`save-project`**
- Saves project to disk
- Payload: `Project`
- Returns: `void`

**`delete-project`**
- Deletes project
- Payload: `string` (project ID)
- Returns: `void`

**`get-projects`**
- Retrieves all projects
- Payload: `undefined`
- Returns: `Record<string, Project>`

**`get-measurements`**
- Retrieves measurements
- Payload: `undefined`
- Returns: `Measurement[]`

**`get-settings`**
- Retrieves settings
- Payload: `undefined`
- Returns: `AppSettings`

**`save-settings`**
- Saves settings
- Payload: `AppSettings`
- Returns: `void`

**`set-use-gpu`**
- Toggles GPU acceleration
- Payload: `boolean`
- Returns: `{ success: boolean, reloaded: boolean, useGPU: boolean, providers: string[] }`

**`csv-export`**
- Exports CSV data
- Payload: `string` (CSV content)
- Returns: `void` (saves file)

**`log-error`**
- Logs error to file
- Payload: `ErrorLogEntry`
- Returns: `void`

**`log-telemetry`**
- Logs telemetry event
- Payload: `TelemetryPayload`
- Returns: `void`

**`clear-data`**
- Clears all data
- Payload: `undefined`
- Returns: `void`

## Type Definitions

### Core Types

**`Measurement`**
```typescript
interface Measurement {
  id: string;
  kind: 'distance' | 'polyline' | 'area' | 'volume';
  label: string;
  name?: string;
  startPoint: Point;
  endPoint: Point;
  distanceMeters?: number;
  distance?: number;
  unit: 'metric' | 'imperial';
  areaSquareMeters?: number;
  perimeterMeters?: number;
  volumeCubicMeters?: number;
  dimensionsMeters?: { length: number; width: number; height: number };
  points?: Point[];
  timestamp: number;
  panoId?: string;
  cameraParams?: CameraParams;
  error?: string;
  source?: 'planes' | 'onnx' | 'ground' | 'area' | 'volume' | 'polyline';
  confidence?: number;
  metadata?: Record<string, unknown>;
}
```

**`CameraParams`**
```typescript
interface CameraParams {
  panoId?: string;
  lat?: number;
  lng?: number;
  heading?: number;
  pitch?: number;
  zoom?: number;
  fov?: number;
  vFov?: number;
  pano?: string;
  calibrationPitchOffsetDeg?: number;
  cameraHeight?: number;
  distortion?: {
    k1?: number;
    k2?: number;
    p1?: number;
    p2?: number;
    k3?: number;
  };
}
```

**`AppError`**
```typescript
interface AppError {
  id: string;
  code: string;
  message: string;
  userFriendlyMessage: string;
  severity: ErrorSeverity;
  category: ErrorCategory;
  details?: unknown;
  timestamp: number;
  stack?: string;
  recoverable: boolean;
  retryCount: number;
  maxRetries: number;
}
```

## Constants

### Error Codes
- `NETWORK_TIMEOUT`, `NETWORK_UNREACHABLE`, `API_RATE_LIMITED`
- `MODEL_LOAD_FAILED`, `MODEL_INFERENCE_FAILED`
- `GEOMETRY_CALCULATION_FAILED`, `GEOMETRY_DEPTH_INTERSECTION_FAILED`
- `MEASUREMENT_CALCULATION_FAILED`, `MEASUREMENT_NO_DEPTH_DATA`
- `STORAGE_SAVE_FAILED`, `STORAGE_LOAD_FAILED`, `STORAGE_CORRUPTED`
- `UI_RENDER_FAILED`, `UI_INTERACTION_FAILED`
- `SYSTEM_MEMORY_LOW`, `SYSTEM_RESOURCE_UNAVAILABLE`, `SYSTEM_UNKNOWN`

### Error Severity
- `ErrorSeverity.LOW`
- `ErrorSeverity.MEDIUM`
- `ErrorSeverity.HIGH`
- `ErrorSeverity.CRITICAL`

### Error Category
- `ErrorCategory.NETWORK`
- `ErrorCategory.MODEL`
- `ErrorCategory.GEOMETRY`
- `ErrorCategory.MEASUREMENT`
- `ErrorCategory.STORAGE`
- `ErrorCategory.UI`
- `ErrorCategory.SYSTEM`
- `ErrorCategory.UNKNOWN`

