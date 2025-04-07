import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import electron from 'vite-plugin-electron'
// import pkg from './package.json' // pkg is not used, can be removed if not needed later
import path from 'node:path'

// https://vitejs.dev/config/
export default defineConfig(({ mode, command }) => {
  process.env = { ...process.env, ...loadEnv(mode, process.cwd()) };

  // Define the electron plugin configuration separately
  const electronPlugin = electron([
    {
      // Main process configuration
      entry: path.resolve(__dirname, 'electron/main.ts'),
      // Optional: Add further main process config here if needed
      vite: {
        build: {
          outDir: path.resolve(__dirname, 'dist-electron/main'),
          emptyOutDir: true,
          // Keep lib config if needed for build, but often not req for dev
          lib: {
            entry: path.resolve(__dirname, 'electron/main.ts'),
            formats: ['cjs'],
            fileName: () => 'main.cjs'
          },
        }
      }
    },
    {
      // Preload script configuration
      entry: path.resolve(__dirname, 'electron/preload.ts'),
      onstart(options) {
        // Notify the Renderer-Process to reload when the Preload-Scripts build is complete
        // Instead of restarting the entire Electron app.
        options.reload()
      },
      // Optional: Add further preload process config here if needed
      vite: {
        build: {
          outDir: path.resolve(__dirname, 'dist-electron/preload'),
          emptyOutDir: true,
          // Keep rollupOptions if needed for build
          rollupOptions: {
            input: {
              preload: path.resolve(__dirname, 'electron/preload.ts'),
            },
            output: {
              format: 'cjs',
              entryFileNames: 'preload.cjs',
            }
          },
        }
      }
    }
  ]);

  return {
    plugins: [
      react(),
      // Conditionally apply the electron plugin only for the 'build' command
      command === 'build' ? electronPlugin : undefined,
    ].filter(Boolean), // Filter out undefined plugin in dev mode
    define: {
      // Define env var for API key (ensure VITE_ prefix for client exposure)
      'import.meta.env.VITE_GOOGLE_MAPS_API_KEY': JSON.stringify(process.env.VITE_GOOGLE_MAPS_API_KEY)
    },
    // Ensure relative paths work correctly in Electron build
    base: './',
    build: {
      // Output directory for the React build
      outDir: 'dist'
    }
  }
})
