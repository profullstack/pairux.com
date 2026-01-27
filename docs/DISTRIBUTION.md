# PairUX Distribution Guide

## Overview

This document details the distribution strategy for PairUX across all supported platforms, including package manager publishing, code signing, and release management.

---

## Distribution Channels

### Summary

| Platform              | Primary Channel | Secondary Channel    |
| --------------------- | --------------- | -------------------- |
| macOS                 | Homebrew Cask   | DMG direct download  |
| Windows               | WinGet          | MSI direct download  |
| Linux (Debian/Ubuntu) | APT repository  | .deb direct download |
| Linux (Fedora/RHEL)   | DNF repository  | .rpm direct download |
| Linux (Arch)          | AUR             | -                    |
| Linux (Universal)     | AppImage        | -                    |

---

## Shell Installers (Quick Install)

For users who prefer a one-liner installation, PairUX provides shell installers that automatically detect the platform and install the appropriate version.

### macOS / Linux

```sh
curl -LsSf https://install.pairux.sh | sh
```

This script will:

1. Detect the operating system and architecture
2. Download the appropriate installer
3. Install PairUX to the standard location
4. Add to PATH if necessary

### Windows (Preferred)

```powershell
winget install PairUX
```

### Windows (Fallback)

For systems without WinGet or for automated deployments:

```powershell
irm https://install.pairux.sh/windows | iex
```

This PowerShell script will:

1. Download the latest MSI installer
2. Verify the checksum
3. Run the installer silently
4. Clean up temporary files

### Shell Installer Implementation

The shell installer is hosted at `install.pairux.sh` and should:

**Unix Script (`install.sh`)**:

```bash
#!/bin/sh
set -e

# Detect OS and architecture
OS="$(uname -s)"
ARCH="$(uname -m)"

case "$OS" in
  Darwin)
    PLATFORM="macos"
    ;;
  Linux)
    PLATFORM="linux"
    ;;
  *)
    echo "Unsupported OS: $OS"
    exit 1
    ;;
esac

case "$ARCH" in
  x86_64|amd64)
    ARCH="x64"
    ;;
  arm64|aarch64)
    ARCH="arm64"
    ;;
  *)
    echo "Unsupported architecture: $ARCH"
    exit 1
    ;;
esac

VERSION="${PAIRUX_VERSION:-latest}"
BASE_URL="https://github.com/profullstack/pairux.com/releases"

if [ "$VERSION" = "latest" ]; then
  DOWNLOAD_URL="$BASE_URL/latest/download"
else
  DOWNLOAD_URL="$BASE_URL/download/v$VERSION"
fi

echo "Installing PairUX for $PLATFORM ($ARCH)..."

if [ "$PLATFORM" = "macos" ]; then
  # Download and mount DMG
  TEMP_DMG=$(mktemp).dmg
  curl -LsSf "$DOWNLOAD_URL/PairUX-$ARCH.dmg" -o "$TEMP_DMG"

  # Mount, copy, unmount
  MOUNT_POINT=$(hdiutil attach "$TEMP_DMG" -nobrowse | tail -1 | awk '{print $3}')
  cp -R "$MOUNT_POINT/PairUX.app" /Applications/
  hdiutil detach "$MOUNT_POINT" -quiet
  rm "$TEMP_DMG"

  echo "PairUX installed to /Applications/PairUX.app"

elif [ "$PLATFORM" = "linux" ]; then
  # Detect package manager
  if command -v apt-get >/dev/null 2>&1; then
    # Debian/Ubuntu - add repo and install
    curl -fsSL https://pairux.com/apt/pairux.gpg | sudo gpg --dearmor -o /usr/share/keyrings/pairux.gpg
    echo "deb [signed-by=/usr/share/keyrings/pairux.gpg] https://pairux.com/apt stable main" | sudo tee /etc/apt/sources.list.d/pairux.list
    sudo apt-get update
    sudo apt-get install -y pairux
  elif command -v dnf >/dev/null 2>&1; then
    # Fedora/RHEL
    sudo dnf config-manager --add-repo https://pairux.com/rpm/pairux.repo
    sudo dnf install -y pairux
  elif command -v pacman >/dev/null 2>&1; then
    # Arch - use AUR helper if available
    if command -v yay >/dev/null 2>&1; then
      yay -S --noconfirm pairux-bin
    elif command -v paru >/dev/null 2>&1; then
      paru -S --noconfirm pairux-bin
    else
      echo "Please install pairux-bin from AUR manually"
      exit 1
    fi
  else
    # Fallback to AppImage
    INSTALL_DIR="${XDG_DATA_HOME:-$HOME/.local/share}/pairux"
    mkdir -p "$INSTALL_DIR"
    curl -LsSf "$DOWNLOAD_URL/PairUX-x86_64.AppImage" -o "$INSTALL_DIR/PairUX.AppImage"
    chmod +x "$INSTALL_DIR/PairUX.AppImage"

    # Create symlink
    mkdir -p "$HOME/.local/bin"
    ln -sf "$INSTALL_DIR/PairUX.AppImage" "$HOME/.local/bin/pairux"

    echo "PairUX installed to $INSTALL_DIR"
    echo "Make sure $HOME/.local/bin is in your PATH"
  fi
fi

echo "Installation complete!"
```

