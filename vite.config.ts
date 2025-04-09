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
      // Main process configuration
      entry: path.resolve(__dirname, 'electron/main.ts'),
      vite: {
        build: {
          rollupOptions: {
            external: ['onnxruntime-node', 'sharp'], // Treat sharp as external too
          },
        },
      },
    },
    {
      // Preload script configuration
      entry: path.resolve(__dirname, 'electron/preload.ts'),
    }
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
