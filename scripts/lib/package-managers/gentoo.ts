/**
 * Gentoo Package Manager (Ebuild)
 *
 * Submits ebuilds to a custom overlay repository.
 * Overlay repo: profullstack/gentoo-pairux
 */

import { BasePackageManager } from './base.js';
import type { ReleaseInfo, SubmissionResult } from './types.js';

const OVERLAY_OWNER = 'profullstack';
const OVERLAY_REPO = 'gentoo-pairux';
const CATEGORY = 'net-misc';
const PACKAGE_NAME = 'pairux-bin';

export class GentooPackageManager extends BasePackageManager {
  readonly name = 'gentoo';
  readonly displayName = 'Gentoo';
  readonly platform = 'linux' as const;
  readonly priority = 8;

  isConfigured(): Promise<boolean> {
    return Promise.resolve(this.config.enabled && !!this.getGitHubToken());
  }

  async checkExisting(version: string): Promise<boolean> {
    try {
      const ebuildPath = `${CATEGORY}/${PACKAGE_NAME}/${PACKAGE_NAME}-${version}.ebuild`;
      const existing = await this.getFileContent(OVERLAY_OWNER, OVERLAY_REPO, ebuildPath);
      return existing !== null;
    } catch {
      return false;
    }
  }

  generateManifest(release: ReleaseInfo): Promise<Record<string, string>> {
    // Generate ebuild
    const ebuild = `# Copyright 2024 Gentoo Authors
# Distributed under the terms of the MIT License

EAPI=8

DESCRIPTION="Collaborative screen sharing with remote control"
HOMEPAGE="https://pairux.com"
SRC_URI="https://github.com/profullstack/pairux.com/releases/download/v\${PV}/PairUX-\${PV}-x86_64.AppImage -> \${P}.AppImage"

LICENSE="MIT"
SLOT="0"
KEYWORDS="~amd64"
IUSE=""

RDEPEND="
	dev-libs/nss
	media-libs/alsa-lib
	sys-apps/fuse:0
	x11-libs/gtk+:3
	x11-libs/libnotify
	x11-libs/libXScrnSaver
	x11-libs/libXtst
"
DEPEND=""
BDEPEND=""

S="\${WORKDIR}"

QA_PREBUILT="opt/pairux/*"

src_unpack() {
	cp "\${DISTDIR}/\${P}.AppImage" "\${S}/" || die
}

src_install() {
	# Install AppImage
	insinto /opt/pairux
	doins "\${P}.AppImage"
	fperms 0755 "/opt/pairux/\${P}.AppImage"

	# Create wrapper script
	dobin "\${FILESDIR}/pairux"

	# Install desktop file
	insinto /usr/share/applications
	doins "\${FILESDIR}/pairux.desktop"

	# Extract and install icon
	"\${S}/\${P}.AppImage" --appimage-extract usr/share/icons/hicolor/512x512/apps/*.png 2>/dev/null || true
	if [[ -f squashfs-root/usr/share/icons/hicolor/512x512/apps/*.png ]]; then
		insinto /usr/share/pixmaps
		newins squashfs-root/usr/share/icons/hicolor/512x512/apps/*.png pairux.png
	fi
	rm -rf squashfs-root
}

pkg_postinst() {
	xdg_desktop_database_update
	xdg_icon_cache_update
}

pkg_postrm() {
	xdg_desktop_database_update
	xdg_icon_cache_update
}
`;

    // Generate metadata.xml
    const metadataXml = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE pkgmetadata SYSTEM "https://www.gentoo.org/dtd/metadata.dtd">
<pkgmetadata>
	<maintainer type="person">
		<email>hello@pairux.com</email>
		<name>PairUX Team</name>
	</maintainer>
	<upstream>
		<remote-id type="github">profullstack/pairux.com</remote-id>
		<bugs-to>https://github.com/profullstack/pairux.com/issues</bugs-to>
	</upstream>
	<longdescription lang="en">
		PairUX is a collaborative screen sharing application with simultaneous
		remote mouse and keyboard control. Like Screenhero, but open source.
		Perfect for pair programming, remote support, and collaboration.
	</longdescription>
</pkgmetadata>
`;

    // Generate actual wrapper script with version
    const actualWrapper = `#!/bin/bash
export ELECTRON_DISABLE_SANDBOX=1
exec /opt/pairux/pairux-bin-${release.version}.AppImage "$@"
`;

    // Generate actual desktop file with version
    const actualDesktop = `[Desktop Entry]
Name=PairUX
Comment=Collaborative screen sharing with remote control
Exec=/opt/pairux/pairux-bin-${release.version}.AppImage --no-sandbox %U
Icon=pairux
Type=Application
Categories=Network;RemoteAccess;
StartupWMClass=PairUX
`;

    // Generate README
    const readme = `# PairUX Gentoo Overlay

Gentoo overlay for [PairUX](https://pairux.com) - Collaborative screen sharing with remote control.

## Installation

### Using eselect-repository (recommended)

\`\`\`bash
# Install eselect-repository if not already installed
sudo emerge app-eselect/eselect-repository

# Add the overlay
sudo eselect repository add pairux git https://github.com/profullstack/gentoo-pairux.git

# Sync the overlay
sudo emaint sync -r pairux

# Install PairUX
sudo emerge net-misc/pairux-bin
\`\`\`

### Using layman (deprecated)

\`\`\`bash
# Add overlay
sudo layman -o https://raw.githubusercontent.com/profullstack/gentoo-pairux/master/repositories.xml -f -a pairux

# Install
sudo emerge net-misc/pairux-bin
\`\`\`

## Package Info

- **Category:** net-misc
- **Package:** pairux-bin
- **Version:** ${release.version}
- **License:** MIT

## Uninstall

\`\`\`bash
sudo emerge --unmerge net-misc/pairux-bin
sudo eselect repository remove pairux
\`\`\`

## License

MIT
`;

    // Generate repositories.xml for layman compatibility
    const repositoriesXml = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE repositories SYSTEM "/dtd/repositories.dtd">
<repositories xmlns="" version="1.0">
  <repo quality="experimental" status="unofficial">
    <name>pairux</name>
    <description>Gentoo overlay for PairUX - collaborative screen sharing</description>
    <homepage>https://pairux.com</homepage>
    <owner>
      <email>hello@pairux.com</email>
      <name>PairUX Team</name>
    </owner>
    <source type="git">https://github.com/profullstack/gentoo-pairux.git</source>
  </repo>
</repositories>
`;

    return Promise.resolve({
      [`${CATEGORY}/${PACKAGE_NAME}/${PACKAGE_NAME}-${release.version}.ebuild`]: ebuild,
      [`${CATEGORY}/${PACKAGE_NAME}/metadata.xml`]: metadataXml,
      [`${CATEGORY}/${PACKAGE_NAME}/files/pairux`]: actualWrapper,
      [`${CATEGORY}/${PACKAGE_NAME}/files/pairux.desktop`]: actualDesktop,
      'README.md': readme,
      'repositories.xml': repositoriesXml,
    });
  }

  async submit(release: ReleaseInfo, dryRun = false): Promise<SubmissionResult> {
    // Check if already exists
    if (await this.checkExisting(release.version)) {
      return {
        packageManager: this.name,
        status: 'skipped',
        message: `Version ${release.version} already exists in Gentoo overlay`,
        alreadyExists: true,
      };
    }

    const files = await this.generateManifest(release);

    if (dryRun) {
      this.logger.info('Dry run - generated Gentoo ebuild files:');
      for (const [path, content] of Object.entries(files)) {
        this.logger.info(`\n--- ${path} ---`);
        console.log(content);
      }
      return {
        packageManager: this.name,
        status: 'skipped',
        message: 'Dry run - ebuild files generated',
      };
    }

    // Ensure overlay repo exists
    await this.ensureRepo(
      OVERLAY_OWNER,
      OVERLAY_REPO,
      'Gentoo overlay for PairUX - collaborative screen sharing'
    );

    // Submit directly to the overlay repo
    const githubFiles = Object.entries(files).map(([path, content]) => ({
      path,
      content,
    }));

    return this.submitDirect(
      OVERLAY_OWNER,
      OVERLAY_REPO,
      githubFiles,
      `Update ${PACKAGE_NAME} to ${release.version}`
    );
  }
}
