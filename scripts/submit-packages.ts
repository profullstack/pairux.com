#!/usr/bin/env npx tsx

/**
 * Submit Packages Script
 *
 * Automatically submits PairUX releases to various package managers.
 *
 * Usage:
 *   npx tsx scripts/submit-packages.ts [options]
 *
 * Options:
 *   -v, --version <version>        Version to submit (default: latest git tag)
 *   -p, --package-manager <name>   Package manager(s) to submit to (can repeat)
 *   -d, --dry-run                  Generate manifests without submitting
 *   --skip-existing                Skip if version already exists (default: true)
 *   -h, --help                     Show this help message
 *
 * Package Managers:
 *   homebrew    macOS Homebrew Cask
 *   scoop       Windows Scoop bucket
 *   winget      Windows Package Manager
 *   chocolatey  Windows Chocolatey
 *   aur         Arch User Repository
 *   apt         Debian/Ubuntu APT repository
 *   rpm         Fedora/RHEL RPM repository
 *   gentoo      Gentoo ebuild overlay
 *   nix         Nix/NixOS package
 *   all         All configured package managers
 *
 * Environment Variables:
 *   GITHUB_TOKEN           Required for all submissions
 *   AUR_SSH_KEY            Required for AUR (base64 encoded)
 *   GPG_PRIVATE_KEY        Required for APT/RPM (base64 encoded)
 *   GPG_PASSPHRASE         Optional GPG passphrase
 *   CHOCOLATEY_API_KEY     Required for Chocolatey
 */

import { parseArgs } from 'node:util';
import { readFileSync, existsSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  createAllPackageManagers,
  getPackageManager,
  PACKAGE_MANAGER_NAMES,
  type ReleaseInfo,
  type ReleaseAsset,
  type SubmissionResult,
  type Logger,
  type AllConfigs,
  type PackageManager,
} from './lib/package-managers/index.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const rootDir = join(__dirname, '..');

const GITHUB_REPO = 'profullstack/pairux.com';

