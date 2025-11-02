import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import electron from 'vite-plugin-electron'
import path from 'node:path'
import type { Plugin } from 'vite'

// https://vitejs.dev/config/
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), 'VITE_');
  process.env = { ...process.env, ...loadEnv(mode, process.cwd(), '') };
  const isProduction = mode === 'production';

  // Plugin to replace CSP in production builds
  const cspTransformPlugin = (): Plugin => ({
    name: 'csp-transform',
    transformIndexHtml(html) {
      if (isProduction) {
        // Production CSP: strict, no unsafe-eval or unsafe-inline
        const productionCSP = "default-src 'self'; img-src 'self' data: blob: https://maps.googleapis.com https://maps.gstatic.com https://streetviewpixels.googleapis.com; style-src 'self' https://fonts.googleapis.com; script-src 'self' https://maps.googleapis.com https://maps.gstatic.com; connect-src 'self' https://maps.googleapis.com https://streetviewpixels.googleapis.com https://maps.gstatic.com; font-src 'self' https://fonts.gstatic.com; object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'; worker-src 'self' blob:";
        return html.replace(
          /<meta http-equiv="Content-Security-Policy" content="[^"]*">/,
          `<meta http-equiv="Content-Security-Policy" content="${productionCSP}">`
        );
      }
      return html;
    }
  });

  return {
    plugins: [
      cspTransformPlugin(),
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
                  entryFileNames: 'preload.cjs',
                  exports: 'named',
                  esModule: false,
                  interop: 'default'
                }
              },
            },
          },
        },
      ]),
    ],
    define: {
      // Ensure the renderer has the key at build time
      'import.meta.env.VITE_GOOGLE_MAPS_API_KEY': JSON.stringify(env.VITE_GOOGLE_MAPS_API_KEY || process.env.GOOGLE_MAPS_API_KEY || ''),
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
        },
        // Handle CommonJS modules properly
        external: (id) => {
          // Don't externalize react-window, we want it bundled
          return false;
        }
      },
      commonjsOptions: {
        include: [/react-window/, /node_modules\/react-window/],
        transformMixedEsModules: true,
        defaultIsModuleExports: 'auto',
        requireReturnsDefault: 'auto'
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
      dedupe: ['react', 'react-dom'],
      // Ensure proper resolution of CommonJS modules
      conditions: ['import', 'module', 'browser', 'default']
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
        '@googlemaps/js-api-loader',
        'react-window'
      ],
      exclude: ['electron'],
      esbuildOptions: {
        // Handle CommonJS modules
        target: 'esnext'
      }
    },
    // CSS optimization
    css: {
      devSourcemap: !isProduction,
      preprocessorOptions: {
        scss: {
          additionalData: ``
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

