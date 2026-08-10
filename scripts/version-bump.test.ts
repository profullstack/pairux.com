import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
// @ts-expect-error -- plain .mjs script with no type declarations
import { PACKAGES_TO_UPDATE, INDEPENDENTLY_VERSIONED } from './version-bump.mjs';

const rootDir = resolve(__dirname, '..');

const updated = PACKAGES_TO_UPDATE as string[];
const independent = INDEPENDENTLY_VERSIONED as string[];

/** Every package.json in the workspace, relative to the repo root. */
function workspacePackageFiles(): string[] {
  const found = ['package.json'];

  for (const group of ['apps', 'packages']) {
    const groupDir = join(rootDir, group);
    if (!existsSync(groupDir)) continue;

    for (const entry of readdirSync(groupDir, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const relative = `${group}/${entry.name}/package.json`;
      if (existsSync(join(rootDir, relative))) found.push(relative);
    }
  }

  return found;
}

function versionOf(relativePath: string): string {
  const pkg = JSON.parse(readFileSync(join(rootDir, relativePath), 'utf-8')) as {
    version?: string;
  };
  return pkg.version ?? '';
}

describe('version-bump package list', () => {
  // The bug this exists for: apps/livekit was missing from the list, so it sat
  // at an older version through two releases without anything complaining.
  it('accounts for every workspace package', () => {
    const unclassified = workspacePackageFiles().filter(
      (pkg) => !updated.includes(pkg) && !independent.includes(pkg)
    );

    expect(unclassified).toEqual([]);
  });

  it('does not list a package as both bumped and independent', () => {
    expect(updated.filter((pkg) => independent.includes(pkg))).toEqual([]);
  });

  it('only lists packages that exist', () => {
    const missing = [...updated, ...independent].filter((pkg) => !existsSync(join(rootDir, pkg)));

    expect(missing).toEqual([]);
  });

  // A release must not ship two different versions of itself.
  it('keeps every bumped package on the root version', () => {
    const rootVersion = versionOf('package.json');
    const drifted = updated
      .map((pkg) => ({ pkg, version: versionOf(pkg) }))
      .filter(({ version }) => version !== rootVersion);

    expect(drifted).toEqual([]);
  });
});