**Windows Script (`install.ps1`)**:

```powershell
#Requires -Version 5.1
$ErrorActionPreference = 'Stop'

$Version = $env:PAIRUX_VERSION
if (-not $Version) { $Version = 'latest' }

$Arch = if ([Environment]::Is64BitOperatingSystem) {
    if ($env:PROCESSOR_ARCHITECTURE -eq 'ARM64') { 'arm64' } else { 'x64' }
} else {
    Write-Error "32-bit systems are not supported"
    exit 1
}

$BaseUrl = "https://github.com/profullstack/pairux.com/releases"
$DownloadUrl = if ($Version -eq 'latest') {
    "$BaseUrl/latest/download/PairUX-$Arch.msi"
} else {
    "$BaseUrl/download/v$Version/PairUX-$Arch.msi"
}

Write-Host "Installing PairUX for Windows ($Arch)..."

$TempMsi = Join-Path $env:TEMP "PairUX-$Arch.msi"

try {
    # Download MSI
    Invoke-WebRequest -Uri $DownloadUrl -OutFile $TempMsi -UseBasicParsing

    # Install silently
    $process = Start-Process msiexec.exe -ArgumentList "/i `"$TempMsi`" /qn /norestart" -Wait -PassThru

    if ($process.ExitCode -ne 0) {
        Write-Error "Installation failed with exit code $($process.ExitCode)"
        exit 1
    }

    Write-Host "PairUX installed successfully!"
}
finally {
    # Cleanup
    if (Test-Path $TempMsi) {
        Remove-Item $TempMsi -Force
    }
}
```

### Hosting the Installer

The installer scripts should be hosted on a CDN or static hosting:

1. **Primary**: `https://install.pairux.sh` (redirects to raw script)
2. **Windows**: `https://install.pairux.sh/windows` (PowerShell script)
3. **Versioned**: `https://install.pairux.sh/v1.0.0` (specific version)

**Cloudflare Workers Example**:

```typescript
export default {
  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const path = url.pathname;

    if (path === '/' || path === '/sh') {
      // Unix installer
      const script = await fetch(
        'https://raw.githubusercontent.com/pairux/pairux/master/scripts/install.sh'
      );
      return new Response(script.body, {
        headers: { 'Content-Type': 'text/plain' },
      });
    }

    if (path === '/windows' || path === '/ps1') {
      // Windows installer
      const script = await fetch(
        'https://raw.githubusercontent.com/pairux/pairux/master/scripts/install.ps1'
      );
      return new Response(script.body, {
        headers: { 'Content-Type': 'text/plain' },
      });
    }

    return new Response('Not Found', { status: 404 });
  },
};
```

---

## macOS Distribution

### Homebrew Cask

**Repository Structure**:

```
homebrew-pairux/
├── Casks/
│   └── pairux.rb
└── README.md
```

**Cask Formula** (`pairux.rb`):

