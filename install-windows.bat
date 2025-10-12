@echo off
setlocal enabledelayedexpansion

echo ========================================
echo Street Spec Desktop - Complete Installer
echo ========================================
echo.
echo This installer will:
echo 1. Install all prerequisites (Node.js, Git, Git LFS)
echo 2. Set up the Street Spec Desktop application
echo 3. Create desktop and start menu shortcuts
echo 4. Launch the application
echo.

REM Check if running as administrator
net session >nul 2>&1
if %errorLevel% == 0 (
    echo Administrator privileges detected.
) else (
    echo Requesting administrator privileges...
    powershell "start-process '%~f0' -verb runas"
    exit
)

REM Check if Node.js is installed
echo Checking prerequisites...
node --version >nul 2>&1
if %errorlevel% neq 0 (
    echo Installing Node.js...
    echo Downloading Node.js installer...
    powershell -Command "Invoke-WebRequest -Uri 'https://nodejs.org/dist/v18.19.0/node-v18.19.0-x64.msi' -OutFile 'nodejs.msi'"
    if %errorlevel% neq 0 (
        echo ERROR: Failed to download Node.js
        echo Please install Node.js manually from https://nodejs.org/
        pause
        exit /b 1
    )

    echo Installing Node.js...
    msiexec /i nodejs.msi /quiet
    if %errorlevel% neq 0 (
        echo ERROR: Failed to install Node.js
        pause
        exit /b 1
    )

    del nodejs.msi
    echo ✓ Node.js installed
) else (
    echo ✓ Node.js found
)

REM Check if Git is installed
git --version >nul 2>&1
if %errorlevel% neq 0 (
    echo Installing Git...
    echo Downloading Git installer...
    powershell -Command "Invoke-WebRequest -Uri 'https://github.com/git-for-windows/git/releases/download/v2.43.0.windows.1/Git-2.43.0-64-bit.exe' -OutFile 'git.exe'"
    if %errorlevel% neq 0 (
        echo ERROR: Failed to download Git
        echo Please install Git manually from https://git-scm.com/
        pause
        exit /b 1
    )

    echo Installing Git...
    git.exe /VERYSILENT /NORESTART
    if %errorlevel% neq 0 (
        echo ERROR: Failed to install Git
        pause
        exit /b 1
    )

    del git.exe
    echo ✓ Git installed
) else (
    echo ✓ Git found
)

REM Check if Git LFS is installed
git lfs version >nul 2>&1
if %errorlevel% neq 0 (
    echo Installing Git LFS...
    git lfs install
    if %errorlevel% neq 0 (
        echo WARNING: Git LFS installation failed, but continuing...
    ) else (
        echo ✓ Git LFS installed
    )
) else (
    echo ✓ Git LFS found
)

REM Create application directory if it doesn't exist
if not exist "Street-Spec-Desktop" (
    mkdir "Street-Spec-Desktop"
    echo Created Street-Spec-Desktop directory
)

cd "Street-Spec-Desktop"

REM Check if package.json exists (indicating app is already set up)
if exist "package.json" (
    echo Application files found, skipping download...
) else (
    echo Downloading Street Spec Desktop...
    echo This may take a few minutes...
    powershell -Command "Invoke-WebRequest -Uri 'https://github.com/lukifer23/Street-Spec-Desktop/archive/refs/heads/main.zip' -OutFile 'streetspec.zip'"
    if %errorlevel% neq 0 (
        echo ERROR: Failed to download Street Spec Desktop
        echo Please check your internet connection and try again
        pause
        exit /b 1
    )

    echo Extracting files...
    powershell -Command "Expand-Archive -Path 'streetspec.zip' -DestinationPath '.' -Force"
    if %errorlevel% neq 0 (
        echo ERROR: Failed to extract files
        pause
        exit /b 1
    )

    REM Move files from subdirectory to current directory
    for /d %%i in (*) do (
        if exist "%%i\package.json" (
            xcopy "%%i\*" . /e /y >nul
            rmdir "%%i" /s /q >nul
        )
    )

    del streetspec.zip
    echo ✓ Street Spec Desktop downloaded and extracted
)

