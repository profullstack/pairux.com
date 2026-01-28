/**
 * Arch User Repository (AUR)
 *
 * Pushes PKGBUILD to aur.archlinux.org via SSH.
 */

import { execSync } from 'node:child_process';
import { writeFileSync, mkdirSync, rmSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { BasePackageManager } from './base.js';
import type { ReleaseInfo, SubmissionResult } from './types.js';

const AUR_SSH_HOST = 'aur@aur.archlinux.org';
const PACKAGE_NAME = 'pairux-bin';

export class AURPackageManager extends BasePackageManager {
  readonly name = 'aur';
  readonly displayName = 'AUR';
  readonly platform = 'linux' as const;
  readonly priority = 4;

  isConfigured(): Promise<boolean> {
    // AUR requires SSH key
    return Promise.resolve(this.config.enabled && !!process.env.AUR_SSH_KEY);
  }

  async checkExisting(version: string): Promise<boolean> {
    try {
      // Check AUR RPC API
      const response = await fetch(`https://aur.archlinux.org/rpc/v5/info?arg[]=${PACKAGE_NAME}`);
      const data = (await response.json()) as {
        results: { Version: string }[];
      };

      if (data.results.length === 0) return false;

      // AUR version format might have -1 suffix
      const aurVersion = data.results[0].Version.replace(/-\d+$/, '');
      return aurVersion === version;
    } catch {
      return false;
    }
  }

  generateManifest(release: ReleaseInfo): Promise<string> {
    // Find the AppImage for x86_64
    const appImage = this.findAsset(
      release,
      (a) => a.name.includes('x86_64') && a.name.endsWith('.AppImage')
    );

    const sha256 = appImage?.sha256 ?? 'SKIP';

    const pkgbuild = `# Maintainer: PairUX Team <hello@pairux.com>
pkgname=${PACKAGE_NAME}
pkgver=${release.version}
pkgrel=1
pkgdesc="Collaborative screen sharing with remote control"
arch=('x86_64')
url="https://pairux.com"
license=('MIT')
depends=('gtk3' 'libnotify' 'nss' 'libxss' 'libxtst' 'xdg-utils' 'at-spi2-core' 'util-linux-libs' 'fuse2')
provides=('pairux')
conflicts=('pairux' 'pairux-git')
options=('!strip')
source=("PairUX-\${pkgver}.AppImage::https://github.com/profullstack/pairux.com/releases/download/v\${pkgver}/PairUX-\${pkgver}-x86_64.AppImage")
sha256sums=('${sha256}')

package() {
    cd "$srcdir"

    # Install AppImage
    install -Dm755 "PairUX-\${pkgver}.AppImage" "$pkgdir/opt/pairux/pairux.AppImage"

    # Create wrapper script
    install -dm755 "$pkgdir/usr/bin"
    cat > "$pkgdir/usr/bin/pairux" << 'WRAPPER'
#!/bin/bash
export ELECTRON_DISABLE_SANDBOX=1
exec /opt/pairux/pairux.AppImage "$@"
WRAPPER
    chmod 755 "$pkgdir/usr/bin/pairux"

    # Create and install desktop file
    cat > "$srcdir/pairux.desktop" << 'DESKTOP'
[Desktop Entry]
Name=PairUX
Comment=Collaborative screen sharing with remote control
Exec=/opt/pairux/pairux.AppImage --no-sandbox %U
Icon=pairux
Type=Application
Categories=Network;RemoteAccess;
StartupWMClass=PairUX
DESKTOP
    install -Dm644 "$srcdir/pairux.desktop" "$pkgdir/usr/share/applications/pairux.desktop"

    # Extract and install icon from AppImage
    cd "$pkgdir/opt/pairux"
    ./pairux.AppImage --appimage-extract usr/share/icons/hicolor/512x512/apps/*.png 2>/dev/null || true
    if [ -f squashfs-root/usr/share/icons/hicolor/512x512/apps/*.png ]; then
        install -Dm644 squashfs-root/usr/share/icons/hicolor/512x512/apps/*.png "$pkgdir/usr/share/pixmaps/pairux.png"
    fi
    rm -rf squashfs-root
}
`;

    return Promise.resolve(pkgbuild);
  }

  private generateSrcinfo(version: string): string {
    return `pkgbase = ${PACKAGE_NAME}
\tpkgdesc = Collaborative screen sharing with remote control
\tpkgver = ${version}
\tpkgrel = 1
\turl = https://pairux.com
\tarch = x86_64
\tlicense = MIT
\tdepends = gtk3
\tdepends = libnotify
\tdepends = nss
\tdepends = libxss
\tdepends = libxtst
\tdepends = xdg-utils
\tdepends = at-spi2-core
\tdepends = util-linux-libs
\tdepends = fuse2
\tprovides = pairux
\tconflicts = pairux
\tconflicts = pairux-git
\toptions = !strip
\tsource = PairUX-${version}.AppImage::https://github.com/profullstack/pairux.com/releases/download/v${version}/PairUX-${version}-x86_64.AppImage

pkgname = ${PACKAGE_NAME}
`;
  }

  async submit(release: ReleaseInfo, dryRun = false): Promise<SubmissionResult> {
    // Check if already exists
    if (await this.checkExisting(release.version)) {
      return {
        packageManager: this.name,
        status: 'skipped',
        message: `Version ${release.version} already exists in AUR`,
        alreadyExists: true,
      };
    }

    const pkgbuild = await this.generateManifest(release);
    const srcinfo = this.generateSrcinfo(release.version);

    if (dryRun) {
      this.logger.info('Dry run - generated AUR PKGBUILD:');
      console.log(pkgbuild);
      console.log('\n=== .SRCINFO ===');
      console.log(srcinfo);
      return {
        packageManager: this.name,
        status: 'skipped',
        message: 'Dry run - PKGBUILD generated',
      };
    }

    // Setup SSH key
    const sshKeyBase64 = process.env.AUR_SSH_KEY;
    if (!sshKeyBase64) {
      return {
        packageManager: this.name,
        status: 'failed',
        message: 'AUR_SSH_KEY environment variable required',
      };
    }

    const tempDir = join(tmpdir(), `aur-${String(Date.now())}`);
    const sshDir = join(tempDir, '.ssh');
    const repoDir = join(tempDir, PACKAGE_NAME);

    try {
      mkdirSync(sshDir, { recursive: true, mode: 0o700 });

      // Write SSH key
      const sshKeyPath = join(sshDir, 'aur');
      const sshKey = Buffer.from(sshKeyBase64, 'base64').toString('utf-8');
      writeFileSync(sshKeyPath, sshKey, { mode: 0o600 });

      // Configure SSH
      const sshConfig = `Host aur.archlinux.org
  IdentityFile ${sshKeyPath}
  User aur
  StrictHostKeyChecking no
`;
      writeFileSync(join(sshDir, 'config'), sshConfig, { mode: 0o600 });

      // Set HOME to use our SSH config
      const env = {
        ...process.env,
        HOME: tempDir,
        GIT_SSH_COMMAND: `ssh -F ${join(sshDir, 'config')}`,
      };

      // Clone the AUR repo
      this.logger.info('Cloning AUR repository...');
      try {
        execSync(`git clone ${AUR_SSH_HOST}:${PACKAGE_NAME}.git ${repoDir}`, {
          env,
          stdio: 'pipe',
        });
      } catch {
        // Package doesn't exist yet, create it
        this.logger.info('Creating new AUR package...');
        mkdirSync(repoDir, { recursive: true });
        execSync('git init -b master', { cwd: repoDir, env, stdio: 'pipe' });
        execSync(`git remote add origin ${AUR_SSH_HOST}:${PACKAGE_NAME}.git`, {
          cwd: repoDir,
          env,
          stdio: 'pipe',
        });
      }

      // Ensure we're on a master branch (clone may leave us in detached HEAD)
      try {
        execSync('git checkout -B master origin/master', { cwd: repoDir, env, stdio: 'pipe' });
      } catch {
        // No remote master yet, create local master from current HEAD
        try {
          execSync('git checkout -b master', { cwd: repoDir, env, stdio: 'pipe' });
        } catch {
          // Already on master
        }
      }

      // Configure git
      execSync('git config user.email "hello@pairux.com"', { cwd: repoDir, env, stdio: 'pipe' });
      execSync('git config user.name "PairUX Bot"', { cwd: repoDir, env, stdio: 'pipe' });

      // Write PKGBUILD and .SRCINFO
      writeFileSync(join(repoDir, 'PKGBUILD'), pkgbuild);
      writeFileSync(join(repoDir, '.SRCINFO'), srcinfo);

      // Stage and commit
      execSync('git add PKGBUILD .SRCINFO', { cwd: repoDir, env, stdio: 'pipe' });

      try {
        execSync(`git commit -m "Update to ${release.version}"`, {
          cwd: repoDir,
          env,
          stdio: 'pipe',
        });
      } catch {
        // No changes to commit
        return {
          packageManager: this.name,
          status: 'skipped',
          message: 'No changes to commit',
        };
      }

      // Push to AUR
      this.logger.info('Pushing to AUR...');
      execSync('git push origin master', { cwd: repoDir, env, stdio: 'pipe' });

      return {
        packageManager: this.name,
        status: 'success',
        message: `Pushed to AUR: https://aur.archlinux.org/packages/${PACKAGE_NAME}`,
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      return {
        packageManager: this.name,
        status: 'failed',
        message: `AUR submission failed: ${errorMessage}`,
        error: error instanceof Error ? error : new Error(errorMessage),
      };
    } finally {
      // Cleanup
      if (existsSync(tempDir)) {
        rmSync(tempDir, { recursive: true, force: true });
      }
    }
  }
}
