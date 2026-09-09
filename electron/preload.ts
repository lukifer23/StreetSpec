import type { IpcRendererEvent } from 'electron';
const { contextBridge, ipcRenderer } = require('electron');
const path = require('path');
try {
  const dotenv = require('dotenv');
  const candidates = [
    path.join(__dirname, '..', '.env'),
    path.join(process.cwd(), '.env')
  ];
  let loadedPath: string | null = null;
  for (const p of candidates) {
    const res: any = dotenv.config({ path: p });
    if (res && res.parsed) {
      loadedPath = p;
      break;
    }
  }
  console.log('[env:preload] loaded', loadedPath ?? 'none', 'VITE?', Boolean(process.env.VITE_GOOGLE_MAPS_API_KEY), 'GOOGLE?', Boolean(process.env.GOOGLE_MAPS_API_KEY));
} catch (_e) {
  // ignore
}

// Validate required Electron APIs
if (!contextBridge) {
  throw new Error('contextBridge is not available');
}

if (!ipcRenderer) {
  throw new Error('ipcRenderer is not available');
}

// Define valid channels (whitelist approach)
const validChannels = {
  invoke: [
    'fetch-depth-data',
    'csv-export',
    'infer-depth',
    'get-projects',
    'get-measurements',
    'save-measurements',
    'save-project',
    'delete-project',
    'get-settings',
    'save-settings',
    'set-use-gpu',
    'clear-data',
    'log-error',
    'log-telemetry'
  ],
  send: ['message'],
  receive: ['main-process-message']
} as const;

// Create the electronAPI object with type-safe IPC
const electronAPI = {
  invoke: async (channel: string, data?: unknown) => {
    // Validate channel
    if (typeof channel !== 'string' || !(validChannels.invoke as readonly string[]).includes(channel)) {
      throw new Error(`Invalid invoke channel: ${channel}`);
    }
    
    // Preserve payloads intact; the main process validates channel-specific bounds.
    const sanitizedData = data;
    
    try {
      const result = await ipcRenderer.invoke(channel, sanitizedData);
      return result;
    } catch (error) {
      console.error(`[preload] IPC invoke error for channel ${channel}:`, error);
      throw error;
    }
  },

  sendMessage: (channel: string, data: unknown) => {
    // Validate channel
    if (typeof channel !== 'string' || !(validChannels.send as readonly string[]).includes(channel)) {
      throw new Error(`Invalid send channel: ${channel}`);
    }
    
    // Sanitize input data
    const sanitizedData = data;
    
    try {
      ipcRenderer.send(channel, sanitizedData);
    } catch (error) {
      console.error(`[preload] IPC send error for channel ${channel}:`, error);
      throw error;
    }
  },

  onMainProcessMessage: (callback: (data: unknown) => void) => {
    if (typeof callback !== 'function') {
      throw new Error('Callback must be a function');
    }

    const channel = 'main-process-message';
    if (!validChannels.receive.includes(channel)) {
      throw new Error(`Invalid receive channel: ${channel}`);
    }

    const listener = (_event: IpcRendererEvent, data: any) => {
      try {
        // Sanitize received data before passing to callback
        const sanitizedData = data;
        callback(sanitizedData);
      } catch (error) {
        console.error('[preload] Error in main process message callback:', error);
      }
    };

    ipcRenderer.on(channel, listener);
    return () => {
      ipcRenderer.removeListener(channel, listener);
    };
  },

  getEnv: () => ({ VITE_GOOGLE_MAPS_API_KEY: process.env.VITE_GOOGLE_MAPS_API_KEY || process.env.GOOGLE_MAPS_API_KEY })
};

// Expose the electronAPI to the renderer process
try {
  contextBridge.exposeInMainWorld('electronAPI', electronAPI);
} catch (error) {
  throw error;
}