// Colors for terminal output
const colors = {
  reset: '\x1b[0m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  cyan: '\x1b[36m',
  gray: '\x1b[90m',
};

/**
 * Create a logger instance
 */
function createLogger(prefix: string): Logger {
  const timestamp = () => new Date().toISOString().split('T')[1].slice(0, 8);

  return {
    info: (message, ...args) => {
      console.log(
        `${colors.gray}[${timestamp()}]${colors.reset} ${colors.blue}[${prefix}]${colors.reset} ${message}`,
        ...args
      );
    },
    warn: (message, ...args) => {
      console.log(
        `${colors.gray}[${timestamp()}]${colors.reset} ${colors.yellow}[${prefix}] WARN:${colors.reset} ${message}`,
        ...args
      );
    },
    error: (message, ...args) => {
      console.error(
        `${colors.gray}[${timestamp()}]${colors.reset} ${colors.red}[${prefix}] ERROR:${colors.reset} ${message}`,
        ...args
      );
    },
    success: (message, ...args) => {
      console.log(
        `${colors.gray}[${timestamp()}]${colors.reset} ${colors.green}[${prefix}] SUCCESS:${colors.reset} ${message}`,
        ...args
      );
    },
    debug: (message, ...args) => {
      if (process.env.DEBUG) {
        console.log(
          `${colors.gray}[${timestamp()}] [${prefix}] DEBUG: ${message}${colors.reset}`,
          ...args
        );
      }
    },
  };
}

const logger = createLogger('submit-packages');

/**
 * Parse command line arguments
 */
function parseArguments() {
  const { values } = parseArgs({
    options: {
      version: { type: 'string', short: 'v' },
      'package-manager': { type: 'string', short: 'p', multiple: true },
      'dry-run': { type: 'boolean', short: 'd', default: false },
      'skip-existing': { type: 'boolean', default: true },
      help: { type: 'boolean', short: 'h' },
    },
  });

  return values;
}

/**
 * Show help message
 */
function showHelp(): void {
  console.log(`
${colors.cyan}PairUX Package Submission Script${colors.reset}

${colors.yellow}Usage:${colors.reset}
  npx tsx scripts/submit-packages.ts [options]

${colors.yellow}Options:${colors.reset}
  -v, --version <version>        Version to submit (default: latest git tag)
  -p, --package-manager <name>   Package manager(s) to submit to (can repeat)
  -d, --dry-run                  Generate manifests without submitting
  --skip-existing                Skip if version already exists (default: true)
  -h, --help                     Show this help message

${colors.yellow}Package Managers:${colors.reset}
  homebrew    macOS Homebrew Cask
  scoop       Windows Scoop bucket
  winget      Windows Package Manager
  chocolatey  Windows Chocolatey
  aur         Arch User Repository
  apt         Debian/Ubuntu APT repository
  rpm         Fedora/RHEL RPM repository
  gentoo      Gentoo ebuild overlay
  nix         Nix/NixOS package
  all         All configured package managers

${colors.yellow}Environment Variables:${colors.reset}
  GITHUB_TOKEN           Required for all submissions
  AUR_SSH_KEY            Required for AUR (base64 encoded)
  GPG_PRIVATE_KEY        Required for APT/RPM (base64 encoded)
  GPG_PASSPHRASE         Optional GPG passphrase
  CHOCOLATEY_API_KEY     Required for Chocolatey

${colors.yellow}Examples:${colors.reset}
  npx tsx scripts/submit-packages.ts --dry-run
  npx tsx scripts/submit-packages.ts -v 0.1.7 -p homebrew -p winget
  npx tsx scripts/submit-packages.ts --package-manager all
`);
}

/**
 * Get version from git tag or package.json
 */
async function getVersion(requestedVersion?: string): Promise<string> {
  if (requestedVersion) {
    return requestedVersion.replace(/^v/, '');
  }

  // Try to get from latest git tag
  try {
    const tag = execSync('git describe --tags --abbrev=0', {
      cwd: rootDir,
      encoding: 'utf-8',
    }).trim();
    return tag.replace(/^v/, '');
  } catch {
    // Fall back to package.json
    const pkgPath = join(rootDir, 'package.json');
    const pkg = JSON.parse(readFileSync(pkgPath, 'utf-8'));
    return pkg.version;
  }
}

/**
 * Fetch release info from GitHub
 */
async function fetchReleaseInfo(version: string): Promise<ReleaseInfo | null> {
  const token = process.env.GITHUB_TOKEN;
  const headers: Record<string, string> = {
    Accept: 'application/vnd.github.v3+json',
    'User-Agent': 'PairUX-Submit-Packages',
  };
  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }

  try {
    const response = await fetch(
      `https://api.github.com/repos/${GITHUB_REPO}/releases/tags/v${version}`,
      { headers }
    );

    if (!response.ok) {
      return null;
    }

    const data = (await response.json()) as {
      tag_name: string;
      assets: {
        name: string;
        browser_download_url: string;
        size: number;
        content_type: string;
      }[];
      published_at: string;
      html_url: string;
      prerelease: boolean;
    };

    const assets: ReleaseAsset[] = data.assets.map((asset) => ({
      name: asset.name,
      downloadUrl: asset.browser_download_url,
      size: asset.size,
      contentType: asset.content_type,
    }));

    return {
      version,
      tagName: data.tag_name,
      assets,
      checksums: new Map(),
      publishedAt: new Date(data.published_at),
      releaseUrl: data.html_url,
      isPrerelease: data.prerelease,
    };
  } catch (error) {
    logger.error(`Failed to fetch release info: ${error}`);
    return null;
  }
}

/**
 * Fetch checksums from release
 */
async function fetchChecksums(version: string): Promise<Map<string, string>> {
  const checksums = new Map<string, string>();

  try {
    const response = await fetch(
      `https://github.com/${GITHUB_REPO}/releases/download/v${version}/SHA256SUMS.txt`
    );

    if (response.ok) {
      const text = await response.text();
      for (const line of text.split('\n')) {
        const match = /^([a-f0-9]{64})\s+(.+)$/.exec(line);
        if (match) {
          checksums.set(match[2], match[1]);
        }
      }
    }
  } catch {
    logger.warn('Could not fetch checksums file');
  }

  return checksums;
}

