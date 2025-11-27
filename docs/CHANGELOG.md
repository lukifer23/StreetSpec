# Street Spec Desktop - Changelog

All notable changes to this project will be documented in this file.

## [Unreleased] - Comprehensive Unification & Hardening

### Major Improvements

#### Code Unification
- **Centralized Math Utilities**: Created `src/utils/math.ts` with unified 3D/2D distance, magnitude, normalization, and vector operations
- **Consolidated Imports**: Created index files (`src/services/index.ts`, `src/utils/index.ts`, `src/types/index.ts`) for cleaner imports
- **Removed Duplication**: Eliminated duplicate implementations of `distance3D`, `magnitude3D`, `normalizeVector3D`, `degreesToRadians`, etc.
- **Unified Cache System**: All caches now use `UnifiedCache` with consistent eviction, TTL, and statistics

#### Enhanced Error Handling
- **Centralized Error System**: All errors conform to `AppError` interface with standardized codes and categories
- **Error Utilities**: Created `src/utils/errorUtils.ts` with category-specific error creators and conversion utilities
- **Windows-Specific Recovery**: Implemented Windows error detection and automatic recovery strategies
- **IPC Error Handling**: Zod-based validation for all IPC channels with proper error propagation

#### Documentation
- **ARCHITECTURE.md**: Complete technical architecture documentation with design patterns, data flows, and optimizations
- **API.md**: Comprehensive API documentation for all services and IPC channels
- **DEVELOPMENT.md**: Development guide with coding standards, common patterns, and best practices
- **Updated README**: Enhanced with better structure and cross-references to technical docs

#### Depth System Enhancements
- **Adaptive Compression**: UTF16 compression for large datasets, standard for small; tracks compression ratios
- **Dual-Layer Caching**: In-memory `UnifiedCache` + persistent IndexedDB with synchronization
- **Predictive Caching**: TTL-based prefetching with automatic cleanup of expired entries
- **Enhanced Statistics**: Cache stats include compression metrics, predictive counts, and unified cache stats

#### Measurement Hardening
- **Unified Depth Fusion**: Robust fusion algorithm combining Street View planes, ONNX depth, and ground-plane geometry
- **Spatial Agreement**: 3D position agreement checks in addition to distance agreement for fusion
- **Polygon Validation**: Comprehensive validation for degenerate polygons, self-intersections, convexity, angles
- **Plausibility Checks**: Physical constraint validation with camera parameter awareness
- **Real-Time Feedback**: Validation errors and confidence scores displayed during measurement creation

#### Calibration Improvements
- **Enhanced RANSAC**: Adaptive thresholds, progressive sampling, early termination, quality-based selection
- **Per-Zoom Bias Tables**: Confidence-weighted interpolation with adaptive learning from measurements
- **Confidence Scoring**: Exposure of confidence levels for calibration offset and zoom bias

#### Type Safety
- **Zod Schemas**: Runtime validation for all IPC communication with proper error messages
- **Branded Types**: Type-safe IDs (`PanoId`, `MeasurementId`, `ProjectId`) and numeric types (`DistanceMeters`, `ConfidenceScore`)
- **Type Guards**: Runtime validators for branded types

#### Geometry Robustness
- **Fast Rejection**: Early validation for plane parameters to avoid expensive calculations
- **Improved RANSAC**: Multi-scale with quality-based result selection and adaptive iterations
- **Height Estimation**: Confidence scoring for height calculations
- **Unified Ray-Plane Intersection**: Consistent validation and confidence calculation

#### Performance
- **Memory Management**: Progressive cache cleanup (expired → full) with memory pressure detection
- **Virtualization**: `react-window` v2 API for large measurement lists
- **Optimized Compression**: Lower threshold (512 bytes) with adaptive algorithm selection
- **Increased Cache Capacity**: Cache size 100→150 entries, memory 200MB→300MB with better compression

### Breaking Changes
- **calculateDistance3D**: Deprecated in favor of `distance3D` from `src/utils/math` (wrapper maintained for backward compatibility)
- **Cache Keys**: Version bumped to 1.3; old cache entries will be ignored

### Bug Fixes
- Fixed duplicate imports across multiple files
- Fixed `react-window` v2 API migration issues
- Fixed IPC validation to use Zod schemas consistently
- Fixed Windows process cleanup error messages
- Fixed Vite/React CommonJS interop issues

### Developer Experience
- **Cleaner Imports**: Use index files for consistent imports across application
- **Better Documentation**: Comprehensive guides for architecture, APIs, and development
- **Type Safety**: Eliminated all `any` types; added runtime validation
- **Consistent Patterns**: Standardized error handling, caching, and validation

### Next Steps
- Rendering performance optimization (canvas redraws, RAF batching, viewport culling)
- Memory management improvements (listener cleanup, weak references, Windows APIs)
- Network optimization (connection pooling, deduplication, bandwidth awareness)
- Accessibility enhancements (ARIA labels, keyboard navigation, screen reader support)
- UI consistency (CSS variables, standardized spacing, unified loading states)
- Windows 11 integration (Fluent Design, context menus, snap layouts, notifications)
- Expanded test coverage (integration, E2E, performance, Windows-specific)

## Previous Versions

See git history for previous changes and version history.


