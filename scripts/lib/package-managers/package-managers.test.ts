/**
 * Package Managers Tests
 *
 * Tests for the package manager submission system.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { ReleaseInfo, Logger, PackageManagerConfig } from './types.js';
import { WingetPackageManager } from './winget.js';
import { HomebrewPackageManager } from './homebrew.js';
import { ScoopPackageManager } from './scoop.js';
import { AURPackageManager } from './aur.js';
import { ChocolateyPackageManager } from './chocolatey.js';
import { GentooPackageManager } from './gentoo.js';
import { NixPackageManager } from './nix.js';

// Mock fetch globally
const mockFetch = vi.fn();
global.fetch = mockFetch;

// Create a mock logger
function createMockLogger(): Logger {
  return {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    success: vi.fn(),
    debug: vi.fn(),
  };
}

// Create a sample release
function createSampleRelease(version = '1.0.0'): ReleaseInfo {
  return {
    version,
    tagName: `v${version}`,
    assets: [
      {
        name: `PairUX-${version}-x64.exe`,
        downloadUrl: `https://github.com/profullstack/pairux.com/releases/download/v${version}/PairUX-${version}-x64.exe`,
        size: 100000000,
        contentType: 'application/octet-stream',
        sha256: 'ABC123DEF456789ABCDEF0123456789ABCDEF0123456789ABCDEF0123456789A',
      },
      {
        name: `PairUX-${version}-arm64.dmg`,
        downloadUrl: `https://github.com/profullstack/pairux.com/releases/download/v${version}/PairUX-${version}-arm64.dmg`,
        size: 120000000,
        contentType: 'application/octet-stream',
        sha256: 'DEF456789ABCDEF0123456789ABCDEF0123456789ABCDEF0123456789ABCDEF01',
      },
      {
        name: `PairUX-${version}-x64.dmg`,
        downloadUrl: `https://github.com/profullstack/pairux.com/releases/download/v${version}/PairUX-${version}-x64.dmg`,
        size: 115000000,
        contentType: 'application/octet-stream',
        sha256: 'GHI789ABCDEF0123456789ABCDEF0123456789ABCDEF0123456789ABCDEF012345',
      },
      {
        name: `PairUX-${version}-x86_64.AppImage`,
        downloadUrl: `https://github.com/profullstack/pairux.com/releases/download/v${version}/PairUX-${version}-x86_64.AppImage`,
        size: 95000000,
        contentType: 'application/octet-stream',
        sha256: 'JKL012ABCDEF0123456789ABCDEF0123456789ABCDEF0123456789ABCDEF012345',
      },
    ],
    checksums: new Map([
      [
        `PairUX-${version}-x64.exe`,
        'ABC123DEF456789ABCDEF0123456789ABCDEF0123456789ABCDEF0123456789A',
      ],
      [
        `PairUX-${version}-arm64.dmg`,
        'DEF456789ABCDEF0123456789ABCDEF0123456789ABCDEF0123456789ABCDEF01',
      ],
      [
        `PairUX-${version}-x64.dmg`,
        'GHI789ABCDEF0123456789ABCDEF0123456789ABCDEF0123456789ABCDEF012345',
      ],
      [
        `PairUX-${version}-x86_64.AppImage`,
        'JKL012ABCDEF0123456789ABCDEF0123456789ABCDEF0123456789ABCDEF012345',
      ],
    ]),
    publishedAt: new Date('2024-01-15T10:00:00Z'),
    releaseUrl: `https://github.com/profullstack/pairux.com/releases/tag/v${version}`,
    isPrerelease: false,
  };
}

describe('WingetPackageManager', () => {
  let winget: WingetPackageManager;
  let logger: Logger;
  let config: PackageManagerConfig;

  beforeEach(() => {
    logger = createMockLogger();
    config = { enabled: true };
    winget = new WingetPackageManager(config, logger);
    mockFetch.mockReset();
    process.env.GITHUB_TOKEN = 'test-token';
  });

  afterEach(() => {
    delete process.env.GITHUB_TOKEN;
  });

  describe('generateManifest', () => {
    it('should generate valid WinGet manifests', async () => {
      const release = createSampleRelease('1.0.0');
      const manifests = await winget.generateManifest(release);

      expect(manifests).toHaveProperty('version');
      expect(manifests).toHaveProperty('installer');
      expect(manifests).toHaveProperty('locale');

      // Check version manifest
      expect(manifests.version).toContain('PackageIdentifier: Profullstack.PairUX');
      expect(manifests.version).toContain('PackageVersion: 1.0.0');
      expect(manifests.version).toContain('ManifestType: version');

      // Check installer manifest
      expect(manifests.installer).toContain('InstallerType: nullsoft');
      expect(manifests.installer).toContain('Architecture: x64');
      expect(manifests.installer).toContain('InstallerSha256:');

      // Check locale manifest
      expect(manifests.locale).toContain('Publisher: Profullstack, Inc.');
      expect(manifests.locale).toContain('PackageName: PairUX');
      expect(manifests.locale).toContain('License: MIT');
    });

    it('should include correct download URL in installer manifest', async () => {
      const release = createSampleRelease('2.0.0');
      const manifests = await winget.generateManifest(release);

      expect(manifests.installer).toContain(
        'InstallerUrl: https://github.com/profullstack/pairux.com/releases/download/v2.0.0/PairUX-2.0.0-x64.exe'
      );
    });

    it('should include SHA256 hash in uppercase', async () => {
      const release = createSampleRelease('1.0.0');
      const manifests = await winget.generateManifest(release);

      // SHA should be uppercase
      expect(manifests.installer).toContain(
        'ABC123DEF456789ABCDEF0123456789ABCDEF0123456789ABCDEF0123456789A'
      );
    });
  });

  describe('isConfigured', () => {
    it('should return true when enabled and token is set', async () => {
      expect(await winget.isConfigured()).toBe(true);
    });

    it('should return false when disabled', async () => {
      winget = new WingetPackageManager({ enabled: false }, logger);
      expect(await winget.isConfigured()).toBe(false);
    });

    it('should return false when no token', async () => {
      delete process.env.GITHUB_TOKEN;
      expect(await winget.isConfigured()).toBe(false);
    });
  });

  describe('checkExisting', () => {
    it('should return true if version exists in winget-pkgs', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ content: 'base64content', sha: 'abc123' }),
      });

      const exists = await winget.checkExisting('1.0.0');
      expect(exists).toBe(true);
      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining(
          'microsoft/winget-pkgs/contents/manifests/p/Profullstack/PairUX/1.0.0'
        ),
        expect.any(Object)
      );
    });

    it('should return false if version does not exist', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 404,
      });

      const exists = await winget.checkExisting('99.0.0');
      expect(exists).toBe(false);
    });
  });

  describe('submit with cross-fork PR', () => {
    it('should skip if version already exists', async () => {
      // Mock checkExisting to return true
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ content: 'base64content', sha: 'abc123' }),
      });

      const release = createSampleRelease('1.0.0');
      const result = await winget.submit(release, false);

      expect(result.status).toBe('skipped');
      expect(result.alreadyExists).toBe(true);
    });

    it('should generate manifests in dry run mode', async () => {
      // Mock checkExisting to return false
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 404,
      });

      const release = createSampleRelease('1.0.0');
      const result = await winget.submit(release, true);

      expect(result.status).toBe('skipped');
      expect(result.message).toContain('Dry run');
    });

    it('should fork repo if not exists and create PR', async () => {
      const release = createSampleRelease('1.0.0');

      // Mock responses in order:
      // 1. checkExisting - version doesn't exist
      mockFetch.mockResolvedValueOnce({ ok: false, status: 404 });
      // 2. Get user info
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ login: 'testuser' }),
      });
      // 3. Check fork exists - doesn't exist
      mockFetch.mockResolvedValueOnce({ ok: false, status: 404 });
      // 4. Create fork
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ full_name: 'testuser/winget-pkgs' }),
      });
      // 5. Sync fork
      mockFetch.mockResolvedValueOnce({ ok: true, json: () => Promise.resolve({}) });
      // 6. Check branch exists - doesn't exist
      mockFetch.mockResolvedValueOnce({ ok: false, status: 404 });
      // 7. Get base branch SHA
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ object: { sha: 'base-sha-123' } }),
      });
      // 8. Create branch
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ ref: 'refs/heads/pairux-1.0.0' }),
      });
      // 9-11. Create/update 3 manifest files
      for (let i = 0; i < 3; i++) {
        mockFetch.mockResolvedValueOnce({ ok: false, status: 404 }); // file doesn't exist
        mockFetch.mockResolvedValueOnce({
          ok: true,
          json: () =>
            Promise.resolve({ content: { sha: `file-sha-${String(i)}`, html_url: 'https://...' } }),
        });
      }
      // 12. Check for existing PR - none
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve([]),
      });
      // 13. Create PR
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () =>
          Promise.resolve({
            number: 12345,
            html_url: 'https://github.com/microsoft/winget-pkgs/pull/12345',
          }),
      });

      const result = await winget.submit(release, false);

      expect(result.status).toBe('success');
      expect(result.prUrl).toContain('microsoft/winget-pkgs/pull/12345');
    });
  });
});

describe('HomebrewPackageManager', () => {
  let homebrew: HomebrewPackageManager;
  let logger: Logger;

  beforeEach(() => {
    logger = createMockLogger();
    homebrew = new HomebrewPackageManager(
      {
        enabled: true,
        additionalConfig: {
          tapOwner: 'profullstack',
          tapRepo: 'homebrew-pairux',
        },
      },
      logger
    );
    mockFetch.mockReset();
    process.env.GITHUB_TOKEN = 'test-token';
  });

  afterEach(() => {
    delete process.env.GITHUB_TOKEN;
  });

  describe('generateManifest', () => {
    it('should generate valid Homebrew cask', async () => {
      const release = createSampleRelease('1.0.0');
      const cask = await homebrew.generateManifest(release);

      expect(cask).toContain('cask "pairux"');
      expect(cask).toContain('version "1.0.0"');
      expect(cask).toContain('homepage "https://pairux.com"');
      expect(cask).toContain('app "PairUX.app"');
    });

    it('should include both arm64 and x64 URLs', async () => {
      const release = createSampleRelease('1.0.0');
      const cask = await homebrew.generateManifest(release);

      // Homebrew uses on_arm and on_intel blocks
      expect(cask).toContain('on_arm do');
      expect(cask).toContain('on_intel do');
    });
  });
});

describe('ScoopPackageManager', () => {
  let scoop: ScoopPackageManager;
  let logger: Logger;

  beforeEach(() => {
    logger = createMockLogger();
    scoop = new ScoopPackageManager(
      {
        enabled: true,
        additionalConfig: {
          bucketOwner: 'profullstack',
          bucketRepo: 'scoop-pairux',
        },
      },
      logger
    );
    mockFetch.mockReset();
    process.env.GITHUB_TOKEN = 'test-token';
  });

  afterEach(() => {
    delete process.env.GITHUB_TOKEN;
  });

  describe('generateManifest', () => {
    it('should generate valid Scoop manifest JSON', async () => {
      const release = createSampleRelease('1.0.0');
      const manifest = await scoop.generateManifest(release);
      const json = JSON.parse(manifest);

      expect(json.version).toBe('1.0.0');
      expect(json.homepage).toBe('https://pairux.com');
      expect(json.license).toBe('MIT');
      expect(json.url).toContain('github.com');
      expect(json.hash).toBeDefined();
    });
  });
});

describe('AURPackageManager', () => {
  let aur: AURPackageManager;
  let logger: Logger;

  beforeEach(() => {
    logger = createMockLogger();
    aur = new AURPackageManager({ enabled: true }, logger);
    mockFetch.mockReset();
  });

  describe('generateManifest', () => {
    it('should generate valid PKGBUILD', async () => {
      const release = createSampleRelease('1.0.0');
      const pkgbuild = await aur.generateManifest(release);

      expect(pkgbuild).toContain('pkgname=pairux-bin');
      expect(pkgbuild).toContain('pkgver=1.0.0');
      expect(pkgbuild).toContain('pkgrel=1');
      expect(pkgbuild).toContain("arch=('x86_64')");
      expect(pkgbuild).toContain("license=('MIT')");
      expect(pkgbuild).toContain("provides=('pairux')");
    });

    it('should include AppImage download URL', async () => {
      const release = createSampleRelease('1.0.0');
      const pkgbuild = await aur.generateManifest(release);

      expect(pkgbuild).toContain('.AppImage');
      expect(pkgbuild).toContain('github.com/profullstack/pairux.com/releases');
    });
  });

  describe('checkExisting', () => {
    it('should query AUR RPC API', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ results: [{ Version: '1.0.0-1' }] }),
      });

      const exists = await aur.checkExisting('1.0.0');
      expect(exists).toBe(true);
      expect(mockFetch).toHaveBeenCalledWith(expect.stringContaining('aur.archlinux.org/rpc'));
    });

    it('should handle version suffix correctly', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ results: [{ Version: '1.0.0-2' }] }),
      });

      // Should match 1.0.0 even if AUR has 1.0.0-2
      const exists = await aur.checkExisting('1.0.0');
      expect(exists).toBe(true);
    });
  });
});

describe('ChocolateyPackageManager', () => {
  let chocolatey: ChocolateyPackageManager;
  let logger: Logger;

  beforeEach(() => {
    logger = createMockLogger();
    chocolatey = new ChocolateyPackageManager({ enabled: true }, logger);
    mockFetch.mockReset();
    process.env.CHOCOLATEY_API_KEY = 'test-api-key';
  });

  afterEach(() => {
    delete process.env.CHOCOLATEY_API_KEY;
  });

  describe('generateManifest', () => {
    it('should generate valid nuspec and install scripts', async () => {
      const release = createSampleRelease('1.0.0');
      const files = await chocolatey.generateManifest(release);

      // Should return multiple files
      expect(files).toHaveProperty('pairux.nuspec');
      expect(files).toHaveProperty('tools/chocolateyInstall.ps1');
      expect(files).toHaveProperty('tools/chocolateyUninstall.ps1');

      // Check nuspec content
      const nuspec = files['pairux.nuspec'];
      expect(nuspec).toContain('<id>pairux</id>');
      expect(nuspec).toContain('<version>1.0.0</version>');
      expect(nuspec).toContain('<authors>Profullstack, Inc.</authors>');
      expect(nuspec).toContain('<projectUrl>https://pairux.com</projectUrl>');
    });
  });

  describe('isConfigured', () => {
    it('should require CHOCOLATEY_API_KEY', async () => {
      expect(await chocolatey.isConfigured()).toBe(true);

      delete process.env.CHOCOLATEY_API_KEY;
      expect(await chocolatey.isConfigured()).toBe(false);
    });
  });
});

describe('GentooPackageManager', () => {
  let gentoo: GentooPackageManager;
  let logger: Logger;

  beforeEach(() => {
    logger = createMockLogger();
    gentoo = new GentooPackageManager({ enabled: true }, logger);
    mockFetch.mockReset();
    process.env.GITHUB_TOKEN = 'test-token';
  });

  afterEach(() => {
    delete process.env.GITHUB_TOKEN;
  });

  describe('generateManifest', () => {
    it('should generate valid ebuild and supporting files', async () => {
      const release = createSampleRelease('1.0.0');
      const files = await gentoo.generateManifest(release);

      // Should have multiple files including ebuild
      const keys = Object.keys(files);
      expect(keys.some((k) => k.endsWith('.ebuild'))).toBe(true);
      expect(keys.some((k) => k.includes('metadata.xml'))).toBe(true);

      // Check ebuild content
      const ebuildKey = keys.find((k) => k.endsWith('.ebuild'))!;
      const ebuild = files[ebuildKey];
      expect(ebuild).toContain('EAPI=8');
      expect(ebuild).toContain('DESCRIPTION="Collaborative screen sharing');
      expect(ebuild).toContain('HOMEPAGE="https://pairux.com"');
      expect(ebuild).toContain('LICENSE="MIT"');
      expect(ebuild).toContain('SLOT="0"');
    });
  });
});

describe('NixPackageManager', () => {
  let nix: NixPackageManager;
  let logger: Logger;

  beforeEach(() => {
    logger = createMockLogger();
    nix = new NixPackageManager({ enabled: true }, logger);
    mockFetch.mockReset();
    process.env.GITHUB_TOKEN = 'test-token';
  });

  afterEach(() => {
    delete process.env.GITHUB_TOKEN;
  });

  describe('generateManifest', () => {
    it('should generate valid Nix expression', async () => {
      const release = createSampleRelease('1.0.0');
      const nixExpr = await nix.generateManifest(release);

      expect(nixExpr).toContain('pname = "pairux"');
      expect(nixExpr).toContain('version = "1.0.0"');
      // Nix uses `meta = with lib;` syntax
      expect(nixExpr).toContain('meta = with lib;');
      expect(nixExpr).toContain('homepage = "https://pairux.com"');
      expect(nixExpr).toContain('license = licenses.mit');
    });
  });
});
