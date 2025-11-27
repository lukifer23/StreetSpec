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
        jsxImportSource: undefined,
        babel: {
          plugins: isProduction ? [
            ['@babel/plugin-transform-react-jsx', { runtime: 'automatic' }]
          ] : []
        }
      }),
      // Plugin to handle React CommonJS exports properly
      {
        name: 'react-cjs-interop',
        resolveId(id) {
          if (id === 'react' || id.startsWith('react/')) {
            return null; // Let Vite handle it normally
          }
          return null;
        },
        transform(code, id) {
          // Ensure React.Component is accessible
          if (id.includes('ErrorBoundary.tsx')) {
            // Replace React import patterns if needed
            return null; // Let normal transform handle it
          }
          return null;
        }
      },
      electron([
        {
          // Main process entry
          entry: 'electron/main.ts',
          onstart(options) {
            options.startup();
            // Improved suppression of Windows taskkill "process not found" errors
            const originalStdoutWrite = process.stdout.write.bind(process.stdout);
            const originalStderrWrite = process.stderr.write.bind(process.stderr);

            process.stdout.write = (chunk: any, encoding?: any) => {
              if (typeof chunk === 'string' && chunk.includes('ERROR: The process') && chunk.includes('not found')) {
                console.log('[vite-plugin-electron] Suppressed process not found error');
                return true;
              }
              return originalStdoutWrite(chunk, encoding);
            };

            process.stderr.write = (chunk: any, encoding?: any) => {
              if (typeof chunk === 'string' && chunk.includes('ERROR: The process') && chunk.includes('not found')) {
                console.log('[vite-plugin-electron] Suppressed process not found error');
                return true;
              }
              return originalStderrWrite(chunk, encoding);
            };
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
          assetFileNames: isProduction ? 'assets/[name]-[hash].[ext]' : 'assets/[name].[ext]',
          // Ensure proper interop for CommonJS modules - create default export
          interop: 'default', // Create default export from CJS modules
          exports: 'auto'
        },
        // Handle CommonJS modules properly
        external: (_id) => {
          // Don't externalize react-window, we want it bundled
          return false;
        },
        plugins: [
          // Note: Vite already includes commonjs plugin, but we can configure it here if needed
        ]
      },
      commonjsOptions: {
        include: [/react-window/, /node_modules\/react-window/, /react-window-infinite-loader/, /react/, /node_modules\/react/, /zustand/, /scheduler/, /lz-string/],
        transformMixedEsModules: true,
        defaultIsModuleExports: true, // Create default export from module.exports for React
        requireReturnsDefault: true, // require() returns default export
        // Ensure named exports are preserved for react-window, scheduler, and lz-string
        namedExports: {
          'react-window': ['FixedSizeList', 'VariableSizeList', 'FixedSizeGrid', 'VariableSizeGrid'],
          'react-window-infinite-loader': ['InfiniteLoader'],
          'scheduler': ['unstable_NormalPriority', 'unstable_runWithPriority', 'unstable_next'],
          'lz-string': ['compress', 'decompress', 'compressToUTF16', 'decompressFromUTF16']
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
      dedupe: ['react', 'react-dom'],
      // Ensure proper resolution of CommonJS modules
      conditions: ['import', 'module', 'browser', 'default'],
      // Prefer ESM but allow CJS fallback
      mainFields: ['module', 'main']
    },
      // Ensure React CommonJS interop works correctly  
      // Note: This is separate from build.commonjsOptions - this is at root level
      // React CJS interop is handled via the build.commonjsOptions below
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
        'react-window',
        'react-window-infinite-loader',
        'scheduler'
      ],
      exclude: ['electron'],
      esbuildOptions: {
        // Handle CommonJS modules
        target: 'esnext'
      },
      // Force re-optimization of react-window
      force: false
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

