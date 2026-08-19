import { defineConfig } from 'vitest/config';
import { resolve } from 'path';

/**
 * The release scripts have tests, and they are easy to lose.
 *
 * This config already existed, for running `vitest` from inside `scripts/`.
 * What it was not was *reachable from the root* -- `scripts/` is not a pnpm
 * workspace, so a projects list of `apps/*` and `packages/*` skips it, and the
 * three test files here would have gone from being swept up by the old
 * repository-wide glob to not running at all. The suite would have reported 171
 * files, every one passing, which is the shape of a problem nobody notices.
 *
 * Hence the explicit entry in the root config's `projects`.
 */
export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    root: resolve(__dirname),
    include: ['**/*.test.ts'],
    testTimeout: 10000,
  },
});
