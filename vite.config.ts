import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import electron from 'vite-plugin-electron'
// import pkg from './package.json' // pkg is not used, can be removed if not needed later
import path from 'node:path'

// https://vitejs.dev/config/
export default defineConfig(({ mode, command }) => {
  process.env = { ...process.env, ...loadEnv(mode, process.cwd(), '') };

  // Define the electron plugin configuration
  const electronPlugin = electron([
    {
      // Main process entry for Vite plugin to launch Electron
      entry: path.resolve(__dirname, 'electron/main.ts'),
      // NO vite.build options here - tsc-watch handles compilation
    }
    // Preload entry remains removed - tsc-watch handles it
  ]);

  return {
    plugins: [
      react(),
      // Apply electron plugin configuration
      electronPlugin,
    ],
    define: {
      // Pass API key to the renderer build
      'import.meta.env.VITE_GOOGLE_MAPS_API_KEY': JSON.stringify(process.env.VITE_GOOGLE_MAPS_API_KEY)
    },
    // Ensure relative paths work correctly
    base: './',
    build: {
      // Output directory for the React/renderer build
      outDir: 'dist'
    }
  }
})
