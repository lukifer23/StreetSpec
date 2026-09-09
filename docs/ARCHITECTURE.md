# Architecture

Current public baseline, September 2026. See [public-release provenance](PUBLIC_RELEASE.md) for the sale/NDA history and confidential exclusions.

## Runtime and trust boundaries

Electron main owns filesystem access, `electron-store`, image decoding, ONNX Runtime, network depth requests and native CSV save dialogs. A context-isolated preload exposes a channel allowlist. Renderer payloads are preserved intact and validated against channel-specific Zod schemas in main; invalid writes fail rather than silently truncating data. Renderer Node integration is disabled. Production scripts remain CSP-restricted; inline styles are permitted because React/Google Maps require them.

IPC handlers register once before the window loads. Development loads the explicitly supplied Vite URL; compiled launches load `dist/index.html`. The app remains navigable without API keys or depth assets. API credentials belong to local settings/configuration, not source control. They are not encrypted at rest.

## Dataflow

1. Startup reads settings, projects and workspace measurements before enabling autosave. Persisted settings merge with defaults.
2. Map camera changes establish panorama, pose, FOV and viewport. Panorama changes invalidate plane depth; pose changes invalidate learned depth and calibration.
3. Static imagery preserves viewport aspect ratio. Main letterboxes it to 518×518, applies RGB ImageNet normalization and runs the metric VKITTI Small graph.
4. The returned transform maps viewport coordinates into the padded depth tensor. Output is explicitly axial depth; sampling converts it to radial range before 3D projection. Camera/viewport staleness is checked before installing asynchronous results.
5. Measurements retain canonical SI values, source, camera/points, metadata and heuristic confidence. Unit conversion happens for display/export.
6. Workspace autosaves are serialized with captured measurement/project snapshots. Project creation, deletion and revision restoration wait for storage acknowledgement. Undo snapshots are deep copies and remain session-local.

## Geometry contract

The camera uses positive-up pitch. Manual horizon calibration and estimated-height calculations honor that convention. ONNX sampling must use `estimateDistanceToPoint` to convert camera-axis depth to ray range. Plane depth follows its panorama projection path. Ground fallback assumes a ground plane and camera height; it cannot establish arbitrary object depth.

Polyline length sums 3D segment lengths. Area is a ground-plane footprint. Volume is footprint area times the supplied extrusion height; PCA-derived dimensions describe its extent. Reversed polygon winding retains the same area, centroid and dimensions. International-foot conversions derive from exact 0.3048 m; canonical values are never repeatedly converted on a unit toggle.

## Persistence and caches

`electron-store` persists settings, workspace measurements and project snapshots/revisions. Saves validate before replacement. Loading saved work does not apply the active history retention limit. Adding measurements still applies the configured active-history limit with a notification; archive/export before exceeding it. Project switching replaces the workspace, so save pending work first. The active project selection, undo stack and templates are session-local.

Depth cache v2 uses IndexedDB and an in-memory registry. Camera parameters identify entries; saved transforms describe image-to-model mapping and are rebased to the consuming viewport. Compression format is stored explicitly instead of inferred from compressed length. Old incompatible records are not accepted as v2 maps. The cache is bounded at 150 current entries and is disposable.

## Limits

Accuracy was verified privately for the original system; the public baseline excludes that custom tuning and private data, so results may vary. Synthetic fixtures and PyTorch/ONNX comparisons establish consistency, not field accuracy. Live Google imagery/search/depth/Solar require service access and independent verification. The panorama depth endpoint is undocumented. Confidence is heuristic; do not present it as a measured probability. Signing/notarization and native Windows/Linux qualification are separate from local macOS development checks.
