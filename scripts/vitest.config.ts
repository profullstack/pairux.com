import { defineConfig } from 'vitest/config';

/**
 * The release scripts have tests too, and they are easy to lose.
 *
 * `scripts/` is not a pnpm workspace, so it has no config of its own and was
 * only ever swept up by the root runner's repository-wide glob. Moving the root
 * to per-workspace projects would have dropped these three files silently --
 * the suite would simply have reported 171 files instead of 174 and still said
 * everything passed.
 */
export default defineConfig({
  test: {
    globals: true,
    // Plain Node tooling: version bumping, package managers, AUR submission.
    environment: 'node',
    include: ['**/*.test.ts'],
    exclude: ['**/node_modules/**'],
  },
});