/**
 * Load configuration for package managers
 */
function loadConfig(): AllConfigs {
  const defaultConfig: AllConfigs = {
    homebrew: {
      enabled: true,
      additionalConfig: {
        tapOwner: 'profullstack',
        tapRepo: 'homebrew-pairux',
      },
    },
    scoop: {
      enabled: true,
      additionalConfig: {
        bucketOwner: 'profullstack',
        bucketRepo: 'scoop-pairux',
      },
    },
    winget: {
      enabled: true,
    },
    chocolatey: {
      enabled: !!process.env.CHOCOLATEY_API_KEY,
    },
    aur: {
      enabled: !!process.env.AUR_SSH_KEY,
    },
    apt: {
      enabled: !!process.env.GPG_PRIVATE_KEY,
      additionalConfig: {
        repoOwner: 'profullstack',
        repoName: 'pairux-apt',
      },
    },
    rpm: {
      enabled: !!process.env.GPG_PRIVATE_KEY,
      additionalConfig: {
        repoOwner: 'profullstack',
        repoName: 'pairux-rpm',
      },
    },
    gentoo: {
      enabled: true,
    },
    nix: {
      enabled: true,
    },
  };

  // Look for optional config file
  const configPath = join(rootDir, '.package-managers.json');
  if (existsSync(configPath)) {
    try {
      const fileConfig = JSON.parse(readFileSync(configPath, 'utf-8'));
      return { ...defaultConfig, ...fileConfig };
    } catch {
      // Use defaults
    }
  }

  return defaultConfig;
}

/**
 * Main function
 */
