import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const appRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const expoCli = require.resolve('expo/bin/cli');
const outputDir = mkdtempSync(join(tmpdir(), 'pairux-mobile-bundle-'));
const packageJson = JSON.parse(readFileSync(join(appRoot, 'package.json'), 'utf8'));
const expectedReactVersion = packageJson.dependencies.react;

function findSourceMaps(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return findSourceMaps(path);
    return entry.name.endsWith('.js.map') ? [path] : [];
  });
}

try {
  const exportResult = spawnSync(
    process.execPath,
    [
      expoCli,
      'export',
      '--platform',
      'android',
      '--output-dir',
      outputDir,
      '--source-maps',
      '--no-bytecode',
      '--no-minify',
      '--clear',
    ],
    { cwd: appRoot, env: { ...process.env, CI: '1' }, stdio: 'inherit' }
  );

  if (exportResult.error) {
    throw exportResult.error;
  }
  if (exportResult.status !== 0) {
    throw new Error(`Expo export failed with status ${exportResult.status ?? 'unknown'}.`);
  }

  const sourceMaps = findSourceMaps(outputDir);
  if (sourceMaps.length === 0) {
    throw new Error('Expo export did not produce a JavaScript source map.');
  }

  const reactVersions = new Set();
  for (const sourceMap of sourceMaps) {
    const { sources = [] } = JSON.parse(readFileSync(sourceMap, 'utf8'));
    for (const source of sources) {
      const match = source.match(/[/\\]react@([^/\\]+)[/\\]node_modules[/\\]react[/\\]/);
      if (match) reactVersions.add(match[1]);
    }
  }

  if (reactVersions.size !== 1 || !reactVersions.has(expectedReactVersion)) {
    throw new Error(
      `Expected only React ${expectedReactVersion} in the mobile bundle, found: ${
        [...reactVersions].join(', ') || 'none'
      }`
    );
  }

  console.log(`Mobile bundle contains one React runtime (${expectedReactVersion}).`);
} finally {
  rmSync(outputDir, { recursive: true, force: true });
}
