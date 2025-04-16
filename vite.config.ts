import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import electron from 'vite-plugin-electron'
// import electronRenderer from 'vite-plugin-electron/renderer' // Remove this import
// import pkg from './package.json' // pkg is not used, can be removed if not needed later
import path from 'node:path'

// https://vitejs.dev/config/
export default defineConfig(({ mode, command }) => {
  process.env = { ...process.env, ...loadEnv(mode, process.cwd(), '') };

  // Define the electron plugin configuration
  // Combine main and renderer configuration in one call for this version
  const electronPlugin = electron([
    {
      // Main process entry
      entry: path.resolve(__dirname, 'electron/main.ts'),
      // NO vite.build options here - tsc-watch handles compilation
    },
    {
      // Renderer process entry (which Vite handles)
      entry: path.resolve(__dirname, 'src/main.tsx'), // Point to your React entry
      vite: { // Specify Vite config for the renderer
        build: {
          outDir: path.resolve(__dirname, 'dist'), // Match your build output dir
        },
      },
    },
    // Preload entry remains removed - tsc-watch handles it
  ]);

  return {
    plugins: [
      react(),
      // Apply combined electron plugin configuration
      electronPlugin,
      // electronRenderer(), // Remove this line
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
