import { app, BrowserWindow, shell, ipcMain, dialog } from 'electron'
import { release } from 'node:os'
import { join, dirname } from 'node:path' // Use dirname instead of resolve for this pattern
import fetch from 'node-fetch'
// Removed pako import as getRawDepthData was removed
// Removed import.meta.url logic as we are compiling to CommonJS
// import { fileURLToPath } from 'node:url' 
// Removed onnxruntime-node static import
// import ort from 'onnxruntime-node'
import sharp from 'sharp'
// Removed require and type import for electron-store
// import type { default as ElectronStoreType } from 'electron-store';
// const ElectronStore = require('electron-store');

// --- Type Imports (Use import type for type checking only) ---
import type { default as ElectronStoreType } from 'electron-store';
import type * as ORTType from 'onnxruntime-node'; // Import ORT types

// Define the structure of our persistent storage
interface StorageSchema {
  measurements: unknown[]; // Use unknown[] or import/define a shared Measurement type
  // settings?: { preferredUnits: string; fovOverride: number | null };
}

// Declare store and ort variables, initialize within whenReady
let store: ElectronStoreType<StorageSchema> | null = null;
let ort: typeof ORTType | null = null;

// ESM equivalent for __dirname -> Removed, use standard __dirname
// const __filename = fileURLToPath(import.meta.url);
// const __dirname = dirname(__filename);

console.log(`[Main Process] Standard __dirname: ${__dirname}`); // Log standard path

// The built directory structure
//
// ├── dist-electron
// │   ├── main.cjs
// │   ├── preload.cjs
// │   └── ...other-support-files
// ├── dist (frontend build)
// │   ├── index.html
// │   ├── assets
// │   └── ...other-static-files
// ├── public
// │   └── vite.svg (example)
// └──

// Disable GPU Acceleration for Windows 7
if (release().startsWith('6.1')) app.disableHardwareAcceleration()

// Set application name for Windows 10+ notifications
if (process.platform === 'win32') app.setAppUserModelId(app.getName())

if (!app.requestSingleInstanceLock()) {
  app.quit()
  process.exit(0)
}

// === Helper Function for Depth Data ===
// Removed getRawDepthData function (lines 42-99) as it relied on unstable internal APIs
// and was not used by the primary ONNX inference workflow.

// === End Helper Function ===

let win: BrowserWindow | null = null
// Calculate the path to the compiled preload script (now .cjs)
const preloadScriptPath = join(__dirname, 'preload.cjs'); // <--- Changed to preload.cjs
console.log(`[Main Process] Preload script path for webPreferences: ${preloadScriptPath}`); // Log calculated path

// Determine the correct path for index.html
// In dev, vite-plugin-electron sets VITE_DEV_SERVER_URL.
// In prod, index.html is in the 'dist' folder adjacent to 'dist-electron'.
const devServerUrl = process.env.VITE_DEV_SERVER_URL; // Get the potential URL from vite-plugin-electron
const indexHtmlPath = join(__dirname, '../dist/index.html'); // Path to index.html relative to main.cjs

console.log(`[Main Process] Is app packaged? ${app.isPackaged}`);
console.log(`[Main Process] VITE_DEV_SERVER_URL: ${devServerUrl}`);
console.log(`[Main Process] index.html path: ${indexHtmlPath}`);

// --- Global ONNX Session ---
let depthSession: ORTType.InferenceSession | null = null;
// Match the preprocessor config size of 518x518
const modelInputShape = [1, 3, 518, 518];

// Determine the correct path for the ONNX model
const modelFilename = 'depth_anything.onnx';
const modelPath = app.isPackaged
  ? join(process.resourcesPath, 'assets', 'models', 'onnx_model', modelFilename) // Path in packaged app
  : join(app.getAppPath(), 'src', 'assets', 'models', 'onnx_model', modelFilename); // Path relative to project root in dev

// Updated to use dynamically imported ort
async function loadModel() {
  if (!ort) {
      console.error("[Main Process] ONNX Runtime not loaded. Cannot load model.");
      return;
  }
  try {
    console.log(`[Main Process] Loading ONNX model from: ${modelPath}`);
    // Ensure GPU is preferred if available (optional, adjust provider as needed)
    // const options: ort.InferenceSession.SessionOptions = { executionProviders: ['cuda', 'cpu'] };
    depthSession = await ort.InferenceSession.create(modelPath); // Use dynamically loaded ort
    console.log('[Main Process] ONNX Depth Model loaded successfully.');
    // Log input/output names - useful for debugging
    console.log('[Main Process] Model Input Names:', depthSession.inputNames);
    console.log('[Main Process] Model Output Names:', depthSession.outputNames);
  } catch (error) {
    console.error("[Main Process] Error loading ONNX model:", error);
    depthSession = null;
    // Optionally notify the renderer process of the failure
    win?.webContents.send('model-load-error', error instanceof Error ? error.message : String(error));
  }
}
// --- End ONNX Setup ---

