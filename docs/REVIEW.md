# Public baseline repair review — September 2026

This was a bounded root-cause maintenance pass after inactivity, covering launch, dependencies, core math, depth dataflow, saving/projects, interface and documentation. It does not attempt to perfect the product or recreate the confidential commercial system.

StreetSpec was sold and previously private under an NDA. The disclosure restrictions have expired and the code is now public. Certain custom-tuned checkpoints, proprietary datasets, customer information and deployment details remain excluded. **Accuracy was verified privately for the original system; results from this public baseline may vary.** Private validation details are not published.

## Findings and repairs

| Area | Root cause | Repair/evidence |
| --- | --- | --- |
| Compiled launch | Main required unbundled TypeScript; defaulted to a missing Vite server; handlers registered after window load | Bundle validation, explicit dev URL, one-time IPC registration before rendering; native compiled Electron launch |
| Dependencies/macOS | Obsolete Spectron and vulnerable dependency tree; old Electron artifact failed macOS security checks | Locked compatible upgrades, fresh Electron, verified download checksum; no Gatekeeper bypass; advisory scan is separate from malware attribution |
| Renderer | React-window v2 dependency used with v1 source API; invalid template syntax and preload type conflict | Compatible list API, corrected syntax, actual renderer/Electron type checks |
| ONNX model | Tracked graph contained corrupted bytes; old conversion/preprocessing did not honor metric contract | Rebuild from SHA-verified public VKITTI Small weights, correct metric head/normalization, ONNX checker, PyTorch comparison and native inference |
| Image/depth alignment | Square stretching and incorrect transform rebasing; camera-axis depth treated as ray range | Aspect-preserving 518×518 letterbox, viewport transform, explicit axial/radial convention; analytic off-axis/rotation tests |
| Calibration/geometry | Pitch-sign mismatch; polygon centroid used unsigned area; rounded conversion constants | Positive-up pitch convention, signed centroid denominator, exact international-foot conversions; projection/winding/unit tests |
| Async depth/cache | Nested limiter could deadlock; cache write/read keys differed; compression format guessed from length; stale pose result accepted | Single limiter, consistent keys, explicit compression format, cache v2, viewport rebasing and stale-result rejection |
| IPC/persistence | Preload truncated arrays at 1,000 and long strings; startup did not hydrate measurements before autosave | Intact payloads with main-process validation; hydrate before saving; real IPC tests with 1,001 entries and 12,000-character metadata |
| Projects/revisions | Loading truncated saved measurements; writes/deletes/restores assumed success; revision restore persisted old contents | Preserve archived records; acknowledged writes, error reporting and correctly persisted restored values; failed-write regression tests |
| Undo | Shared measurement objects mutated old history; same-ID checks skipped real edits | Deep snapshots; rename/delete undo and redo tests |
| UI | Offline error replaced usable app; Settings clipped; API key controls crowded; project names mouse-only; stale version label | Offline workspace/configure action, wrapped toolbar, scrollable validated Settings with focus handling, project buttons, explicit workspace save, actual version |
| Packaging/setup | Unsupported builder options, missing macOS association icon, placeholder Windows ICO, Node 18/no tests in CI, wrong artifact paths | Node 22 locked installs, current builder configuration, remove nonfunctional file association, generate a real Windows ICO from existing SVG artwork, real checks and release-directory artifacts |
| Public documentation | Private-era instructions/readiness claims and missing provenance | Rewritten README/setup/API/architecture/manual QA, public-release boundary and private-accuracy distinction; historical plans explicitly marked historical |

## Verification

- `npm run validate`: **22 suites / 143 tests**, renderer and Electron type checks, zero-warning lint passed.
- `npm run test:e2e`: **13 tests passed** against both the compiled development app and the packaged macOS application. Actual Electron UI/IPC/settings/restart/project/model checks include startup preservation of all 1,001 saved measurements and long metadata.
- `npm audit`: **0 known vulnerabilities** in the repaired lockfile at review time. This is advisory evidence, not a blanket malware-free guarantee.
- Model: `onnx.checker` passed. Two seeded conversion comparisons had maximum absolute errors **0.0000163 m** and **0.0000220 m** versus PyTorch. These are conversion errors, not scene-measurement accuracy figures.
- Native inference returned a complete finite **518×518** depth tensor from a generated 640×360 image via real preload/main/Sharp/ONNX Runtime. No product stub or fake depth response was introduced.
- Remote validation and macOS/Linux packaging passed. Windows packaging exposed a text placeholder masquerading as ICO; a real multi-resolution icon and reproducible conversion script replace it.
- macOS ARM64 DMG/ZIP packaging completed. Developer ID signing/notarization remains external; this local build does not prove clean-machine Gatekeeper acceptance.

Existing Jest component/service tests use isolated doubles where appropriate, including deliberate storage failure injection. Those checks are distinct from the real native E2E execution and do not claim live Google or field validation.

## UI flow review

1. **Open offline workspace → Settings:** repaired navigation, explanatory text, visible heading, scrollable form and reachable Save/Cancel. Current-run native screenshots were inspected.
2. **Open Projects → create/save:** keyboard-operable project buttons, creation confirmation through real storage, manual workspace save. Layout remains recognizably the existing app rather than a redesign.
3. **Return to measurements → restart:** virtualized list renders saved work, undo is not incorrectly enabled on hydration, and settings persist.

Local screenshots are generated under ignored `test-results/`; they are synthetic/offline review evidence and contain no customer data. Broader visual consistency, screen-reader coverage and live-map interactions were not certified by these captures.

## Explicit limits and next steps

No configured Google key was supplied, so live search/Street View/undocumented panorama depth/Solar were not qualified. Public baseline accuracy needs its own publishable reference evidence; privately verified original-system results must not be presented as identical public performance. Windows/Linux native behavior and clean-machine signing/notarization need separate validation.

Active measurement retention still removes oldest entries with a notification when adding beyond the configured history limit; save/archive/export first. Active project selection, templates and undo history are session-local. Switching projects replaces the active workspace; save pending work first. CSV is not a restorable project archive. No `.ssp` import is advertised.

The checkout lacks a standalone application LICENSE despite earlier MIT wording; resolve the grant separately. The included public weights match upstream SHA-256 `9203e538d35255c90dda4b7fedb47ff33fe725497bcca3b1e53b3a65ee63f0cb`; excluded custom checkpoints are not distributed.

GitHub About/description/topics have been added. Upstream maintenance remains on **main only**. Dependency alerts remain enabled; automatic security-update branches are disabled to prevent branch proliferation. Review alerts regularly rather than treating that setting as remediation.