async function main(): Promise<void> {
  const args = parseArguments();

  if (args.help) {
    showHelp();
    process.exit(0);
  }

  console.log(`
${colors.cyan}╔════════════════════════════════════════════════════════════╗
║           PairUX Package Submission Script                 ║
╚════════════════════════════════════════════════════════════╝${colors.reset}
`);

  // Check for GITHUB_TOKEN
  if (!process.env.GITHUB_TOKEN) {
    logger.error('GITHUB_TOKEN environment variable is required');
    process.exit(1);
  }

  // Load configuration
  const config = loadConfig();
  const version = await getVersion(args.version);

  logger.info(`Version: ${colors.cyan}${version}${colors.reset}`);
  logger.info(`Dry run: ${args['dry-run'] ? 'yes' : 'no'}`);
  logger.info(`Skip existing: ${args['skip-existing'] ? 'yes' : 'no'}`);

  // Fetch release info from GitHub
  logger.info('Fetching release information from GitHub...');
  const releaseInfo = await fetchReleaseInfo(version);

  if (!releaseInfo) {
    logger.error(`Release v${version} not found on GitHub`);
    logger.info(
      `Make sure the release exists at: https://github.com/${GITHUB_REPO}/releases/tag/v${version}`
    );
    process.exit(1);
  }

  logger.success(`Found release with ${releaseInfo.assets.length} assets`);

  // Fetch checksums
  logger.info('Fetching checksums...');
  releaseInfo.checksums = await fetchChecksums(version);
  logger.info(`Found ${releaseInfo.checksums.size} checksums`);

  // Map checksums to assets
  // Note: checksums file may have spaces in filename (e.g., "PairUX Setup 0.1.17.exe")
  // while GitHub asset has dots (e.g., "PairUX.Setup.0.1.17.exe")
  for (const asset of releaseInfo.assets) {
    // Try exact match first
    let checksum = releaseInfo.checksums.get(asset.name);

    // If not found, try replacing "PairUX.Setup" with "PairUX Setup"
    if (!checksum && asset.name.startsWith('PairUX.Setup.')) {
      const nameWithSpaces = asset.name.replace('PairUX.Setup.', 'PairUX Setup ');
      checksum = releaseInfo.checksums.get(nameWithSpaces);
    }

    if (checksum) {
      asset.sha256 = checksum;
    }
  }

  // Get package managers to run
  const selectedPMs = args['package-manager'] ?? ['all'];
  let managers: PackageManager[];

  if (selectedPMs.includes('all')) {
    managers = createAllPackageManagers(config, logger);
  } else {
    managers = selectedPMs
      .map((name) => getPackageManager(name, config, logger))
      .filter((pm): pm is PackageManager => pm !== undefined);
  }

  // Filter by configured
  const configuredManagers: PackageManager[] = [];
  for (const pm of managers) {
    if (await pm.isConfigured()) {
      configuredManagers.push(pm);
    } else {
      logger.warn(`${pm.displayName}: Not configured, skipping`);
    }
  }

  if (configuredManagers.length === 0) {
    logger.error('No package managers are configured');
    process.exit(1);
  }

  logger.info(
    `Package managers to process: ${configuredManagers.map((pm) => pm.displayName).join(', ')}`
  );

  // Process each package manager
  const results: SubmissionResult[] = [];

  for (const pm of configuredManagers) {
    console.log(`
${colors.cyan}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  ${pm.displayName}
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${colors.reset}
`);

    try {
      // Check if already exists
      if (args['skip-existing']) {
        const exists = await pm.checkExisting(version);
        if (exists) {
          logger.info(`Version ${version} already exists, skipping`);
          results.push({
            packageManager: pm.name,
            status: 'skipped',
            message: `Version ${version} already exists`,
            alreadyExists: true,
          });
          continue;
        }
      }

      // Submit
      const result = await pm.submit(releaseInfo, args['dry-run']);
      results.push(result);

      if (result.status === 'success') {
        logger.success(result.message);
        if (result.prUrl) {
          logger.info(`PR: ${result.prUrl}`);
        }
        if (result.commitUrl) {
          logger.info(`Commit: ${result.commitUrl}`);
        }
      } else if (result.status === 'failed') {
        logger.error(result.message);
      } else {
        logger.info(result.message);
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      results.push({
        packageManager: pm.name,
        status: 'failed',
        message: errorMessage,
        error: error instanceof Error ? error : new Error(errorMessage),
      });
      logger.error(`Error: ${errorMessage}`);
    }
  }

  // Summary
  console.log(`
${colors.cyan}╔════════════════════════════════════════════════════════════╗
║                      SUMMARY                               ║
╚════════════════════════════════════════════════════════════╝${colors.reset}
`);

  const successful = results.filter((r) => r.status === 'success');
  const failed = results.filter((r) => r.status === 'failed');
  const skipped = results.filter((r) => r.status === 'skipped');

  console.log(`${colors.green}Successful: ${successful.length}${colors.reset}`);
  console.log(`${colors.red}Failed: ${failed.length}${colors.reset}`);
  console.log(`${colors.yellow}Skipped: ${skipped.length}${colors.reset}`);

  if (successful.length > 0) {
    console.log(`\n${colors.green}Successful submissions:${colors.reset}`);
    for (const r of successful) {
      const extra = r.prUrl ? ` - ${r.prUrl}` : r.commitUrl ? ` - ${r.commitUrl}` : '';
      console.log(`  ${colors.green}✓${colors.reset} ${r.packageManager}${extra}`);
    }
  }

  if (skipped.length > 0) {
    console.log(`\n${colors.yellow}Skipped:${colors.reset}`);
    for (const r of skipped) {
      console.log(`  ${colors.yellow}○${colors.reset} ${r.packageManager}: ${r.message}`);
    }
  }

  if (failed.length > 0) {
    console.log(`\n${colors.red}Failed submissions:${colors.reset}`);
    for (const r of failed) {
      console.log(`  ${colors.red}✗${colors.reset} ${r.packageManager}: ${r.message}`);
    }
    process.exit(1);
  }
}

main().catch((error) => {
  logger.error('Fatal error:', error);
  process.exit(1);
});
