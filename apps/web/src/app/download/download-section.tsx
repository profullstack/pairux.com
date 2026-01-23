'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import {
  Apple,
  Monitor,
  Terminal,
  Download,
  Copy,
  Check,
  ExternalLink,
  ChevronDown,
  Shield,
} from 'lucide-react';
import { detectOS, type OS, type Arch } from '@/lib/utils';
import { trackDownload } from '@/lib/analytics';

const VERSION = '0.1.0';

// Placeholder checksums - will be generated during release build
const CHECKSUMS: Record<string, string> = {
  [`PairUX-${VERSION}-arm64.dmg`]: 'sha256-placeholder-arm64-dmg',
  [`PairUX-${VERSION}-x64.dmg`]: 'sha256-placeholder-x64-dmg',
  [`PairUX-${VERSION}-arm64.msi`]: 'sha256-placeholder-arm64-msi',
  [`PairUX-${VERSION}-x64.msi`]: 'sha256-placeholder-x64-msi',
  [`PairUX-${VERSION}-x86_64.AppImage`]: 'sha256-placeholder-appimage',
};

interface DownloadOption {
  command?: string;
  directUrl?: string;
  directLabel?: string;
}

interface PlatformInfo {
  name: string;
  icon: typeof Apple;
  primary: DownloadOption;
  secondary?: DownloadOption;
}

const DOWNLOADS: Record<OS, Record<Arch, PlatformInfo> | PlatformInfo> = {
  macos: {
    arm64: {
      name: 'macOS (Apple Silicon)',
      icon: Apple,
      primary: {
        command: 'brew install --cask pairux',
      },
      secondary: {
        directUrl: `https://github.com/profullstack/pairux.com/releases/download/v${VERSION}/PairUX-${VERSION}-arm64.dmg`,
        directLabel: 'Download DMG (arm64)',
      },
    },
    x64: {
      name: 'macOS (Intel)',
      icon: Apple,
      primary: {
        command: 'brew install --cask pairux',
      },
      secondary: {
        directUrl: `https://github.com/profullstack/pairux.com/releases/download/v${VERSION}/PairUX-${VERSION}-x64.dmg`,
        directLabel: 'Download DMG (x64)',
      },
    },
    unknown: {
      name: 'macOS',
      icon: Apple,
      primary: {
        command: 'brew install --cask pairux',
      },
    },
  },
  windows: {
    arm64: {
      name: 'Windows (ARM64)',
      icon: Monitor,
      primary: {
        command: 'winget install PairUX.PairUX',
      },
      secondary: {
        directUrl: `https://github.com/profullstack/pairux.com/releases/download/v${VERSION}/PairUX-${VERSION}-arm64.msi`,
        directLabel: 'Download MSI (arm64)',
      },
    },
    x64: {
      name: 'Windows',
      icon: Monitor,
      primary: {
        command: 'winget install PairUX.PairUX',
      },
      secondary: {
        directUrl: `https://github.com/profullstack/pairux.com/releases/download/v${VERSION}/PairUX-${VERSION}-x64.msi`,
        directLabel: 'Download MSI (x64)',
      },
    },
    unknown: {
      name: 'Windows',
      icon: Monitor,
      primary: {
        command: 'winget install PairUX.PairUX',
      },
    },
  },
  linux: {
    name: 'Linux',
    icon: Terminal,
    primary: {
      command: 'sudo apt install pairux',
    },
    secondary: {
      directUrl: `https://github.com/profullstack/pairux.com/releases/download/v${VERSION}/PairUX-${VERSION}-x86_64.AppImage`,
      directLabel: 'Download AppImage',
    },
  },
  unknown: {
    name: 'Desktop App',
    icon: Monitor,
    primary: {
      directUrl: `https://github.com/profullstack/pairux.com/releases/tag/v${VERSION}`,
      directLabel: 'View All Downloads',
    },
  },
};

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    await navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => { setCopied(false); }, 2000);
  };

  return (
    <button
      onClick={() => { void handleCopy(); }}
      className="rounded p-1.5 text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-600"
      title="Copy to clipboard"
    >
      {copied ? (
        <Check className="h-4 w-4 text-accent-600" />
      ) : (
        <Copy className="h-4 w-4" />
      )}
    </button>
  );
}

