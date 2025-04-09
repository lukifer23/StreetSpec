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

/* // --- Temporarily Commented Out Loading Indicator Logic --- 
function domReady(condition: DocumentReadyState[] = ['complete', 'interactive']) {
  return new Promise((resolve) => {
    if (condition.includes(document.readyState)) {
      resolve(true)
    } else {
      document.addEventListener('readystatechange', () => {
        if (condition.includes(document.readyState)) {
          resolve(true)
        }
      })
    }
  })
}

const safeDOM = {
  append(parent: HTMLElement, child: HTMLElement) {
    if (!Array.from(parent.children).find(e => e === child)) {
      parent.appendChild(child)
    }
  },
  remove(parent: HTMLElement, child: HTMLElement) {
    if (Array.from(parent.children).find(e => e === child)) {
      parent.removeChild(child)
    }
  },
}

function useLoading() {
  const className = `loaders-css__square-spin`
  const styleContent = `
  @keyframes square-spin {
    25% { transform: perspective(100px) rotateX(180deg) rotateY(0); }
    50% { transform: perspective(100px) rotateX(180deg) rotateY(180deg); }
    75% { transform: perspective(100px) rotateX(0) rotateY(180deg); }
    100% { transform: perspective(100px) rotateX(0) rotateY(0); }
  }
  .${className} > div {
    animation-fill-mode: both;
    width: 50px;
    height: 50px;
    background: #fff;
    animation: square-spin 3s 0s cubic-bezier(0.09, 0.57, 0.49, 0.9) infinite;
  }
  .app-loading-wrap {
    position: fixed;
    top: 0;
    left: 0;
    width: 100vw;
    height: 100vh;
    display: flex;
    align-items: center;
    justify-content: center;
    background: #282c34;
    z-index: 9;
  }
      `
  const oStyle = document.createElement('style')
  const oDiv = document.createElement('div')

  oStyle.id = 'app-loading-style'
  oStyle.innerHTML = styleContent
  oDiv.className = 'app-loading-wrap'
  oDiv.innerHTML = `<div class="${className}"><div></div></div>`

  return {
    appendLoading() {
      safeDOM.append(document.head, oStyle)
      safeDOM.append(document.body, oDiv)
    },
    removeLoading() {
      safeDOM.remove(document.head, oStyle)
      safeDOM.remove(document.body, oDiv)
    },
  }
}

const { appendLoading, removeLoading } = useLoading()
domReady().then(appendLoading)

// Example of removing loading indicator via IPC message from main process
// This matches the message sent in main.ts
ipcRenderer.on('main-process-message', () => {
  console.log('Message received from main process, removing loading indicator.');
  removeLoading();
});

// Fallback removal after a timeout
setTimeout(removeLoading, 5000)

console.log('[Preload] Preload script executed successfully and electronAPI exposed.'); 
*/ // --- End Commented Out Section --- 