import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import electron from 'vite-plugin-electron'
// import pkg from './package.json' // pkg is not used, can be removed if not needed later
import path from 'node:path'

// https://vitejs.dev/config/
export default defineConfig(({ mode }) => {
  process.env = { ...process.env, ...loadEnv(mode, process.cwd(), '') };

  return {
    plugins: [
      react(),
      electron([
        {
          // Main process entry
          entry: 'electron/main.ts',
          onstart(options) {
            options.startup();
          },
          vite: {
            build: {
              outDir: 'dist-electron',
              minify: false,
              sourcemap: 'inline',
              rollupOptions: {
                external: ['electron', 'onnxruntime-node', 'sharp', 'node-fetch', 'pako'],
              },
            },
          },
        },
        {
          // Preload script entry
          entry: 'electron/preload.ts',
          onstart(options) {
            options.reload();
          },
          vite: {
            build: {
              outDir: 'dist-electron',
              minify: false,
              sourcemap: 'inline',
              lib: {
                entry: 'electron/preload.ts',
                formats: ['cjs'],
                fileName: () => 'preload.cjs',
              },
              rollupOptions: {
                external: ['electron'],
              },
            },
          },
        },
      ]),
    ],
    define: {
      // Pass API key to the renderer build
      'import.meta.env.VITE_GOOGLE_MAPS_API_KEY': JSON.stringify(process.env.VITE_GOOGLE_MAPS_API_KEY)
    },
    // Ensure relative paths work correctly
    base: './',
    build: {
      outDir: 'dist',
      emptyOutDir: true,
      sourcemap: true,
    },
    resolve: {
      alias: {
        '@': path.resolve(__dirname, 'src'),
      },
    },
    server: {
      host: '127.0.0.1',
      port: 5173,
    },
  }
})
