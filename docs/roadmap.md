# Follow-up work after the public repair pass

The completed repair scope and checks are recorded in [REVIEW.md](REVIEW.md). This is a bounded maintenance release after inactivity, not an attempt to recreate confidential commercial functionality. Accuracy was verified privately; public results may vary because custom checkpoints and data remain excluded.

Remaining work should be separately scoped:

- Qualify the public baseline against publishable measured reference scenes and document its error distribution.
- Exercise online Google search/imagery/panorama depth/Solar with configured service access, including failures and changing cameras.
- Complete clean-machine macOS signing/notarization and native Windows/Linux validation.
- Clarify the application license grant (the former README claimed MIT but no standalone LICENSE was supplied).
- Evaluate persistent active-project selection, durable templates, full project import/export and explicit retention controls based on user needs.
- Improve visual consistency and keyboard/screen-reader coverage after the launch, clipping and inaccessible project-control fixes.

Do not restore private checkpoints or data to satisfy these tasks. Maintain a single upstream branch, `main`.
