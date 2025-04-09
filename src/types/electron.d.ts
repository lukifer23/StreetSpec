// src/types/electron.d.ts

// Define the shape of the API exposed by preload.ts
export interface IElectronAPI {
  sendMessage: (channel: string, data: any) => void;
  onMainProcessMessage: (callback: (message: any) => void) => (() => void) | undefined;
  invoke: (channel: string, data?: any) => Promise<any>; // Ensure invoke is defined
}

// Add the interface directly to the Window object for broader recognition
interface Window {
  electronAPI?: IElectronAPI; // Make it optional initially to avoid errors before preload runs
} 