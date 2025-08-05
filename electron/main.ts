import { app, BrowserWindow, ipcMain, dialog, IpcMainInvokeEvent, Event } from 'electron';
import { release } from 'node:os';
import { join, dirname } from 'node:path';
import fetch from 'node-fetch';
import * as ort from 'onnxruntime-node';
import sharp from 'sharp';
import { existsSync } from 'node:fs';
import * as fs from 'fs';
import Store from 'electron-store';

// --- Add ESM __dirname equivalent --- 
import { fileURLToPath } from 'node:url';
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
// --- End ESM __dirname equivalent ---

// Initialize electron-store for persistence
const store = new Store({
  defaults: {
    measurements: [],
    settings: {
      defaultUnit: 'metric',
      autoSave: true,
      theme: 'light',
      language: 'en',
      measurementHistoryLimit: 1000,
      useGPU: false,
      calibrationPitchOffsetDeg: 0
    }
  },
  schema: {
    measurements: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          label: { type: 'string' },
          name: { type: 'string' },
          startPoint: { type: 'object' },
          endPoint: { type: 'object' },
          distance: { type: 'number' },
          unit: { type: 'string', enum: ['metric', 'imperial'] },
          timestamp: { type: 'number' },
          panoId: { type: 'string' },
          cameraParams: { type: 'object' },
          error: { type: 'string' }
        }
      }
    },
    settings: {
      type: 'object',
      properties: {
        defaultUnit: { type: 'string', enum: ['metric', 'imperial'] },
        autoSave: { type: 'boolean' },
        theme: { type: 'string', enum: ['light', 'dark', 'system'] },
        language: { type: 'string' },
        measurementHistoryLimit: { type: 'number', minimum: 1, maximum: 10000 },
        useGPU: { type: 'boolean' },
        calibrationPitchOffsetDeg: { type: 'number' }
      }
    }
  }
});

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

// Global variables for model session
let depthSession: ort.InferenceSession | null = null;

// Add rate limiting configuration
const RATE_LIMIT = {
  maxRetries: 5,
  delayMs: 1000,
  tooManyRequestsCode: 429
};

// === Helper Function for Depth Data ===
async function getRawDepthData(panoId: string): Promise<Uint8Array | null> {
  const apiUrl = `https://maps.googleapis.com/maps/api/streetview/metadata?pano=${panoId}&key=${process.env.GOOGLE_MAPS_API_KEY}`;
  
  try {
    const response = await fetch(apiUrl);
    if (!response.ok) {
      if (response.status === RATE_LIMIT.tooManyRequestsCode) {
        console.warn('[depth] Rate limited, retrying...');
        await new Promise(resolve => setTimeout(resolve, RATE_LIMIT.delayMs));
        return getRawDepthData(panoId);
      }
      return null;
    }
    
    const data = await response.json() as any;
    if (data.status !== 'OK') {
      return null;
    }
    
    // This is a placeholder - actual depth data would need to be fetched from Google's depth API
    // For now, we'll return null as the depth API is not publicly available
    return null;
  } catch (error) {
    console.error('[depth] Error fetching depth data:', error);
    return null;
  }
}

let win: BrowserWindow | null = null;

// Calculate the preload script path
const preloadScriptPath = join(__dirname, 'preload.cjs');

// Determine the correct path for index.html
// In dev, vite-plugin-electron sets VITE_DEV_SERVER_URL.
// In prod, index.html is in the 'dist' folder adjacent to 'dist-electron'.
const devServerUrl = process.env.VITE_DEV_SERVER_URL; // Get the potential URL from vite-plugin-electron
const indexHtmlPath = join(__dirname, '../dist/index.html'); // Path to index.html relative to main.cjs

// --- Model selection logic ---
const envModelFilename = process.env.DEPTH_MODEL_FILENAME; // optional override via .env

// Primary model we ship with the repo (≈94 MB, outdoor metric)
const primaryModelFilename = 'depth_anything_v2_metric_vkitti_vits.onnx';
// Fallback to tiny (33 MB) if user supplies it manually
const tinyModelFilename = 'depth_anything_v2_vit_tiny_metric_outdoor.onnx';

let selectedModelFilename = primaryModelFilename;

if (envModelFilename) {
  selectedModelFilename = envModelFilename;
} else if (!existsSync(join(__dirname, '..', 'src', 'assets', 'models', primaryModelFilename)) && existsSync(join(__dirname, '..', 'src', 'assets', 'models', tinyModelFilename))) {
  selectedModelFilename = tinyModelFilename;
}

const isTinyModel = selectedModelFilename.includes('vit_tiny');

let modelInputShape: [number, number, number, number] = isTinyModel ? [1, 3, 384, 384] : [1, 3, 518, 518];

const appPath = app.getAppPath(); // Use app.getAppPath() for a reliable base
const modelRelativePath = join('src', 'assets', 'models', selectedModelFilename);

const modelPath = app.isPackaged
  ? join(appPath, '..', 'app.asar.unpacked', modelRelativePath) // Path when packaged (assuming asarUnpack)
  : join(__dirname, '..', modelRelativePath); // Dev path relative to dist-electron

