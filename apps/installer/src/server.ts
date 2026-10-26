import { serve } from '@hono/node-server';
import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { logger } from 'hono/logger';
import { descriptor, escapeHtml, footerHtml } from '@profullstack/footer';
import { existsSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));

// Read package.json version for fallback
function getPackageVersion(): string {
  try {
    const pkgPath = join(__dirname, '../package.json');
    const pkg = JSON.parse(readFileSync(pkgPath, 'utf-8')) as { version: string };
    return pkg.version;
  } catch {
    return '0.1.0';
  }
}

// Configuration
const PORT = parseInt(process.env.PORT ?? '8080', 10);
const SCRIPTS_DIR = process.env.SCRIPTS_DIR ?? join(__dirname, '../scripts');
const BASE_URL = process.env.BASE_URL ?? 'https://installer.pairux.com';
const GITHUB_REPO = process.env.GITHUB_REPO ?? 'profullstack/pairux.com';
const FALLBACK_VERSION = process.env.LATEST_VERSION ?? getPackageVersion();

// Cache for GitHub version
let cachedVersion: { version: string; timestamp: number } | null = null;
const CACHE_TTL = 5 * 60 * 1000; // 5 minutes

// Fetch latest version from GitHub releases
async function getLatestVersion(): Promise<string> {
  // Check cache
  if (cachedVersion && Date.now() - cachedVersion.timestamp < CACHE_TTL) {
    return cachedVersion.version;
  }

  try {
    const response = await fetch(`https://api.github.com/repos/${GITHUB_REPO}/releases/latest`, {
      headers: {
        Accept: 'application/vnd.github.v3+json',
        'User-Agent': 'PairUX-Installer',
      },
    });

    if (response.ok) {
      const data = (await response.json()) as { tag_name: string };
      const version = data.tag_name.replace(/^v/, '');
      cachedVersion = { version, timestamp: Date.now() };
      return version;
    }
  } catch (error) {
    console.error('Failed to fetch version from GitHub:', error);
  }

  return FALLBACK_VERSION;
}

// Get GitHub download URL for platform
function getGitHubDownloadUrl(version: string, platform: string): string {
  const baseUrl = `https://github.com/${GITHUB_REPO}/releases/download/v${version}`;

  // Map platform to electron-builder output filenames
  // These must match the artifactName pattern in electron-builder.yml
  switch (platform) {
    case 'darwin-x64':
      return `${baseUrl}/PairUX-${version}-mac.zip`;
    case 'darwin-arm64':
      return `${baseUrl}/PairUX-${version}-arm64-mac.zip`;
    case 'linux-x64':
      return `${baseUrl}/PairUX-${version}-x86_64.AppImage`;
    case 'linux-arm64':
      return `${baseUrl}/PairUX-${version}-arm64.AppImage`;
    case 'windows-x64':
      return `${baseUrl}/PairUX.Setup.${version}.exe`;
    default:
      return '';
  }
}

// Supported platforms
const PLATFORMS = [
  'linux-x64',
  'linux-arm64',
  'darwin-x64',
  'darwin-arm64',
  'windows-x64',
] as const;

type Platform = (typeof PLATFORMS)[number];

const app = new Hono();

// Middleware
app.use('*', logger());
app.use('*', cors());

// Health check
app.get('/health', async (c) => {
  const version = await getLatestVersion();
  return c.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    version,
  });
});

// The site's homepage, as the Profullstack webring and the built.indie / pwamart
// badges know it.
const SITE = `${BASE_URL.replace(/\/+$/, '')}/`;

// Browsers (and crawlers such as the ring verifier) get an HTML page with the
// install commands and the server-rendered Profullstack footer; scripts and
// `curl` (Accept: */* or application/json) keep getting the JSON service info.
function wantsHtml(accept: string | undefined): boolean {
  return /text\/html/i.test(accept ?? '');
}

