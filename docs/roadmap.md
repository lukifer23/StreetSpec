# Street Spec Desktop - Development Roadmap 2025

## Vision
Street Spec aims to be a reliable desktop application for accurate measurements in Google Street View imagery, with an emphasis on precision, usability, and robust tooling.

---

## 1. Comprehensive Analysis (January 2025)

### Current Strengths
- Solid Electron + React + TypeScript foundation
- Machine-learning depth model with caching
- Height measurement, CSV export, settings panel, and theme support
- Strong TypeScript and ESLint configuration
- Established unit and integration test coverage
- Centralized state management with Zustand

### Areas for Improvement
- Expand unit and integration test coverage
- Improve error handling and user feedback
- Optimise performance for large datasets
- Strengthen accessibility and keyboard navigation
- Complete API documentation and user guides

---

## 2. Detailed Improvement Hit List

### Priority 1: Core Improvements
- Testing infrastructure: finish service tests, add integration coverage
- State management: enhance persistence, introduce undo/redo, tune performance
- Error handling: expand error boundaries, validation, and logging
- Performance: virtualise lists, optimise depth caching, instrument key paths

### Priority 2: Feature Enhancements
- Advanced measurements: multi-segment paths, area polygons, volume estimation, templates
- AI assistance: object detection, snapping aids, auto labelling, confidence scoring
- Data management: project system, revision history, export formats, cloud sync
- Advanced geometry: horizon detection, multi-view fusion, better calibration, validation

### Priority 3: Advanced Features
- Collaboration: real-time sharing, comments, version history, team roles
- Enterprise: REST integrations, database backing, reporting, audit trails
- ML roadmap: multi-model support, optimisation, edge inference, federated learning

---

## 3. Implementation Plan

### Phase 1: Core Improvements (Ongoing)
1. Harden the Jest + React Testing Library stack and cover key services
2. Refactor store boundaries, add persistence, and improve recovery flows
3. Introduce error boundaries, validation, and structured logging
4. Optimise rendering paths, depth-map caching, and add instrumentation

### Phase 2: Feature Enhancements (Planned)
1. Unified measurement sidebar with polyline, area, and volume summaries
2. Project management UX, revision history, and export improvements
3. Automated calibration helpers and better confidence surfacing
4. Incremental rollout of AI-assisted placement and templates

### Phase 3: Advanced Features (Backlog)
1. Collaboration mode with session sharing and comments
2. Enterprise connectors, reporting, and audit compliance
3. ML tuning and optional on-device optimisation

---

## 4. Technical Architecture Improvements
- Consolidate stores and IPC pathways between renderer and Electron main
- Harden depth model lifecycle, cleanup routines, and cache invalidation
- Establish shared validation utilities for calibration and measurements
- Formalise module boundaries (components, hooks, stores, services, utils, types)
- Expand test suites: unit, integration, and Playwright end-to-end

---

## 5. Priority Matrix
| Priority | Theme                | Notes |
|---------|----------------------|-------|
| P0      | Stability             | Crash fixes, data integrity, depth generation
| P1      | Measurement Accuracy  | Calibration, geometry, confidence scoring
| P1      | UX & Accessibility    | Sidebar integration, tool discoverability
| P2      | Collaboration         | Projects, revisions, sharing
| P3      | Advanced ML           | Model tuning, on-device optimisation

---

## 6. Success Metrics
- < 2% crash rate across supported platforms
- Depth map generation success > 95% on valid scenes
- Measurement error < 5% on benchmark locations
- 80% task completion rate in moderated usability tests
- 90th percentile load-to-measure time under 5 seconds

---

## 7. Current Status (October 2025)

### Completed
- Core measurement tools and CSV export
- Depth caching, memory management, and theming
- Initial auto calibration and confidence scoring
- Zustand store architecture and foundational testing

### In Progress
- Measurement sidebar integration and advanced tools polish
- Project workflows with consistent state management
- Calibration UX refinements and viewport-driven adjustments

### Next Priorities
- Repair project persistence and store divergence
- Harden measurement tool data models (area, volume, polyline)
- Remove placeholder text, restore accessibility, and expand docs/tests
