/**
 * Chocolatey Package Manager
 *
 * Submits packages to chocolatey.org.
 * Requires CHOCOLATEY_API_KEY environment variable.
 */

import { execSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { BasePackageManager } from './base.js';
import type { ReleaseInfo, SubmissionResult } from './types.js';

const PACKAGE_ID = 'pairux';
const CHOCOLATEY_API_URL = 'https://push.chocolatey.org/';

export class ChocolateyPackageManager extends BasePackageManager {
  readonly name = 'chocolatey';
  readonly displayName = 'Chocolatey';
  readonly platform = 'windows' as const;
  readonly priority = 3;

  private getChocolateyApiKey(): string | undefined {
    return process.env.CHOCOLATEY_API_KEY;
  }

  isConfigured(): Promise<boolean> {
    return Promise.resolve(this.config.enabled && !!this.getChocolateyApiKey());
  }

  async checkExisting(version: string): Promise<boolean> {
    try {
      // Check if package version exists on chocolatey.org
      const response = await fetch(
        `https://community.chocolatey.org/api/v2/package/${PACKAGE_ID}/${version}`
      );
      return response.ok;
    } catch {
      return false;
    }
  }

  generateManifest(release: ReleaseInfo): Promise<Record<string, string>> {
    // Find the Windows installer (NSIS exe)
    const x64Exe = this.findAsset(
      release,
      (a) => a.name.endsWith('.exe') && a.name.includes('x64')
    );
    const exe = x64Exe ?? this.findAsset(release, (a) => a.name.endsWith('.exe'));

    const downloadUrl =
      exe?.downloadUrl ??
      `https://github.com/profullstack/pairux.com/releases/download/v${release.version}/PairUX-${release.version}-x64.exe`;

    // Get checksum from asset or from checksums map (required for Chocolatey validation - CPMR0073)
    // Note: checksums file may have spaces in filename (e.g., "PairUX Setup 0.1.17.exe")
    // while GitHub asset has dots (e.g., "PairUX.Setup.0.1.17.exe")
    const checksum =
      exe?.sha256 ??
      release.checksums.get(`PairUX Setup ${release.version}.exe`) ??
      release.checksums.get(`PairUX-${release.version}-x64.exe`) ??
      '';

    if (!checksum) {
      throw new Error(
        `No SHA256 checksum found for Windows installer. Chocolatey requires checksum validation (CPMR0073). ` +
          `Ensure checksums.txt is uploaded with the release.`
      );
    }

    // Generate .nuspec file
    const nuspec = `<?xml version="1.0" encoding="utf-8"?>
<package xmlns="http://schemas.microsoft.com/packaging/2015/06/nuspec.xsd">
  <metadata>
    <id>${PACKAGE_ID}</id>
    <version>${release.version}</version>
    <title>PairUX</title>
    <authors>Profullstack, Inc.</authors>
    <owners>profullstack</owners>
    <projectUrl>https://pairux.com</projectUrl>
    <iconUrl>https://pairux.com/logo.svg</iconUrl>
    <licenseUrl>https://github.com/profullstack/pairux.com/blob/master/LICENSE</licenseUrl>
    <requireLicenseAcceptance>false</requireLicenseAcceptance>
    <projectSourceUrl>https://github.com/profullstack/pairux.com</projectSourceUrl>
    <docsUrl>https://pairux.com/docs</docsUrl>
    <bugTrackerUrl>https://github.com/profullstack/pairux.com/issues</bugTrackerUrl>
    <tags>screen-sharing remote-control pair-programming collaboration webrtc</tags>
    <summary>Collaborative screen sharing with remote control</summary>
    <description>PairUX is a collaborative screen sharing application with simultaneous remote mouse and keyboard control. Like Screenhero, but open source. Perfect for pair programming, remote support, and collaboration.

## Features
- Real-time screen sharing with low latency
- Simultaneous remote control (mouse and keyboard)
- Cross-platform support (Windows, macOS, Linux)
- End-to-end encryption
- Easy session sharing with join codes
- Open source under MIT License
    </description>
    <releaseNotes>https://github.com/profullstack/pairux.com/releases/tag/v${release.version}</releaseNotes>
  </metadata>
  <files>
    <file src="tools\\**" target="tools" />
  </files>
</package>`;

    // Generate chocolateyInstall.ps1
    const installScript = `$ErrorActionPreference = 'Stop'

$packageName = '${PACKAGE_ID}'
$toolsDir = "$(Split-Path -parent $MyInvocation.MyCommand.Definition)"
$url64 = '${downloadUrl}'
$checksum64 = '${checksum}'
$checksumType64 = 'sha256'

$packageArgs = @{
  packageName    = $packageName
  unzipLocation  = $toolsDir
  fileType       = 'exe'
  url64bit       = $url64
  softwareName   = 'PairUX*'
  checksum64     = $checksum64
  checksumType64 = $checksumType64
  silentArgs     = '/S'
  validExitCodes = @(0)
}

Install-ChocolateyPackage @packageArgs
`;

    // Generate chocolateyUninstall.ps1
    const uninstallScript = `$ErrorActionPreference = 'Stop'

$packageName = '${PACKAGE_ID}'
$softwareName = 'PairUX*'
$installerType = 'exe'

[array]$key = Get-UninstallRegistryKey -SoftwareName $softwareName

if ($key.Count -eq 1) {
  $key | ForEach-Object {
    $file = "$($_.UninstallString)"

    if ($installerType -eq 'msi') {
      $silentArgs = "/qn /norestart"
      Uninstall-ChocolateyPackage -PackageName $packageName -FileType $installerType -SilentArgs "$silentArgs" -File ''
    }

    if ($installerType -eq 'exe') {
      $silentArgs = '/S'
      Uninstall-ChocolateyPackage -PackageName $packageName -FileType $installerType -SilentArgs "$silentArgs" -File "$file"
    }
  }
} elseif ($key.Count -eq 0) {
  Write-Warning "$packageName has already been uninstalled by other means."
} elseif ($key.Count -gt 1) {
  Write-Warning "$($key.Count) matches found!"
  Write-Warning "To prevent accidental data loss, no uninstall will occur."
  Write-Warning "Please alert the package maintainer."
}
`;

    // Generate VERIFICATION.txt
    const verification = `VERIFICATION
Verification is intended to assist the Chocolatey moderators and community
in verifying that this package's contents are trustworthy.

The installer can be downloaded from:
${downloadUrl}

The SHA256 checksum for the installer is:
${checksum}

This can be verified by:
1. Downloading the installer from the official GitHub releases
2. Running: Get-FileHash <path-to-installer> -Algorithm SHA256
3. Comparing the output to the checksum above

The source code is available at:
https://github.com/profullstack/pairux.com
`;

    return Promise.resolve({
      'pairux.nuspec': nuspec,
      'tools/chocolateyInstall.ps1': installScript,
      'tools/chocolateyUninstall.ps1': uninstallScript,
      'tools/VERIFICATION.txt': verification,
    });
  }

  async submit(release: ReleaseInfo, dryRun = false): Promise<SubmissionResult> {
    // Check if already exists
    if (await this.checkExisting(release.version)) {
      return {
        packageManager: this.name,
        status: 'skipped',
        message: `Version ${release.version} already exists on Chocolatey`,
        alreadyExists: true,
      };
    }

    const apiKey = this.getChocolateyApiKey();
    if (!apiKey) {
      return {
        packageManager: this.name,
        status: 'skipped',
        message: 'CHOCOLATEY_API_KEY not configured',
      };
    }

    const files = await this.generateManifest(release);

    if (dryRun) {
      this.logger.info('Dry run - generated Chocolatey package files:');
      for (const [path, content] of Object.entries(files)) {
        this.logger.info(`\n--- ${path} ---`);
        console.log(content);
      }
      return {
        packageManager: this.name,
        status: 'skipped',
        message: 'Dry run - package files generated',
      };
    }

    // Create temporary directory for package
    const tempDir = mkdtempSync(join(tmpdir(), 'chocolatey-'));

    try {
      // Write package files
      for (const [filePath, content] of Object.entries(files)) {
        const fullPath = join(tempDir, filePath);
        const dir = dirname(fullPath);
        // Create parent directory if it doesn't exist (no-op if it does)
        mkdirSync(dir, { recursive: true });
        writeFileSync(fullPath, content, 'utf-8');
      }

      // Pack the package
      this.logger.info('Packing Chocolatey package...');
      try {
        execSync('choco pack', { cwd: tempDir, stdio: 'pipe' });
      } catch (packError) {
        // If choco is not installed, try using nuget
        this.logger.warn('choco not found, trying nuget pack...');
        try {
          execSync('nuget pack pairux.nuspec', { cwd: tempDir, stdio: 'pipe' });
        } catch {
          return {
            packageManager: this.name,
            status: 'failed',
            message:
              'Neither choco nor nuget CLI available. Install Chocolatey or NuGet CLI to submit packages.',
            error: packError instanceof Error ? packError : new Error(String(packError)),
          };
        }
      }

      // Push the package
      this.logger.info('Pushing to Chocolatey...');
      const nupkgFile = `${PACKAGE_ID}.${release.version}.nupkg`;

      try {
        execSync(`choco push ${nupkgFile} --source ${CHOCOLATEY_API_URL} --api-key ${apiKey}`, {
          cwd: tempDir,
          stdio: 'pipe',
        });
      } catch (chocoError) {
        const errorMessage = chocoError instanceof Error ? chocoError.message : String(chocoError);

        // Check if this is a pending submission error (403)
        if (
          errorMessage.includes('previous version in a submitted state') ||
          errorMessage.includes('403')
        ) {
          const packageUrl = `https://community.chocolatey.org/packages/${PACKAGE_ID}`;
          this.logger.success(`Previous version pending review: ${packageUrl}`);
          return {
            packageManager: this.name,
            status: 'success',
            message: `Previous version pending review on Chocolatey: ${packageUrl}`,
            url: packageUrl,
          };
        }

        // Try nuget push as fallback for other errors
        try {
          execSync(`nuget push ${nupkgFile} -Source ${CHOCOLATEY_API_URL} -ApiKey ${apiKey}`, {
            cwd: tempDir,
            stdio: 'pipe',
          });
        } catch (nugetError) {
          const nugetErrorMessage =
            nugetError instanceof Error ? nugetError.message : String(nugetError);

          // Also check nuget error for pending submission
          if (
            nugetErrorMessage.includes('previous version in a submitted state') ||
            nugetErrorMessage.includes('403')
          ) {
            const packageUrl = `https://community.chocolatey.org/packages/${PACKAGE_ID}`;
            this.logger.success(`Previous version pending review: ${packageUrl}`);
            return {
              packageManager: this.name,
              status: 'success',
              message: `Previous version pending review on Chocolatey: ${packageUrl}`,
              url: packageUrl,
            };
          }

          throw nugetError;
        }
      }

      this.logger.success(`Pushed ${PACKAGE_ID} ${release.version} to Chocolatey`);

      return {
        packageManager: this.name,
        status: 'success',
        message: `Submitted to Chocolatey: https://community.chocolatey.org/packages/${PACKAGE_ID}/${release.version}`,
      };
    } catch (error) {
      return {
        packageManager: this.name,
        status: 'failed',
        message: `Failed to submit to Chocolatey: ${error instanceof Error ? error.message : String(error)}`,
        error: error instanceof Error ? error : new Error(String(error)),
      };
    } finally {
      // Clean up temp directory
      try {
        rmSync(tempDir, { recursive: true, force: true });
      } catch {
        // Ignore cleanup errors
      }
    }
  }
}
