# Installation and troubleshooting

Follow the [README setup](README.md#setup). Node 22.16+ (22.x), npm and Git LFS are required. Use `npm ci`, not an unbounded dependency upgrade. `git lfs pull` retrieves the public model assets. Setup scripts preserve existing `.env` files and never request elevated privileges or disable platform security.

## macOS

The supported local development path was exercised on Apple Silicon. `npm run build` produces a DMG and ZIP in `release/`. These local packages are not Developer ID signed/notarized unless you supply release credentials. Packaging success does not establish Gatekeeper acceptance.

The old Electron installation produced a macOS malware/security block. Its signature/resources were inconsistent. A fresh supported Electron installation replaced it; the downloaded artifact's checksum was verified and native launch was tested. No Gatekeeper bypass is part of setup. If a block persists, retain the exact filename and system security message, verify the locked download, and investigate that artifact rather than removing quarantine globally.

## Launch and offline use

`npm run dev` starts both Vite and Electron. `npm run build:vite` followed by `npm run dev:electron` launches the compiled app. A blank API key shows an offline configuration message while Settings, saved measurements and Projects remain usable.

Google imagery/search requires your own appropriately configured API key. Solar building insights are optional. Panorama depth relies on an undocumented endpoint and may be unavailable. The local metric model is a separate depth source. Missing/corrupted ONNX files should be replaced from verified public assets or rebuilt using [the conversion instructions](docs/DEVELOPMENT.md); never rename arbitrary checkpoints to the expected filename.

## Local data

Storage uses `electron-store` in Electron's user-data directory (normally `~/Library/Application Support/Street Spec Desktop` for the packaged macOS app; development names can differ). Back up the complete user-data directory with the app closed before migration. Depth caches are disposable IndexedDB data. CSV is an export, not a full project backup. No `.ssp` file association/import is advertised because it is not implemented.

Windows and Linux package configurations remain available. Their installer/native workflows require separate platform verification; do not assume the macOS results prove them.
