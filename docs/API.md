# Interfaces and storage contract

The desktop preload exposes `window.electronAPI.invoke(channel, data)`. Main owns validation and side effects. There is no public HTTP server. See `src/utils/validation.ts` for authoritative bounds and `electron/preload.ts` for the channel allowlist.

| Channel | Input | Result |
| --- | --- | --- |
| `get-settings` | none | persisted settings/defaults |
| `save-settings` | settings object | boolean acknowledgement |
| `get-measurements` | none | canonical measurement array |
| `save-measurements` | array, at most 10,000 entries | boolean acknowledgement; invalid arrays are not written |
| `get-projects` | none | projects keyed by UUID |
| `save-project` | UUID, name, measurements, optional revisions | boolean acknowledgement; at most 100 revisions |
| `delete-project` | UUID | boolean acknowledgement |
| `infer-depth` | base64 image data URL | axial depth array, width/height and transform; null on failure |
| `fetch-depth-data` | panorama ID or bounded retry options | panorama depth payload or failure |
| `csv-export` | CSV string, at most 10 MiB | native save-dialog outcome |
| `set-use-gpu` | boolean | provider/model reload result |
| `clear-data` | none | clears persisted workspace measurements |
| `log-error` | bounded structured error | local logging result |
| `log-telemetry` | bounded event | local telemetry only when opted in |

Errors/status updates use `main-process-message`. Do not assume a successful promise resolution means a write succeeded: inspect the acknowledgement. A timeout does not cancel arbitrary native work already in progress.

Measurements identify `distance`, `polyline`, `area` or `volume`; retain SI fields (`distanceMeters`, `areaSquareMeters`, `volumeCubicMeters`), points/camera, timestamp, metadata and source. Legacy display `distance` is only a fallback when canonical length is absent. Exporting CSV does not create a restorable project archive.

There is no supported `.ssp` import/file-open handler. Templates are session-local. External Google services and model assets are not supplied by this IPC contract; credentials and confidential custom assets are excluded from the public release.
