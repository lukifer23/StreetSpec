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
  // eslint-disable-next-line no-console
  console.log('[env:preload] loaded', loadedPath ?? 'none', 'VITE?', Boolean(process.env.VITE_GOOGLE_MAPS_API_KEY), 'GOOGLE?', Boolean(process.env.GOOGLE_MAPS_API_KEY));
} catch (_e) {
  // ignore
}

// Type declaration for window.electronAPI
declare global {
  interface Window {
    electronAPI: {
      invoke: (channel: string, data?: any) => Promise<any>;
      sendMessage: (channel: string, data: any) => void;
      onMainProcessMessage: (callback: (data: any) => void) => () => void;
      getEnv: () => { VITE_GOOGLE_MAPS_API_KEY?: string };
    }
  }
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

// Input sanitization utilities
function sanitizeString(input: unknown, maxLength: number = 10000): string | null {
  if (typeof input !== 'string') return null;
  if (input.length > maxLength) return null;
  // Remove control characters except newlines and tabs
  return input.replace(/[\x00-\x08\x0B-\x0C\x0E-\x1F\x7F]/g, '');
}

function sanitizeObject(input: unknown, maxDepth: number = 10): unknown {
  if (maxDepth <= 0) return null;
  if (input === null || input === undefined) return input;
  if (typeof input === 'string') return sanitizeString(input);
  if (typeof input === 'number') return Number.isFinite(input) ? input : null;
  if (typeof input === 'boolean') return input;
  if (Array.isArray(input)) {
    return input.slice(0, 1000).map(item => sanitizeObject(item, maxDepth - 1));
  }
  if (typeof input === 'object') {
    const sanitized: Record<string, unknown> = {};
    const entries = Object.entries(input).slice(0, 100);
    for (const [key, value] of entries) {
      const sanitizedKey = sanitizeString(key, 200);
      if (sanitizedKey) {
        sanitized[sanitizedKey] = sanitizeObject(value, maxDepth - 1);
      }
    }
    return sanitized;
  }
  return null;
}

// Create the electronAPI object
const electronAPI = {
  invoke: async (channel: string, data?: any) => {
    // Validate channel
    if (typeof channel !== 'string' || !(validChannels.invoke as readonly string[]).includes(channel)) {
      throw new Error(`Invalid invoke channel: ${channel}`);
    }
    
    // Sanitize input data
    const sanitizedData = data !== undefined ? sanitizeObject(data) : undefined;
    
    try {
      const result = await ipcRenderer.invoke(channel, sanitizedData);
      return result;
    } catch (error) {
      console.error(`[preload] IPC invoke error for channel ${channel}:`, error);
      throw error;
    }
  },

  sendMessage: (channel: string, data: any) => {
    // Validate channel
    if (typeof channel !== 'string' || !(validChannels.send as readonly string[]).includes(channel)) {
      throw new Error(`Invalid send channel: ${channel}`);
    }
    
    // Sanitize input data
    const sanitizedData = sanitizeObject(data);
    
    try {
      ipcRenderer.send(channel, sanitizedData);
    } catch (error) {
      console.error(`[preload] IPC send error for channel ${channel}:`, error);
      throw error;
    }
  },

  onMainProcessMessage: (callback: (data: any) => void) => {
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
        const sanitizedData = sanitizeObject(data);
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
