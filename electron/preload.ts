import { contextBridge, ipcRenderer, IpcRendererEvent } from 'electron'

console.log('[Preload Minimal] Script loaded, attempting to expose API.');

try {
  contextBridge.exposeInMainWorld('electronAPI', {
    minimalTest: () => {
      console.log('[Preload Minimal] minimalTest function called.');
      // Example of sending a message (optional for basic test)
      // ipcRenderer.send('to-main', 'hello from minimal preload'); 
      return 'Minimal API exposed!';
    },
    // Keep invoke for compatibility with App.tsx calls during testing
     invoke: async (channel: string, data: any) => {
      // Define valid channels for invoke - KEEP THE ONES USED BY APP
      const validInvokeChannels = [
        'fetch-depth-data', // If still used or potentially called
        'infer-depth', 
        'load-measurements',
        'save-measurements',
        'export-file'
      ];
      if (validInvokeChannels.includes(channel)) {
          try {
              console.log(`[Preload Minimal] Invoking channel: ${channel}`);
              return await ipcRenderer.invoke(channel, data);
          } catch (error) {
              console.error(`[Preload Minimal] Error invoking channel '${channel}':`, error);
              throw error; // Re-throw
          }
      } else {
          console.error(`[Preload Minimal] Invalid invoke channel attempted: ${channel}`);
          throw new Error(`Invalid invoke channel: ${channel}`);
      }
    },
    // Keep onMainProcessMessage for compatibility
    onMainProcessMessage: (callback: (message: any) => void) => {
      const listener = (_event: IpcRendererEvent, message: any) => callback(message);
      ipcRenderer.on('main-process-message', listener);
      return () => ipcRenderer.removeListener('main-process-message', listener);
    },
  });
  console.log('[Preload Minimal] contextBridge.exposeInMainWorld successful.');
} catch (error) {
  console.error('[Preload Minimal] Error exposing API:', error);
}

// Remove all loading indicator logic