const modelExists = existsSync(modelPath);

async function loadModel() {
  console.log('[model] Model path:', modelPath);
  console.log('[model] Model exists:', modelExists);
  console.log('[model] __dirname:', __dirname);
  console.log('[model] app.getAppPath():', app.getAppPath());
  console.log('[model] app.isPackaged:', app.isPackaged);
  
  if (!modelExists) {
    console.error('[model] Model file not found at:', modelPath);
    if (win) {
      win.webContents.send('main-process-message', { type: 'error', message: 'ONNX model file not found.' });
    }
    return;
  }
  
  try {
    console.log('[model] Loading ONNX model...');
    
    // Try with minimal session options first
    depthSession = await ort.InferenceSession.create(modelPath);
    
    console.log('[model] Model loaded successfully');
    console.log('[model] Input names:', depthSession.inputNames);
    console.log('[model] Output names:', depthSession.outputNames);
    
    if (win) {
      win.webContents.send('main-process-message', { type: 'model-status', status: 'loaded' });
    }

  } catch (error) {
    depthSession = null;
    console.error('[model] Failed to load model:', error);
    
    if (win) {
      win.webContents.send('main-process-message', { type: 'error', message: `Failed to load ONNX model: ${error}` });
    }
  }
}
// --- End ONNX Setup ---

