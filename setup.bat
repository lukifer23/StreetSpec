@echo off
echo ========================================
echo PoleCheck Desktop - Auto Setup Script
echo ========================================
echo.
echo This script will automatically set up PoleCheck Desktop
echo for development and launch the application.
echo.

REM Check if Node.js is installed
echo Checking prerequisites...
node --version >nul 2>&1
if %errorlevel% neq 0 (
    echo ERROR: Node.js is not installed
    echo Please install Node.js from https://nodejs.org/
    echo Then run this script again.
    echo.
    pause
    exit /b 1
)

echo ✓ Node.js found

REM Check if npm is available
npm --version >nul 2>&1
if %errorlevel% neq 0 (
    echo ERROR: npm is not available
    echo Please ensure npm is installed with Node.js
    pause
    exit /b 1
)

echo ✓ npm found

REM Check if Git is installed
git --version >nul 2>&1
if %errorlevel% neq 0 (
    echo ERROR: Git is not installed
    echo Please install Git from https://git-scm.com/
    echo Then run this script again.
    echo.
    pause
    exit /b 1
)

echo ✓ Git found

REM Check if Git LFS is installed
git lfs version >nul 2>&1
if %errorlevel% neq 0 (
    echo WARNING: Git LFS is not installed
    echo Installing Git LFS...
    git lfs install
    if %errorlevel% neq 0 (
        echo ERROR: Failed to install Git LFS
        echo Please install Git LFS manually from https://git-lfs.com/
        pause
        exit /b 1
    )
)

echo ✓ Git LFS ready

echo.
echo Installing dependencies...
npm install
if %errorlevel% neq 0 (
    echo ERROR: Failed to install dependencies
    pause
    exit /b 1
)

echo ✓ Dependencies installed

echo.
echo Downloading model files...
git lfs pull
if %errorlevel% neq 0 (
    echo WARNING: Failed to download model files automatically
    echo You may need to download them manually from:
    echo https://huggingface.co/depth-anything/Depth-Anything-V2-Metric-VKITTI-Small
    echo.
    set /p continue="Continue without models? (y/N): "
    if /i not "%continue%"=="y" (
        echo Setup cancelled
        pause
        exit /b 1
    )
) else (
    echo ✓ Model files downloaded
)

REM Check if .env file exists
if not exist ".env" (
    echo.
    echo Creating .env file...
    echo Please enter your Google Maps API key:
    echo (You can get one from https://console.cloud.google.com/)
    echo.
    set /p api_key="Enter your Google Maps API key: "
    if not "%api_key%"=="" (
        echo VITE_GOOGLE_MAPS_API_KEY=%api_key% > .env
        echo ✓ .env file created
    ) else (
        echo WARNING: No API key provided
        echo You can add it later by editing the .env file
        echo VITE_GOOGLE_MAPS_API_KEY=YOUR_API_KEY_HERE > .env
    )
) else (
    echo ✓ .env file found
)

echo.
echo Running linting check...
npm run lint
if %errorlevel% neq 0 (
    echo WARNING: Linting found issues
    echo You can fix them later by running: npm run lint
) else (
    echo ✓ Code quality check passed
)

echo.
echo Running type checking...
npm run typecheck
if %errorlevel% neq 0 (
    echo WARNING: Type checking found issues
    echo You can fix them later by running: npm run typecheck
) else (
    echo ✓ Type checking passed
)

echo.
echo ========================================
echo Setup completed successfully!
echo ========================================
echo.
echo Starting PoleCheck Desktop...
echo.
echo If the app doesn't start automatically, you can run:
echo npm run dev
echo.
echo To build for production:
echo npm run build:win
echo.

REM Start the application
npm run dev

echo.
echo Application closed.
pause 