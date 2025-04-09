import { app, BrowserWindow, shell, ipcMain, dialog } from 'electron'
import { release } from 'node:os'
import { join, dirname } from 'node:path' // Use dirname instead of resolve for this pattern
import fetch from 'node-fetch'
import pako from 'pako'
import { fileURLToPath } from 'node:url' // Import necessary modules for ESM __dirname equivalent
import ort from 'onnxruntime-node'
import sharp from 'sharp'

// ESM equivalent for __dirname
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

console.log(`[Main Process] ESM __dirname equivalent: ${__dirname}`); // Log calculated path

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
async function getRawDepthData(panoId: string): Promise<Uint8Array | null> {
    const url = `https://maps.google.com/cbk?output=json&cb_client=maps_sv&v=4&dm=1&pm=1&ph=1&hl=en&panoid=${panoId}`;
    console.log(`[Main Process] Fetching depth data from: ${url}`);
    try {
        const response = await fetch(url);
        if (!response.ok) {
            console.error(`[Main Process] Failed to fetch depth data: ${response.status} ${response.statusText}`);
            try {
              const errorBody = await response.text(); // Try to get error body
              console.error(`[Main Process] Error body: ${errorBody}`);
            } catch { /* Ignore if reading body fails */ }
            return null;
        }
        
        // Log the raw text first to inspect structure
        const responseText = await response.text();
        console.log(`[Main Process] Received response text for ${panoId}:`, responseText.substring(0, 500) + '...'); // Log first 500 chars

        // Try parsing JSON *after* logging text
        let jsonData: any;
        try {
            jsonData = JSON.parse(responseText);
        } catch (parseError) {
             console.error(`[Main Process] Failed to parse JSON for ${panoId}:`, parseError);
             console.error(`[Main Process] Raw text was:`, responseText);
             return null;
        }

        // Check the expected path again
        const base64Data = jsonData?.model?.depth_map;

        if (!base64Data || typeof base64Data !== 'string') {
            console.error(`[Main Process] Depth map data (string) not found in expected location (model.depth_map) for ${panoId}. Full JSON:`, JSON.stringify(jsonData, null, 2).substring(0, 1000) + '...'); // Log structure
            // *** Attempt alternative path if needed based on logs ***
            // const alternativeData = jsonData?.some?.other?.path;
            // if (alternativeData) { ... }
            return null;
        }

        console.log(`[Main Process] Found base64 depth map string (length: ${base64Data.length}) for ${panoId}.`);

        // Decode Base64 (URL-safe variant) & Decompress
        const base64Standard = base64Data.replace(/-/g, '+').replace(/_/g, '/');
        const compressedBytes = Buffer.from(base64Standard, 'base64');
        console.log(`[Main Process] Decoded base64 (compressed size: ${compressedBytes.length} bytes) for ${panoId}.`);
        const decompressedBytes = pako.inflate(compressedBytes);
        console.log(`[Main Process] Decompressed depth data (size: ${decompressedBytes.length} bytes) for ${panoId}`);
        return decompressedBytes;
    } catch (error) {
        console.error(`[Main Process] Error fetching/processing depth data for ${panoId}:`, error);
        return null;
    }
}
// === End Helper Function ===

let win: BrowserWindow | null = null
// Calculate the path to the compiled preload script (now .js)
const preloadScriptPath = join(__dirname, 'preload.js'); // <--- Changed to preload.js
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
let depthSession: ort.InferenceSession | null = null;
const modelInputShape = [1, 3, 518, 518]; // Input shape likely remains the same
// *** IMPORTANT: Use the filename for your downloaded METRIC outdoor model ***
const modelPath = join(__dirname, '..', 'src', 'assets', 'models', 'depth_anything_v2_metric_vkitti_vits.onnx'); // Use VKITTI outdoor small model 

