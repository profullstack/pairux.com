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
  Loader2,
} from 'lucide-react';
import { detectOS, type OS, type Arch } from '@/lib/utils';
import { trackDownload } from '@/lib/analytics';

const GITHUB_REPO = 'profullstack/pairux.com';
const INSTALLER_API = 'https://installer.pairux.com';

interface ReleaseInfo {
  version: string;
  downloads: {
    // macOS
    'mac-arm64-dmg': string;
    'mac-x64-dmg': string;
    'mac-arm64-zip': string;
    'mac-x64-zip': string;
    // Windows
    'win-x64-exe': string;
    // Linux
    'linux-x64-appimage': string;
    'linux-arm64-appimage': string;
    'linux-x64-deb': string;
    'linux-arm64-deb': string;
    'linux-x64-rpm': string;
    'linux-arm64-rpm': string;
  };
  checksums: Record<string, string>;
}

function getDownloadUrls(version: string): ReleaseInfo['downloads'] {
  const base = `https://github.com/${GITHUB_REPO}/releases/download/v${version}`;
  return {
    // macOS
    'mac-arm64-dmg': `${base}/PairUX-${version}-arm64.dmg`,
    'mac-x64-dmg': `${base}/PairUX-${version}.dmg`,
    'mac-arm64-zip': `${base}/PairUX-${version}-arm64-mac.zip`,
    'mac-x64-zip': `${base}/PairUX-${version}-mac.zip`,
    // Windows
    'win-x64-exe': `${base}/PairUX.Setup.${version}.exe`,
    // Linux
    'linux-x64-appimage': `${base}/PairUX-${version}-x86_64.AppImage`,
    'linux-arm64-appimage': `${base}/PairUX-${version}-arm64.AppImage`,
    'linux-x64-deb': `${base}/PairUX-${version}-amd64.deb`,
    'linux-arm64-deb': `${base}/PairUX-${version}-arm64.deb`,
    'linux-x64-rpm': `${base}/PairUX-${version}-x86_64.rpm`,
    'linux-arm64-rpm': `${base}/PairUX-${version}-aarch64.rpm`,
  };
}

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    await navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => {
      setCopied(false);
    }, 2000);
  };

  return (
    <button
      onClick={() => {
        void handleCopy();
      }}
      className="rounded p-1.5 text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-600"
      title="Copy to clipboard"
    >
      {copied ? <Check className="text-accent-600 h-4 w-4" /> : <Copy className="h-4 w-4" />}
    </button>
  );
}