```ruby
cask "pairux" do
  version "1.0.0"
  sha256 "CHECKSUM_HERE"

  url "https://github.com/profullstack/pairux.com/releases/download/v#{version}/PairUX-#{version}-arm64.dmg",
      verified: "github.com/pairux/pairux/"
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
    "~/Library/Caches/com.pairux.app",
    "~/Library/Preferences/com.pairux.app.plist",
  ]
end
```

**Publishing Process**:

1. Build signed DMG
2. Calculate SHA256 checksum
3. Update cask formula with new version and checksum
4. Submit PR to homebrew-cask or maintain own tap

**Installation Command**:

```bash
# Using official tap
brew tap pairux/tap
brew install --cask pairux

# Or if accepted to homebrew-cask
brew install --cask pairux
```

### Code Signing & Notarization

**Requirements**:

- Apple Developer ID Application certificate
- Apple Developer ID Installer certificate (for .pkg)
- App-specific password for notarization

**electron-builder Configuration**:

```yaml
# electron-builder.yml
mac:
  category: public.app-category.productivity
  target:
    - target: dmg
      arch:
        - x64
        - arm64
    - target: pkg
      arch:
        - x64
        - arm64
  hardenedRuntime: true
  gatekeeperAssess: false
  entitlements: build/entitlements.mac.plist
  entitlementsInherit: build/entitlements.mac.plist
  notarize:
    teamId: YOUR_TEAM_ID

dmg:
  sign: true
  writeUpdateInfo: false

pkg:
  installLocation: /Applications
```

**Entitlements** (`build/entitlements.mac.plist`):

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>com.apple.security.cs.allow-jit</key>
  <true/>
  <key>com.apple.security.cs.allow-unsigned-executable-memory</key>
  <true/>
  <key>com.apple.security.cs.disable-library-validation</key>
  <true/>
  <key>com.apple.security.device.audio-input</key>
  <true/>
  <key>com.apple.security.device.camera</key>
  <true/>
</dict>
</plist>
```

**Environment Variables for CI**:

```bash
# Code signing
CSC_LINK=base64-encoded-p12-certificate
CSC_KEY_PASSWORD=certificate-password

# Notarization
APPLE_ID=your-apple-id@email.com
APPLE_APP_SPECIFIC_PASSWORD=xxxx-xxxx-xxxx-xxxx
APPLE_TEAM_ID=XXXXXXXXXX
```

---

## Windows Distribution

### WinGet

**Manifest Structure**:

```
manifests/
└── p/
    └── PairUX/
        └── PairUX/
            └── 1.0.0/
                ├── PairUX.PairUX.installer.yaml
                ├── PairUX.PairUX.locale.en-US.yaml
                └── PairUX.PairUX.yaml
```

**Version Manifest** (`PairUX.PairUX.yaml`):

```yaml
PackageIdentifier: PairUX.PairUX
PackageVersion: 1.0.0
DefaultLocale: en-US
ManifestType: version
ManifestVersion: 1.4.0
```

**Installer Manifest** (`PairUX.PairUX.installer.yaml`):

```yaml
PackageIdentifier: PairUX.PairUX
PackageVersion: 1.0.0
Platform:
  - Windows.Desktop
MinimumOSVersion: 10.0.17763.0
InstallerType: msi
Scope: user
InstallModes:
  - interactive
  - silent
  - silentWithProgress
Installers:
  - Architecture: x64
    InstallerUrl: https://github.com/profullstack/pairux.com/releases/download/v1.0.0/PairUX-1.0.0-x64.msi
    InstallerSha256: CHECKSUM_HERE
    ProductCode: '{GUID-HERE}'
  - Architecture: arm64
    InstallerUrl: https://github.com/profullstack/pairux.com/releases/download/v1.0.0/PairUX-1.0.0-arm64.msi
    InstallerSha256: CHECKSUM_HERE
    ProductCode: '{GUID-HERE}'
