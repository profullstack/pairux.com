/**
 * Homebrew Cask Package Manager
 *
 * Submits to a Homebrew tap repository (profullstack/homebrew-pairux).
 */

import { BasePackageManager } from './base.js';
import type { PackageManagerConfig, ReleaseInfo, SubmissionResult, Logger } from './types.js';

const DEFAULT_TAP_OWNER = 'profullstack';
const DEFAULT_TAP_REPO = 'homebrew-pairux';
const CASK_NAME = 'pairux';

export class HomebrewPackageManager extends BasePackageManager {
  readonly name = 'homebrew';
  readonly displayName = 'Homebrew';
  readonly platform = 'macos' as const;
  readonly priority = 1;

  private readonly tapOwner: string;
  private readonly tapRepo: string;

  constructor(config: PackageManagerConfig, logger: Logger) {
    super(config, logger);
    this.tapOwner = (config.additionalConfig?.tapOwner as string | undefined) ?? DEFAULT_TAP_OWNER;
    this.tapRepo = (config.additionalConfig?.tapRepo as string | undefined) ?? DEFAULT_TAP_REPO;
  }

  isConfigured(): Promise<boolean> {
    return Promise.resolve(this.config.enabled && !!this.getGitHubToken());
  }

  async checkExisting(version: string): Promise<boolean> {
    try {
      const file = await this.getFileContent(this.tapOwner, this.tapRepo, `Casks/${CASK_NAME}.rb`);

      if (!file) return false;

      // Check if version is in the cask
      return file.content.includes(`version "${version}"`);
    } catch {
      return false;
    }
  }

  generateManifest(release: ReleaseInfo): Promise<string> {
    // Find the DMG assets for arm64 and x64
    const arm64Dmg = this.findAsset(
      release,
      (a) => a.name.includes('arm64') && a.name.endsWith('.dmg')
    );
    const x64Dmg = this.findAsset(
      release,
      (a) =>
        !a.name.includes('arm64') && a.name.endsWith('.dmg') && a.name.includes(release.version)
    );

    const arm64Sha = arm64Dmg?.sha256 ?? 'SHA256_PLACEHOLDER';
    const x64Sha = x64Dmg?.sha256 ?? 'SHA256_PLACEHOLDER';

    return Promise.resolve(`cask "pairux" do
  version "${release.version}"

  on_arm do
    sha256 "${arm64Sha}"
    url "https://github.com/profullstack/pairux.com/releases/download/v#{version}/PairUX-#{version}-arm64.dmg",
        verified: "github.com/profullstack/pairux.com/"
  end

  on_intel do
    sha256 "${x64Sha}"
    url "https://github.com/profullstack/pairux.com/releases/download/v#{version}/PairUX-#{version}-x64.dmg",
        verified: "github.com/profullstack/pairux.com/"
  end

  name "PairUX"
  desc "Collaborative screen sharing with remote control"
  homepage "https://pairux.com"

  livecheck do
    url :url
    strategy :github_latest
  end

  auto_updates true
  depends_on macos: ">= :monterey"

  app "PairUX.app"

  zap trash: [
    "~/Library/Application Support/PairUX",
    "~/Library/Caches/com.pairux.desktop",
    "~/Library/Preferences/com.pairux.desktop.plist",
    "~/Library/Saved Application State/com.pairux.desktop.savedState",
  ]
end
`);
  }

  async submit(release: ReleaseInfo, dryRun = false): Promise<SubmissionResult> {
    // Check if already exists
    if (await this.checkExisting(release.version)) {
      return {
        packageManager: this.name,
        status: 'skipped',
        message: `Version ${release.version} already exists in tap`,
        alreadyExists: true,
      };
    }

    const manifest = await this.generateManifest(release);

    if (dryRun) {
      this.logger.info('Dry run - generated Homebrew cask:');
      console.log(manifest);
      return {
        packageManager: this.name,
        status: 'skipped',
        message: 'Dry run - manifest generated',
      };
    }

    // Ensure the tap repository exists
    await this.ensureRepo(this.tapOwner, this.tapRepo, 'Homebrew tap for PairUX', false);

    // Ensure Casks directory exists by creating a placeholder if needed
    const casksDir = await this.getFileContent(this.tapOwner, this.tapRepo, 'Casks/.gitkeep');
    if (!casksDir) {
      try {
        await this.createOrUpdateFile(
          this.tapOwner,
          this.tapRepo,
          'Casks/.gitkeep',
          '',
          'Create Casks directory'
        );
      } catch {
        // Directory might already exist
      }
    }

    // Submit directly to the tap (we own this repo)
    return this.submitDirect(
      this.tapOwner,
      this.tapRepo,
      [
        {
          path: `Casks/${CASK_NAME}.rb`,
          content: manifest,
        },
      ],
      `Update pairux to ${release.version}`
    );
  }
}
