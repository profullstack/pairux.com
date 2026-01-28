/**
 * APT Repository (Debian/Ubuntu)
 *
 * Updates a GitHub Pages-hosted APT repository.
 */

import { execSync } from 'node:child_process';
import { writeFileSync, mkdirSync, rmSync, existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createHash } from 'node:crypto';
import { BasePackageManager } from './base.js';
import type { PackageManagerConfig, ReleaseInfo, SubmissionResult, Logger } from './types.js';

const DEFAULT_REPO_OWNER = 'profullstack';
const DEFAULT_REPO_NAME = 'pairux-apt';

export class APTPackageManager extends BasePackageManager {
  readonly name = 'apt';
  readonly displayName = 'APT';
  readonly platform = 'linux' as const;
  readonly priority = 5;

  private readonly repoOwner: string;
  private readonly repoName: string;

  constructor(config: PackageManagerConfig, logger: Logger) {
    super(config, logger);
    this.repoOwner =
      (config.additionalConfig?.repoOwner as string | undefined) ?? DEFAULT_REPO_OWNER;
    this.repoName = (config.additionalConfig?.repoName as string | undefined) ?? DEFAULT_REPO_NAME;
  }

  isConfigured(): Promise<boolean> {
    // APT requires GitHub token and GPG key for signing
    return Promise.resolve(
      this.config.enabled && !!this.getGitHubToken() && !!process.env.GPG_PRIVATE_KEY
    );
  }

  async checkExisting(version: string): Promise<boolean> {
    try {
      // Check if the .deb file exists in the pool
      const path = `pool/main/p/pairux/pairux_${version}_amd64.deb`;
      const file = await this.getFileContent(this.repoOwner, this.repoName, path);
      return file !== null;
    } catch {
      return false;
    }
  }

  generateManifest(release: ReleaseInfo): Promise<string> {
    // APT doesn't use a manifest file in the traditional sense
    // This returns instructions for the repo structure
    return Promise.resolve(`APT Repository Update for ${release.version}

Pool structure:
  pool/main/p/pairux/pairux_${release.version}_amd64.deb

Distribution structure:
  dists/stable/main/binary-amd64/Packages
  dists/stable/main/binary-amd64/Packages.gz
  dists/stable/Release
  dists/stable/Release.gpg
  dists/stable/InRelease
`);
  }

