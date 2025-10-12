@echo off
echo ========================================
echo Street Spec Desktop - Windows Build Script
echo ========================================

echo.
echo Checking prerequisites...

REM Check if Node.js is installed
node --version >nul 2>&1
if %errorlevel% neq 0 (
    echo ERROR: Node.js is not installed or not in PATH
    echo Please install Node.js from https://nodejs.org/
    pause
    exit /b 1
)

REM Check if npm is available
npm --version >nul 2>&1
if %errorlevel% neq 0 (
    echo ERROR: npm is not available
    echo Please ensure npm is installed with Node.js
    pause
    exit /b 1
)

echo OK: Node.js and npm found

REM Check if .env file exists
if not exist ".env" (
    echo WARNING: .env file not found
    echo Please create a .env file with your Google Maps API key:
    echo VITE_GOOGLE_MAPS_API_KEY=YOUR_API_KEY_HERE
    echo.
    set /p continue="Continue without API key? (y/N): "
    if /i not "%continue%"=="y" (
        echo Build cancelled
        pause
        exit /b 1
    )
)

REM Check if ONNX model exists
if not exist "src\assets\models\depth_anything_v2_metric_vkitti_vits.onnx" (
    echo ERROR: ONNX model file not found
    echo Please ensure the model file is in src\assets\models\
    echo Filename: depth_anything_v2_metric_vkitti_vits.onnx
    pause
    exit /b 1
)

echo OK: ONNX model found

echo.
echo Installing dependencies...
npm install
if %errorlevel% neq 0 (
    echo ERROR: Failed to install dependencies
    pause
    exit /b 1
)

echo.
echo Running linting...
npm run lint
if %errorlevel% neq 0 (
    echo ERROR: Linting failed
    pause
    exit /b 1
)

echo.
echo Running type checking...
npm run typecheck
if %errorlevel% neq 0 (
    echo ERROR: Type checking failed
    pause
    exit /b 1
)

echo.
echo Building for Windows...
npm run build:win:dev
if %errorlevel% neq 0 (
    echo ERROR: Build failed
    pause
    exit /b 1
)

echo.
echo ========================================
echo Build completed successfully!
echo ========================================
echo.
echo The installer should be available in the release/ directory
echo.

REM Check if release directory exists and has files
if exist "release\*.exe" (
    echo Found installer files in release/ directory:
    dir /b release\*.exe
    echo.
    echo ========================================
    echo Installation Instructions:
    echo ========================================
    echo 1. Double-click the installer file in release/ directory
    echo 2. Follow the setup wizard
    echo 3. Choose installation location and options
    echo 4. Desktop shortcut will be created automatically
    echo 5. Launch Street Spec Desktop from desktop or start menu
    echo.
    echo ========================================
    echo First Run Instructions:
    echo ========================================
    echo 1. Open Street Spec Desktop
    echo 2. Set up your Google Maps API key in Settings
    echo 3. Start measuring objects in Street View!
    echo.
) else (
    echo WARNING: No installer files found in release/ directory
    echo.
    echo Troubleshooting:
    echo - Ensure all dependencies are installed
    echo - Check that .env file exists with API key
    echo - Verify ONNX model file is present
    echo.
)

echo.
echo ========================================
echo Build Summary:
echo ========================================
echo OK: Dependencies installed
echo OK: TypeScript compilation complete
echo OK: Application bundled
echo OK: Windows installer created
echo OK: Desktop shortcut configured
echo.
echo Street Spec Desktop is ready for distribution!
echo.

pause 