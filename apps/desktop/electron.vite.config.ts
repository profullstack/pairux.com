import { defineConfig, externalizeDepsPlugin } from 'electron-vite';
import react from '@vitejs/plugin-react';
import { resolve } from 'path';
import { config } from 'dotenv';

// Load .env so build-time values can be injected via `define`
config();

export default defineConfig({
  main: {
    resolve: {
      // dbus-next has an optional legacy X11 address-discovery branch. PairUX
      // always requires DBUS_SESSION_BUS_ADDRESS for its Wayland portal path,
      // so make that unused branch resolve to a harmless local module instead
      // of emitting a runtime `require('x11')` in the AppImage.
      alias: {
        x11: resolve(__dirname, 'src/main/lib/x11-unavailable.ts'),
      },
    },
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
