/**
 * Nix Package Manager
 *
 * Submits packages to a custom flake repository (profullstack/pairux-nix).
 * Users can install via: nix profile install github:profullstack/pairux-nix
 */

import { BasePackageManager } from './base.js';
import type { ReleaseInfo, SubmissionResult } from './types.js';

const FLAKE_OWNER = 'profullstack';
const FLAKE_REPO = 'pairux-nix';
const PACKAGE_NAME = 'pairux';

export class NixPackageManager extends BasePackageManager {
  readonly name = 'nix';
  readonly displayName = 'Nix';
  readonly platform = 'linux' as const;
  readonly priority = 9;

  isConfigured(): Promise<boolean> {
    return Promise.resolve(this.config.enabled && !!this.getGitHubToken());
  }

  async checkExisting(version: string): Promise<boolean> {
    try {
      // Check if the version is already in our flake repo
      const file = await this.getFileContent(FLAKE_OWNER, FLAKE_REPO, 'flake.nix');
      if (!file) return false;

      // Check if version is in the flake
      return file.content.includes(`version = "${version}"`);
    } catch {
      return false;
    }
  }

  generateManifest(release: ReleaseInfo): Promise<Record<string, string>> {
    // Find assets for different architectures
    const x86AppImage = this.findAsset(
      release,
      (a) => a.name.includes('x86_64') && a.name.endsWith('.AppImage')
    );

    const x86Sha256 = release.checksums.get(x86AppImage?.name ?? '') ?? '';

    // Generate flake.nix
    const flakeNix = `{
  description = "PairUX - Collaborative screen sharing with remote control";

  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/nixos-unstable";
    flake-utils.url = "github:numtide/flake-utils";
  };

  outputs = { self, nixpkgs, flake-utils }:
    flake-utils.lib.eachSystem [ "x86_64-linux" ] (system:
      let
        pkgs = nixpkgs.legacyPackages.\${system};
        pname = "${PACKAGE_NAME}";
        version = "${release.version}";

        src = pkgs.fetchurl {
          url = "https://github.com/profullstack/pairux.com/releases/download/v\${version}/PairUX-\${version}-x86_64.AppImage";
          sha256 = "${x86Sha256 !== '' ? x86Sha256 : 'sha256-AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA='}";
        };

        appimageContents = pkgs.appimageTools.extractType2 { inherit pname version src; };
      in
      {
        packages = {
          default = pkgs.appimageTools.wrapType2 {
            inherit pname version src;

            extraInstallCommands = ''
              install -m 444 -D \${appimageContents}/pairux.desktop $out/share/applications/pairux.desktop
              install -m 444 -D \${appimageContents}/usr/share/icons/hicolor/512x512/apps/pairux.png \\
                $out/share/icons/hicolor/512x512/apps/pairux.png 2>/dev/null || true
              substituteInPlace $out/share/applications/pairux.desktop \\
                --replace 'Exec=AppRun' 'Exec=pairux' 2>/dev/null || true
            '';

            meta = with pkgs.lib; {
              description = "Collaborative screen sharing with remote control";
              longDescription = ''
                PairUX is a collaborative screen sharing application with simultaneous
                remote mouse and keyboard control. Like Screenhero, but open source.
                Perfect for pair programming, remote support, and collaboration.
              '';
              homepage = "https://pairux.com";
              changelog = "https://github.com/profullstack/pairux.com/releases/tag/v\${version}";
              license = licenses.mit;
              maintainers = [ ];
              platforms = [ "x86_64-linux" ];
              mainProgram = "pairux";
              sourceProvenance = with sourceTypes; [ binaryNativeCode ];
            };
          };

          ${PACKAGE_NAME} = self.packages.\${system}.default;
        };

        apps.default = {
          type = "app";
          program = "\${self.packages.\${system}.default}/bin/pairux";
        };
      }
    );
}
`;

    // Generate README
    const readme = `# PairUX Nix Flake

Nix flake for [PairUX](https://pairux.com) - Collaborative screen sharing with remote control.

## Installation

### Using flakes (recommended)

\`\`\`bash
# Install directly
nix profile install github:profullstack/pairux-nix

# Or run without installing
nix run github:profullstack/pairux-nix
\`\`\`

### Using nix-shell

\`\`\`bash
nix-shell -p "(builtins.getFlake \\"github:profullstack/pairux-nix\\").packages.x86_64-linux.default"
\`\`\`

### NixOS configuration

Add to your \`flake.nix\`:

\`\`\`nix
{
  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/nixos-unstable";
    pairux.url = "github:profullstack/pairux-nix";
  };

  outputs = { self, nixpkgs, pairux }: {
    nixosConfigurations.yourhostname = nixpkgs.lib.nixosSystem {
      modules = [
        ({ pkgs, ... }: {
          environment.systemPackages = [
            pairux.packages.\${pkgs.system}.default
          ];
        })
      ];
    };
  };
}
\`\`\`

## Version

Current version: ${release.version}

## License

MIT
`;

    return Promise.resolve({
      'flake.nix': flakeNix,
      'README.md': readme,
    });
  }

  async submit(release: ReleaseInfo, dryRun = false): Promise<SubmissionResult> {
    // Check if already exists
    if (await this.checkExisting(release.version)) {
      return {
        packageManager: this.name,
        status: 'skipped',
        message: `Version ${release.version} already exists in Nix flake`,
        alreadyExists: true,
      };
    }

    const files = await this.generateManifest(release);

    if (dryRun) {
      this.logger.info('Dry run - generated Nix flake files:');
      for (const [path, content] of Object.entries(files)) {
        this.logger.info(`\n--- ${path} ---`);
        console.log(content);
      }
      return {
        packageManager: this.name,
        status: 'skipped',
        message: 'Dry run - flake files generated',
      };
    }

    // Ensure flake repo exists
    await this.ensureRepo(
      FLAKE_OWNER,
      FLAKE_REPO,
      'Nix flake for PairUX - collaborative screen sharing'
    );

    // Submit directly to the flake repo
    const githubFiles = Object.entries(files).map(([path, content]) => ({
      path,
      content,
    }));

    return this.submitDirect(
      FLAKE_OWNER,
      FLAKE_REPO,
      githubFiles,
      `Update pairux to ${release.version}`
    );
  }
}