export function DownloadSection() {
  const [detected, setDetected] = useState<{ os: OS; arch: Arch } | null>(null);
  const [showChecksums, setShowChecksums] = useState(false);
  const [release, setRelease] = useState<ReleaseInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setDetected(detectOS());

    // Fetch latest version from installer API
    async function fetchRelease() {
      try {
        const response = await fetch(`${INSTALLER_API}/api/version`);
        if (!response.ok) throw new Error('Failed to fetch version');
        const version = (await response.text()).trim();

        // Fetch checksums if available
        const checksums: Record<string, string> = {};
        try {
          const checksumsUrl = `https://github.com/${GITHUB_REPO}/releases/download/v${version}/SHA256SUMS.txt`;
          const checksumResponse = await fetch(checksumsUrl);
          if (checksumResponse.ok) {
            const text = await checksumResponse.text();
            // Parse SHA256SUMS.txt format: "hash  filename"
            text.split('\n').forEach((line) => {
              const match = /^([a-f0-9]{64})\s+(.+)$/.exec(line);
              if (match?.[1] && match[2]) {
                checksums[match[2]] = match[1];
              }
            });
          }
        } catch {
          // Checksums not available, that's ok
        }

        setRelease({
          version,
          downloads: getDownloadUrls(version),
          checksums,
        });
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load release info');
      } finally {
        setLoading(false);
      }
    }

    void fetchRelease();
  }, []);

  const shellInstallCommand = 'curl -fsSL https://installer.pairux.com/install.sh | bash';
  const psInstallCommand = 'irm https://installer.pairux.com/install.ps1 | iex';

  if (loading) {
    return (
      <section className="bg-white py-16">
        <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
          <div className="flex items-center justify-center gap-3">
            <Loader2 className="h-6 w-6 animate-spin text-gray-400" />
            <span className="text-gray-600">Loading release info...</span>
          </div>
        </div>
      </section>
    );
  }

  if (error || !release) {
    return (
      <section className="bg-white py-16">
        <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
          <div className="text-center">
            <p className="text-red-600">{error ?? 'Failed to load release info'}</p>
            <Link
              href={`https://github.com/${GITHUB_REPO}/releases`}
              className="text-primary-600 mt-4 inline-flex items-center gap-2 hover:underline"
            >
              View releases on GitHub
              <ExternalLink className="h-4 w-4" />
            </Link>
          </div>
        </div>
      </section>
    );
  }

  const { version, downloads, checksums } = release;

  return (
    <section className="bg-white py-16">
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        {/* Version Badge */}
        <div className="mb-8 text-center">
          <span className="inline-flex items-center gap-2 rounded-full bg-gray-100 px-4 py-1 text-sm font-medium text-gray-700">
            Latest: v{version}
          </span>
        </div>

        {/* Quick Install - Shell Script */}
        <div className="mb-16">
          <div className="border-accent-500 bg-accent-50 mx-auto max-w-2xl rounded-2xl border-2 p-8">
            <div className="flex items-center justify-center gap-3">
              <Terminal className="text-accent-600 h-8 w-8" />
              <h2 className="text-2xl font-bold text-gray-900">Quick Install</h2>
            </div>
            <p className="mt-2 text-center text-gray-600">
              The fastest way to get started. Works on macOS, Linux, and Windows.
            </p>

            <div className="mt-6 space-y-4">
              {/* Unix */}
              <div>
                <label className="mb-2 block text-sm font-medium text-gray-700">
                  macOS / Linux
                </label>
                <div className="flex items-center gap-2 rounded-lg bg-gray-900 p-4 font-mono text-sm text-gray-100">
                  <span className="text-gray-500">$</span>
                  <code className="flex-1 overflow-x-auto">{shellInstallCommand}</code>
                  <CopyButton text={shellInstallCommand} />
                </div>
              </div>

              {/* Windows */}
              <div>
                <label className="mb-2 block text-sm font-medium text-gray-700">
                  Windows (PowerShell)
                </label>
                <div className="flex items-center gap-2 rounded-lg bg-gray-900 p-4 font-mono text-sm text-gray-100">
                  <span className="text-blue-400">PS&gt;</span>
                  <code className="flex-1 overflow-x-auto">{psInstallCommand}</code>
                  <CopyButton text={psInstallCommand} />
                </div>
              </div>
            </div>

            <p className="mt-4 text-center text-xs text-gray-500">
              Automatically downloads the latest version for your platform
            </p>

            <div className="mt-6 border-t border-gray-200 pt-4">
              <p className="text-center text-sm text-gray-600">
                After installing, use{' '}
                <code className="rounded bg-gray-200 px-1.5 py-0.5 text-xs">pairux update</code> to
                upgrade and{' '}
                <code className="rounded bg-gray-200 px-1.5 py-0.5 text-xs">pairux uninstall</code>{' '}
                to remove.
              </p>
            </div>
          </div>
        </div>

        {/* Platform-Specific Download (Detected) */}
        {detected && detected.os !== 'unknown' && (
          <div className="mb-16">
            <div className="border-primary-200 bg-primary-50 mx-auto max-w-2xl rounded-2xl border p-8">
              <div className="flex items-center justify-center gap-3">
                {detected.os === 'macos' && <Apple className="text-primary-600 h-8 w-8" />}
                {detected.os === 'windows' && <Monitor className="text-primary-600 h-8 w-8" />}
                {detected.os === 'linux' && <Terminal className="text-primary-600 h-8 w-8" />}
                <h2 className="text-2xl font-bold text-gray-900">
                  {detected.os === 'macos' &&
                    `macOS ${detected.arch === 'arm64' ? '(Apple Silicon)' : '(Intel)'}`}
                  {detected.os === 'windows' && 'Windows'}
                  {detected.os === 'linux' &&
                    `Linux ${detected.arch === 'arm64' ? '(ARM64)' : '(x64)'}`}
                </h2>
              </div>
              <p className="mt-2 text-center text-gray-600">Detected based on your browser</p>

              <div className="mt-6 flex flex-col items-center gap-4">
                {detected.os === 'macos' && (
                  <Link
                    href={
                      detected.arch === 'arm64'
                        ? downloads['mac-arm64-dmg']
                        : downloads['mac-x64-dmg']
                    }
                    className="bg-primary-600 hover:bg-primary-700 inline-flex items-center gap-2 rounded-lg px-6 py-3 font-semibold text-white transition-colors"
                    onClick={() => {
                      trackDownload({ platform: 'macos', method: 'direct' });
                    }}
                  >
                    <Download className="h-5 w-5" />
                    Download DMG
                  </Link>
                )}
                {detected.os === 'windows' && (
                  <Link
                    href={downloads['win-x64-exe']}
                    className="bg-primary-600 hover:bg-primary-700 inline-flex items-center gap-2 rounded-lg px-6 py-3 font-semibold text-white transition-colors"
                    onClick={() => {
                      trackDownload({ platform: 'windows', method: 'direct' });
                    }}
                  >
                    <Download className="h-5 w-5" />
                    Download Installer
                  </Link>
                )}
                {detected.os === 'linux' && (
                  <Link
                    href={
                      detected.arch === 'arm64'
                        ? downloads['linux-arm64-appimage']
                        : downloads['linux-x64-appimage']
                    }
                    className="bg-primary-600 hover:bg-primary-700 inline-flex items-center gap-2 rounded-lg px-6 py-3 font-semibold text-white transition-colors"
                    onClick={() => {
                      trackDownload({ platform: 'linux', method: 'direct' });
                    }}
                  >
                    <Download className="h-5 w-5" />
                    Download AppImage
                  </Link>
                )}
              </div>
            </div>
          </div>
        )}

        {/* All Platforms */}
        <div>
          <h2 className="text-center text-2xl font-bold text-gray-900">All Platforms</h2>
          <p className="mt-2 text-center text-gray-600">
            Choose your operating system and preferred format
          </p>

          <div className="mt-10 grid gap-8 lg:grid-cols-3">
            {/* macOS */}
            <div className="rounded-xl border border-gray-200 p-6">
              <div className="flex items-center gap-3">
                <Apple className="h-8 w-8 text-gray-800" />
                <h3 className="text-xl font-semibold text-gray-900">macOS</h3>
              </div>
              <p className="mt-2 text-sm text-gray-600">Requires macOS 12 (Monterey) or later</p>

              <div className="mt-6 space-y-2">
                <Link
                  href={downloads['mac-arm64-dmg']}
                  className="flex items-center justify-between rounded-lg border border-gray-200 px-4 py-2 text-sm transition-colors hover:bg-gray-50"
                  onClick={() => {
                    trackDownload({ platform: 'macos', method: 'direct' });
                  }}
                >
                  <span>DMG (Apple Silicon)</span>
                  <Download className="h-4 w-4 text-gray-500" />
                </Link>
                <Link
                  href={downloads['mac-x64-dmg']}
                  className="flex items-center justify-between rounded-lg border border-gray-200 px-4 py-2 text-sm transition-colors hover:bg-gray-50"
                  onClick={() => {
                    trackDownload({ platform: 'macos', method: 'direct' });
                  }}
                >
                  <span>DMG (Intel)</span>
                  <Download className="h-4 w-4 text-gray-500" />
                </Link>
                <Link
                  href={downloads['mac-arm64-zip']}
                  className="flex items-center justify-between rounded-lg border border-gray-200 px-4 py-2 text-sm transition-colors hover:bg-gray-50"
                  onClick={() => {
                    trackDownload({ platform: 'macos', method: 'direct' });
                  }}
                >
                  <span>ZIP (Apple Silicon)</span>
                  <Download className="h-4 w-4 text-gray-500" />
                </Link>
                <Link
                  href={downloads['mac-x64-zip']}
                  className="flex items-center justify-between rounded-lg border border-gray-200 px-4 py-2 text-sm transition-colors hover:bg-gray-50"
                  onClick={() => {
                    trackDownload({ platform: 'macos', method: 'direct' });
                  }}
                >
                  <span>ZIP (Intel)</span>
                  <Download className="h-4 w-4 text-gray-500" />
                </Link>
              </div>

              <div className="mt-4">
                <label className="block text-sm font-medium text-gray-700">Shell Script</label>
                <div className="mt-1 flex items-center gap-2 rounded bg-gray-100 p-2 font-mono text-xs">
                  <code className="flex-1 truncate">{shellInstallCommand}</code>
                  <CopyButton text={shellInstallCommand} />
                </div>
              </div>
            </div>

            {/* Windows */}
            <div className="rounded-xl border border-gray-200 p-6">
              <div className="flex items-center gap-3">
                <Monitor className="h-8 w-8 text-blue-600" />
                <h3 className="text-xl font-semibold text-gray-900">Windows</h3>
              </div>
              <p className="mt-2 text-sm text-gray-600">Requires Windows 10 (1809) or later</p>

              <div className="mt-6 space-y-2">
                <Link
                  href={downloads['win-x64-exe']}
                  className="flex items-center justify-between rounded-lg border border-gray-200 px-4 py-2 text-sm transition-colors hover:bg-gray-50"
                  onClick={() => {
                    trackDownload({ platform: 'windows', method: 'direct' });
                  }}
                >
                  <span>Installer (x64)</span>
                  <Download className="h-4 w-4 text-gray-500" />
                </Link>
              </div>

              <div className="mt-4">
                <label className="block text-sm font-medium text-gray-700">PowerShell</label>
                <div className="mt-1 flex items-center gap-2 rounded bg-gray-100 p-2 font-mono text-xs">
                  <code className="flex-1 truncate">{psInstallCommand}</code>
                  <CopyButton text={psInstallCommand} />
                </div>
              </div>
            </div>

            {/* Linux */}
            <div className="rounded-xl border border-gray-200 p-6">
              <div className="flex items-center gap-3">
                <Terminal className="h-8 w-8 text-orange-600" />
                <h3 className="text-xl font-semibold text-gray-900">Linux</h3>
              </div>
              <p className="mt-2 text-sm text-gray-600">Ubuntu 20.04+, Fedora 35+, Arch Linux</p>

              <div className="mt-6 space-y-2">
                <Link
                  href={downloads['linux-x64-appimage']}
                  className="flex items-center justify-between rounded-lg border border-gray-200 px-4 py-2 text-sm transition-colors hover:bg-gray-50"
                  onClick={() => {
                    trackDownload({ platform: 'linux', method: 'direct' });
                  }}
                >
                  <span>AppImage (x64)</span>
                  <Download className="h-4 w-4 text-gray-500" />
                </Link>
                <Link
                  href={downloads['linux-arm64-appimage']}
                  className="flex items-center justify-between rounded-lg border border-gray-200 px-4 py-2 text-sm transition-colors hover:bg-gray-50"
                  onClick={() => {
                    trackDownload({ platform: 'linux', method: 'direct' });
                  }}
                >
                  <span>AppImage (ARM64)</span>
                  <Download className="h-4 w-4 text-gray-500" />
                </Link>
                <Link
                  href={downloads['linux-x64-deb']}
                  className="flex items-center justify-between rounded-lg border border-gray-200 px-4 py-2 text-sm transition-colors hover:bg-gray-50"
                  onClick={() => {
                    trackDownload({ platform: 'linux', method: 'direct' });
                  }}
                >
                  <span>DEB (Debian/Ubuntu x64)</span>
                  <Download className="h-4 w-4 text-gray-500" />
                </Link>
                <Link
                  href={downloads['linux-arm64-deb']}
                  className="flex items-center justify-between rounded-lg border border-gray-200 px-4 py-2 text-sm transition-colors hover:bg-gray-50"
                  onClick={() => {
                    trackDownload({ platform: 'linux', method: 'direct' });
                  }}
                >
                  <span>DEB (Debian/Ubuntu ARM64)</span>
                  <Download className="h-4 w-4 text-gray-500" />
                </Link>
                <Link
                  href={downloads['linux-x64-rpm']}
                  className="flex items-center justify-between rounded-lg border border-gray-200 px-4 py-2 text-sm transition-colors hover:bg-gray-50"
                  onClick={() => {
                    trackDownload({ platform: 'linux', method: 'direct' });
                  }}
                >
                  <span>RPM (Fedora/RHEL x64)</span>
                  <Download className="h-4 w-4 text-gray-500" />
                </Link>
                <Link
                  href={downloads['linux-arm64-rpm']}
                  className="flex items-center justify-between rounded-lg border border-gray-200 px-4 py-2 text-sm transition-colors hover:bg-gray-50"
                  onClick={() => {
                    trackDownload({ platform: 'linux', method: 'direct' });
                  }}
                >
                  <span>RPM (Fedora/RHEL ARM64)</span>
                  <Download className="h-4 w-4 text-gray-500" />
                </Link>
              </div>

              <div className="mt-4">
                <label className="block text-sm font-medium text-gray-700">Shell Script</label>
                <div className="mt-1 flex items-center gap-2 rounded bg-gray-100 p-2 font-mono text-xs">
                  <code className="flex-1 truncate">{shellInstallCommand}</code>
                  <CopyButton text={shellInstallCommand} />
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* All Releases Link */}
        <div className="mt-12 text-center">
          <Link
            href={`https://github.com/${GITHUB_REPO}/releases`}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-2 text-sm text-gray-600 hover:text-gray-900"
          >
            View all releases on GitHub
            <ExternalLink className="h-4 w-4" />
          </Link>
        </div>

        {/* SHA256 Checksums */}
        {Object.keys(checksums).length > 0 && (
          <div className="mt-12 border-t border-gray-200 pt-8">
            <button
              onClick={() => {
                setShowChecksums(!showChecksums);
              }}
              className="mx-auto flex items-center gap-2 text-sm text-gray-600 hover:text-gray-900"
            >
              <Shield className="h-4 w-4" />
              <span>Verify downloads (SHA256 checksums)</span>
              <ChevronDown
                className={`h-4 w-4 transition-transform ${showChecksums ? 'rotate-180' : ''}`}
              />
            </button>

            {showChecksums && (
              <div className="mx-auto mt-6 max-w-3xl">
                <p className="mb-4 text-center text-sm text-gray-600">
                  Verify your download by comparing the SHA256 checksum.
                </p>
                <div className="overflow-x-auto rounded-lg border border-gray-200 bg-gray-50 p-4">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-gray-200">
                        <th className="pb-2 text-left font-medium text-gray-700">File</th>
                        <th className="pb-2 text-left font-medium text-gray-700">SHA256</th>
                      </tr>
                    </thead>
                    <tbody className="font-mono text-xs">
                      {Object.entries(checksums).map(([filename, hash]) => (
                        <tr key={filename} className="border-b border-gray-100 last:border-0">
                          <td className="py-2 pr-4 text-gray-700">{filename}</td>
                          <td className="py-2">
                            <div className="flex items-center gap-2">
                              <code className="text-gray-500">{hash}</code>
                              <CopyButton text={hash} />
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </section>
  );
}
