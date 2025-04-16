import { app, BrowserWindow, shell, ipcMain, dialog } from 'electron'
import { release } from 'node:os'
import { join, dirname } from 'node:path' // Use dirname instead of resolve for this pattern
import fetch from 'node-fetch'
// Removed pako import as getRawDepthData was removed
// Removed import.meta.url logic as we are compiling to CommonJS
import { fileURLToPath } from 'url'
// Removed onnxruntime-node static import
// import ort from 'onnxruntime-node'
import sharp from 'sharp'
// Removed require and type import for electron-store
// import type { default as ElectronStoreType } from 'electron-store';
// const ElectronStore = require('electron-store');
import * as path from 'path';
// import type { default as ElectronStoreType } from 'electron-store'; // Temporarily remove type import
import type * as ORTType from 'onnxruntime-node'; // Import ORT types
import type { default as ElectronStoreType } from 'electron-store'; // Restore type import
// Use require for CJS version of electron-store
// eslint-disable-next-line @typescript-eslint/no-var-requires
const ElectronStore = require('electron-store'); 

// Define a schema (optional but good practice)
interface StorageSchema {
  measurements: unknown[]; // Define specific type if possible
  calibrationFactors: number[]; // Store multiple factors
}

let store: ElectronStoreType<StorageSchema>;
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

// --- Global ONNX Sessions ---
let depthSession: ORTType.InferenceSession | null = null;
let segmentationSession: ORTType.InferenceSession | null = null; // Add session for segmentation

// Input shape for Depth Anything model
const depthModelInputShape = [1, 3, 518, 518]; // Keep original depth shape
// Input shape for Segformer B0 - Typically 1024x1024, but verify based on specific model conversion
// Let's assume 518x518 for now, same as depth, for simpler preprocessing
// **IMPORTANT**: If segformer expects 1024x1024, preprocessing needs adjustment!
const segmentationModelInputShape = [1, 3, 518, 518]; 

// Paths for ONNX models
const depthModelFilename = 'depth_anything.onnx';
const segmentationModelFilename = 'segformer_b0_cityscapes_1024_corm.onnx'; // Use the correct filename

const baseModelPath = app.isPackaged 
  ? join(process.resourcesPath, 'assets', 'models', 'onnx_model') 
  : join(app.getAppPath(), 'src', 'assets', 'models', 'onnx_model');

const depthModelPath = join(baseModelPath, depthModelFilename);
const segmentationModelPath = join(baseModelPath, 'segformer_onnx_model', segmentationModelFilename); // Correct subdirectory

// Function to load both models
async function loadModels() {
  if (!ort) {
    console.error("[Main Process] ONNX Runtime not loaded. Cannot load models.");
    return;
  }

  // Load Depth Model
  try {
    console.log(`[Main Process] Loading Depth model from: ${depthModelPath}`);
    depthSession = await ort.InferenceSession.create(depthModelPath); 
    console.log('[Main Process] ONNX Depth Model loaded successfully.');
    console.log('[Main Process] Depth Model Inputs:', depthSession.inputNames);
    console.log('[Main Process] Depth Model Outputs:', depthSession.outputNames);
  } catch (error) {
    console.error("[Main Process] Error loading Depth model:", error);
    depthSession = null;
    win?.webContents.send('model-load-error', `Depth Model Load Error: ${error instanceof Error ? error.message : String(error)}`);
  }

  // Load Segmentation Model
  try {
    console.log(`[Main Process] Loading Segmentation model from: ${segmentationModelPath}`);
    segmentationSession = await ort.InferenceSession.create(segmentationModelPath); 
    console.log('[Main Process] ONNX Segmentation Model loaded successfully.');
    console.log('[Main Process] Segmentation Model Inputs:', segmentationSession.inputNames);
    console.log('[Main Process] Segmentation Model Outputs:', segmentationSession.outputNames);
    // Verify input shape if possible/needed
    // const segInputMetadata = segmentationSession.handler.getInputMeta(0);
    // console.log('[Main Process] Segmentation Model Expected Input Shape:', segInputMetadata?.dims);
  } catch (error) {
    console.error("[Main Process] Error loading Segmentation model:", error);
    segmentationSession = null;
    win?.webContents.send('model-load-error', `Segmentation Model Load Error: ${error instanceof Error ? error.message : String(error)}`);
  }
}
// --- End ONNX Setup ---

