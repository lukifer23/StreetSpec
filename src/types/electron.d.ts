// src/types/electron.d.ts

// Define the shape of the API exposed by preload.ts
interface IElectronAPI {
  invoke: (channel: string, data?: any) => Promise<any>;
  sendMessage: (channel: string, data: any) => void;
  onMainProcessMessage: (callback: (data: any) => void) => () => void;
  getEnv: () => { VITE_GOOGLE_MAPS_API_KEY?: string };
}

// Add the interface directly to the Window object for broader recognition
declare global {
  interface Window {
    electronAPI: IElectronAPI;
  }
}

export { IElectronAPI }; 