  async submit(release: ReleaseInfo, dryRun = false): Promise<SubmissionResult> {
    // Check if already exists
    if (await this.checkExisting(release.version)) {
      return {
        packageManager: this.name,
        status: 'skipped',
        message: `Version ${release.version} already exists in APT repo`,
        alreadyExists: true,
      };
    }

    if (dryRun) {
      const manifest = await this.generateManifest(release);
      this.logger.info('Dry run - APT repository update plan:');
      console.log(manifest);
      return {
        packageManager: this.name,
        status: 'skipped',
        message: 'Dry run - update plan generated',
      };
    }

    // Find the .deb file
    const debAsset = this.findAsset(
      release,
      (a) => a.name.endsWith('.deb') && (a.name.includes('amd64') || a.name.includes('x64'))
    );

    if (!debAsset) {
      return {
        packageManager: this.name,
        status: 'failed',
        message: 'No .deb asset found in release',
      };
    }

    const tempDir = join(tmpdir(), `apt-${String(Date.now())}`);
    const repoDir = join(tempDir, 'repo');

    try {
      mkdirSync(tempDir, { recursive: true });

      // Clone the APT repo
      const token = this.getGitHubToken();
      this.logger.info('Cloning APT repository...');

      // Ensure repo exists
      await this.ensureRepo(this.repoOwner, this.repoName, 'APT repository for PairUX', false);

      execSync(
        `git clone https://${token ?? ''}@github.com/${this.repoOwner}/${this.repoName}.git ${repoDir}`,
        { stdio: 'pipe' }
      );

      // Create directory structure
      const poolDir = join(repoDir, 'pool/main/p/pairux');
      const distsDir = join(repoDir, 'dists/stable/main/binary-amd64');
      mkdirSync(poolDir, { recursive: true });
      mkdirSync(distsDir, { recursive: true });

      // Remove old .deb files to keep only the latest version
      if (existsSync(poolDir)) {
        const oldDebs = readdirSync(poolDir).filter((f) => f.endsWith('.deb'));
        for (const oldDeb of oldDebs) {
          rmSync(join(poolDir, oldDeb));
        }
      }

      // Download the .deb file
      this.logger.info('Downloading .deb package...');
      const debData = await this.downloadFile(debAsset.downloadUrl);
      const debFilename = `pairux_${release.version}_amd64.deb`;
      const debPath = join(poolDir, debFilename);
      writeFileSync(debPath, debData);

      // Generate Packages file using dpkg-scanpackages
      this.logger.info('Generating Packages file...');
      try {
        const packagesContent = execSync(`dpkg-scanpackages --arch amd64 pool/`, {
          cwd: repoDir,
          encoding: 'utf-8',
        });
        writeFileSync(join(distsDir, 'Packages'), packagesContent);

        // Create gzipped version
        execSync(`gzip -k -f ${join(distsDir, 'Packages')}`, { stdio: 'pipe' });
      } catch {
        // dpkg-scanpackages not available, generate manually
        this.logger.warn('dpkg-scanpackages not available, generating minimal Packages file');
        const packagesContent = this.generatePackagesFile(release, debData.length);
        writeFileSync(join(distsDir, 'Packages'), packagesContent);
        execSync(`gzip -k -f ${join(distsDir, 'Packages')}`, { stdio: 'pipe' });
      }

      // Generate Release file
      this.logger.info('Generating Release file...');
      const releaseContent = this.generateReleaseFile(repoDir, distsDir);
      const releasePath = join(repoDir, 'dists/stable/Release');
      writeFileSync(releasePath, releaseContent);

      // Sign Release file with GPG
      this.logger.info('Signing Release file...');
      this.signReleaseFile(repoDir);

      // Export public key
      const gpgPublicKey = this.exportGPGPublicKey();
      if (gpgPublicKey) {
        writeFileSync(join(repoDir, 'pairux.gpg'), gpgPublicKey);
      }

      // Create README with installation instructions
      const readmeContent = `# PairUX APT Repository

## Installation

\`\`\`bash
# Add GPG key
curl -fsSL https://${this.repoOwner}.github.io/${this.repoName}/pairux.gpg | sudo gpg --dearmor -o /usr/share/keyrings/pairux.gpg

# Add repository
echo "deb [signed-by=/usr/share/keyrings/pairux.gpg] https://${this.repoOwner}.github.io/${this.repoName} stable main" | sudo tee /etc/apt/sources.list.d/pairux.list

# Install
sudo apt update
sudo apt install pairux
\`\`\`
`;
      writeFileSync(join(repoDir, 'README.md'), readmeContent);

      // Commit and push
      this.logger.info('Committing changes...');
      execSync('git config user.email "hello@pairux.com"', { cwd: repoDir, stdio: 'pipe' });
      execSync('git config user.name "PairUX Bot"', { cwd: repoDir, stdio: 'pipe' });
      execSync('git add -A', { cwd: repoDir, stdio: 'pipe' });

      try {
        execSync(`git commit -m "Add PairUX ${release.version}"`, {
          cwd: repoDir,
          stdio: 'pipe',
        });
        execSync('git push', { cwd: repoDir, stdio: 'pipe' });
      } catch {
        return {
          packageManager: this.name,
          status: 'skipped',
          message: 'No changes to commit',
        };
      }

      return {
        packageManager: this.name,
        status: 'success',
        message: `Updated APT repo: https://${this.repoOwner}.github.io/${this.repoName}`,
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      return {
        packageManager: this.name,
        status: 'failed',
        message: `APT submission failed: ${errorMessage}`,
        error: error instanceof Error ? error : new Error(errorMessage),
      };
    } finally {
      // Cleanup
      if (existsSync(tempDir)) {
        rmSync(tempDir, { recursive: true, force: true });
      }
    }
  }

  private generatePackagesFile(release: ReleaseInfo, size: number): string {
    return `Package: pairux
Version: ${release.version}
Architecture: amd64
Maintainer: PairUX Team <hello@pairux.com>
Installed-Size: ${String(Math.ceil(size / 1024))}
Depends: libgtk-3-0, libnotify4, libnss3, libxss1, libxtst6, xdg-utils, libatspi2.0-0, libuuid1
Filename: pool/main/p/pairux/pairux_${release.version}_amd64.deb
Size: ${String(size)}
Section: net
Priority: optional
Homepage: https://pairux.com
Description: Collaborative screen sharing with remote control
 PairUX enables real-time screen sharing with simultaneous local
 and remote mouse/keyboard control for pair programming and collaboration.

`;
  }

  private generateReleaseFile(repoDir: string, distsDir: string): string {
    const packagesPath = join(distsDir, 'Packages');
    const packagesGzPath = join(distsDir, 'Packages.gz');

    let packagesHash = '';
    let packagesGzHash = '';
    let packagesSize = 0;
    let packagesGzSize = 0;

    if (existsSync(packagesPath)) {
      const content = readFileSync(packagesPath);
      packagesHash = createHash('sha256').update(content).digest('hex');
      packagesSize = content.length;
    }

    if (existsSync(packagesGzPath)) {
      const content = readFileSync(packagesGzPath);
      packagesGzHash = createHash('sha256').update(content).digest('hex');
      packagesGzSize = content.length;
    }

    const date = new Date().toUTCString();

    return `Origin: PairUX
Label: PairUX
Suite: stable
Codename: stable
Architectures: amd64
Components: main
Description: PairUX APT Repository
Date: ${date}
SHA256:
 ${packagesHash} ${String(packagesSize)} main/binary-amd64/Packages
 ${packagesGzHash} ${String(packagesGzSize)} main/binary-amd64/Packages.gz
`;
  }

  private signReleaseFile(repoDir: string): void {
    const gpgKey = process.env.GPG_PRIVATE_KEY;
    if (!gpgKey) {
      this.logger.warn('GPG_PRIVATE_KEY not set, skipping signing');
      return;
    }

    const releasePath = join(repoDir, 'dists/stable/Release');
    const releaseGpgPath = join(repoDir, 'dists/stable/Release.gpg');
    const inReleasePath = join(repoDir, 'dists/stable/InRelease');

    try {
      // Import GPG key
      const keyData = Buffer.from(gpgKey, 'base64').toString('utf-8');
      execSync(`echo "${keyData}" | gpg --batch --import`, { stdio: 'pipe' });

      const passphrase = process.env.GPG_PASSPHRASE ?? '';

      // Create detached signature
      execSync(
        `gpg --batch --yes --pinentry-mode loopback --passphrase "${passphrase}" -abs -o ${releaseGpgPath} ${releasePath}`,
        { stdio: 'pipe' }
      );

      // Create inline signature (InRelease)
      execSync(
        `gpg --batch --yes --pinentry-mode loopback --passphrase "${passphrase}" --clearsign -o ${inReleasePath} ${releasePath}`,
        { stdio: 'pipe' }
      );
    } catch (error) {
      this.logger.warn(
        `GPG signing failed: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  private exportGPGPublicKey(): string | null {
    try {
      return execSync('gpg --armor --export PairUX', { encoding: 'utf-8' });
    } catch {
      return null;
    }
  }
}