ManifestType: installer
ManifestVersion: 1.4.0
```

**Locale Manifest** (`PairUX.PairUX.locale.en-US.yaml`):

```yaml
PackageIdentifier: PairUX.PairUX
PackageVersion: 1.0.0
PackageLocale: en-US
Publisher: PairUX
PublisherUrl: https://pairux.com
PublisherSupportUrl: https://pairux.com/support
PrivacyUrl: https://pairux.com/privacy
PackageName: PairUX
PackageUrl: https://pairux.com
License: MIT
LicenseUrl: https://github.com/profullstack/pairux.com/blob/master/LICENSE
ShortDescription: Collaborative screen sharing with remote control
Description: PairUX enables real-time screen sharing with simultaneous local and remote mouse/keyboard control.
Tags:
  - screen-sharing
  - remote-control
  - collaboration
  - webrtc
ManifestType: defaultLocale
ManifestVersion: 1.4.0
```

**Publishing Process**:

1. Build signed MSI
2. Calculate SHA256 checksum
3. Create/update manifest files
4. Submit PR to microsoft/winget-pkgs

**Installation Command**:

```powershell
winget install PairUX.PairUX
```

### Code Signing (Windows)

**Requirements**:

- EV Code Signing Certificate (recommended for SmartScreen)
- Or Standard Code Signing Certificate

**electron-builder Configuration**:

```yaml
# electron-builder.yml
win:
  target:
    - target: msi
      arch:
        - x64
        - arm64
    - target: nsis
      arch:
        - x64
  sign: ./scripts/sign.js
  signingHashAlgorithms:
    - sha256

msi:
  oneClick: false
  perMachine: false
  createDesktopShortcut: true
  createStartMenuShortcut: true

nsis:
  oneClick: false
  allowToChangeInstallationDirectory: true
  installerIcon: build/icon.ico
  uninstallerIcon: build/icon.ico
```

**Custom Signing Script** (`scripts/sign.js`):

```javascript
exports.default = async function (configuration) {
  // Use Azure SignTool or similar for EV certificates
  const { execSync } = require('child_process');

  execSync(`AzureSignTool sign \
    -kvu "${process.env.AZURE_KEY_VAULT_URI}" \
    -kvi "${process.env.AZURE_CLIENT_ID}" \
    -kvs "${process.env.AZURE_CLIENT_SECRET}" \
    -kvc "${process.env.AZURE_CERT_NAME}" \
    -kvt "${process.env.AZURE_TENANT_ID}" \
    -tr http://timestamp.digicert.com \
    -td sha256 \
    "${configuration.path}"`);
};
```

---

## Linux Distribution

### APT Repository (Debian/Ubuntu)

**Repository Structure**:

```
apt-repo/
├── pool/
│   └── main/
│       └── p/
│           └── pairux/
│               └── pairux_1.0.0_amd64.deb
├── dists/
│   └── stable/
│       ├── main/
│       │   └── binary-amd64/
│       │       ├── Packages
│       │       ├── Packages.gz
│       │       └── Release
│       ├── Release
│       ├── Release.gpg
│       └── InRelease
└── pairux.gpg
```

**Repository Setup Script**:

```bash
#!/bin/bash
# scripts/update-apt-repo.sh

REPO_DIR="./apt-repo"
GPG_KEY_ID="YOUR_GPG_KEY_ID"

# Generate Packages file
cd $REPO_DIR
dpkg-scanpackages pool/main /dev/null > dists/stable/main/binary-amd64/Packages
gzip -k -f dists/stable/main/binary-amd64/Packages

# Generate Release file
cd dists/stable
apt-ftparchive release . > Release

# Sign Release file
gpg --default-key $GPG_KEY_ID -abs -o Release.gpg Release
gpg --default-key $GPG_KEY_ID --clearsign -o InRelease Release
```

**User Installation**:

```bash
# Add GPG key
curl -fsSL https://pairux.com/apt/pairux.gpg | sudo gpg --dearmor -o /usr/share/keyrings/pairux.gpg

# Add repository
echo "deb [signed-by=/usr/share/keyrings/pairux.gpg] https://pairux.com/apt stable main" | sudo tee /etc/apt/sources.list.d/pairux.list

# Install
sudo apt update
sudo apt install pairux
```

**electron-builder Configuration**:

```yaml
# electron-builder.yml
linux:
  target:
    - target: deb
      arch:
        - x64
        - arm64
    - target: rpm
      arch:
        - x64
        - arm64
    - target: AppImage
      arch:
        - x64
  category: Network
  maintainer: PairUX <support@pairux.com>
  vendor: PairUX
  synopsis: Collaborative screen sharing
  description: |
    PairUX enables real-time screen sharing with simultaneous
    local and remote mouse/keyboard control.