function getPlatformInfo(os: OS, arch: Arch): PlatformInfo {
  const platformData = DOWNLOADS[os];
  if ('name' in platformData) {
    return platformData;
  }
  // platformData is Record<Arch, PlatformInfo>, arch is guaranteed to exist
  return platformData[arch];
}

export function DownloadSection() {
  const [detected, setDetected] = useState<{ os: OS; arch: Arch } | null>(null);
  const [showChecksums, setShowChecksums] = useState(false);

  useEffect(() => {
    setDetected(detectOS());
  }, []);

  const currentPlatform = detected
    ? getPlatformInfo(detected.os, detected.arch)
    : null;

  const shellInstallCommand = 'curl -fsSL https://installer.pairux.com/install.sh | bash';

  return (
    <section className="bg-white py-16">
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        {/* Quick Install - Shell Script */}
        <div className="mb-16">
          <div className="mx-auto max-w-2xl rounded-2xl border-2 border-accent-500 bg-accent-50 p-8">
            <div className="flex items-center justify-center gap-3">
              <Terminal className="h-8 w-8 text-accent-600" />
              <h2 className="text-2xl font-bold text-gray-900">
                Quick Install
              </h2>
            </div>
            <p className="mt-2 text-center text-gray-600">
              The fastest way to get started. Works on macOS and Linux.
            </p>

            <div className="mt-6">
              <div className="flex items-center gap-2 rounded-lg bg-gray-900 p-4 font-mono text-sm text-gray-100">
                <span className="text-gray-500">$</span>
                <code className="flex-1 overflow-x-auto">
                  {shellInstallCommand}
                </code>
                <CopyButton text={shellInstallCommand} />
              </div>
            </div>

            <p className="mt-4 text-center text-xs text-gray-500">
              Installs to ~/.pairux and adds to your PATH automatically
            </p>
          </div>
        </div>

        {/* Platform-Specific Download */}
        {currentPlatform && detected && detected.os !== 'unknown' && (
          <div className="mb-16">
            <div className="mx-auto max-w-2xl rounded-2xl border border-primary-200 bg-primary-50 p-8">
              <div className="flex items-center justify-center gap-3">
                <currentPlatform.icon className="h-8 w-8 text-primary-600" />
                <h2 className="text-2xl font-bold text-gray-900">
                  {currentPlatform.name}
                </h2>
              </div>
              <p className="mt-2 text-center text-gray-600">
                Detected based on your browser
              </p>

              {currentPlatform.primary.command && (
                <div className="mt-6">
                  <label className="block text-sm font-medium text-gray-700">
                    Install via package manager (recommended)
                  </label>
                  <div className="mt-2 flex items-center gap-2 rounded-lg bg-gray-900 p-4 font-mono text-sm text-gray-100">
                    <span className="text-gray-500">$</span>
                    <code className="flex-1">
                      {currentPlatform.primary.command}
                    </code>
                    <CopyButton text={currentPlatform.primary.command} />
                  </div>
                </div>
              )}

              {currentPlatform.primary.directUrl && (
                <div className="mt-6 text-center">
                  <Link
                    href={currentPlatform.primary.directUrl}
                    className="inline-flex items-center gap-2 rounded-lg bg-primary-600 px-6 py-3 font-semibold text-white transition-colors hover:bg-primary-700"
                  >
                    <Download className="h-5 w-5" />
                    {currentPlatform.primary.directLabel}
                  </Link>
                </div>
              )}

              {currentPlatform.secondary && (
                <div className="mt-6 text-center">
                  <Link
                    href={currentPlatform.secondary.directUrl ?? '#'}
                    className="inline-flex items-center gap-2 text-sm text-primary-600 hover:underline"
                  >
                    <Download className="h-4 w-4" />
                    {currentPlatform.secondary.directLabel}
                    <ExternalLink className="h-3 w-3" />
                  </Link>
                </div>
              )}
            </div>
          </div>
        )}

        {/* All Platforms */}
        <div>
          <h2 className="text-center text-2xl font-bold text-gray-900">
            All Platforms
          </h2>
          <p className="mt-2 text-center text-gray-600">
            Choose your operating system and preferred installation method
          </p>

          <div className="mt-10 grid gap-8 lg:grid-cols-3">
            {/* macOS */}
            <div className="rounded-xl border border-gray-200 p-6">
              <div className="flex items-center gap-3">
                <Apple className="h-8 w-8 text-gray-800" />
                <h3 className="text-xl font-semibold text-gray-900">macOS</h3>
              </div>
              <p className="mt-2 text-sm text-gray-600">
                Requires macOS 12 (Monterey) or later
              </p>

              <div className="mt-6 space-y-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700">
                    Homebrew
                  </label>
                  <div className="mt-1 flex items-center gap-2 rounded bg-gray-100 p-2 font-mono text-xs">
                    <code className="flex-1 truncate">
                      brew install --cask pairux
                    </code>
                    <CopyButton text="brew install --cask pairux" />
                  </div>
                </div>

                <div className="flex flex-col gap-2">
                  <Link
                    href={`https://github.com/profullstack/pairux.com/releases/download/v${VERSION}/PairUX-${VERSION}-arm64.dmg`}
                    className="flex items-center justify-between rounded-lg border border-gray-200 px-4 py-2 text-sm transition-colors hover:bg-gray-50"
                    onClick={() => { trackDownload({ platform: 'macos', method: 'direct' }); }}
                  >
                    <span>DMG (Apple Silicon)</span>
                    <Download className="h-4 w-4 text-gray-500" />
                  </Link>
                  <Link
                    href={`https://github.com/profullstack/pairux.com/releases/download/v${VERSION}/PairUX-${VERSION}-x64.dmg`}
                    className="flex items-center justify-between rounded-lg border border-gray-200 px-4 py-2 text-sm transition-colors hover:bg-gray-50"
                    onClick={() => { trackDownload({ platform: 'macos', method: 'direct' }); }}
                  >
                    <span>DMG (Intel)</span>
                    <Download className="h-4 w-4 text-gray-500" />
                  </Link>
                </div>
              </div>
            </div>

            {/* Windows */}
            <div className="rounded-xl border border-gray-200 p-6">
              <div className="flex items-center gap-3">
                <Monitor className="h-8 w-8 text-blue-600" />
                <h3 className="text-xl font-semibold text-gray-900">Windows</h3>
              </div>
              <p className="mt-2 text-sm text-gray-600">
                Requires Windows 10 (1809) or later
              </p>

              <div className="mt-6 space-y-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700">
                    WinGet
                  </label>
                  <div className="mt-1 flex items-center gap-2 rounded bg-gray-100 p-2 font-mono text-xs">
                    <code className="flex-1 truncate">
                      winget install PairUX.PairUX
                    </code>
                    <CopyButton text="winget install PairUX.PairUX" />
                  </div>
                </div>

                <div className="flex flex-col gap-2">
                  <Link
                    href={`https://github.com/profullstack/pairux.com/releases/download/v${VERSION}/PairUX-${VERSION}-x64.msi`}
                    className="flex items-center justify-between rounded-lg border border-gray-200 px-4 py-2 text-sm transition-colors hover:bg-gray-50"
                    onClick={() => { trackDownload({ platform: 'windows', method: 'direct' }); }}
                  >
                    <span>MSI Installer (x64)</span>
                    <Download className="h-4 w-4 text-gray-500" />
                  </Link>
                  <Link
                    href={`https://github.com/profullstack/pairux.com/releases/download/v${VERSION}/PairUX-${VERSION}-arm64.msi`}
                    className="flex items-center justify-between rounded-lg border border-gray-200 px-4 py-2 text-sm transition-colors hover:bg-gray-50"
                    onClick={() => { trackDownload({ platform: 'windows', method: 'direct' }); }}
                  >
                    <span>MSI Installer (ARM64)</span>
                    <Download className="h-4 w-4 text-gray-500" />
                  </Link>
                </div>
              </div>
            </div>

            {/* Linux */}
            <div className="rounded-xl border border-gray-200 p-6">
              <div className="flex items-center gap-3">
                <Terminal className="h-8 w-8 text-orange-600" />
                <h3 className="text-xl font-semibold text-gray-900">Linux</h3>
              </div>
              <p className="mt-2 text-sm text-gray-600">
                Ubuntu 20.04+, Fedora 35+, Arch Linux
              </p>

              <div className="mt-6 space-y-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700">
                    Debian/Ubuntu
                  </label>
                  <div className="mt-1 flex items-center gap-2 rounded bg-gray-100 p-2 font-mono text-xs">
                    <code className="flex-1 truncate">
                      sudo apt install pairux
                    </code>
                    <CopyButton text="sudo apt install pairux" />
                  </div>
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700">
                    Fedora/RHEL
                  </label>
                  <div className="mt-1 flex items-center gap-2 rounded bg-gray-100 p-2 font-mono text-xs">
                    <code className="flex-1 truncate">
                      sudo dnf install pairux
                    </code>
                    <CopyButton text="sudo dnf install pairux" />
                  </div>
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700">
                    Arch Linux (AUR)
                  </label>
                  <div className="mt-1 flex items-center gap-2 rounded bg-gray-100 p-2 font-mono text-xs">
                    <code className="flex-1 truncate">yay -S pairux-bin</code>
                    <CopyButton text="yay -S pairux-bin" />
                  </div>
                </div>

                <Link
                  href={`https://github.com/profullstack/pairux.com/releases/download/v${VERSION}/PairUX-${VERSION}-x86_64.AppImage`}
                  className="flex items-center justify-between rounded-lg border border-gray-200 px-4 py-2 text-sm transition-colors hover:bg-gray-50"
                  onClick={() => { trackDownload({ platform: 'linux', method: 'direct' }); }}
                >
                  <span>AppImage (Universal)</span>
                  <Download className="h-4 w-4 text-gray-500" />
                </Link>
              </div>
            </div>
          </div>
        </div>

        {/* All Releases Link */}
        <div className="mt-12 text-center">
          <Link
            href="https://github.com/profullstack/pairux.com/releases"
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-2 text-sm text-gray-600 hover:text-gray-900"
          >
            View all releases on GitHub
            <ExternalLink className="h-4 w-4" />
          </Link>
        </div>

        {/* SHA256 Checksums */}
        <div className="mt-12 border-t border-gray-200 pt-8">
          <button
            onClick={() => { setShowChecksums(!showChecksums); }}
            className="mx-auto flex items-center gap-2 text-sm text-gray-600 hover:text-gray-900"
          >
            <Shield className="h-4 w-4" />
            <span>Verify downloads (SHA256 checksums)</span>
            <ChevronDown className={`h-4 w-4 transition-transform ${showChecksums ? 'rotate-180' : ''}`} />
          </button>

          {showChecksums && (
            <div className="mt-6 mx-auto max-w-2xl">
              <p className="mb-4 text-center text-sm text-gray-600">
                Verify your download by comparing the SHA256 checksum.
              </p>
              <div className="rounded-lg border border-gray-200 bg-gray-50 p-4">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-gray-200">
                      <th className="pb-2 text-left font-medium text-gray-700">File</th>
                      <th className="pb-2 text-left font-medium text-gray-700">SHA256</th>
                    </tr>
                  </thead>
                  <tbody className="font-mono text-xs">
                    {Object.entries(CHECKSUMS).map(([filename, hash]) => (
                      <tr key={filename} className="border-b border-gray-100 last:border-0">
                        <td className="py-2 pr-4 text-gray-700">{filename}</td>
                        <td className="py-2">
                          <div className="flex items-center gap-2">
                            <code className="text-gray-500 truncate max-w-[200px] sm:max-w-none">
                              {hash}
                            </code>
                            <CopyButton text={hash} />
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <p className="mt-4 text-center text-xs text-gray-500">
                Checksums will be available after the first release.
              </p>
            </div>
          )}
        </div>
      </div>
    </section>
  );
}
