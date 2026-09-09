# Manual QA and remaining external checks

The original system's accuracy was verified privately. This checklist qualifies the public configuration, which excludes custom checkpoints and private data. Do not publish private reference scenes/results.

1. **Startup/offline:** run compiled Electron with a blank key. Confirm the workspace renders, the offline message offers Settings, Projects opens, and no error boundary replaces the UI.
2. **Settings:** check the scrollable dialog at ordinary and small window sizes; all labels, Save/Cancel, numeric constraints and keyboard focus must remain reachable. Escape closes Settings. Toggle units, save, restart and confirm persistence.
3. **Saving:** create representative distance/path/area/volume measurements; save/restart; verify SI values, points, camera and metadata. Create/load/delete projects, save/restore a revision and undo a rename/deletion. Check disk-write failures leave current work available and report failure. Archive before the active-history limit removes older entries.
4. **Online imagery/search:** with your own key, search a location and pan/zoom/resize. Confirm obsolete depth is not shown after camera changes. Exercise Google failures without losing local project controls. This requires real service access.
5. **Depth and math:** run the public model on known images; check alignment at image center/edges, letterboxing and camera rotations. Compare heights, distances, ground areas and extruded volumes with measured reference dimensions. Record the exact public model/parameters; do not transfer private accuracy claims to it.
6. **Exports:** save CSV through the native dialog, inspect unit labels and canonical numbers, quotes, non-ASCII names and metadata. Cancel should not report success. CSV is not a full project import format.
7. **Packaging:** launch the packaged app, verify inference/model resolution and restart storage. Separately sign/notarize and test Gatekeeper on a clean macOS machine before publishing installers. Verify Windows/Linux on their own systems.

Automated local evidence and remaining limits are in [REVIEW.md](REVIEW.md). Native integration tests execute real Electron/IPC/ONNX; synthetic fixtures and isolated failure tests cover deterministic invariants, not Google service availability or field accuracy.