// --- Helper function for ArgMax --- (To process segmentation output)
function argMax2D(data: Float32Array, numClasses: number, height: number, width: number): Uint8Array {
  const outputMap = new Uint8Array(height * width);
  const pixels = height * width;
  
  for (let i = 0; i < pixels; i++) {
    let maxVal = -Infinity;
    let maxIndex = 0;
    for (let j = 0; j < numClasses; j++) {
      // Index calculation: pixel_index * num_classes + class_index
      // OR class_index * pixels + pixel_index depending on layout (C, H, W)
      // Assuming C, H, W layout: access data[j * pixels + i]
      const val = data[j * pixels + i]; 
      if (val > maxVal) {
        maxVal = val;
        maxIndex = j;
      }
    }
    outputMap[i] = maxIndex;
  }
  return outputMap;
}

// --- Helper for resizing mask ---
async function resizeSegmentationMask(maskData: Uint8Array, originalWidth: number, originalHeight: number, targetWidth: number, targetHeight: number): Promise<Uint8Array> {
  console.log(`[Main Process] Resizing mask from ${originalWidth}x${originalHeight} to ${targetWidth}x${targetHeight}`);
  // Sharp needs a buffer
  const buffer = Buffer.from(maskData);
  const resizedBuffer = await sharp(buffer, { 
      raw: { width: originalWidth, height: originalHeight, channels: 1 }
  })
  .resize(targetWidth, targetHeight, { kernel: sharp.kernel.nearest }) // Use nearest neighbor for masks
  .raw()
  .toBuffer();
  console.log(`[Main Process] Mask resize complete. Output buffer length: ${resizedBuffer.length}`);
  return new Uint8Array(resizedBuffer); // Convert back to Uint8Array
}

