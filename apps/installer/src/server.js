/* eslint-disable @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access */
/* global process, console */
import express from 'express';
import { existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = process.env.PORT ?? 8080;

// Configuration
const RELEASES_DIR = process.env.RELEASES_DIR ?? join(__dirname, '../releases');
const LATEST_VERSION = process.env.LATEST_VERSION ?? '0.1.0';

// Supported platforms
const PLATFORMS = [
  'linux-x64',
  'linux-arm64',
  'darwin-x64',
  'darwin-arm64',
  'windows-x64',
];

// Health check
app.get('/health', (_req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Get latest version
app.get('/api/version', (_req, res) => {
  res.type('text/plain').send(LATEST_VERSION);
});

// Get release info
app.get('/api/releases', (_req, res) => {
  res.json({
    latest: LATEST_VERSION,
    platforms: PLATFORMS,
    downloads: PLATFORMS.reduce((acc, platform) => {
      acc[platform] = `/download/${LATEST_VERSION}/${platform}`;
      return acc;
    }, {}),
  });
});

// Get release info for specific version
app.get('/api/releases/:version', (req, res) => {
  const { version } = req.params;

  res.json({
    version,
    platforms: PLATFORMS,
    downloads: PLATFORMS.reduce((acc, platform) => {
      acc[platform] = `/download/${version}/${platform}`;
      return acc;
    }, {}),
  });
});

// Serve install script
app.get('/install.sh', (_req, res) => {
  const scriptPath = join(__dirname, '../scripts/install.sh');

  if (!existsSync(scriptPath)) {
    return res.status(404).send('Install script not found');
  }

  res.type('text/plain').sendFile(scriptPath);
});

// Download binary
app.get('/download/:version/:platform', (req, res) => {
  const { version, platform } = req.params;

  if (!PLATFORMS.includes(platform)) {
    return res.status(400).json({
      error: `Unsupported platform: ${platform}`,
      supported: PLATFORMS,
    });
  }

  // Determine file extension based on platform
  const ext = platform.startsWith('windows') ? 'zip' : 'tar.gz';
  const filename = `pairux-${version}-${platform}.${ext}`;
  const filePath = join(RELEASES_DIR, version, filename);

  if (!existsSync(filePath)) {
    return res.status(404).json({
      error: `Release not found: ${filename}`,
      hint: 'This version may not be available yet.',
    });
  }

  res.download(filePath, filename);
});

// Download latest for platform
app.get('/download/latest/:platform', (req, res) => {
  res.redirect(`/download/${LATEST_VERSION}/${req.params.platform}`);
});

// Checksums
app.get('/checksums/:version', (req, res) => {
  const { version } = req.params;
  const checksumPath = join(RELEASES_DIR, version, 'checksums.txt');

  if (!existsSync(checksumPath)) {
    return res.status(404).json({ error: 'Checksums not found for this version' });
  }

  res.type('text/plain').sendFile(checksumPath);
});

// Root - redirect to main site or show info
app.get('/', (_req, res) => {
  res.json({
    name: 'PairUX Installer Service',
    version: '0.1.0',
    latestRelease: LATEST_VERSION,
    install: 'curl -fsSL https://installer.pairux.com/install.sh | bash',
    endpoints: {
      install: '/install.sh',
      version: '/api/version',
      releases: '/api/releases',
      download: '/download/:version/:platform',
      checksums: '/checksums/:version',
    },
  });
});

// 404 handler
app.use((_req, res) => {
  res.status(404).json({ error: 'Not found' });
});

// Error handler
app.use((err, _req, res, _next) => {
  console.error('Server error:', err);
  res.status(500).json({ error: 'Internal server error' });
});

app.listen(PORT, () => {
  console.log(`PairUX Installer Service running on port ${String(PORT)}`);
  console.log(`Latest version: ${LATEST_VERSION}`);
  console.log(`Releases directory: ${RELEASES_DIR}`);
});
