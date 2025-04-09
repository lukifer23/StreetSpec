// src/electron.d.ts

// Define the structure of the API exposed by the preload script
export interface IElectronAPI {
    fetchDepthData: (panoId: string) => Promise<Uint8Array | null>;
    // Add the new function signature
    onMainProcessMessage: (callback: (message: any) => void) => () => void; // Returns a cleanup function
    // Add other exposed functions here if needed
}

// Extend the global Window interface
declare global {
    interface Window {
        electronAPI: IElectronAPI;
        ipcRenderer: any; // Keep this if you still need direct access elsewhere (discouraged)
    }
}

// Export an empty object to satisfy the module requirement if no other exports exist
export {}; 