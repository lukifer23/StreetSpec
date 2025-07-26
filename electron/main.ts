import { app, BrowserWindow, shell, ipcMain, dialog, IpcMainInvokeEvent, Event } from 'electron';
import { release } from 'node:os';
import { join, dirname } from 'node:path';
import fetch from 'node-fetch';
import pako from 'pako';
import * as ort from 'onnxruntime-node';
import sharp from 'sharp';
import { existsSync } from 'node:fs';
import path from 'path';
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
      useGPU: false
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
        useGPU: { type: 'boolean' }
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

// Add rate limiting configuration
const RATE_LIMIT = {
  maxRetries: 5,
  delayMs: 1000,
  tooManyRequestsCode: 429
};

// === Helper Function for Depth Data ===
async function getRawDepthData(panoId: string): Promise<Uint8Array | null> {
    const apiUrl = `https://maps.google.com/cbk?output=json&cb_client=maps_sv&v=4&dm=1&pm=1&ph=1&hl=en&panoid=${panoId}`;
    let retryCount = 0;

    while (retryCount < RATE_LIMIT.maxRetries) {
        try {
            const response = await fetch(apiUrl);

            if (response.status === RATE_LIMIT.tooManyRequestsCode) {
                const delay = RATE_LIMIT.delayMs * Math.pow(2, retryCount);
                await new Promise(resolve => setTimeout(resolve, delay));
                retryCount++;
                continue;
            } else if (response.status >= 500) {
                const delay = RATE_LIMIT.delayMs * Math.pow(2, retryCount);
                await new Promise(resolve => setTimeout(resolve, delay));
                retryCount++;
                continue;
            }

            if (response.status >= 400 && response.status < 500 && response.status !== RATE_LIMIT.tooManyRequestsCode) {
                try {
                    const errorBody = await response.text();
                } catch (e) {
                    // Ignore error body read failures
                }
                return null;
            }

            if (retryCount >= RATE_LIMIT.maxRetries) {
                return null;
            }

            if (!response.ok) {
                try {
                    const errorBody = await response.text();
                } catch (e) {
                    // Ignore error body read failures
                }
                return null;
            }

            const responseText = await response.text();
            let jsonData: any;
            
            try {
                jsonData = JSON.parse(responseText);
            } catch (parseError) {
                return null;
            }

            const base64Data = jsonData?.model?.depth_map;
            if (!base64Data || typeof base64Data !== 'string' || base64Data.trim() === '') {
                return null;
            }

            const base64Standard = base64Data.replace(/-/g, '+').replace(/_/g, '/');
            const compressedBytes = Buffer.from(base64Standard, 'base64');

            try {
                const decompressedBytes = pako.inflate(compressedBytes);
                return decompressedBytes;
            } catch (decompressionError) {
                return null;
            }

        } catch (error: any) {
            retryCount++;
            if (retryCount < RATE_LIMIT.maxRetries) {
                const delay = RATE_LIMIT.delayMs * Math.pow(2, retryCount - 1);
                await new Promise(resolve => setTimeout(resolve, delay));
            } else {
                return null;
            }
        }
    }

    return null;
}
// === End Helper Function ===

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

// Global ONNX session holder
let depthSession: ort.InferenceSession | null = null;

const appPath = app.getAppPath(); // Use app.getAppPath() for a reliable base
const modelRelativePath = join('src', 'assets', 'models', selectedModelFilename);

const modelPath = app.isPackaged
  ? join(appPath, '..', 'app.asar.unpacked', modelRelativePath) // Path when packaged (assuming asarUnpack)
  : join(__dirname, '..', modelRelativePath); // Dev path relative to dist-electron

const modelExists = existsSync(modelPath);

async function loadModel() {
  if (!modelExists) {
    if (win) {
      win.webContents.send('main-process-message', { type: 'error', message: 'ONNX model file not found.' });
    }
    return;
  }
  try {
    const options: ort.InferenceSession.SessionOptions = { executionProviders: ['cpu'] };
    depthSession = await ort.InferenceSession.create(modelPath, options);

    if (win) {
      win.webContents.send('main-process-message', { type: 'model-status', status: 'loaded' });
    }

  } catch (error) {
    depthSession = null;
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
    await win.loadURL(devServerUrl).catch((err: Error) => {
      dialog.showErrorBox('Development Load Error', `Could not connect to the Vite development server at:\n${devServerUrl}\n\nPlease ensure 'npm run dev' is running.`);
    });
    win.webContents.openDevTools();
  } else {
    if (!existsSync(indexHtmlPath)) {
      dialog.showErrorBox('Application Error', `Failed to load essential components. index.html not found at:\n${indexHtmlPath}`);
      app.quit();
      return;
    }
    await win.loadFile(indexHtmlPath).catch((err: Error) => {
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
      const metadata = await image.metadata(); // keep for potential future debug
      
      const resizedBuffer = await image
        .resize(modelInputShape[3], modelInputShape[2], { fit: 'fill' })
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

      return {
        data: Array.from(outputTensor.data as Float32Array),
        width: w,
        height: h
      };
    } catch (error) {
      console.error('[infer-depth] failed', error);
      event.sender.send('main-process-message', { type: 'error', message: `Depth inference failed: ${error}` });
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
    } catch (error) {
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
        useGPU: false
      });
    } catch (error) {
      return {
        defaultUnit: 'metric',
        autoSave: true,
        theme: 'light',
        language: 'en',
        measurementHistoryLimit: 1000,
        useGPU: false
      };
    }
  });

  ipcMain.handle('save-settings', async (event: IpcMainInvokeEvent, settings: any) => {
    try {
      store.set('settings', settings);
      return true;
    } catch (error) {
      return false;
    }
  });

  ipcMain.handle('clear-data', async () => {
    try {
      store.delete('measurements');
      return true;
    } catch (error) {
      return false;
    }
  });
}

// Modify app.whenReady() to ensure proper initialization
app.whenReady().then(async () => {
  try {
    await loadModel();
  } catch (error) {
    // Continue anyway, as we want the app to at least start
  }

  try {
    await createWindow();
  } catch (error) {
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
process.on('uncaughtException', (error) => {
  app.quit();
});

process.on('unhandledRejection', (reason: any, promise: Promise<any>) => {
  if (win) {
    const wc = win.webContents;
    if (!wc.isDestroyed()) {
        wc.send('main-process-message', { type: 'error', message: `Unhandled Rejection: ${reason}` });
    }
  }
}); 
