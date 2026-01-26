/**
 * Package Managers Index
 *
 * Exports all package manager implementations and utilities.
 */

// Types
export type {
  ReleaseAsset,
  ReleaseInfo,
  PackageManagerConfig,
  SubmissionStatus,
  SubmissionResult,
  Platform,
  PackageManager,
  GitHubFile,
  PRSubmissionParams,
  CrossForkPRSubmissionParams,
  Logger,
} from './types.js';

// Base class
export { BasePackageManager } from './base.js';

// Package manager implementations
export { HomebrewPackageManager } from './homebrew.js';
export { ScoopPackageManager } from './scoop.js';
export { WingetPackageManager } from './winget.js';
export { ChocolateyPackageManager } from './chocolatey.js';
export { AURPackageManager } from './aur.js';
export { APTPackageManager } from './apt.js';
export { RPMPackageManager } from './rpm.js';
export { GentooPackageManager } from './gentoo.js';
export { NixPackageManager } from './nix.js';

import type { PackageManager, PackageManagerConfig, Logger } from './types.js';
import { HomebrewPackageManager } from './homebrew.js';
import { ScoopPackageManager } from './scoop.js';
import { WingetPackageManager } from './winget.js';
import { ChocolateyPackageManager } from './chocolatey.js';
import { AURPackageManager } from './aur.js';
import { APTPackageManager } from './apt.js';
import { RPMPackageManager } from './rpm.js';
import { GentooPackageManager } from './gentoo.js';
import { NixPackageManager } from './nix.js';

export interface AllConfigs {
  homebrew: PackageManagerConfig;
  scoop: PackageManagerConfig;
  winget: PackageManagerConfig;
  chocolatey: PackageManagerConfig;
  aur: PackageManagerConfig;
  apt: PackageManagerConfig;
  rpm: PackageManagerConfig;
  gentoo: PackageManagerConfig;
  nix: PackageManagerConfig;
}

/**
 * Create all package manager instances
 */
export function createAllPackageManagers(configs: AllConfigs, logger: Logger): PackageManager[] {
  return [
    new HomebrewPackageManager(configs.homebrew, logger),
    new ScoopPackageManager(configs.scoop, logger),
    new WingetPackageManager(configs.winget, logger),
    new ChocolateyPackageManager(configs.chocolatey, logger),
    new AURPackageManager(configs.aur, logger),
    new APTPackageManager(configs.apt, logger),
    new RPMPackageManager(configs.rpm, logger),
    new GentooPackageManager(configs.gentoo, logger),
    new NixPackageManager(configs.nix, logger),
  ].sort((a, b) => a.priority - b.priority);
}

/**
 * Get a specific package manager by name
 */
export function getPackageManager(
  name: string,
  configs: AllConfigs,
  logger: Logger
): PackageManager | undefined {
  const managers: Record<
    string,
    new (config: PackageManagerConfig, logger: Logger) => PackageManager
  > = {
    homebrew: HomebrewPackageManager,
    scoop: ScoopPackageManager,
    winget: WingetPackageManager,
    chocolatey: ChocolateyPackageManager,
    aur: AURPackageManager,
    apt: APTPackageManager,
    rpm: RPMPackageManager,
    gentoo: GentooPackageManager,
    nix: NixPackageManager,
  };

  const ManagerClass = managers[name.toLowerCase()];
  if (!ManagerClass) {
    return undefined;
  }

  const config = configs[name.toLowerCase() as keyof AllConfigs];
  return new ManagerClass(config, logger);
}

/**
 * List of all supported package manager names
 */
export const PACKAGE_MANAGER_NAMES = [
  'homebrew',
  'scoop',
  'winget',
  'chocolatey',
  'aur',
  'apt',
  'rpm',
  'gentoo',
  'nix',
] as const;

export type PackageManagerName = (typeof PACKAGE_MANAGER_NAMES)[number];
