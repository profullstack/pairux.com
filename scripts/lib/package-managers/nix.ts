/**
 * Nix Package Manager
 *
 * Submits packages to nixpkgs via Pull Request.
 * Target repo: NixOS/nixpkgs
 */

import { BasePackageManager } from './base.js';
import type { ReleaseInfo, SubmissionResult } from './types.js';

const NIXPKGS_OWNER = 'NixOS';
const NIXPKGS_REPO = 'nixpkgs';
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
      // Check if there's already an open PR for this version
      const prs = await this.githubRequest<{ title: string }[]>(
        `/repos/${NIXPKGS_OWNER}/${NIXPKGS_REPO}/pulls?state=open&per_page=100`
      );

      return prs.some(
        (pr) => pr.title.toLowerCase().includes(PACKAGE_NAME) && pr.title.includes(version)
      );
    } catch {
      return false;
    }
  }

  generateManifest(release: ReleaseInfo): Promise<string> {
    // Find assets for different architectures
    const x86AppImage = this.findAsset(
      release,
      (a) => a.name.includes('x86_64') && a.name.endsWith('.AppImage')
    );

    const x86Sha256 = release.checksums.get(x86AppImage?.name ?? '') ?? '';

    // Generate Nix expression
    const nixExpr = `{ lib
, appimageTools
, fetchurl
}:

let
  pname = "${PACKAGE_NAME}";
  version = "${release.version}";

  src = fetchurl {
    url = "https://github.com/profullstack/pairux.com/releases/download/v\${version}/PairUX-\${version}-x86_64.AppImage";
    sha256 = "${x86Sha256 !== '' ? x86Sha256 : 'sha256-AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA='}";
  };

  appimageContents = appimageTools.extractType2 { inherit pname version src; };
in
appimageTools.wrapType2 {
  inherit pname version src;

  extraInstallCommands = ''
    install -m 444 -D \${appimageContents}/pairux.desktop $out/share/applications/pairux.desktop
    install -m 444 -D \${appimageContents}/usr/share/icons/hicolor/512x512/apps/pairux.png \\
      $out/share/icons/hicolor/512x512/apps/pairux.png
    substituteInPlace $out/share/applications/pairux.desktop \\
      --replace 'Exec=AppRun' 'Exec=pairux'
  '';

  meta = with lib; {
    description = "Collaborative screen sharing with remote control";
    longDescription = ''
      PairUX is a collaborative screen sharing application with simultaneous
      remote mouse and keyboard control. Like Screenhero, but open source.
      Perfect for pair programming, remote support, and collaboration.
    '';
    homepage = "https://pairux.com";
    changelog = "https://github.com/profullstack/pairux.com/releases/tag/v\${version}";
    license = licenses.mit;
    maintainers = with maintainers; [ ];
    platforms = [ "x86_64-linux" ];
    mainProgram = "pairux";
    sourceProvenance = with sourceTypes; [ binaryNativeCode ];
  };
}
`;

    return Promise.resolve(nixExpr);
  }

  async submit(release: ReleaseInfo, dryRun = false): Promise<SubmissionResult> {
    // Check if PR already exists
    if (await this.checkExisting(release.version)) {
      return {
        packageManager: this.name,
        status: 'skipped',
        message: `PR for version ${release.version} already exists in nixpkgs`,
        alreadyExists: true,
      };
    }

    const nixExpr = await this.generateManifest(release);

    if (dryRun) {
      this.logger.info('Dry run - generated Nix expression:');
      console.log(nixExpr);
      return {
        packageManager: this.name,
        status: 'skipped',
        message: 'Dry run - Nix expression generated',
      };
    }

    // For nixpkgs, we need to fork and create PR
    // This is more complex - we'll create the expression and guide the user
    this.logger.info('Nix package submission requires manual PR to nixpkgs.');
    this.logger.info('Generated Nix expression:');
    console.log(nixExpr);
    this.logger.info('');
    this.logger.info('To submit to nixpkgs:');
    this.logger.info('1. Fork https://github.com/NixOS/nixpkgs');
    this.logger.info('2. Create pkgs/by-name/pa/pairux/package.nix with the above content');
    this.logger.info('3. Test locally with: nix-build -A pairux');
    this.logger.info('4. Submit a PR following nixpkgs contribution guidelines');

    this.logger.info('');
    this.logger.info('Alternatively, users can install via flake:');
    this.logger.info('  nix profile install github:profullstack/pairux-nix');

    return {
      packageManager: this.name,
      status: 'skipped',
      message: 'Nix expression generated - manual submission to nixpkgs required',
    };
  }
}
