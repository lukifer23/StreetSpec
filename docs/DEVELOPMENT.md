# Development and reproduction

See [README](../README.md) for initial setup and [public-release boundaries](PUBLIC_RELEASE.md) before adding assets. Use Node 22.16+ (22.x), Git LFS and `npm ci`. `npm run dev` launches Electron with Vite; `npm run build:vite` emits both renderer and Electron bundles.

## Checks

- `npm run validate`: renderer/Electron type checks, zero-warning lint and all Jest suites.
- `npm run test:e2e`: Playwright drives real Electron, isolated temporary user data, actual IPC, restart persistence, offline panels and local ONNX execution.
- `npm audit`: dependency advisories for the installed lockfile.
- `npm run build`: platform package under `release/`; credentials are needed for signed/notarized releases.

Jest has focused test doubles for isolated components/failures. They are not substitutes for native integration or measurements against real surveyed scenes. Golden scene fixtures are analytically constructed projection inputs. Do not describe them as field data or report commercial accuracy from them.

To test the packaged macOS app after `npm run build`, set `STREETSPEC_PACKAGED_EXECUTABLE` to the absolute path of `release/mac-arm64/Street Spec Desktop.app/Contents/MacOS/Street Spec Desktop` and run `npm run test:e2e`. The suite uses a temporary profile and the actual bundled resources.

## Rebuild the public metric ONNX model

Use Python 3.11/3.12 and `uv`. The script declares pinned conversion dependencies. Obtain the official source and existing public weights through Git LFS:

```bash
git clone https://github.com/DepthAnything/Depth-Anything-V2.git .local/Depth-Anything-V2
git -C .local/Depth-Anything-V2 checkout a561b849ebae10a6f5ef49e26c83cbbcd36c71bf
git lfs pull
uv run --python 3.11 convert_model_proper.py --source .local/Depth-Anything-V2 --weights models_temp/depth_anything_v2_metric_vkitti_vits.pth
```

The script loads the metric `vits` architecture with `max_depth=80`, strictly loads weights, exports opset 17 at fixed 518×518, runs ONNX validation and compares two seeded inputs against PyTorch before replacing the output. The input contract is RGB, `(pixel/255 - mean)/std`, with mean `[0.485,0.456,0.406]`, std `[0.229,0.224,0.225]`. Main preserves source aspect ratio by letterboxing. The output is camera-axis depth in meters and must be converted to radial range for ray projection.

`src/assets/models/depth_anything_v2_metric_vkitti_vits.json` records source/weight/graph hashes and numerical conversion errors. Rebuilding this public model does not recreate confidential custom tuning. Never export private checkpoints into a tracked model path.

## Maintenance

Use the single upstream branch `main`. Alerts remain enabled, while automatic security-update branches are disabled. Review advisories, apply compatible root-cause upgrades and validate before committing. Do not bypass macOS security checks or replace a failing native binary with a stub. Keep private data and credentials outside the checkout; `.local/`, `.env`, build outputs and test artifacts are ignored.
