import { defineConfig } from 'vitest/config';

/**
 * The root test runner, which delegates rather than decides.
 *
 * It used to declare `environment: 'node'` and its own `include` glob covering
 * the whole repository, which quietly overrode the `vitest.config.ts` that each
 * app and package already had. The effect was that `pnpm vitest run` from the
 * root collected all 174 test files and then ran every one of them in the wrong
 * environment, with no `@/` alias and no setup file: 91 files failed, 282 tests
 * with them, on `document is not defined`, `localStorage is not defined` and
 * `Cannot find package '@/lib/...'`.
 *
 * None of those were real. `apps/web/vitest.config.ts` has specified jsdom, the
 * alias and a setup file all along -- running the same suite through it turns
 * 16 failures into 16 passes without touching a line of test code. The tests
 * were fine; the runner above them was not, and because the failures looked
 * like ordinary broken tests the suite had stopped being able to tell anybody
 * whether a change had broken something.
 *
 * `projects` is the fix: each workspace keeps its own environment, its own
 * aliases and its own setup, and this file only says where they are. The three
 * `@/` aliases in this repo point at three different directories
 * (`apps/web/src`, `apps/mobile/src`, `apps/desktop/src/renderer`), so no single
 * root-level alias could ever have served all of them anyway.
 *
 * Every workspace listed here has tests. `apps/livekit`, `apps/turn` and
 * `apps/installer` are absent because they have none; they can be added the
 * moment they do, alongside a config of their own.
 */
export default defineConfig({
  test: {
    projects: [
      'apps/web',
      'apps/mobile',
      'apps/desktop',
      'packages/shared-types',
      'packages/ai-core',
      'packages/remote-input',
      // Not a workspace, and the reason this list is written out rather than
      // globbed: `scripts/` holds three test files that only the old
      // repository-wide glob was picking up, and a projects list of `apps/*`
      // and `packages/*` would have dropped them without saying so.
      'scripts',
    ],

    // Coverage stays here, because it is the one thing that is genuinely about
    // the repository as a whole rather than about any single workspace.
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html', 'lcov'],
      exclude: [
        'node_modules/**',
        '**/dist/**',
        '**/.next/**',
        '**/coverage/**',
        '**/*.config.{js,ts,mjs}',
        '**/scripts/**',
        '**/*.d.ts',
      ],
      thresholds: {
        lines: 70,
        functions: 70,
        branches: 70,
        statements: 70,
      },
    },
  },
});