async function loadModel() {
  try {
    console.log(`[Main Process] Loading ONNX model from: ${modelPath}`);
    // Ensure GPU is preferred if available (optional, adjust provider as needed)
    // const options: ort.InferenceSession.SessionOptions = { executionProviders: ['cuda', 'cpu'] }; 
    depthSession = await ort.InferenceSession.create(modelPath);
    console.log('[Main Process] ONNX Depth Model loaded successfully.');
    // Log input/output names - useful for debugging
    console.log('[Main Process] Model Input Names:', depthSession.inputNames);
    console.log('[Main Process] Model Output Names:', depthSession.outputNames);
  } catch (error) {
    console.error("[Main Process] Error loading ONNX model:", error);
    depthSession = null;
    // Optionally notify the renderer process of the failure
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

  // === NEW IPC Handler for CSV Export ===
  ipcMain.handle('export-to-csv', async (event, csvContent: string) => {
      console.log("[Main Process] Received request to export CSV data.");
      if (!win) {
          console.error("[Main Process] Cannot export CSV: BrowserWindow not available.");
          return null; // Indicate failure
      }
      try {
          const { canceled, filePath } = await dialog.showSaveDialog(win, {
              title: 'Export Measurements as CSV',
              defaultPath: `polecheck-measurements-${Date.now()}.csv`,
              filters: [
                  { name: 'CSV Files', extensions: ['csv'] },
                  { name: 'All Files', extensions: ['*'] }
              ]
          });

          if (canceled || !filePath) {
              console.log("[Main Process] CSV export save dialog cancelled.");
              return null; // Indicate cancellation
          }

          // Use Node.js fs module to write the file
          const fs = require('node:fs');
          await fs.promises.writeFile(filePath, csvContent, 'utf8');
          console.log(`[Main Process] Successfully wrote CSV to: ${filePath}`);
          return filePath; // Return the path on success

      } catch (error) {
          console.error("[Main Process] Error exporting CSV:", error);
          dialog.showErrorBox("Export Error", `Failed to save CSV file: ${error}`);
          return null; // Indicate failure
      }
  });
  // === End IPC Handler ===

  // --- NEW IPC Handler for Depth Inference ---
  ipcMain.handle('infer-depth', async (event, imageDataUrl: string) => {
    if (!depthSession) {
      console.error('[Main Process] Depth model not loaded, cannot infer.');
      return null;
    }
    console.log('[Main Process] Received request for depth inference.');
    try {
      // 1. Decode Base64 Image Data URL
      const base64Data = imageDataUrl.split(',')[1];
      if (!base64Data) throw new Error('Invalid Image Data URL format');
      const imageBuffer = Buffer.from(base64Data, 'base64');

      // 2. Preprocess Image using Sharp
      const image = sharp(imageBuffer);
      const metadata = await image.metadata();
      console.log(`[Main Process] Original image size: ${metadata.width}x${metadata.height}`);

      const inputWidth = modelInputShape[3];
      const inputHeight = modelInputShape[2];

      const resizedBuffer = await image
        .resize(inputWidth, inputHeight, { fit: 'fill' }) // Ensure exact size
        .removeAlpha() // Ensure 3 channels
        .raw()
        .toBuffer();

      // Normalize image data using ImageNet mean and std
      const mean = [0.485, 0.456, 0.406];
      const std = [0.229, 0.224, 0.225];
      const float32Data = new Float32Array(inputWidth * inputHeight * 3);
      for (let i = 0; i < resizedBuffer.length; i += 3) {
          // Normalize each channel (R, G, B)
          float32Data[i]     = (resizedBuffer[i] / 255.0 - mean[0]) / std[0]; // R
          float32Data[i + 1] = (resizedBuffer[i + 1] / 255.0 - mean[1]) / std[1]; // G
          float32Data[i + 2] = (resizedBuffer[i + 2] / 255.0 - mean[2]) / std[2]; // B
      }

       // Permute from HWC to CHW 
       const inputTensorData = new Float32Array(inputWidth * inputHeight * 3);
       const channelSize = inputHeight * inputWidth;
       for (let h = 0; h < inputHeight; h++) {
           for (let w = 0; w < inputWidth; w++) {
               const baseIdx = (h * inputWidth + w) * 3;
               inputTensorData[h * inputWidth + w]                 = float32Data[baseIdx];     // R -> C1
               inputTensorData[channelSize + h * inputWidth + w]   = float32Data[baseIdx + 1]; // G -> C2
               inputTensorData[channelSize * 2 + h * inputWidth + w] = float32Data[baseIdx + 2]; // B -> C3
           }
       }

      const inputTensor = new ort.Tensor('float32', inputTensorData, modelInputShape);
      console.log(`[Main Process] Prepared input tensor shape: ${inputTensor.dims}`);

      // 3. Run Inference
      const feeds: Record<string, ort.Tensor> = {};
      feeds[depthSession.inputNames[0]] = inputTensor; // Use the actual input name
      
      console.log('[Main Process] Running model inference...');
      const results = await depthSession.run(feeds);
      console.log('[Main Process] Inference complete.');

      // 4. Process Output (METRIC MODEL)
      const outputTensor = results[depthSession.outputNames[0]]; 
      const depthMapData = outputTensor.data as Float32Array; 
      const outputShape = outputTensor.dims;
      console.log(`[Main Process] Raw METRIC depth map output shape: ${outputShape}, data length: ${depthMapData.length}`);
      // Log a sample of the raw metric output
      console.log(`[Main Process] Raw METRIC depth data sample:`, depthMapData.slice(0, 10)); 

      // Output shape is [Batch, Height, Width]
      const mapHeight = outputShape[1]; 
      const mapWidth = outputShape[2];  

      // REMOVED: Incorrect min/max normalization and scaling for relative depth
      // The output from the metric model should ideally be in meters already, 
      // or require model-specific scaling if documented.

      // --- Return data to renderer --- 
      const returnData = {
          data: Array.from(depthMapData), // Return the raw (metric) data
          width: mapWidth,
          height: mapHeight
      };
      // console.log(`[Main Process] Returning data - Type: ${typeof returnData}, Width: ${returnData.width}, Height: ${returnData.height}, Data Sample:`, returnData.data.slice(0, 10)); 
      return returnData;

    } catch (error) {
      console.error("[Main Process] Error during depth inference:", error);
      return null;
    }
  });
  // --- End Depth Inference Handler ---

  win.on('closed', () => {
    win = null
  })
}

// Load the ONNX model when the app is ready
app.whenReady().then(() => {
  console.log('[Main Process] App is ready, loading ONNX model...');
  loadModel(); // Load the model before creating the window
});

app.on('window-all-closed', () => {
  win = null
  if (process.platform !== 'darwin') app.quit()
})

app.on('second-instance', () => {
  if (win) {
    if (win.isMinimized()) win.restore()
    win.focus()
  }
})

app.on('activate', () => {
  const allWindows = BrowserWindow.getAllWindows()
  if (allWindows.length) {
    allWindows[0].focus()
  } else {
    createWindow()
  }
}) 