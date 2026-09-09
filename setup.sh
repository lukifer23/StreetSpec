#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"
command -v node >/dev/null || { echo 'Install Node.js 22.16 or newer in the 22.x series.'; exit 1; }
node -e 'const [major,minor]=process.versions.node.split(".").map(Number); if(major!==22 || minor<16) { console.error("Node 22.16+ (22.x) is required; use .nvmrc."); process.exit(1); }'
command -v git-lfs >/dev/null || { echo 'Install Git LFS before setup.'; exit 1; }
git lfs install --local
git lfs pull
npm ci
if [ ! -f .env ]; then
  umask 077
  cp .env.example .env
fi
npm run validate
npm run build:vite
printf '\nSetup complete. Configure your API key in Settings. Run npm run dev to launch.\n'
