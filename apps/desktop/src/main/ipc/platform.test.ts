import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Create mock handlers storage
const mockHandlers = new Map<string, (...args: unknown[]) => unknown>();

vi.mock('electron', () => ({
  ipcMain: {
    handle: vi.fn((channel: string, handler: (...args: unknown[]) => unknown) => {
      mockHandlers.set(channel, handler);
    }),
  },
  app: {
    getPath: vi.fn((type: string) => `/test/path/${type}`),
  },
  shell: {
    openExternal: vi.fn().mockResolvedValue(undefined),
    showItemInFolder: vi.fn(),
  },
  dialog: {
    showMessageBox: vi.fn().mockResolvedValue({ response: 1 }),
  },
}));

vi.mock('../platform', () => ({
  getPlatformInfo: vi.fn().mockReturnValue({
    platform: 'darwin',
    displayServer: 'unknown',
    isWayland: false,
    isX11: false,
    arch: 'arm64',
    version: '14.0.0',
    isElevated: false,
    hasScreenCaptureSupport: true,
    hasInputInjectionSupport: true,
  }),
  checkPipeWireAvailable: vi.fn().mockReturnValue(false),
  checkXTESTAvailable: vi.fn().mockReturnValue(true),
  getLinuxDistro: vi.fn().mockReturnValue({ name: 'Ubuntu', version: '22.04' }),
  requestWindowsElevation: vi.fn().mockResolvedValue(false),
  checkWindowsDefenderExclusion: vi.fn().mockReturnValue(false),
  showWindowsDefenderHelp: vi.fn().mockResolvedValue(undefined),
  openMacOSSystemPreferences: vi.fn().mockResolvedValue(undefined),
  isAppleSilicon: vi.fn().mockReturnValue(true),
  isElevated: vi.fn().mockReturnValue(false),
}));

describe('Platform IPC Handlers', () => {
  const originalPlatform = process.platform;
  const originalEnv = { ...process.env };

  beforeEach(async () => {
    vi.clearAllMocks();
    mockHandlers.clear();

    // Register handlers
    const { registerPlatformHandlers } = await import('./platform');
    registerPlatformHandlers();
  });

  afterEach(() => {
    Object.defineProperty(process, 'platform', { value: originalPlatform });
    process.env = { ...originalEnv };
  });

  describe('platform:info', () => {
    it('should return platform information', async () => {
      const handler = mockHandlers.get('platform:info');
      expect(handler).toBeDefined();

      const result = handler?.();
      expect(result).toEqual({
        platform: 'darwin',
        displayServer: 'unknown',
        isWayland: false,
        isX11: false,
        arch: 'arm64',
        version: '14.0.0',
        isElevated: false,
        hasScreenCaptureSupport: true,
        hasInputInjectionSupport: true,
      });
    });
  });

  describe('platform:linux-info', () => {
    it('should return null on non-Linux', async () => {
      Object.defineProperty(process, 'platform', { value: 'darwin' });

      const handler = mockHandlers.get('platform:linux-info');
      expect(handler).toBeDefined();

      const result = handler?.();
      expect(result).toBeNull();
    });

    it('should return Linux info on Linux', async () => {
      Object.defineProperty(process, 'platform', { value: 'linux' });
      process.env.XDG_SESSION_TYPE = 'x11';
      process.env.DISPLAY = ':0';

      // Re-register handlers after platform change
      vi.resetModules();
      mockHandlers.clear();
      const { registerPlatformHandlers } = await import('./platform');
      registerPlatformHandlers();

      const handler = mockHandlers.get('platform:linux-info');
      const result = handler?.();

      expect(result).not.toBeNull();
      expect(result).toHaveProperty('distro');
      expect(result).toHaveProperty('hasPipeWire');
      expect(result).toHaveProperty('hasXTEST');
    });
  });

  describe('platform:is-elevated', () => {
    it('should return elevation status', async () => {
      const handler = mockHandlers.get('platform:is-elevated');
      expect(handler).toBeDefined();

      const result = handler?.();
      expect(result).toBe(false);
    });
  });

  describe('platform:request-elevation', () => {
    it('should request elevation', async () => {
      const handler = mockHandlers.get('platform:request-elevation');
      expect(handler).toBeDefined();

      const { requestWindowsElevation } = await import('../platform');
      const result = await handler?.({}, 'Test reason');

      expect(requestWindowsElevation).toHaveBeenCalledWith('Test reason');
      expect(result).toBe(false);
    });
  });

  describe('platform:check-defender-exclusion', () => {
    it('should check Windows Defender exclusion', async () => {
      const handler = mockHandlers.get('platform:check-defender-exclusion');
      expect(handler).toBeDefined();

      const { checkWindowsDefenderExclusion } = await import('../platform');
      const result = handler?.();

      expect(checkWindowsDefenderExclusion).toHaveBeenCalled();
      expect(result).toBe(false);
    });
  });

  describe('platform:show-defender-help', () => {
    it('should show Windows Defender help', async () => {
      const handler = mockHandlers.get('platform:show-defender-help');
      expect(handler).toBeDefined();

      const { showWindowsDefenderHelp } = await import('../platform');
      const result = await handler?.();

      expect(showWindowsDefenderHelp).toHaveBeenCalled();
      expect(result).toEqual({ success: true });
    });
  });

  describe('platform:open-macos-preferences', () => {
    it('should open macOS System Preferences', async () => {
      const handler = mockHandlers.get('platform:open-macos-preferences');
      expect(handler).toBeDefined();

      const { openMacOSSystemPreferences } = await import('../platform');
      const result = await handler?.({}, 'accessibility');

      expect(openMacOSSystemPreferences).toHaveBeenCalledWith('accessibility');
      expect(result).toEqual({ success: true });
    });
  });

  describe('platform:is-apple-silicon', () => {
    it('should check Apple Silicon', async () => {
      const handler = mockHandlers.get('platform:is-apple-silicon');
      expect(handler).toBeDefined();

      const { isAppleSilicon } = await import('../platform');
      const result = handler?.();

      expect(isAppleSilicon).toHaveBeenCalled();
      expect(result).toBe(true);
    });
  });

  describe('platform:get-paths', () => {
    it('should return app paths', async () => {
      const handler = mockHandlers.get('platform:get-paths');
      expect(handler).toBeDefined();

      const result = handler?.();

      expect(result).toHaveProperty('exe');
      expect(result).toHaveProperty('userData');
      expect(result).toHaveProperty('logs');
      expect(result).toHaveProperty('temp');
    });
  });

  describe('platform:open-external', () => {
    it('should open external URL', async () => {
      const { shell } = await import('electron');
      const handler = mockHandlers.get('platform:open-external');
      expect(handler).toBeDefined();

      const result = await handler?.({}, 'https://pairux.com');

      expect(shell.openExternal).toHaveBeenCalledWith('https://pairux.com');
      expect(result).toEqual({ success: true });
    });
  });

  describe('platform:show-in-folder', () => {
    it('should show item in folder', async () => {
      const { shell } = await import('electron');
      const handler = mockHandlers.get('platform:show-in-folder');
      expect(handler).toBeDefined();

      const result = await handler?.({}, '/test/path/file.txt');

      expect(shell.showItemInFolder).toHaveBeenCalledWith('/test/path/file.txt');
      expect(result).toEqual({ success: true });
    });
  });
});
