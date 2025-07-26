# PoleCheck Desktop – Production-Grade Roadmap 2025

## 0 ▕ VISION
PoleCheck will be **the de-facto desktop tool for precise, auditable 3-D measurements on Google Street View imagery**.  We will differentiate with AI-assisted workflows, enterprise-grade data management, offline capability, and flawless UX.

---
## 1 ▕ STATE OF THE CODEBASE (May 2025)
✓ Core height measurement, CSV export, ONNX depth inference, persistence, error handling, keyboard shortcuts, unit conversion.
✗ Remaining ESLint errors, depth caching, tests, model file in Git, advanced geometry, UI polish.

---
## 2 ▕ CRITICAL FIXES  (– SHIP BLOCKERS)
| ID | Fix | Owner | Status |
|----|-----|-------|--------|
| CF-1 | **Zero ESLint errors** – clean build gate | FE | ✅ |
| CF-2 | **Git LFS** for `.onnx` + history rewrite | INFRA | ⏳ |
| CF-3 | **Settings panel** (dark-mode, units, GPU toggle, history limit) | FE | ☐ |
| CF-4 | **Depth-map caching** (IndexedDB keyed by panoId+cam) | ML | ☐ |
| CF-5 | **Tests bootstrap** – Jest + first unit test (unit-conversion) | QA | ☐ |
| CF-6 | **CI GitHub Actions** – lint, typecheck, test, build | INFRA | ☐ |

_All CF tasks must be ✅ before any Tier-1 feature work ships._

---
## 3 ▕ FEATURE ROADMAP
Features are grouped in tiers.  Each tier may run parallel tracks but must respect CF completion.

### 3.1 Tier 1 : 90-Day Differentiators
1. **AI Object Auto-Detection & Snap**  
   Model: YOLOv8-Nano + NMS → bounding-box centrelines → auto-select base/top click.  Exports confidence.
2. **Polyline / Chain Measurements**  
   Multi-segment distance with cumulative length, per-segment grade %, undo/redo.
3. **Guided Templates / Wizards**  
   Pre-baked flows (Utility Pole, Sign, Building façade) that auto-label rows.
4. **Dark-Mode + Responsive UX**  
   CSS vars, prefers-color-scheme, < 900 px layout.

### 3.2 Tier 2 : Platform Strength – 6 months
5. **GPU / DirectML / MPS Inference Toggle**  
   ort-web DirectML EP (Win) / MPS (mac). Benchmarked auto-select.
6. **Projects & Revision History**  
   `.pchk` file (JSON+PNG) – manual save/load, SHA-256 hash chain per edit.  Diff viewer.
7. **Area & Volume**  
   Ground-plane polygon → m²/ft²; extrude to arbitrary height for m³/ft³.
8. **GeoJSON / KML Export**  
   Spatial data for GIS ingestion.

### 3.3 Tier 3 : Enterprise & Viral – 12 months
9. **Realtime Collaboration (CRDT)**  
   WebSocket presence, cursors, comments.
10. **Depth-Map CDN & Multi-View Fusion**  
    Serverless cache; optional local SfM fusion for accuracy σ.
11. **Auto-Updater & Code-Signing**  
    electron-updater, Windows & macOS notarisation.
12. **Audit Trail & Tamper-Seal**  
    Signed measurement history for legal evidence.

---
## 4 ▕ TECHNICAL TRACKS
### 4.1 ML / Depth
• Migrate Depth-Anything V2 to Git LFS.  
• Investigate lighter Outdoor-Tiny (33 MB) + Indoor model auto-switch.  
• Cache inference results (IndexedDB) + LRU.

### 4.2 Frontend
• React-Testing-Library, Storybook, virtualised lists.  
• Theme provider with CSS variables.  
• Global state < 100 lines (Zustand).

### 4.3 Infrastructure
• GitHub Actions matrix → lint / test / build / release-draft.  
• Large-file downloads in CI (LFS pull).  
• Sentry crash reporting (renderer + main).

### 4.4 Documentation
• CONTRIBUTING.md: branch strategy, commit emoji legend.  
• User Manual (md → docs site).  
• Architecture diagram (Mermaid).

---
## 5 ▕ EXECUTION PLAN
1. **Week 1–2** – complete CF-1 → CF-3 (lint zero, LFS, settings UI).  
2. **Week 3** – CF-4 depth-cache, CF-5 tests bootstrap.  
3. **Week 4** – GitHub Actions (CF-6).  _MVP ready → push v0.2._
4. **Month 2–3** – Tier 1 features in parallel feature branches, merged behind feature flags.
5. **Quarter 2** – Tier 2 roadmap begins once Tier 1 flags ship.

---
## 6 ▕ DONE LOG (auto-append)
| Date | Commit | Note |
|------|--------|------|
| 2025-05-28 | 6a43d00 | Unit conversion, shortcuts, accessibility, ESLint config, UI polish |
| 2025-05-29 | 581c728 | ESLint zero-error baseline + Git LFS track *.onnx |