deb:
  depends:
    - libgtk-3-0
    - libnotify4
    - libnss3
    - libxss1
    - libxtst6
    - xdg-utils
    - libatspi2.0-0
    - libuuid1
  afterInstall: build/linux/postinst
  afterRemove: build/linux/postrm
```

### DNF Repository (Fedora/RHEL)

**Repository Structure**:

```
rpm-repo/
├── Packages/
│   └── pairux-1.0.0-1.x86_64.rpm
├── repodata/
│   ├── repomd.xml
│   ├── primary.xml.gz
│   ├── filelists.xml.gz
│   └── other.xml.gz
└── RPM-GPG-KEY-pairux
```

**Repository Setup Script**:

```bash
#!/bin/bash
# scripts/update-rpm-repo.sh

REPO_DIR="./rpm-repo"
GPG_KEY_ID="YOUR_GPG_KEY_ID"

# Sign RPM
rpm --addsign $REPO_DIR/Packages/*.rpm

# Create repository metadata
createrepo_c $REPO_DIR

# Sign repository metadata
gpg --default-key $GPG_KEY_ID --detach-sign --armor $REPO_DIR/repodata/repomd.xml
```

**User Installation**:

```bash
# Add repository
sudo dnf config-manager --add-repo https://pairux.com/rpm/pairux.repo

# Import GPG key
sudo rpm --import https://pairux.com/rpm/RPM-GPG-KEY-pairux

# Install
sudo dnf install pairux
```

**Repository Config** (`pairux.repo`):

```ini
[pairux]
name=PairUX Repository
baseurl=https://pairux.com/rpm
enabled=1
gpgcheck=1
gpgkey=https://pairux.com/rpm/RPM-GPG-KEY-pairux
```

### Arch User Repository (AUR)

**PKGBUILD** (`pairux-bin/PKGBUILD`):

```bash
# Maintainer: PairUX <support@pairux.com>
pkgname=pairux-bin
pkgver=1.0.0
pkgrel=1
pkgdesc="Collaborative screen sharing with remote control"
arch=('x86_64')
url="https://pairux.com"
license=('MIT')
depends=('gtk3' 'libnotify' 'nss' 'libxss' 'libxtst' 'xdg-utils' 'at-spi2-core' 'util-linux-libs')
provides=('pairux')
conflicts=('pairux')
source=("https://github.com/profullstack/pairux.com/releases/download/v${pkgver}/pairux-${pkgver}-linux-x64.tar.gz")
sha256sums=('CHECKSUM_HERE')

package() {
    cd "$srcdir"

    # Install to /opt
    install -dm755 "$pkgdir/opt/pairux"
    cp -r * "$pkgdir/opt/pairux/"

    # Create symlink
    install -dm755 "$pkgdir/usr/bin"
    ln -s /opt/pairux/pairux "$pkgdir/usr/bin/pairux"

    # Desktop file
    install -Dm644 "$pkgdir/opt/pairux/pairux.desktop" "$pkgdir/usr/share/applications/pairux.desktop"

    # Icon
    install -Dm644 "$pkgdir/opt/pairux/resources/icon.png" "$pkgdir/usr/share/pixmaps/pairux.png"
}
```

**Publishing Process**:

1. Create AUR account
2. Clone AUR package: `git clone ssh://aur@aur.archlinux.org/pairux-bin.git`
3. Add PKGBUILD and .SRCINFO
4. Push to AUR

**Installation Command**:

```bash
# Using yay
yay -S pairux-bin

# Using paru
paru -S pairux-bin

# Manual
git clone https://aur.archlinux.org/pairux-bin.git
cd pairux-bin
makepkg -si
```

### AppImage (Universal)

**electron-builder Configuration**:

```yaml
# electron-builder.yml
appImage:
  artifactName: PairUX-${version}-${arch}.AppImage
  category: Network
```

**Distribution**:

- Upload to GitHub Releases
- Register on AppImageHub (optional)

**Installation**:

```bash
# Download
wget https://github.com/profullstack/pairux.com/releases/download/v1.0.0/PairUX-1.0.0-x86_64.AppImage

# Make executable
chmod +x PairUX-1.0.0-x86_64.AppImage

# Run
./PairUX-1.0.0-x86_64.AppImage
```

---

## Release Artifacts

### Required Artifacts per Release

| Platform | Artifact                         | Signed   |
| -------- | -------------------------------- | -------- |
| macOS    | PairUX-{version}-arm64.dmg       | ✅       |
| macOS    | PairUX-{version}-x64.dmg         | ✅       |
| macOS    | PairUX-{version}-arm64.pkg       | ✅       |
| macOS    | PairUX-{version}-x64.pkg         | ✅       |
| Windows  | PairUX-{version}-x64.msi         | ✅       |
| Windows  | PairUX-{version}-arm64.msi       | ✅       |
| Linux    | pairux\_{version}\_amd64.deb     | ✅ (GPG) |
| Linux    | pairux-{version}-1.x86_64.rpm    | ✅ (GPG) |
| Linux    | PairUX-{version}-x86_64.AppImage | ❌       |
| All      | SHA256SUMS.txt                   | ✅ (GPG) |

### Checksum Generation

```bash
#!/bin/bash
# scripts/generate-checksums.sh

cd dist

# Generate checksums
sha256sum *.dmg *.pkg *.msi *.deb *.rpm *.AppImage > SHA256SUMS.txt

# Sign checksums file
gpg --armor --detach-sign SHA256SUMS.txt
```

### Version Consistency

All artifacts must have consistent versioning:

```typescript
// scripts/verify-versions.ts
import { readFileSync } from 'fs';

const packageJson = JSON.parse(readFileSync('apps/desktop/package.json', 'utf-8'));
const version = packageJson.version;

// Verify all manifests match
const checks = [
  { file: 'homebrew-pairux/Casks/pairux.rb', pattern: /version "(\d+\.\d+\.\d+)"/ },
  { file: 'winget/PairUX.PairUX.yaml', pattern: /PackageVersion: (\d+\.\d+\.\d+)/ },
  { file: 'aur/pairux-bin/PKGBUILD', pattern: /pkgver=(\d+\.\d+\.\d+)/ },
];

for (const check of checks) {
  const content = readFileSync(check.file, 'utf-8');
  const match = content.match(check.pattern);
  if (!match || match[1] !== version) {
    console.error(`Version mismatch in ${check.file}: expected ${version}, found ${match?.[1]}`);
    process.exit(1);
  }
}

console.log(`All versions match: ${version}`);
```

---

## Auto-Update

### Electron Auto-Updater

**Configuration**:

```yaml
# electron-builder.yml
publish:
  provider: github
  owner: pairux
  repo: pairux
  releaseType: release
```

**Main Process Code**:

```typescript
import { autoUpdater } from 'electron-updater';

class UpdateManager {
  constructor() {
    autoUpdater.autoDownload = false;
    autoUpdater.autoInstallOnAppQuit = true;

    autoUpdater.on('update-available', (info) => {
      this.notifyUpdateAvailable(info.version);
    });

    autoUpdater.on('update-downloaded', () => {
      this.notifyUpdateReady();
    });

    autoUpdater.on('error', (error) => {
      console.error('Update error:', error);
    });
  }

  async checkForUpdates(): Promise<void> {
    await autoUpdater.checkForUpdates();
  }

  async downloadUpdate(): Promise<void> {
    await autoUpdater.downloadUpdate();
  }

  installUpdate(): void {
    autoUpdater.quitAndInstall();
  }
}
```

### Update Channels

| Channel | Audience       | Update Frequency     |
| ------- | -------------- | -------------------- |
| stable  | All users      | Major/minor releases |
| beta    | Opt-in testers | Pre-release versions |
| alpha   | Internal       | Development builds   |

```typescript
// Set update channel
autoUpdater.channel = 'stable'; // or 'beta', 'alpha'
```

---

## Download Page Implementation

### OS Detection

```typescript
// apps/web/src/lib/os-detection.ts
export type OS = 'macos' | 'windows' | 'linux' | 'unknown';
export type Arch = 'x64' | 'arm64' | 'unknown';

export function detectOS(): { os: OS; arch: Arch } {
  const userAgent = navigator.userAgent.toLowerCase();
  const platform = navigator.platform.toLowerCase();

  let os: OS = 'unknown';
  let arch: Arch = 'unknown';

  if (userAgent.includes('mac')) {
    os = 'macos';
  } else if (userAgent.includes('win')) {
    os = 'windows';
  } else if (userAgent.includes('linux')) {
    os = 'linux';
  }

  // Detect ARM
  if (userAgent.includes('arm') || platform.includes('arm')) {
    arch = 'arm64';
  } else {
    arch = 'x64';
  }

  return { os, arch };
}
```

### Download Component

```tsx
// apps/web/src/components/DownloadSection.tsx
import { detectOS } from '@/lib/os-detection';

const DOWNLOADS = {
  macos: {
    x64: {
      primary: 'brew install --cask pairux',
      direct: 'https://github.com/profullstack/pairux.com/releases/latest/download/PairUX-x64.dmg',
    },
    arm64: {
      primary: 'brew install --cask pairux',
      direct:
        'https://github.com/profullstack/pairux.com/releases/latest/download/PairUX-arm64.dmg',
    },
  },
  windows: {
    x64: {
      primary: 'winget install PairUX.PairUX',
      direct: 'https://github.com/profullstack/pairux.com/releases/latest/download/PairUX-x64.msi',
    },
    arm64: {
      primary: 'winget install PairUX.PairUX',
      direct:
        'https://github.com/profullstack/pairux.com/releases/latest/download/PairUX-arm64.msi',
    },
  },
  linux: {
    x64: {
      debian: 'sudo apt install pairux',
      fedora: 'sudo dnf install pairux',
      arch: 'yay -S pairux-bin',
      direct:
        'https://github.com/profullstack/pairux.com/releases/latest/download/PairUX-x86_64.AppImage',
    },
  },
};

export function DownloadSection() {
  const { os, arch } = detectOS();
  const downloads = DOWNLOADS[os]?.[arch] || DOWNLOADS.linux.x64;

  return (
    <div className="download-section">
      <h2>Download PairUX</h2>
      <p>
        Detected: {os} ({arch})
      </p>

      {os === 'macos' && (
        <div>
          <h3>Recommended: Homebrew</h3>
          <code>{downloads.primary}</code>
          <a href={downloads.direct}>Direct Download (DMG)</a>
        </div>
      )}

      {os === 'windows' && (
        <div>
          <h3>Recommended: WinGet</h3>
          <code>{downloads.primary}</code>
          <a href={downloads.direct}>Direct Download (MSI)</a>
        </div>
      )}

      {os === 'linux' && (
        <div>
          <h3>Choose your distribution:</h3>
          <div>
            <h4>Debian/Ubuntu</h4>
            <code>{downloads.debian}</code>
          </div>
          <div>
            <h4>Fedora/RHEL</h4>
            <code>{downloads.fedora}</code>
          </div>
          <div>
            <h4>Arch Linux</h4>
            <code>{downloads.arch}</code>
          </div>
          <a href={downloads.direct}>Download AppImage</a>
        </div>
      )}
    </div>
  );
}
```

---

## Release Checklist

### Pre-Release

- [ ] Version bumped in package.json
- [ ] CHANGELOG.md updated
- [ ] All tests passing
- [ ] Build succeeds on all platforms
- [ ] Code signing certificates valid

### Release

- [ ] Create git tag: `git tag v1.0.0`
- [ ] Push tag: `git push origin v1.0.0`
- [ ] CI builds and uploads artifacts
- [ ] Verify all artifacts on GitHub Releases
- [ ] Verify checksums

### Post-Release

- [ ] Update Homebrew cask
- [ ] Submit WinGet PR
- [ ] Update APT repository
- [ ] Update RPM repository
- [ ] Update AUR PKGBUILD
- [ ] Verify auto-updater works
- [ ] Update download page
- [ ] Announce release
