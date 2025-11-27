# Street Spec Desktop - Installation Guide

## System Requirements

### Minimum Requirements
- **Operating System:** Windows 10 (version 1903 or later) or Windows 11
- **Architecture:** x64 (64-bit) only
- **RAM:** 4 GB minimum (8 GB recommended)
- **Storage:** 500 MB free disk space
- **Internet Connection:** Required for Google Maps API access
- **Display:** 1280x720 minimum resolution

### Recommended Requirements
- **Operating System:** Windows 11 (latest update)
- **RAM:** 8 GB or more
- **Storage:** 1 GB free disk space (for cache and projects)
- **Internet Connection:** Broadband connection for Street View imagery
- **Display:** 1920x1080 or higher resolution
- **GPU:** DirectX 11 compatible (optional, for GPU acceleration)

### Required Runtime Dependencies
Street Spec Desktop includes all necessary runtime dependencies bundled with the installer. No additional software installation is required, including:
- ✅ Node.js runtime (bundled)
- ✅ ONNX Runtime (bundled)
- ✅ Visual C++ Redistributables (bundled with Electron)
- ✅ Depth estimation model (bundled)

## Installation Instructions

### Option 1: NSIS Installer (Recommended)

1. **Download the installer**
   - Download `StreetSpec-Desktop-Setup-{version}.exe` from the releases page

2. **Run the installer**
   - Double-click the installer executable
   - If Windows SmartScreen appears, click "More info" → "Run anyway" (if you trust the source)
   - The installer will launch

3. **Follow the installation wizard**
   - Click "Next" on the welcome screen
   - Choose installation directory (default: `C:\Users\<YourUsername>\AppData\Local\Programs\streetspec-desktop`)
   - Select components to install (all are required)
   - Choose whether to create desktop and Start Menu shortcuts
   - Click "Install" to begin installation
   - Wait for installation to complete (typically 30-60 seconds)

4. **Launch the application**
   - Check "Run Street Spec Desktop" to launch immediately after installation
   - Or find "Street Spec Desktop" in your Start Menu

### Option 2: Portable Version

1. **Download the portable executable**
   - Download `StreetSpec-Desktop-Portable-{version}.exe` from the releases page

2. **Extract and run**
   - Extract the portable executable to any folder (e.g., `C:\StreetSpec-Desktop`)
   - Double-click `StreetSpec-Desktop-Portable-{version}.exe` to run
   - No installation required - all files are self-contained

**Note:** Portable version stores settings and cache in the same directory as the executable.

### Option 3: ZIP Archive

1. **Download the ZIP archive**
   - Download `StreetSpec-Desktop-{version}.zip` from the releases page

2. **Extract and run**
   - Extract the ZIP file to any location
   - Navigate to the extracted folder
   - Run `Street Spec Desktop.exe`

## First-Time Setup

After installation, you'll need to configure your Google Maps API key:

1. **Launch Street Spec Desktop**
   - Open the application from Start Menu or desktop shortcut

2. **Access Settings**
   - Click the "Settings" button in the header
   - Or press `Ctrl+,` (if supported)

3. **Enter API Key**
   - Navigate to the "API Configuration" section
   - Enter your Google Maps API key
   - Ensure the API key has the following APIs enabled:
     - Maps JavaScript API
     - Places API
     - Street View Static API
     - Street View Depth API (for depth data)

4. **Save Settings**
   - Click "Save" to apply the changes
   - The application will reload and be ready to use

## Verifying Installation

To verify your installation is complete:

1. **Check installation directory**
   - Default: `C:\Users\<YourUsername>\AppData\Local\Programs\streetspec-desktop`
   - Should contain: `Street Spec Desktop.exe`, `resources/`, `locales/`

2. **Check model files**
   - Navigate to `resources/app.asar.unpacked/assets/models/`
   - Should contain: `depth_anything_v2_metric_vkitti_vits.onnx` (~94 MB)

3. **Launch and test**
   - Launch the application
   - Search for a location (e.g., "Times Square, New York")
   - Click "Generate Depth Map"
   - If depth map generates successfully, installation is complete

## Troubleshooting

### Installer won't run
- **Issue:** Windows SmartScreen blocks the installer
- **Solution:** Click "More info" → "Run anyway" (only if you trust the source)

### "Missing dependencies" error
- **Issue:** Application fails to start with dependency errors
- **Solution:** Reinstall using the NSIS installer (includes all dependencies)

### Model file not found
- **Issue:** "ONNX model not found" error on launch
- **Solution:** 
  1. Verify installation completed successfully
  2. Check `resources/app.asar.unpacked/assets/models/` contains the .onnx file
  3. Reinstall if file is missing

### Application won't start
- **Issue:** Application crashes immediately on launch
- **Solution:**
  1. Check Windows Event Viewer for error details
  2. Ensure Windows 10/11 is up to date
  3. Try running as administrator
  4. Check antivirus isn't blocking the application

### Google Maps not loading
- **Issue:** Map view is blank or shows errors
- **Solution:**
  1. Verify API key is correctly configured in Settings
  2. Check internet connection
  3. Verify API key has required APIs enabled in Google Cloud Console
  4. Check API key quota/billing is active

## Uninstallation

### NSIS Installer Version
1. Open Windows Settings → Apps → Apps & features
2. Search for "Street Spec Desktop"
3. Click "Uninstall"
4. Follow the uninstaller prompts
5. Choose whether to keep user data (projects, settings, cache)

### Portable Version
Simply delete the folder containing the portable executable.

### Manual Cleanup (if needed)
If uninstallation leaves files behind:
1. Delete installation directory: `C:\Users\<YourUsername>\AppData\Local\Programs\streetspec-desktop`
2. Delete user data: `C:\Users\<YourUsername>\AppData\Roaming\streetspec-desktop`
3. Delete cache: `C:\Users\<YourUsername>\AppData\Local\streetspec-desktop`

## Updating

### Automatic Updates (Future)
Automatic updates are planned for a future release. Currently, updates require manual reinstallation.

### Manual Update
1. Download the latest installer
2. Run the installer
3. Choose "Upgrade" when prompted
4. Existing settings and projects will be preserved

## Installation Size

- **Installer size:** ~150-200 MB (compressed)
- **Installed size:** ~400-500 MB (includes models and dependencies)
- **Cache size:** Varies (grows with usage, typically 50-200 MB)

## Support

For installation issues or questions:
- Check the [README.md](./README.md) for general information
- Review [docs/roadmap.md](./docs/roadmap.md) for known issues
- Open an issue on GitHub with installation logs

## License

See the application's license file (if provided) or repository LICENSE file for terms of use.


