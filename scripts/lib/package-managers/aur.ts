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

/** How many times to try a git command that failed because AUR was unreachable. */
const AUR_ATTEMPTS = 3;
/** Gap between those attempts. AUR maintenance windows are usually short. */
const AUR_RETRY_DELAY_MS = 15_000;

/**
 * aur.archlinux.org drops into maintenance without notice, and when it does it
 * still accepts the SSH connection but refuses the git operation. None of these
 * say anything about our key or our package, so they must not be reported as a
 * submission failure that fails the whole release.
 */
const TRANSIENT_AUR_ERRORS = [
  'down due to maintenance',
  'connection closed by',
  'connection reset by peer',
  'connection timed out',
  'kex_exchange_identification',
  'the remote end hung up unexpectedly',
  'early eof',
];

function isTransientAURError(message: string): boolean {
  const haystack = message.toLowerCase();
  return TRANSIENT_AUR_ERRORS.some((needle) => haystack.includes(needle));
}

/**
 * execSync hides the interesting part in `stderr` when stdio is piped, so the
 * bare message is only ever "Command failed: git push origin master".
 */
function describeCommandError(error: unknown): string {
  if (!(error instanceof Error)) {
    return typeof error === 'string' ? error : JSON.stringify(error);
  }

  const { stderr } = error as Error & { stderr?: Buffer | string };
  const details = stderr?.toString().trim() ?? '';

  return details && !error.message.includes(details)
    ? `${error.message}\n${details}`
    : error.message;
}

class AURCommandError extends Error {
  readonly transient: boolean;

  constructor(command: string, details: string) {
    super(`Command failed: ${command}\n${details}`);
    this.name = 'AURCommandError';
    this.transient = isTransientAURError(details);
  }
}

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
optdepends=(
  'xdg-desktop-portal: Wayland portal-based remote control support'
  'xdg-desktop-portal-kde: KDE Plasma Wayland portal backend'
  'xdg-desktop-portal-gnome: GNOME Wayland portal backend'
  'xdg-desktop-portal-wlr: wlroots-based Wayland portal backend'
  'ydotool: Wayland fallback input injection backend (requires ydotoold)'
)
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
MimeType=x-scheme-handler/pairux;
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
\toptdepends = xdg-desktop-portal: Wayland portal-based remote control support
\toptdepends = xdg-desktop-portal-kde: KDE Plasma Wayland portal backend
\toptdepends = xdg-desktop-portal-gnome: GNOME Wayland portal backend
\toptdepends = xdg-desktop-portal-wlr: wlroots-based Wayland portal backend
\toptdepends = ydotool: Wayland fallback input injection backend (requires ydotoold)
\tprovides = pairux
\tconflicts = pairux
\tconflicts = pairux-git
\toptions = !strip
\tsource = PairUX-${version}.AppImage::https://github.com/profullstack/pairux.com/releases/download/v${version}/PairUX-${version}-x86_64.AppImage

pkgname = ${PACKAGE_NAME}
`;
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  /**
   * Run a git command, retrying while AUR itself is the thing that is broken.
   * Anything else (a bad key, a rejected ref) fails on the first attempt.
   */
  private async runGit(
    command: string,
    options: { cwd?: string; env: NodeJS.ProcessEnv },
    attempts = AUR_ATTEMPTS
  ): Promise<void> {
    for (let attempt = 1; ; attempt++) {
      try {
        execSync(command, { ...options, stdio: 'pipe' });
        return;
      } catch (error) {
        const failure = new AURCommandError(command, describeCommandError(error));

        if (!failure.transient || attempt >= attempts) throw failure;

        this.logger.warn(
          `AUR is unreachable (attempt ${String(attempt)}/${String(attempts)}), ` +
            `retrying in ${String(AUR_RETRY_DELAY_MS / 1000)}s...`
        );
        await this.sleep(AUR_RETRY_DELAY_MS);
      }
    }
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
        await this.runGit(`git clone ${AUR_SSH_HOST}:${PACKAGE_NAME}.git ${repoDir}`, { env });
      } catch (error) {
        // Only treat a clone failure as "package doesn't exist yet" when AUR
        // actually answered. If AUR is down, creating an empty repo here just
        // turns an outage into a confusing push error further down.
        if (error instanceof AURCommandError && error.transient) throw error;

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
      await this.runGit('git push origin master', { cwd: repoDir, env });

      return {
        packageManager: this.name,
        status: 'success',
        message: `Pushed to AUR: https://aur.archlinux.org/packages/${PACKAGE_NAME}`,
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);

      // AUR being down is not a release failure. Every other package manager
      // has already published, so report it as skipped and let the release
      // stand; the next release re-submits the version AUR missed.
      if (error instanceof AURCommandError && error.transient) {
        this.logger.warn(`AUR is unavailable, skipping submission: ${errorMessage}`);
        return {
          packageManager: this.name,
          status: 'skipped',
          message:
            `AUR unreachable after ${String(AUR_ATTEMPTS)} attempts ` +
            `(version ${release.version} not submitted): ${errorMessage}`,
        };
      }

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