async function createWindow() {
  if (!existsSync(preloadScriptPath)) {
    throw new Error('Preload script not found');
  }

  win = new BrowserWindow({
    title: 'PoleCheck Desktop',
    width: 1200,
    height: 800,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      preload: preloadScriptPath,
    },
  });

  win.webContents.on('did-fail-load', (event: Event, errorCode: number, errorDescription: string, validatedURL: string) => {
    if (validatedURL === devServerUrl) {
      dialog.showErrorBox('Development Load Error', `Could not connect to the Vite development server at:\n${devServerUrl}\n\nPlease ensure 'npm run dev' is running.`);
    } else if (validatedURL.startsWith('file://') && validatedURL.endsWith(indexHtmlPath)) {
      if (!existsSync(indexHtmlPath)) {
        dialog.showErrorBox('Application Error', `Failed to load essential components. index.html not found at:\n${indexHtmlPath}`);
        app.quit();
        return;
      }
      dialog.showErrorBox('Production Load Error', `Could not load the application file:\n${indexHtmlPath}`);
    }
  });

  if (devServerUrl && !app.isPackaged) {
    await win.loadURL(devServerUrl).catch((_err: Error) => {
      dialog.showErrorBox('Development Load Error', `Could not connect to the Vite development server at:\n${devServerUrl}\n\nPlease ensure 'npm run dev' is running.`);
    });
    win.webContents.openDevTools();
  } else {
    if (!existsSync(indexHtmlPath)) {
      dialog.showErrorBox('Application Error', `Failed to load essential components. index.html not found at:\n${indexHtmlPath}`);
      app.quit();
      return;
    }
    await win.loadFile(indexHtmlPath).catch((_err: Error) => {
      dialog.showErrorBox('Production Load Error', `Could not load the application file:\n${indexHtmlPath}`);
    });
  }

  win.webContents.on('dom-ready', () => {
    win?.webContents.send('main-process-message', { type: 'status', message: 'Main process ready, window loaded.' });
  });

  // Set up IPC handlers
  // Depth inference handler
  ipcMain.handle('infer-depth', async (event: IpcMainInvokeEvent, imageDataUrl: string) => {
    console.log('[infer-depth] request received');
    if (!depthSession) {
      event.sender.send('main-process-message', { type: 'error', message: 'Depth model is not loaded or failed to load.'});
      return null;
    }

    try {
      console.time('[infer-depth] preprocess');
      // Process image data and run inference
      const base64Data = imageDataUrl.split(',')[1];
      if (!base64Data) throw new Error('Invalid image data');
      
      const imageBuffer = Buffer.from(base64Data, 'base64');
      const image = sharp(imageBuffer);

      // Record original dimensions to help map viewport coordinates
      const metadata = await image.metadata();
      const originalWidth = metadata.width ?? modelInputShape[3];
      const originalHeight = metadata.height ?? modelInputShape[2];

      // Resize to the model's expected input while ignoring aspect ratio
      const resizedWidth = modelInputShape[3];
      const resizedHeight = modelInputShape[2];
      const resizedBuffer = await image
        .resize(resizedWidth, resizedHeight, { fit: 'fill' })
        .removeAlpha()
        .raw()
        .toBuffer();

      const float32Data = new Float32Array(modelInputShape[1] * modelInputShape[2] * modelInputShape[3]);
      for (let i = 0; i < modelInputShape[2] * modelInputShape[3]; i++) {
         float32Data[i] = resizedBuffer[i * 3] / 255.0;         // R channel
         float32Data[modelInputShape[2] * modelInputShape[3] + i] = resizedBuffer[i * 3 + 1] / 255.0; // G channel
         float32Data[2 * modelInputShape[2] * modelInputShape[3] + i] = resizedBuffer[i * 3 + 2] / 255.0; // B channel
       }
      console.timeEnd('[infer-depth] preprocess');

      // Create tensor from the processed float data
      const inputTensor = new ort.Tensor('float32', float32Data, modelInputShape);
      const feeds: Record<string, ort.Tensor> = {};
      feeds[depthSession!.inputNames[0]] = inputTensor;
      
      console.time('[infer-depth] inference');
      const results = await depthSession!.run(feeds);
      console.timeEnd('[infer-depth] inference');

      const outputTensor = results[depthSession!.outputNames[0]];
      console.log('[infer-depth] output dims', outputTensor.dims, 'dataLen', (outputTensor.data as Float32Array).length);

      let h: number | undefined;
      let w: number | undefined;
      if (outputTensor.dims.length === 4) {
        // Expected [1,1,H,W]
        h = outputTensor.dims[2];
        w = outputTensor.dims[3];
      } else if (outputTensor.dims.length === 3) {
        // Some exporters drop the channel dim: [1,H,W]
        h = outputTensor.dims[1];
        w = outputTensor.dims[2];
      }

      if (!w || !h || !(outputTensor.data instanceof Float32Array) || (outputTensor.data as Float32Array).length === 0) {
        throw new Error('ONNX output tensor invalid');
      }

      // Parameters describing how the image was resized prior to inference
      const transform = {
        originalWidth,
        originalHeight,
        resizedWidth,
        resizedHeight,
        scaleX: resizedWidth / originalWidth,
        scaleY: resizedHeight / originalHeight,
        offsetX: 0,
        offsetY: 0
      };

      return {
        data: Array.from(outputTensor.data as Float32Array),
        width: w,
        height: h,
        transform
      };
    } catch (_error) {
      console.error('[infer-depth] failed', _error);
      event.sender.send('main-process-message', { type: 'error', message: `Depth inference failed: ${_error}` });
      return null;
    }
  });

  // CSV export handler
  ipcMain.handle('csv-export', async (event: IpcMainInvokeEvent, csvContent: string) => {
    if (!win) return null;

    try {
      const { canceled, filePath } = await dialog.showSaveDialog(win, {
        title: 'Export Measurements as CSV',
        defaultPath: `polecheck-measurements-${Date.now()}.csv`,
        filters: [
          { name: 'CSV Files', extensions: ['csv'] },
          { name: 'All Files', extensions: ['*'] }
        ]
      });

      if (canceled || !filePath) return null;

      await fs.promises.writeFile(filePath, csvContent, 'utf8');
      return filePath;
    } catch (error) {
      return null;
    }
  });

  // Depth data fetch handler
  ipcMain.handle('fetch-depth-data', async (event: IpcMainInvokeEvent, panoId: string) => {
    try {
      return await getRawDepthData(panoId);
    } catch (error) {
      return null;
    }
  });

  // Persistence handlers
  ipcMain.handle('get-measurements', async () => {
    try {
      return store.get('measurements', []);
    } catch (error) {
      return [];
    }
  });

  ipcMain.handle('save-measurements', async (event: IpcMainInvokeEvent, measurements: any[]) => {
    try {
      store.set('measurements', measurements);
      return true;
    } catch (_error) {
      return false;
    }
  });

  ipcMain.handle('get-settings', async () => {
    try {
      return store.get('settings', {
        defaultUnit: 'metric',
        autoSave: true,
        theme: 'light',
        language: 'en',
        measurementHistoryLimit: 1000,
        useGPU: false,
        calibrationPitchOffsetDeg: 0
      });
    } catch (_error) {
      return {
        defaultUnit: 'metric',
        autoSave: true,
        theme: 'light',
        language: 'en',
        measurementHistoryLimit: 1000,
        useGPU: false,
        calibrationPitchOffsetDeg: 0
      };
    }
  });

  ipcMain.handle('save-settings', async (event: IpcMainInvokeEvent, settings: any) => {
    try {
      store.set('settings', settings);
      return true;
    } catch (_error) {
      return false;
    }
  });

  ipcMain.handle('clear-data', async () => {
    try {
      store.delete('measurements');
      return true;
    } catch (_error) {
      return false;
    }
  });
}

// Modify app.whenReady() to ensure proper initialization
app.whenReady().then(async () => {
  try {
    await loadModel();
  } catch (_error) {
    // Continue anyway, as we want the app to at least start
  }

  try {
    await createWindow();
  } catch (_error) {
    app.quit();
    return;
  }

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
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

// Handle any uncaught exceptions
process.on('uncaughtException', (_error) => {
  app.quit();
});

process.on('unhandledRejection', (reason: any, _promise: Promise<any>) => {
  if (win) {
    const wc = win.webContents;
    if (!wc.isDestroyed()) {
        wc.send('main-process-message', { type: 'error', message: `Unhandled Rejection: ${reason}` });
    }
  }
}); 
