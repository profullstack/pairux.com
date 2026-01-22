#!/usr/bin/env node

/**
 * Setup Environment Symlinks
 *
 * Creates symlinks from apps/*/.env to the root .env file
 * This ensures all apps share the same environment configuration
 *
 * Usage:
 *   node scripts/setup-env.mjs
 *   pnpm setup:env
 */

import { existsSync, symlinkSync, unlinkSync, lstatSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const rootDir = join(__dirname, '..');
const appsDir = join(rootDir, 'apps');
const rootEnv = join(rootDir, '.env');

/**
 * Create a symlink, removing existing file/link if present
 * @param {string} target - The target file (root .env)
 * @param {string} linkPath - The symlink path (apps/*/.env)
 */
function createSymlink(target, linkPath) {
  const relativePath = '../../.env';

  try {
    // Check if link already exists
    if (existsSync(linkPath)) {
      const stats = lstatSync(linkPath);

      if (stats.isSymbolicLink()) {
        console.log(`  ⏭️  ${linkPath} (symlink already exists)`);
        return;
      }

      // Remove existing file (not a symlink)
      console.log(`  🗑️  Removing existing ${linkPath}`);
      unlinkSync(linkPath);
    }

    // Create symlink
    symlinkSync(relativePath, linkPath);
    console.log(`  ✅ ${linkPath} -> ${relativePath}`);
  } catch (error) {
    console.error(`  ❌ Failed to create symlink: ${linkPath}`);
    console.error(`     ${error.message}`);
  }
}

function main() {
  console.log('\n🔗 Setting up environment symlinks...\n');

  // Check if root .env exists
  if (!existsSync(rootEnv)) {
    console.log('⚠️  Root .env file not found.');
    console.log('   Copy .env.example to .env and fill in your values:\n');
    console.log('   cp .env.example .env\n');
  }

  // Check if apps directory exists
  if (!existsSync(appsDir)) {
    console.log('📁 Creating apps directory...');
    // Apps will be created during project setup
  }

  // Get all app directories
  const apps = existsSync(appsDir)
    ? readdirSync(appsDir, { withFileTypes: true })
        .filter((dirent) => dirent.isDirectory())
        .map((dirent) => dirent.name)
    : [];

  if (apps.length === 0) {
    console.log('ℹ️  No apps found in apps/ directory yet.');
    console.log('   Symlinks will be created when apps are added.\n');
    return;
  }

  console.log(`📦 Found ${apps.length} app(s): ${apps.join(', ')}\n`);

  // Create symlinks for each app
  for (const app of apps) {
    const appEnvPath = join(appsDir, app, '.env');
    createSymlink(rootEnv, appEnvPath);
  }

  console.log('\n✅ Environment setup complete!\n');
}

main();