async function createWindow() {
  // Define icon path based on packaging status
  const iconPath = app.isPackaged
    ? join(process.resourcesPath, 'public/vite.svg') // Assuming icon is copied to public in resources
    : join(__dirname, '../public/vite.svg'); // Path relative to __dirname (dist-electron) in dev

  console.log(`[Main Process] Using icon path: ${iconPath}`);

  win = new BrowserWindow({
    title: 'PoleCheck Desktop',
    icon: iconPath,
    width: 1200,
    height: 800,
    webPreferences: {
      preload: preloadScriptPath, // Use the calculated variable
      nodeIntegration: false, // Keep false for security
      contextIsolation: true, // Keep true for security
    },
  })

  if (devServerUrl && !app.isPackaged) {
    // Development mode: Load from Vite Dev Server
    console.log(`[Main Process] Loading DEV URL: ${devServerUrl}`);
    await win.loadURL(devServerUrl);
    // Open dev tools automatically in development
    win.webContents.openDevTools();
  } else {
    // Production mode: Load the built index.html file
    console.log(`[Main Process] Loading FILE: ${indexHtmlPath}`);
    try {
      await win.loadFile(indexHtmlPath);
    } catch (error) {
       console.error(`[Main Process] Failed to load file '${indexHtmlPath}':`, error);
       // Optionally provide more feedback to the user or quit
    }
    // Optional: Open DevTools in prod build ONLY if needed for debugging
    // if (!app.isPackaged) { win.webContents.openDevTools(); }
  }

  // Test actively push message to the Electron-Renderer
  win.webContents.on('did-finish-load', () => {
    console.log('[Main Process] WebContents did-finish-load event triggered.'); // Added log
    win?.webContents.send('main-process-message', new Date().toLocaleString())
  })

  // Make all links open with the browser, not with the application
  win.webContents.setWindowOpenHandler(({ url: targetUrl }) => {
    if (targetUrl.startsWith('https:')) shell.openExternal(targetUrl)
    return { action: 'deny' }
  })

  // === IPC Handler for Measurement Storage ===
  ipcMain.handle('load-measurements', async () => {
    if (!store) {
        console.error("[Main Process] Store not initialized. Cannot load measurements.");
        return [];
    }
    try {
      // Cast to any to resolve linter error
      const measurements: unknown[] = (store as any).get('measurements', []); 
      console.log(`[Main Process] Loaded ${measurements.length} measurements from store.`);
      return measurements;
    } catch (error) {
      console.error("[Main Process] Error loading measurements from store:", error);
      return []; // Return empty array on error
    }
  });

  ipcMain.handle('save-measurements', async (event, measurements: unknown[]) => {
    if (!store) {
        console.error("[Main Process] Store not initialized. Cannot save measurements.");
        return false;
    }
    try {
      // Cast to any to resolve linter error
      (store as any).set('measurements', measurements);
      console.log(`[Main Process] Saved ${measurements.length} measurements to store.`);
      return true; // Indicate success
    } catch (error) {
      console.error("[Main Process] Error saving measurements to store:", error);
      return false; // Indicate failure
    }
  });
  // === End Measurement Storage Handlers ===

  // === Generalized IPC Handler for File Export ===
  ipcMain.handle('export-file', async (event, args: { content: string; type: 'csv' | 'geojson' | 'kml' }) => {
      const { content, type } = args;
      console.log(`[Main Process] Received request to export ${type.toUpperCase()} data.`);
      const activeWindow = BrowserWindow.getFocusedWindow(); // Get the currently focused window

      if (!activeWindow) { // Check if a window is available and focused
          console.error(`[Main Process] Cannot export ${type.toUpperCase()}: No active window available.`);
          dialog.showErrorBox("Export Error", "Cannot perform export: No application window is focused.");
          return null; // Indicate failure
      }

      let defaultFilename = `polecheck-export-${Date.now()}.${type}`;
      let fileFilter = { name: `${type.toUpperCase()} Files`, extensions: [type] };

      try {
          const { canceled, filePath } = await dialog.showSaveDialog(activeWindow, { // Use activeWindow
              title: `Export Data as ${type.toUpperCase()}`,
              defaultPath: defaultFilename,
              filters: [
                  fileFilter,
                  { name: 'All Files', extensions: ['*'] }
              ]
          });

          if (canceled || !filePath) {
              console.log(`[Main Process] ${type.toUpperCase()} export save dialog cancelled.`);
              return null; // Indicate cancellation
          }

          // Use Node.js fs module to write the file
          const fs = await import('node:fs/promises'); // Use async import for promises
          await fs.writeFile(filePath, content, 'utf8');
          console.log(`[Main Process] Successfully wrote ${type.toUpperCase()} to: ${filePath}`);
          return filePath; // Return the path on success

      } catch (error) {
          console.error(`[Main Process] Error exporting ${type.toUpperCase()}:`, error);
          dialog.showErrorBox("Export Error", `Failed to save ${type.toUpperCase()} file: ${error instanceof Error ? error.message : String(error)}`);
          return null; // Indicate failure
      }
  });
  // === End Export Handler ===

  // --- NEW IPC Handler for Depth Inference ---
  ipcMain.handle('infer-depth', async (event, imageDataUrl: string) => {
    if (!depthSession || !ort) { // Also check if ort is loaded
      console.error('[Main Process] Depth model or ONNX runtime not loaded, cannot infer.');
      // Optionally notify renderer:
      // event.sender.send('inference-error', 'Model or runtime not ready.');
      return null;
    }
    console.log('[Main Process] Received request for depth inference.');
    try {
      // 1. Decode Base64 Image Data URL
      const base64Data = imageDataUrl.split(',')[1];
      if (!base64Data) throw new Error('Invalid Image Data URL format');
      const imageBuffer = Buffer.from(base64Data, 'base64');

      // --- Start Preprocessing Timer ---
      console.time('Sharp Preprocessing');

      // 2. Preprocess Image using Sharp
      const image = sharp(imageBuffer);
      const metadata = await image.metadata();
      console.log(`[Main Process] Original image size: ${metadata.width}x${metadata.height}, Channels: ${metadata.channels}`); // Log channels

      const inputWidth = modelInputShape[3];
      const inputHeight = modelInputShape[2];

      // Explicitly check if alpha channel needs removal
      let sharpPipeline = image;
      if (metadata.hasAlpha) {
          console.log('[Main Process] Image has alpha channel, removing it.');
          sharpPipeline = sharpPipeline.removeAlpha();
      }

      // Resize, convert to RGB if necessary, extract raw pixel data
      const resizedImageBuffer = await sharpPipeline
          .resize(inputWidth, inputHeight, {
              fit: 'fill', // Use 'fill' to match exact dimensions
              // kernel: sharp.kernel.mitchell // Optional: specify kernel
          })
          .raw() // Get raw pixel buffer
          .toBuffer();

      // --- End Preprocessing Timer ---
      console.timeEnd('Sharp Preprocessing');

      // 3. Normalize and Prepare Tensor
      const float32Data = new Float32Array(inputWidth * inputHeight * 3);
      // Normalize RGB values (0-255) to Float32 (0-1) and arrange in C, H, W format
      for (let i = 0; i < inputHeight * inputWidth; i++) {
          float32Data[i] = resizedImageBuffer[i * 3] / 255.0;           // R channel
          float32Data[i + inputHeight * inputWidth] = resizedImageBuffer[i * 3 + 1] / 255.0; // G channel
          float32Data[i + 2 * inputHeight * inputWidth] = resizedImageBuffer[i * 3 + 2] / 255.0; // B channel
      }

      const inputTensor = new ort.Tensor('float32', float32Data, modelInputShape); // Use dynamically loaded ort

      // --- Start Inference Timer ---
      console.time('ONNX Inference');

      // 4. Run Inference
      const results = await depthSession.run({ [depthSession.inputNames[0]]: inputTensor });

      // --- End Inference Timer ---
      console.timeEnd('ONNX Inference');

      // 5. Process Output (adjust based on actual model output)
      const outputTensor = results[depthSession.outputNames[0]];
      console.log('[Main Process] Inference successful. Output tensor dims:', outputTensor.dims);
      // Example: Assuming output is [1, 1, height, width] depth map
      // Convert tensor data to a usable format (e.g., Array or Float32Array)
      const depthData = outputTensor.data as Float32Array; // Adjust type if needed
      // Correctly parse 3D output tensor [Batch, Height, Width]
      const [batch, height, width] = outputTensor.dims;

      // Find min/max for normalization visualization (optional but helpful)
      let minVal = Infinity;
      let maxVal = -Infinity;
      for (let i = 0; i < depthData.length; i++) {
          if (depthData[i] < minVal) minVal = depthData[i];
          if (depthData[i] > maxVal) maxVal = depthData[i];
      }
      console.log(`[Main Process] Depth map range: ${minVal} to ${maxVal}`);

      // Normalize depth data to 0-255 grayscale for visualization
      const normalizedDepth = new Uint8Array(width * height);
      const range = maxVal - minVal;
      if (range > 0) { // Avoid division by zero if map is flat
          for (let i = 0; i < depthData.length; i++) {
              normalizedDepth[i] = ((depthData[i] - minVal) / range) * 255;
          }
      } else {
          // Handle flat depth map (e.g., set all to mid-gray)
          normalizedDepth.fill(128);
      }

      // --- Add Debugging Logs ---
      console.log(`[Main Process] Normalized depth array length: ${normalizedDepth.length}`);
      console.log(`[Main Process] Normalized depth sample (first 10): ${normalizedDepth.slice(0, 10)}`);
      // Cast channels to the literal type expected by SharpOptions
      const sharpOptions = { raw: { width: width, height: height, channels: 1 as 1 } }; 
      console.log(`[Main Process] Raw options for sharp:`, sharpOptions);
      // --- End Debugging Logs ---

       // 6. Convert normalized depth map to PNG Data URL using Sharp
       try {
           const pngBuffer = await sharp(normalizedDepth, sharpOptions)
               .toFormat('png')
               .toBuffer();
           const pngDataUrl = `data:image/png;base64,${pngBuffer.toString('base64')}`;
           console.log('[Main Process] Depth inference complete, returning PNG data URL.');
           // Return an object with both PNG and raw data
           return {
               pngDataUrl: pngDataUrl,
               depthData: Array.from(depthData), // Convert Float32Array to plain array for IPC
               width: width,
               height: height
           };
       } catch (sharpError) {
           console.error("[Main Process] Error during sharp PNG conversion:", sharpError);
           // Add more detail about the input to sharp in case of error
           console.error(`[Main Process] Sharp input details: length=${normalizedDepth.length}, width=${width}, height=${height}, channels=1`);
           throw sharpError; // Re-throw to be caught by the outer try-catch
       }

    } catch (error) {
      console.error('[Main Process] Error during depth inference:', error);
      // Optionally notify the renderer process of the error
      win?.webContents.send('inference-error', error instanceof Error ? error.message : String(error));
      return null;
    }
  });
  // --- End Depth Inference Handler ---

  win.on('closed', () => {
    win = null
  })
}

