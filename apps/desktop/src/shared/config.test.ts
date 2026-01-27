import { describe, it, expect, vi, afterEach } from 'vitest';

describe('shared config', () => {
  const originalEnv = { ...process.env };

  afterEach(() => {
    process.env = { ...originalEnv };
    vi.resetModules();
  });

  it('should export APP_URL as production URL', async () => {
    const { APP_URL } = await import('./config');
    expect(APP_URL).toBe('https://pairux.com');
  });

  it('should export API_BASE_URL as pairux.com by default', async () => {
    delete process.env.PAIRUX_API_URL;
    const { API_BASE_URL } = await import('./config');
    expect(API_BASE_URL).toBe('https://pairux.com');
  });

  it('should export API_BASE_URL as pairux.com even in development mode', async () => {
    delete process.env.PAIRUX_API_URL;
    process.env.NODE_ENV = 'development';
    const { API_BASE_URL } = await import('./config');
    expect(API_BASE_URL).toBe('https://pairux.com');
  });

  it('should allow overriding API_BASE_URL via PAIRUX_API_URL env var', async () => {
    process.env.PAIRUX_API_URL = 'http://localhost:3000';
    const { API_BASE_URL } = await import('./config');
    expect(API_BASE_URL).toBe('http://localhost:3000');
  });

  it('should ignore empty PAIRUX_API_URL and fall back to APP_URL', async () => {
    process.env.PAIRUX_API_URL = '';
    const { API_BASE_URL } = await import('./config');
    expect(API_BASE_URL).toBe('https://pairux.com');
  });
});
