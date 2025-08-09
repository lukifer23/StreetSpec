import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import electron from 'vite-plugin-electron'
import path from 'node:path'

// https://vitejs.dev/config/
export default defineConfig(({ mode }) => {
  process.env = { ...process.env, ...loadEnv(mode, process.cwd(), '') };
  const isProduction = mode === 'production';

  return {
    plugins: [
      react({
        // Optimize React for production
        jsxImportSource: undefined, // Remove Emotion JSX runtime
        babel: {
          plugins: isProduction ? [
            ['@babel/plugin-transform-react-jsx', { runtime: 'automatic' }]
          ] : []
        }
      }),
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
              minify: isProduction,
              sourcemap: isProduction ? false : 'inline',
              rollupOptions: {
                external: ['electron', 'onnxruntime-node', 'sharp', 'node-fetch', 'pako', 'electron-store', 'idb-keyval'],
                output: {
                  format: 'cjs',
                  entryFileNames: '[name].js',
                  chunkFileNames: '[name]-[hash].js',
                  assetFileNames: '[name]-[hash].[ext]'
                }
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
              minify: isProduction,
              sourcemap: isProduction ? false : 'inline',
              lib: {
                entry: 'electron/preload.ts',
                formats: ['cjs'],
                fileName: () => 'preload.cjs',
              },
              rollupOptions: {
                external: ['electron'],
                output: {
                  format: 'cjs',
                  entryFileNames: '[name].js'
                }
              },
            },
          },
        },
      ]),
    ],
    define: {
      // Pass API key to the renderer build
      'import.meta.env.VITE_GOOGLE_MAPS_API_KEY': JSON.stringify(process.env.VITE_GOOGLE_MAPS_API_KEY),
      // Global constants for optimization
      __DEV__: JSON.stringify(!isProduction),
      __PROD__: JSON.stringify(isProduction),
      __VERSION__: JSON.stringify(process.env.npm_package_version || '1.0.0')
    },
    // Ensure relative paths work correctly
    base: './',
    build: {
      outDir: 'dist',
      emptyOutDir: true,
      sourcemap: !isProduction,
      minify: isProduction ? 'terser' : false,
      terserOptions: isProduction ? {
        compress: {
          drop_console: true,
          drop_debugger: true,
          pure_funcs: ['console.log', 'console.info', 'console.debug'],
          passes: 2
        },
        mangle: {
          toplevel: true
        }
      } : undefined,
      rollupOptions: {
        output: {
          manualChunks: {
            vendor: ['react', 'react-dom'],
            utils: ['zustand', 'immer'],
            maps: ['@googlemaps/js-api-loader'],
            components: [
              './src/components/MapView.tsx',
              './src/components/MeasurementTool.tsx',
              './src/components/AppHeader.tsx',
              './src/components/MeasurementSidebar.tsx'
            ]
          },
          chunkFileNames: isProduction ? 'assets/[name]-[hash].js' : 'assets/[name].js',
          entryFileNames: isProduction ? 'assets/[name]-[hash].js' : 'assets/[name].js',
          assetFileNames: isProduction ? 'assets/[name]-[hash].[ext]' : 'assets/[name].[ext]'
        }
      },
      // Optimize chunk size
      chunkSizeWarningLimit: 1000,
      // Enable CSS code splitting
      cssCodeSplit: true,
      // Optimize assets
      assetsInlineLimit: 4096, // 4kb
      // Report bundle size
      reportCompressedSize: isProduction,
      // Enable tree shaking
      target: 'esnext'
    },
    resolve: {
      alias: {
        '@': path.resolve(__dirname, 'src'),
        '@components': path.resolve(__dirname, 'src/components'),
        '@services': path.resolve(__dirname, 'src/services'),
        '@stores': path.resolve(__dirname, 'src/stores'),
        '@types': path.resolve(__dirname, 'src/types'),
        '@assets': path.resolve(__dirname, 'src/assets')
      },
      // Optimize module resolution
      dedupe: ['react', 'react-dom']
    },
    server: {
      host: '127.0.0.1',
      port: 5173,
      // Enable HMR optimization
      hmr: {
        overlay: false
      },
      // Optimize dev server
      fs: {
        strict: false
      }
    },
    // Optimize dependencies
    optimizeDeps: {
      include: [
        'react',
        'react-dom',
        'zustand',
        'immer',
        '@googlemaps/js-api-loader'
      ],
      exclude: ['electron']
    },
    // CSS optimization
    css: {
      devSourcemap: !isProduction,
      preprocessorOptions: {
        scss: {
          additionalData: `@import "@/styles/variables.scss";`
        }
      }
    },
    // Performance optimization
    esbuild: {
      target: 'esnext',
      supported: {
        'top-level-await': true
      }
    }
  }
})