async function initializeApp() {
  try {
    console.log('[Main Process] Dynamically importing electron-store...');
    // Use eval to prevent TS from potentially converting dynamic import to require()
    const ElectronStoreModule = await eval('import("electron-store")'); 
    const ElectronStore = ElectronStoreModule.default as typeof ElectronStoreType; // Cast to imported type
    store = new ElectronStore<StorageSchema>({
        // Define schema or defaults if needed
        // schema: { measurements: { type: 'array', default: [] } },
        defaults: { measurements: [] } // Provide default empty array
    });
    console.log('[Main Process] electron-store initialized successfully.');
  } catch (error) {
      console.error('[Main Process] Failed to initialize electron-store:', error);
      // Handle error appropriately, maybe quit or show dialog
      dialog.showErrorBox('Initialization Error', 'Failed to load required storage module. The application might not save data.');
  }

  try {
      console.log('[Main Process] Dynamically importing onnxruntime-node...');
      ort = await import('onnxruntime-node');
      console.log('[Main Process] onnxruntime-node imported successfully.');
      await loadModel(); // Load model after ORT is ready
  } catch (error) {
      console.error('[Main Process] Failed to dynamically import or load ONNX runtime/model:', error);
      dialog.showErrorBox('Initialization Error', 'Failed to load the depth inference engine. Depth features will be unavailable.');
      ort = null; // Ensure ort is null if import failed
      depthSession = null;
  }

  // Create the main window *after* essential modules are loaded
  await createWindow();
}

app.whenReady().then(initializeApp); // <--- Call initializeApp when ready

// Quit when all windows are closed, except on macOS. There, it's common
// for applications and their menu bar to stay active until the user quits
// explicitly with Cmd + Q.
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
  win = null // Clear window reference
})

app.on('second-instance', () => {
  if (win) {
    // Focus on the main window if the user tried to open another
    if (win.isMinimized()) win.restore()
    win.focus()
  }
})

app.on('activate', () => {
  const allWindows = BrowserWindow.getAllWindows()
  if (allWindows.length) {
    allWindows[0].focus()
  } else {
    // Only call createWindow if essential modules are loaded
    // Since initializeApp handles this, we might just call it again,
    // or rely on the initial whenReady call.
    // For simplicity, let's assume if activate is hit and no windows exist,
    // we should re-initialize.
    initializeApp();
  }
}) 