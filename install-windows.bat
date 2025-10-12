@echo off
setlocal enabledelayedexpansion

echo ========================================
echo Street Spec Desktop - Windows Installer
echo ========================================
echo.
echo This script will build and launch the Street Spec Desktop installer.
echo Run it from the repository root on a Windows machine.
echo.

REM Verify project root
if not exist "package.json" (
    echo ERROR: package.json not found. Please run this script from the Street Spec Desktop project root.
    pause
    exit /b 1
)

REM Check for administrator privileges (required for the final installer stage)
net session >nul 2>&1
if %errorLevel% neq 0 (
    echo Requesting administrator privileges...
    powershell -Command "Start-Process '%~f0' -Verb RunAs"
    exit /b 0
)

REM Check prerequisites
echo Checking prerequisites...
node --version >nul 2>&1
if %errorLevel% neq 0 (
    echo ERROR: Node.js is not installed. Install it from https://nodejs.org/ and rerun this script.
    pause
    exit /b 1
)

npm --version >nul 2>&1
if %errorLevel% neq 0 (
    echo ERROR: npm is not available. Ensure Node.js is installed correctly.
    pause
    exit /b 1
)

git --version >nul 2>&1
if %errorLevel% neq 0 (
    echo ERROR: Git is not installed. Install it from https://git-scm.com/ and rerun this script.
    pause
    exit /b 1
)

git lfs version >nul 2>&1
if %errorLevel% neq 0 (
    echo Git LFS not detected. Installing...
    git lfs install
    if %errorLevel% neq 0 (
        echo WARNING: Git LFS installation failed. Depth models may not download automatically.
    )
)

echo.
echo Installing npm dependencies...
npm install
if %errorLevel% neq 0 (
    echo ERROR: npm install failed. Check the output for details.
    pause
    exit /b 1
)

echo.
echo Downloading model assets via Git LFS...
git lfs pull
if %errorLevel% neq 0 (
    echo WARNING: Git LFS pull failed. Models may need to be downloaded manually.
)

echo.
echo Building signed installer with electron-builder...
npm run build:win
if %errorLevel% neq 0 (
    echo ERROR: Installer build failed.
    pause
    exit /b 1
)

REM Locate the most recent installer package
set "INSTALLER="
for /f "delims= tokens=*" %%I in ('dir /b /a:-d /o:-n "release\Street-Spec-Desktop-Setup-*.exe"') do (
    set "INSTALLER=%%I"
    goto :FoundInstaller
)

:FoundInstaller
if not defined INSTALLER (
    echo ERROR: No installer executable found in the release directory.
    pause
    exit /b 1
)

echo.
echo Launching installer: %INSTALLER%
start "" "release\%INSTALLER%"
echo.
echo The installer has been launched in a new window. Follow the setup prompts to finish installation.
pause
