// types/electron.d.ts

// Define the structure of the API exposed via contextBridge
export interface IElectronAPI {
  sendMessage: (channel: string, data: any) => void;
  onMainProcessMessage: (callback: (message: any) => void) => () => void;
  invoke: (channel: string, data?: any) => Promise<any>; // Add the invoke method signature
}

// Extend the global Window interface
declare global {
  interface Window {
    electronAPI: IElectronAPI;
  }
} 