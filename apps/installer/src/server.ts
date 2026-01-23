import { serve } from '@hono/node-server';
import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { logger } from 'hono/logger';
import { existsSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));

// Configuration
const PORT = parseInt(process.env.PORT ?? '8080', 10);
const RELEASES_DIR = process.env.RELEASES_DIR ?? join(__dirname, '../releases');
const SCRIPTS_DIR = process.env.SCRIPTS_DIR ?? join(__dirname, '../scripts');
const LATEST_VERSION = process.env.LATEST_VERSION ?? '0.1.0';
const BASE_URL = process.env.BASE_URL ?? 'https://installer.pairux.com';

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
app.get('/health', (c) => {
  return c.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    version: LATEST_VERSION,
  });
});

// Root - service info
app.get('/', (c) => {
  return c.json({
    name: 'PairUX Installer Service',
    version: '0.1.0',
    latestRelease: LATEST_VERSION,
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
      checksums: '/checksums/:version',
    },
  });
});

// Get latest version (plain text)
app.get('/api/version', (c) => {
  return c.text(LATEST_VERSION);
});

// Get release info
app.get('/api/releases', (c) => {
  const downloads: Record<string, string> = {};
  for (const platform of PLATFORMS) {
    downloads[platform] = `/download/${LATEST_VERSION}/${platform}`;
  }

  return c.json({
    latest: LATEST_VERSION,
    platforms: PLATFORMS,
    downloads,
  });
});

// Get release info for specific version
app.get('/api/releases/:version', (c) => {
  const version = c.req.param('version');
  const downloads: Record<string, string> = {};
  for (const platform of PLATFORMS) {
    downloads[platform] = `/download/${version}/${platform}`;
  }

  return c.json({
    version,
    platforms: PLATFORMS,
    downloads,
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

// Download binary
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

  // Determine file extension based on platform
  const ext = platform.startsWith('windows') ? 'zip' : 'tar.gz';
  const filename = `pairux-${version}-${platform}.${ext}`;
  const filePath = join(RELEASES_DIR, version, filename);

  if (!existsSync(filePath)) {
    return c.json(
      {
        error: `Release not found: ${filename}`,
        hint: 'This version may not be available yet. Check /api/releases for available versions.',
      },
      404
    );
  }

  const content = readFileSync(filePath);
  const contentType = platform.startsWith('windows')
    ? 'application/zip'
    : 'application/gzip';

  return c.body(content, 200, {
    'Content-Type': contentType,
    'Content-Disposition': `attachment; filename="${filename}"`,
    'Content-Length': content.length.toString(),
  });
});

// Download latest for platform
app.get('/download/latest/:platform', (c) => {
  const platform = c.req.param('platform');
  return c.redirect(`/download/${LATEST_VERSION}/${platform}`);
});

// Checksums
app.get('/checksums/:version', (c) => {
  const version = c.req.param('version');
  const checksumPath = join(RELEASES_DIR, version, 'checksums.txt');

  if (!existsSync(checksumPath)) {
    return c.json({ error: 'Checksums not found for this version' }, 404);
  }

  const content = readFileSync(checksumPath, 'utf-8');
  return c.text(content, 200, {
    'Content-Type': 'text/plain; charset=utf-8',
  });
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
console.log(`  Latest version: ${LATEST_VERSION}`);
console.log(`  Releases directory: ${RELEASES_DIR}`);
console.log(`  Scripts directory: ${SCRIPTS_DIR}`);

serve({
  fetch: app.fetch,
  port: PORT,
});

console.log(`Server running at http://localhost:${String(PORT)}`);
