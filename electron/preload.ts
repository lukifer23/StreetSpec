import type { IpcRendererEvent } from 'electron';
const { contextBridge, ipcRenderer } = require('electron');

// Type declaration for window.electronAPI
declare global {
  interface Window {
    electronAPI: {
      invoke: (channel: string, data?: any) => Promise<any>;
      sendMessage: (channel: string, data: any) => void;
      onMainProcessMessage: (callback: (data: any) => void) => () => void;
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

// Define valid channels
const validChannels = {
  invoke: [
    'fetch-depth-data', 
    'csv-export', 
    'infer-depth',
    'get-measurements',
    'save-measurements',
    'get-settings',
    'save-settings',
    'clear-data'
  ],
  send: ['message'],
  receive: ['main-process-message']
};

// Create the electronAPI object
const electronAPI = {
  invoke: async (channel: string, data?: any) => {
    if (!validChannels.invoke.includes(channel)) {
      throw new Error(`Invalid invoke channel: ${channel}`);
    }
    try {
      const result = await ipcRenderer.invoke(channel, data);
      return result;
    } catch (error) {
      throw error;
    }
  },

  sendMessage: (channel: string, data: any) => {
    if (!validChannels.send.includes(channel)) {
      throw new Error(`Invalid send channel: ${channel}`);
    }
    try {
      ipcRenderer.send(channel, data);
    } catch (error) {
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
      callback(data);
    };

    ipcRenderer.on(channel, listener);
    return () => {
      ipcRenderer.removeListener(channel, listener);
    };
  }
};

// Expose the electronAPI to the renderer process
try {
  contextBridge.exposeInMainWorld('electronAPI', electronAPI);
} catch (error) {
  throw error;
}
