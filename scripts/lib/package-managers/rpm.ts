/**
 * RPM Repository (Fedora/RHEL/CentOS)
 *
 * Updates a GitHub Pages-hosted RPM repository.
 */

import { execSync } from 'node:child_process';
import { writeFileSync, mkdirSync, rmSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { BasePackageManager } from './base.js';
import type { PackageManagerConfig, ReleaseInfo, SubmissionResult, Logger } from './types.js';

const DEFAULT_REPO_OWNER = 'profullstack';
const DEFAULT_REPO_NAME = 'pairux-rpm';

export class RPMPackageManager extends BasePackageManager {
  readonly name = 'rpm';
  readonly displayName = 'RPM';
  readonly platform = 'linux' as const;
  readonly priority = 6;

  private readonly repoOwner: string;
  private readonly repoName: string;

  constructor(config: PackageManagerConfig, logger: Logger) {
    super(config, logger);
    this.repoOwner =
      (config.additionalConfig?.repoOwner as string | undefined) ?? DEFAULT_REPO_OWNER;
    this.repoName = (config.additionalConfig?.repoName as string | undefined) ?? DEFAULT_REPO_NAME;
  }

  isConfigured(): Promise<boolean> {
    // RPM requires GitHub token and GPG key for signing
    return Promise.resolve(
      this.config.enabled && !!this.getGitHubToken() && !!process.env.GPG_PRIVATE_KEY
    );
  }

  async checkExisting(version: string): Promise<boolean> {
    try {
      // Check if the .rpm file exists in the Packages directory
      // RPM filename format: pairux-{version}-1.x86_64.rpm
      const path = `Packages/pairux-${version}-1.x86_64.rpm`;
      const file = await this.getFileContent(this.repoOwner, this.repoName, path);
      return file !== null;
    } catch {
      return false;
    }
  }

  generateManifest(release: ReleaseInfo): Promise<string> {
    // RPM doesn't use a manifest file in the traditional sense
    // This returns instructions for the repo structure
    return Promise.resolve(`RPM Repository Update for ${release.version}

Repository structure:
  Packages/pairux-${release.version}-1.x86_64.rpm
  repodata/repomd.xml
  repodata/repomd.xml.asc
  RPM-GPG-KEY-pairux
  pairux.repo
`);
  }

  async submit(release: ReleaseInfo, dryRun = false): Promise<SubmissionResult> {
    // Check if already exists
    if (await this.checkExisting(release.version)) {
      return {
        packageManager: this.name,
        status: 'skipped',
        message: `Version ${release.version} already exists in RPM repo`,
        alreadyExists: true,
      };
    }

    if (dryRun) {
      const manifest = await this.generateManifest(release);
      this.logger.info('Dry run - RPM repository update plan:');
      console.log(manifest);
      return {
        packageManager: this.name,
        status: 'skipped',
        message: 'Dry run - update plan generated',
      };
    }

    // Find the .rpm file
    const rpmAsset = this.findAsset(
      release,
      (a) => a.name.endsWith('.rpm') && (a.name.includes('x86_64') || a.name.includes('x64'))
    );

    if (!rpmAsset) {
      return {
        packageManager: this.name,
        status: 'failed',
        message: 'No .rpm asset found in release',
      };
    }

    const tempDir = join(tmpdir(), `rpm-${String(Date.now())}`);
    const repoDir = join(tempDir, 'repo');

    try {
      mkdirSync(tempDir, { recursive: true });

      // Clone the RPM repo
      const token = this.getGitHubToken();
      this.logger.info('Cloning RPM repository...');

      // Ensure repo exists
      await this.ensureRepo(this.repoOwner, this.repoName, 'RPM repository for PairUX', false);

      execSync(
        `git clone https://${token ?? ''}@github.com/${this.repoOwner}/${this.repoName}.git ${repoDir}`,
        { stdio: 'pipe' }
      );

      // Create directory structure
      const packagesDir = join(repoDir, 'Packages');
      mkdirSync(packagesDir, { recursive: true });

      // Download the .rpm file
      this.logger.info('Downloading .rpm package...');
      const rpmData = await this.downloadFile(rpmAsset.downloadUrl);
      const rpmFilename = `pairux-${release.version}-1.x86_64.rpm`;
      const rpmPath = join(packagesDir, rpmFilename);
      writeFileSync(rpmPath, rpmData);

      // Generate repodata using createrepo
      this.logger.info('Generating repodata...');
      try {
        execSync('createrepo_c .', { cwd: repoDir, stdio: 'pipe' });
      } catch {
        // createrepo_c not available, try createrepo
        try {
          execSync('createrepo .', { cwd: repoDir, stdio: 'pipe' });
        } catch {
          this.logger.warn('createrepo not available, generating minimal repodata');
          // Create minimal repodata structure
          mkdirSync(join(repoDir, 'repodata'), { recursive: true });
          writeFileSync(join(repoDir, 'repodata', 'repomd.xml'), this.generateMinimalRepomd());
        }
      }

      // Sign repomd.xml with GPG
      this.logger.info('Signing repomd.xml...');
      this.signRepomd(repoDir);

      // Export public key
      const gpgPublicKey = this.exportGPGPublicKey();
      if (gpgPublicKey) {
        writeFileSync(join(repoDir, 'RPM-GPG-KEY-pairux'), gpgPublicKey);
      }

      // Create .repo file for easy installation
      const repoFileContent = `[pairux]
name=PairUX Repository
baseurl=https://${this.repoOwner}.github.io/${this.repoName}/
enabled=1
gpgcheck=1
gpgkey=https://${this.repoOwner}.github.io/${this.repoName}/RPM-GPG-KEY-pairux
`;
      writeFileSync(join(repoDir, 'pairux.repo'), repoFileContent);

      // Create README with installation instructions
      const readmeContent = `# PairUX RPM Repository

## Installation

### Fedora / RHEL / CentOS

\`\`\`bash
# Add repository
sudo dnf config-manager --add-repo https://${this.repoOwner}.github.io/${this.repoName}/pairux.repo

# Import GPG key
sudo rpm --import https://${this.repoOwner}.github.io/${this.repoName}/RPM-GPG-KEY-pairux

# Install
sudo dnf install pairux
\`\`\`

### Manual Download

You can also download the RPM directly from the [Packages](./Packages) directory.
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
        message: `Updated RPM repo: https://${this.repoOwner}.github.io/${this.repoName}`,
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      return {
        packageManager: this.name,
        status: 'failed',
        message: `RPM submission failed: ${errorMessage}`,
        error: error instanceof Error ? error : new Error(errorMessage),
      };
    } finally {
      // Cleanup
      if (existsSync(tempDir)) {
        rmSync(tempDir, { recursive: true, force: true });
      }
    }
  }

  private generateMinimalRepomd(): string {
    const timestamp = Math.floor(Date.now() / 1000);
    return `<?xml version="1.0" encoding="UTF-8"?>
<repomd xmlns="http://linux.duke.edu/metadata/repo">
  <revision>${String(timestamp)}</revision>
</repomd>
`;
  }

  private signRepomd(repoDir: string): void {
    const gpgKey = process.env.GPG_PRIVATE_KEY;
    if (!gpgKey) {
      this.logger.warn('GPG_PRIVATE_KEY not set, skipping signing');
      return;
    }

    const repomdPath = join(repoDir, 'repodata/repomd.xml');
    const repomdAscPath = join(repoDir, 'repodata/repomd.xml.asc');

    if (!existsSync(repomdPath)) {
      return;
    }

    try {
      // Import GPG key
      const keyData = Buffer.from(gpgKey, 'base64').toString('utf-8');
      execSync(`echo "${keyData}" | gpg --batch --import`, { stdio: 'pipe' });

      const passphrase = process.env.GPG_PASSPHRASE ?? '';

      // Create detached signature
      execSync(
        `gpg --batch --yes --pinentry-mode loopback --passphrase "${passphrase}" --armor --detach-sign -o ${repomdAscPath} ${repomdPath}`,
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
