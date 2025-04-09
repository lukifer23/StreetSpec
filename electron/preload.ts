const { contextBridge, ipcRenderer } = require('electron')

// --------- Preload Features (Context Isolation ON) --------
// Expose protected methods that allow the renderer process to use
// the ipcRenderer without exposing the entire object
contextBridge.exposeInMainWorld('electronAPI', {
  sendMessage: (channel: string, data: any) => {
    // Whitelist channels
    const validChannels = ['message']; // Add other valid channels as needed
    if (validChannels.includes(channel)) {
      ipcRenderer.send(channel, data);
    }
  },
  onMainProcessMessage: (callback: (message: any) => void) => {
    // Create a listener that calls the provided callback
    const listener = (_event: Electron.IpcRendererEvent, message: any) => callback(message);
    ipcRenderer.on('main-process-message', listener);
    
    // Return a function to remove the listener when no longer needed
    return () => ipcRenderer.removeListener('main-process-message', listener);
  },
  // Add other APIs to expose here, e.g., invoke for two-way communication
  invoke: async (channel: string, data: any) => {
      // Define valid channels for invoke
      const validInvokeChannels = ['fetch-depth-data', 'csv-export', 'infer-depth']; // Add your invoke channels
      if (validInvokeChannels.includes(channel)) {
          try {
              return await ipcRenderer.invoke(channel, data);
          } catch (error) {
              console.error(`[Preload] Error invoking channel '${channel}':`, error);
              throw error; // Re-throw the error to be caught by the caller in the renderer
          }
      } else {
          console.error(`[Preload] Invalid invoke channel attempted: ${channel}`);
          throw new Error(`Invalid invoke channel: ${channel}`);
      }
  },
  // The 'fetchDepthData' function is now implicitly covered by the generic 'invoke'
  // fetchDepthData: (panoId: string): Promise<Uint8Array | null> => ipcRenderer.invoke('fetch-depth-data', panoId)
})

console.log('[Preload] Preload script contextBridge executed using require.');
