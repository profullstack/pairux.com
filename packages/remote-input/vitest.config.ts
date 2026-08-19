import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    // jsdom rather than node, unlike the other packages: this one maps browser
    // key and pointer events, so most of what it tests only exists in a
    // document. Its tests were previously run by the root config -- against the
    // node environment -- and every one that touched `window` failed.
    environment: 'jsdom',
    include: ['src/**/*.test.ts'],
  },
});
