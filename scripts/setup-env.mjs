#!/usr/bin/env node

// Setup Environment Symlinks
// Creates symlinks from apps/.env to the root .env file

import { existsSync, symlinkSync, unlinkSync, lstatSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const rootDir = join(__dirname, '..');
const appsDir = join(rootDir, 'apps');
const rootEnv = join(rootDir, '.env');

function createSymlink(_target, linkPath) {
  const relativePath = '../../.env';

  try {
    if (existsSync(linkPath)) {
      const stats = lstatSync(linkPath);

      if (stats.isSymbolicLink()) {
        console.log(`  Skipped: ${linkPath} (symlink already exists)`);
        return;
      }

      console.log(`  Removing existing ${linkPath}`);
      unlinkSync(linkPath);
    }

    symlinkSync(relativePath, linkPath);
    console.log(`  Created: ${linkPath} -> ${relativePath}`);
  } catch (error) {
    console.error(`  Failed: ${linkPath} - ${error.message}`);
  }
}

function main() {
  console.log('\nSetting up environment symlinks...\n');

  if (!existsSync(rootEnv)) {
    console.log('Warning: Root .env file not found.');
    console.log('Copy .env.example to .env and fill in your values.\n');
  }

  const apps = existsSync(appsDir)
    ? readdirSync(appsDir, { withFileTypes: true })
        .filter((dirent) => dirent.isDirectory())
        .map((dirent) => dirent.name)
    : [];

  if (apps.length === 0) {
    console.log('No apps found in apps/ directory yet.\n');
    return;
  }

  console.log(`Found ${apps.length} app(s): ${apps.join(', ')}\n`);

  for (const app of apps) {
    const appEnvPath = join(appsDir, app, '.env');
    createSymlink(rootEnv, appEnvPath);
  }

  console.log('\nEnvironment setup complete!\n');
}

main();