// --- Updated IPC Handler for Dual Inference ---
ipcMain.handle('infer-depth', async (event, imageDataUrl: string) => {
  // Check if both models and ORT are loaded
  if (!depthSession || !segmentationSession || !ort) { 
    console.error('[Main Process] Depth or Segmentation model or ONNX runtime not loaded, cannot infer.');
    return null;
  }
  console.log('[Main Process] Received request for combined depth and segmentation inference.');
  try {
    // 1. Decode Base64 Image Data URL (Same as before)
    const base64Data = imageDataUrl.split(',')[1];
    if (!base64Data) throw new Error('Invalid Image Data URL format');
    const imageBuffer = Buffer.from(base64Data, 'base64');

    console.time('Sharp Preprocessing');

    // 2. Preprocess Image using Sharp (Same as before - assumes both models take same input size for now)
    const image = sharp(imageBuffer);
    const metadata = await image.metadata();
    // Assuming segmentation model also takes 518x518 input based on segmentationModelInputShape
    const inputWidth = segmentationModelInputShape[3]; 
    const inputHeight = segmentationModelInputShape[2];

    let sharpPipeline = image;
    if (metadata.hasAlpha) {
        sharpPipeline = sharpPipeline.removeAlpha();
    }

    const resizedImageBuffer = await sharpPipeline
        .resize(inputWidth, inputHeight, { fit: 'fill' })
        .raw()
        .toBuffer();

    console.timeEnd('Sharp Preprocessing');

    // 3. Normalize and Prepare Tensor (Same tensor used for both models)
    const float32Data = new Float32Array(inputWidth * inputHeight * 3);
    for (let i = 0; i < inputHeight * inputWidth; i++) {
        float32Data[i] = resizedImageBuffer[i * 3] / 255.0;           // R
        float32Data[i + inputHeight * inputWidth] = resizedImageBuffer[i * 3 + 1] / 255.0; // G
        float32Data[i + 2 * inputHeight * inputWidth] = resizedImageBuffer[i * 3 + 2] / 255.0; // B
    }

    const inputTensor = new ort.Tensor('float32', float32Data, segmentationModelInputShape);

    // 4. Run Inference (Run both models)
    console.time('Depth Inference');
    const depthResults = await depthSession.run({ [depthSession.inputNames[0]]: inputTensor });
    console.timeEnd('Depth Inference');
    
    console.time('Segmentation Inference');
    const segmentationResults = await segmentationSession.run({ [segmentationSession.inputNames[0]]: inputTensor });
    console.timeEnd('Segmentation Inference');

    // 5. Process Depth Output (Same as before)
    const depthOutputTensor = depthResults[depthSession.outputNames[0]];
    const [depthBatch, depthHeight, depthWidth] = depthOutputTensor.dims;
    const depthData = depthOutputTensor.data as Float32Array;
    console.log(`[Main Process] Depth Output dims: [${depthBatch}, ${depthHeight}, ${depthWidth}]`);
    // ... (min/max/avg logging remains the same) ...
    let minVal = Infinity, maxVal = -Infinity, sum = 0;
    for(let i=0; i<depthData.length; i++) { /* ... */ }
    const avgVal = depthData.length > 0 ? sum / depthData.length : 0;
    console.log(`[Main Process] Depth map stats: Min=${minVal}, Max=${maxVal}, Avg=${avgVal}`);

    // 6. Process Segmentation Output
    const segmentationOutputTensor = segmentationResults[segmentationSession.outputNames[0]];
    const segLogits = segmentationOutputTensor.data as Float32Array;
    // Shape is likely [batch, num_classes, height/4, width/4]
    const [segBatch, numClasses, segHeightSmall, segWidthSmall] = segmentationOutputTensor.dims;
    console.log(`[Main Process] Segmentation Output dims: [${segBatch}, ${numClasses}, ${segHeightSmall}, ${segWidthSmall}]`);

    // Perform ArgMax to get class IDs
    console.time('Segmentation ArgMax');
    const segmentationMaskSmall = argMax2D(segLogits, numClasses, segHeightSmall, segWidthSmall);
    console.timeEnd('Segmentation ArgMax');
    console.log(`[Main Process] Segmentation mask (small) created, length: ${segmentationMaskSmall.length}`);

    // Resize mask to match depth map dimensions
    console.time('Segmentation Resize');
    const segmentationMaskFinal = await resizeSegmentationMask(segmentationMaskSmall, segWidthSmall, segHeightSmall, depthWidth, depthHeight);
    console.timeEnd('Segmentation Resize');
    console.log(`[Main Process] Segmentation mask resized to ${depthWidth}x${depthHeight}, length: ${segmentationMaskFinal.length}`);

    // 7. Prepare Visualization PNG (Optional: Could also visualize segmentation)
    // Using normalized depth for now
    const normalizedDepth = new Uint8Array(depthWidth * depthHeight);
    const range = maxVal - minVal;
    if (range > 0) { /* ... */ }
    else { normalizedDepth.fill(128); }
    // ... (sharp PNG conversion remains the same) ...
    const pngBuffer = await sharp(normalizedDepth, { raw: { width: depthWidth, height: depthHeight, channels: 1 } })
        .toFormat('png')
        .toBuffer();
    const pngDataUrl = `data:image/png;base64,${pngBuffer.toString('base64')}`;

    console.log('[Main Process] Combined inference complete, returning depth, segmentation mask, and PNG.');
    // 8. Return combined results
    return {
      pngDataUrl: pngDataUrl,
      depthData: Array.from(depthData),
      width: depthWidth,
      height: depthHeight,
      segmentationMask: Array.from(segmentationMaskFinal) // Send final resized mask
    };

  } catch (error) {
      console.error('[Main Process] Error during combined inference:', error);
      win?.webContents.send('inference-error', error instanceof Error ? error.message : String(error));
      return null;
  }
});
// --- End Updated Inference Handler ---

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

  // === IPC Handlers for Scale Factor ===
  ipcMain.handle('load-scale-factor', async () => {
      if (!store) {
          console.error("[Main Process] Store not initialized, cannot load scale factor.");
          return { average: 1, count: 0 }; // Return default object
      }
      const factors = store.get('calibrationFactors', []); // Get array, default empty
      const count = factors.length;
      if (count === 0) {
          console.log("[Main Process] No calibration factors found, returning default { average: 1, count: 0 }.");
          return { average: 1, count: 0 };
      }
      // Calculate average
      const sum = factors.reduce((acc, val) => acc + val, 0);
      const averageFactor = sum / count;
      console.log(`[Main Process] Loading ${count} factors. Average: ${averageFactor}`);
      return { average: averageFactor, count: count }; // Return object
  });

  ipcMain.handle('save-scale-factor', async (event, newFactor: number) => {
      if (!store) {
          console.error("[Main Process] Store not initialized, cannot save scale factor.");
          return false;
      }
      if (typeof newFactor !== 'number' || isNaN(newFactor) || newFactor <= 0) {
          console.error(`[Main Process] Invalid scale factor provided: ${newFactor}. Must be positive number.`);
          return false; // Indicate failure
      }
      try {
          const currentFactors = store.get('calibrationFactors', []);
          currentFactors.push(newFactor);
          store.set('calibrationFactors', currentFactors);
          console.log(`[Main Process] Appended scale factor: ${newFactor}. Total factors: ${currentFactors.length}`);
          return true; // Indicate success
      } catch (error) {
          console.error(`[Main Process] Error saving scale factor:`, error);
          return false;
      }
  });

  ipcMain.handle('clear-scale-factors', async () => {
      if (!store) {
          console.error("[Main Process] Store not initialized, cannot clear scale factors.");
          return false;
      }
      try {
          store.set('calibrationFactors', []); // Reset to empty array
          console.log("[Main Process] Cleared all scale factors.");
          return true;
      } catch (error) {
          console.error(`[Main Process] Error clearing scale factors:`, error);
          return false;
      }
  });
  // === End Scale Factor Handlers ===

  win.on('closed', () => {
    win = null
  })
}