REM Install dependencies
echo Installing dependencies...
npm install
if %errorlevel% neq 0 (
    echo ERROR: Failed to install dependencies
    echo Please check your internet connection and try again
    pause
    exit /b 1
)

echo ✓ Dependencies installed

REM Download model files
echo Downloading model files...
git lfs pull
if %errorlevel% neq 0 (
    echo WARNING: Failed to download model files automatically
    echo You can download them manually from:
    echo https://huggingface.co/depth-anything/Depth-Anything-V2-Metric-VKITTI-Small
    echo.
) else (
    echo ✓ Model files downloaded
)

REM Create .env file if it doesn't exist
if not exist ".env" (
    echo.
    echo Creating .env file...
    echo Please enter your Google Maps API key:
    echo (You can get one from https://console.cloud.google.com/)
    echo.
    set /p api_key="Enter your Google Maps API key: "
    if not "!api_key!"=="" (
        echo VITE_GOOGLE_MAPS_API_KEY=!api_key! > .env
        echo GOOGLE_MAPS_API_KEY=!api_key! >> .env
        echo ✓ .env file created
    ) else (
        echo WARNING: No API key provided
        echo You can add it later by editing the .env file
        echo VITE_GOOGLE_MAPS_API_KEY=YOUR_API_KEY_HERE > .env
        echo GOOGLE_MAPS_API_KEY=YOUR_API_KEY_HERE >> .env
    )
) else (
    echo ✓ .env file found
)

REM Run quality checks
echo.
echo Running code quality checks...
npm run lint
if %errorlevel% neq 0 (
    echo WARNING: Linting found issues
    echo You can fix them later by running: npm run lint
) else (
    echo ✓ Code quality check passed
)

npm run typecheck
if %errorlevel% neq 0 (
    echo WARNING: Type checking found issues
    echo You can fix them later by running: npm run typecheck
) else (
    echo ✓ Type checking passed
)

echo.
echo ========================================
echo Installation completed successfully!
echo ========================================
echo.
echo Creating shortcuts...

REM Create desktop shortcut
powershell -Command "
$WshShell = New-Object -comObject WScript.Shell
$Shortcut = $WshShell.CreateShortcut([Environment]::GetFolderPath('Desktop') + '\Street Spec Desktop.lnk')
$Shortcut.TargetPath = '%CD%\dist\win-unpacked\Street Spec Desktop.exe'
$Shortcut.WorkingDirectory = '%CD%'
$Shortcut.IconLocation = '%CD%\dist\win-unpacked\Street Spec Desktop.exe,0'
$Shortcut.Description = 'Street Spec Desktop - Measure objects in Google Street View'
$Shortcut.Save()
"
if %errorlevel% neq 0 (
    echo WARNING: Failed to create desktop shortcut
) else (
    echo ✓ Desktop shortcut created
)

REM Create start menu shortcut
powershell -Command "
$WshShell = New-Object -comObject WScript.Shell
$Shortcut = $WshShell.CreateShortcut([Environment]::GetFolderPath('StartMenu') + '\Programs\Street Spec Desktop.lnk')
$Shortcut.TargetPath = '%CD%\dist\win-unpacked\Street Spec Desktop.exe'
$Shortcut.WorkingDirectory = '%CD%'
$Shortcut.IconLocation = '%CD%\dist\win-unpacked\Street Spec Desktop.exe,0'
$Shortcut.Description = 'Street Spec Desktop - Measure objects in Google Street View'
$Shortcut.Save()
"
if %errorlevel% neq 0 (
    echo WARNING: Failed to create start menu shortcut
) else (
    echo ✓ Start menu shortcut created
)

echo.
echo Starting Street Spec Desktop...
echo.
echo If the app doesn't start, you can:
echo 1. Double-click the desktop shortcut
echo 2. Run: npm run dev
echo 3. Build for production: npm run build:win
echo.

REM Start the application
npm run dev

echo.
echo Application closed.
pause
