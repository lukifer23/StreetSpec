# Contributing

Read [README.md](README.md) and [the public-release boundary](docs/PUBLIC_RELEASE.md) first. The project was sold, its disclosure NDAs have expired, and confidential tuned checkpoints/data remain excluded. Do not attach customer data, API keys, private imagery or proprietary model assets to issues or commits.

Use Node 22.16+ in the 22.x series, Git LFS and `npm ci`. Make focused root-cause repairs with no placeholder product behavior. Use synthetic inputs only where they meaningfully test mathematical invariants; label them as synthetic. Native runtime checks must execute the real application/model. Unit-test doubles are not evidence of external-service or field accuracy.

Run `npm run validate`, `npm run test:e2e` for affected desktop paths, and `npm run build` for packaging changes. Record what was actually tested and any external gates. Update the README and relevant docs with the final behavior.

The upstream repository maintains **only `main`**. Coordinate direct maintainer changes on main; outside contributors may propose changes from their own forks. Do not create long-lived upstream feature or dependency-bot branches. Dependency alerts remain enabled and require review; automatic security-update branches are disabled.

For reports, include reproduction steps, platform, version and sanitized logs. Follow the licensing status described in the README; this guide does not supply a missing application license or grant rights to excluded assets.