async function initializeApp() {
  try {
    console.log('[Main Process] Initializing electron-store...');
    // Use require for CJS version
    // const { default: ElectronStore } = await import('electron-store'); // Removed dynamic import
    // Cast the required module to the expected constructor type
    const StoreConstructor = ElectronStore as { new(options?: ElectronStoreType.Options<StorageSchema>): ElectronStoreType<StorageSchema> };
    store = new StoreConstructor({
        // Define schema or defaults if needed
        // schema: { measurements: { type: 'array', default: [] } },
        defaults: { 
          measurements: [],
          calibrationFactors: [] // Default empty array
        } 
    });
    console.log('[Main Process] electron-store initialized successfully. Initial factors:', store.get('calibrationFactors'));
  } catch (error) {
      console.error('[Main Process] Failed to initialize electron-store:', error);
      // Handle error appropriately, maybe quit or show dialog
      dialog.showErrorBox('Initialization Error', 'Failed to load required storage module. The application might not save data.');
  }

  try {
      console.log('[Main Process] Dynamically importing onnxruntime-node...');
      ort = await import('onnxruntime-node');
      console.log('[Main Process] onnxruntime-node imported successfully.');
      await loadModels(); // Load BOTH models
  } catch (error) {
      console.error('[Main Process] Failed to dynamically import or load ONNX runtime/model:', error);
      dialog.showErrorBox('Initialization Error', 'Failed to load the depth inference engine. Depth features will be unavailable.');
      ort = null; // Ensure ort is null if import failed
      depthSession = null;
      segmentationSession = null;
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