async function landingPage(latestVersion: string): Promise<string> {
  const unix = `curl -fsSL ${BASE_URL}/install.sh | bash`;
  const windows = `irm ${BASE_URL}/install.ps1 | iex`;
  const footer = await footerHtml({ site: SITE, name: 'PairUX Installer' });
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Install PairUX</title>
<meta name="description" content="Install the PairUX desktop app with one command on macOS, Linux or Windows.">
<link rel="canonical" href="${escapeHtml(SITE)}">
<style>
:root{color-scheme:light dark;font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;line-height:1.5}
body{margin:0;background:Canvas;color:CanvasText}
main{max-width:46rem;margin:0 auto;padding:3rem 1rem 2rem}
h1{font-size:1.75rem;margin:0 0 .25rem}
h2{font-size:1.05rem;margin:2rem 0 .5rem}
pre{overflow-x:auto;padding:.75rem 1rem;border-radius:.5rem;background:color-mix(in srgb,CanvasText 8%,Canvas)}
a{color:inherit}
.muted{opacity:.75}
</style>
</head>
<body>
<main>
<h1>Install PairUX</h1>
<p class="muted">Latest release: ${escapeHtml(latestVersion)}. <a href="https://pairux.com/">pairux.com</a></p>
<h2>macOS and Linux</h2>
<pre><code>${escapeHtml(unix)}</code></pre>
<h2>Windows (PowerShell)</h2>
<pre><code>${escapeHtml(windows)}</code></pre>
<h2>Downloads</h2>
<p><a href="https://github.com/${escapeHtml(GITHUB_REPO)}/releases">All releases on GitHub</a> &middot; <a href="/api/releases">/api/releases</a> &middot; <a href="/api/version">/api/version</a></p>
</main>
${footer}
</body>
</html>`;
}

app.get('/.well-known/openwebring.json', (c) =>
  c.json(descriptor({ site: SITE, name: 'PairUX Installer' }))
);

// Root - HTML landing page for browsers, service info JSON for everything else
app.get('/', async (c) => {
  const latestVersion = await getLatestVersion();
  c.header('Vary', 'Accept');
  if (wantsHtml(c.req.header('accept'))) {
    return c.html(await landingPage(latestVersion));
  }
  return c.json({
    name: 'PairUX Installer Service',
    version: getPackageVersion(),
    latestRelease: latestVersion,
    install: {
      unix: `curl -fsSL ${BASE_URL}/install.sh | bash`,
      windows: `irm ${BASE_URL}/install.ps1 | iex`,
    },
    endpoints: {
      install: {
        unix: '/install.sh',
        windows: '/install.ps1',
      },
      version: '/api/version',
      releases: '/api/releases',
      download: '/download/:version/:platform',
    },
    github: `https://github.com/${GITHUB_REPO}/releases`,
  });
});

// Get latest version (plain text)
app.get('/api/version', async (c) => {
  const version = await getLatestVersion();
  return c.text(version);
});

// Get release info
app.get('/api/releases', async (c) => {
  const latestVersion = await getLatestVersion();
  const downloads: Record<string, string> = {};

  for (const platform of PLATFORMS) {
    downloads[platform] = getGitHubDownloadUrl(latestVersion, platform);
  }

  return c.json({
    latest: latestVersion,
    platforms: PLATFORMS,
    downloads,
    github: `https://github.com/${GITHUB_REPO}/releases/tag/v${latestVersion}`,
  });
});

// Get release info for specific version
app.get('/api/releases/:version', (c) => {
  const version = c.req.param('version');
  const downloads: Record<string, string> = {};

  for (const platform of PLATFORMS) {
    downloads[platform] = getGitHubDownloadUrl(version, platform);
  }

  return c.json({
    version,
    platforms: PLATFORMS,
    downloads,
    github: `https://github.com/${GITHUB_REPO}/releases/tag/v${version}`,
  });
});

// Serve Unix install script
app.get('/install.sh', (c) => {
  const scriptPath = join(SCRIPTS_DIR, 'install.sh');

  if (!existsSync(scriptPath)) {
    return c.text('Install script not found', 404);
  }

  const content = readFileSync(scriptPath, 'utf-8');
  return c.text(content, 200, {
    'Content-Type': 'text/plain; charset=utf-8',
    'Content-Disposition': 'inline; filename="install.sh"',
  });
});

// Serve Windows install script
app.get('/install.ps1', (c) => {
  const scriptPath = join(SCRIPTS_DIR, 'install.ps1');

  if (!existsSync(scriptPath)) {
    return c.text('Windows install script not found', 404);
  }

  const content = readFileSync(scriptPath, 'utf-8');
  return c.text(content, 200, {
    'Content-Type': 'text/plain; charset=utf-8',
    'Content-Disposition': 'inline; filename="install.ps1"',
  });
});

// Redirect to GitHub releases for downloads
app.get('/download/:version/:platform', (c) => {
  const version = c.req.param('version');
  const platform = c.req.param('platform') as Platform;

  if (!PLATFORMS.includes(platform)) {
    return c.json(
      {
        error: `Unsupported platform: ${platform}`,
        supported: PLATFORMS,
      },
      400
    );
  }

  const downloadUrl = getGitHubDownloadUrl(version, platform);

  if (!downloadUrl) {
    return c.json(
      {
        error: `No download available for platform: ${platform}`,
      },
      404
    );
  }

  return c.redirect(downloadUrl);
});

// Download latest for platform
app.get('/download/latest/:platform', async (c) => {
  const platform = c.req.param('platform');
  const latestVersion = await getLatestVersion();
  return c.redirect(`/download/${latestVersion}/${platform}`);
});

// 404 handler
app.notFound((c) => {
  return c.json({ error: 'Not found' }, 404);
});

// Error handler
app.onError((err, c) => {
  console.error('Server error:', err);
  return c.json({ error: 'Internal server error' }, 500);
});

// Start server
console.log('PairUX Installer Service starting...');
console.log(`  Port: ${String(PORT)}`);
console.log(`  GitHub repo: ${GITHUB_REPO}`);
console.log(`  Fallback version: ${FALLBACK_VERSION}`);
console.log(`  Scripts directory: ${SCRIPTS_DIR}`);

serve({
  fetch: app.fetch,
  port: PORT,
});

console.log(`Server running at http://localhost:${String(PORT)}`);
