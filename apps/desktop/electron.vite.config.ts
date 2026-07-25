import { defineConfig, externalizeDepsPlugin } from 'electron-vite';
import react from '@vitejs/plugin-react';
import { resolve } from 'path';
import { config } from 'dotenv';

// Load .env so build-time values can be injected via `define`
config();

export default defineConfig({
  main: {
    plugins: [
      // Bundle the workspace input library into the main chunk instead of
      // leaving a bare require() for electron-builder to resolve through a
      // pnpm symlink at package time. It is pure JS; the native nut.js binding
      // it loads stays external (and asar-unpacked) as before.
      externalizeDepsPlugin({ exclude: ['@profullstack/remote-input'] }),
    ],
    build: {
      outDir: 'dist/main',
      rollupOptions: {
        input: {
          index: resolve(__dirname, 'src/main/index.ts'),
        },
      },
    },
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    build: {
      outDir: 'dist/preload',
      rollupOptions: {
        input: {
          index: resolve(__dirname, 'src/preload/index.ts'),
        },
      },
    },
  },
  renderer: {
    root: 'src/renderer',
    publicDir: resolve(__dirname, 'public'),
    build: {
      outDir: 'dist/renderer',
      rollupOptions: {
        input: {
          index: resolve(__dirname, 'src/renderer/index.html'),
        },
      },
    },
    plugins: [react()],
    resolve: {
      alias: {
        '@': resolve(__dirname, 'src/renderer'),
      },
    },
    define: {
      'process.env.NEXT_PUBLIC_LIVEKIT_URL': JSON.stringify(
        process.env.NEXT_PUBLIC_LIVEKIT_URL ?? ''
      ),
    },
  },
});
