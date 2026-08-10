#!/usr/bin/env node

/**
 * Version Bump Script for PairUX Monorepo
 *
 * Usage:
 *   pnpm version:bump major|minor|patch
 *   pnpm version:major
 *   pnpm version:minor
 *   pnpm version:patch
 *
 * This script:
 * 1. Bumps version in root package.json
 * 2. Bumps version in apps/desktop/package.json
 * 3. Bumps version in apps/web/package.json
 * 4. Creates a git commit with the version change
 * 5. Creates a git tag (v1.2.3)
 */

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const rootDir = join(__dirname, '..');

/**
 * Every workspace package whose version tracks the app release.
 *
 * Omitting one leaves it pinned at whatever release last touched it by hand,
 * and the drift stays invisible until something ships with two different
 * versions inside it. `version-bump.test.ts` fails if a new workspace package
 * appears in neither this list nor INDEPENDENTLY_VERSIONED below.
 */
export const PACKAGES_TO_UPDATE = [
  'package.json',
  'apps/web/package.json',
  'apps/desktop/package.json',
  'apps/installer/package.json',
  'apps/livekit/package.json',
  'apps/turn/package.json',
  'packages/shared-types/package.json',
];

/**
 * Packages deliberately left out: their versions mean something else.
 *
 * - packages/remote-input is published to npm on its own cadence
 * - packages/ai-core and apps/mobile are not part of the app release yet
 */
export const INDEPENDENTLY_VERSIONED = [
  'apps/mobile/package.json',
  'packages/ai-core/package.json',
  'packages/remote-input/package.json',
];

/**
 * @param {string} version
 * @param {'major' | 'minor' | 'patch'} type
 * @returns {string}
 */
function bumpVersion(version, type) {
  const parts = version.split('.').map(Number);

  if (parts.length !== 3 || parts.some(isNaN)) {
    throw new Error(`Invalid version format: ${version}`);
  }

  const [major, minor, patch] = parts;

  switch (type) {
    case 'major':
      return `${major + 1}.0.0`;
    case 'minor':
      return `${major}.${minor + 1}.0`;
    case 'patch':
      return `${major}.${minor}.${patch + 1}`;
    default:
      throw new Error(`Invalid bump type: ${type}. Use major, minor, or patch.`);
  }
}

/**
 * @param {string} filePath
 * @param {string} newVersion
 */
function updatePackageJson(filePath, newVersion) {
  if (!existsSync(filePath)) {
    console.log(`  ⚠️  Skipping ${filePath} (not found)`);
    return false;
  }

  const content = readFileSync(filePath, 'utf-8');
  const pkg = JSON.parse(content);
  const oldVersion = pkg.version;
  pkg.version = newVersion;

  writeFileSync(filePath, JSON.stringify(pkg, null, 2) + '\n');
  console.log(`  ✅ ${filePath}: ${oldVersion} → ${newVersion}`);
  return true;
}

/**
 * @param {string} command
 * @param {boolean} silent
 */
function exec(command, silent = false) {
  try {
    return execSync(command, {
      cwd: rootDir,
      stdio: silent ? 'pipe' : 'inherit',
      encoding: 'utf-8',
    });
  } catch (error) {
    if (!silent) {
      console.error(`Command failed: ${command}`);
    }
    throw error;
  }
}

function checkGitStatus() {
  const status = exec('git status --porcelain', true);
  if (status && status.trim()) {
    console.error('❌ Working directory is not clean. Commit or stash changes first.');
    console.error('\nUncommitted changes:');
    console.error(status);
    process.exit(1);
  }
}

function main() {
  const args = process.argv.slice(2);
  const fromHook = args.includes('--from-hook');
  const bumpType = args.find((a) => !a.startsWith('--'));

  if (!bumpType || !['major', 'minor', 'patch'].includes(bumpType)) {
    console.error('Usage: pnpm version:bump <major|minor|patch>');
    console.error('\nExamples:');
    console.error('  pnpm version:bump patch  # 0.1.0 → 0.1.1');
    console.error('  pnpm version:bump minor  # 0.1.0 → 0.2.0');
    console.error('  pnpm version:bump major  # 0.1.0 → 1.0.0');
    process.exit(1);
  }

  if (!fromHook) {
    console.log('\n🔍 Checking git status...');
    checkGitStatus();
  }

  // Read current version from root package.json
  const rootPkgPath = join(rootDir, 'package.json');
  const rootPkg = JSON.parse(readFileSync(rootPkgPath, 'utf-8'));
  const currentVersion = rootPkg.version;
  const newVersion = bumpVersion(currentVersion, bumpType);

  console.log(`\n📦 Bumping version: ${currentVersion} → ${newVersion} (${bumpType})\n`);

  console.log('📝 Updating package.json files:');
  for (const pkg of PACKAGES_TO_UPDATE) {
    updatePackageJson(join(rootDir, pkg), newVersion);
  }

  // Git operations
  console.log('\n🔖 Creating git commit and tag...');

  try {
    exec(`git add ${PACKAGES_TO_UPDATE.join(' ')}`);
    exec(`git commit --no-verify -m "chore(release): v${newVersion}"`);
    exec(`git tag -a v${newVersion} -m "Release v${newVersion}"`);

    console.log(`\n✅ Version bumped to v${newVersion}`);
    console.log('\n📋 Next steps:');
    console.log('  1. Review the changes: git log --oneline -3');
    console.log('  2. Push to remote: git push --follow-tags');
    console.log('  3. CI will build and create the release');
  } catch (error) {
    console.error('\n❌ Git operations failed. Rolling back...');
    exec('git checkout -- .', true);
    throw error;
  }
}

// Only bump when run as a command. Importing this module — as the tests do, to
// check the package list — must not rewrite every package.json and tag a release.
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main();
}
