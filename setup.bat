@echo off
setlocal
cd /d "%~dp0"
node -e "const [a,b]=process.versions.node.split('.').map(Number);if(a!==22||b<16){console.error('Node 22.16+ (22.x) required');process.exit(1)}"
if errorlevel 1 exit /b 1
git lfs install --local
if errorlevel 1 exit /b 1
git lfs pull
if errorlevel 1 exit /b 1
call npm ci
if errorlevel 1 exit /b 1
if not exist .env copy .env.example .env >nul
call npm run validate
if errorlevel 1 exit /b 1
call npm run build:vite
if errorlevel 1 exit /b 1
echo Setup complete. Configure your API key in Settings. Run npm run dev to launch.
