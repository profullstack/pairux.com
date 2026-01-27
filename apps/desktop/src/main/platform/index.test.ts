import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mock electron before importing the module
vi.mock('electron', () => ({
  app: {
    getName: vi.fn().mockReturnValue('PairUX'),
    getVersion: vi.fn().mockReturnValue('0.0.0-test'),
    getPath: vi.fn().mockReturnValue('/test/path'),
    isPackaged: false,
    showAboutPanel: vi.fn(),
    quit: vi.fn(),
  },
  dialog: {
    showMessageBox: vi.fn().mockResolvedValue({ response: 0 }),
  },
  shell: {
    openExternal: vi.fn().mockResolvedValue(undefined),
    showItemInFolder: vi.fn(),
  },
  Menu: {
    buildFromTemplate: vi.fn().mockReturnValue({}),
    setApplicationMenu: vi.fn(),
    getApplicationMenu: vi.fn().mockReturnValue(null),
  },
  BrowserWindow: {
    getFocusedWindow: vi.fn().mockReturnValue(null),
    getAllWindows: vi.fn().mockReturnValue([]),
  },
}));

// Mock child_process with default export
vi.mock('child_process', () => {
  const execSyncMock = vi.fn();
  const spawnMock = vi.fn().mockReturnValue({ unref: vi.fn() });
  return {
    execSync: execSyncMock,
    spawn: spawnMock,
    default: {
      execSync: execSyncMock,
      spawn: spawnMock,
    },
  };
});

// Mock fs with default export
vi.mock('fs', () => {
  const existsSyncMock = vi.fn().mockReturnValue(false);
  const readFileSyncMock = vi.fn();
  return {
    existsSync: existsSyncMock,
    readFileSync: readFileSyncMock,
    default: {
      existsSync: existsSyncMock,
      readFileSync: readFileSyncMock,
    },
  };
});

// Import after mocks are set up
import {
  detectDisplayServer,
  isElevated,
  getPlatformInfo,
  getModifierKeyName,
  formatShortcut,
  checkPipeWireAvailable,
  isAppleSilicon,
  initializeMenu,
} from './index';

describe('Platform Module', () => {
  const originalPlatform = process.platform;
  const originalArch = process.arch;
  const originalEnv = { ...process.env };

  beforeEach(() => {
    vi.clearAllMocks();
    // Reset environment
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    // Restore original platform
    Object.defineProperty(process, 'platform', { value: originalPlatform });
    Object.defineProperty(process, 'arch', { value: originalArch });
    process.env = originalEnv;
  });

  describe('detectDisplayServer', () => {
    it('should return "unknown" on non-Linux platforms', () => {
      Object.defineProperty(process, 'platform', { value: 'darwin' });
      expect(detectDisplayServer()).toBe('unknown');
    });

    it('should detect Wayland when XDG_SESSION_TYPE is wayland', () => {
      Object.defineProperty(process, 'platform', { value: 'linux' });
      process.env.XDG_SESSION_TYPE = 'wayland';

      expect(detectDisplayServer()).toBe('wayland');
    });

    it('should detect Wayland when WAYLAND_DISPLAY is set', () => {
      Object.defineProperty(process, 'platform', { value: 'linux' });
      delete process.env.XDG_SESSION_TYPE;
      process.env.WAYLAND_DISPLAY = 'wayland-0';

      expect(detectDisplayServer()).toBe('wayland');
    });

    it('should detect X11 when DISPLAY is set', () => {
      Object.defineProperty(process, 'platform', { value: 'linux' });
      delete process.env.XDG_SESSION_TYPE;
      delete process.env.WAYLAND_DISPLAY;
      process.env.DISPLAY = ':0';

      expect(detectDisplayServer()).toBe('x11');
    });

    it('should return unknown when no display env vars are set', () => {
      Object.defineProperty(process, 'platform', { value: 'linux' });
      delete process.env.XDG_SESSION_TYPE;
      delete process.env.WAYLAND_DISPLAY;
      delete process.env.DISPLAY;

      expect(detectDisplayServer()).toBe('unknown');
    });
  });

  describe('isElevated', () => {
    it('should return false on Windows when not admin', async () => {
      Object.defineProperty(process, 'platform', { value: 'win32' });

      const childProcess = await import('child_process');
      vi.mocked(childProcess.execSync).mockImplementation(() => {
        throw new Error('Access denied');
      });

      expect(isElevated()).toBe(false);
    });

    it('should return true on Windows when admin', async () => {
      Object.defineProperty(process, 'platform', { value: 'win32' });

      const childProcess = await import('child_process');
      vi.mocked(childProcess.execSync).mockReturnValue(Buffer.from(''));

      expect(isElevated()).toBe(true);
    });
  });

  describe('getPlatformInfo', () => {
    it('should return platform information', () => {
      Object.defineProperty(process, 'platform', { value: 'darwin' });

      const info = getPlatformInfo();

      expect(info).toHaveProperty('platform', 'darwin');
      expect(info).toHaveProperty('arch');
      expect(info).toHaveProperty('isElevated');
      expect(info).toHaveProperty('hasScreenCaptureSupport');
      expect(info).toHaveProperty('hasInputInjectionSupport');
      expect(info).toHaveProperty('displayServer');
    });

    it('should detect screen capture support on macOS', () => {
      Object.defineProperty(process, 'platform', { value: 'darwin' });

      const info = getPlatformInfo();
      expect(info.hasScreenCaptureSupport).toBe(true);
    });

    it('should detect screen capture support on Windows', () => {
      Object.defineProperty(process, 'platform', { value: 'win32' });

      const info = getPlatformInfo();
      expect(info.hasScreenCaptureSupport).toBe(true);
    });
  });

  describe('getModifierKeyName', () => {
    it('should return "Cmd" on macOS', () => {
      Object.defineProperty(process, 'platform', { value: 'darwin' });
      expect(getModifierKeyName()).toBe('Cmd');
    });

    it('should return "Ctrl" on Windows', () => {
      Object.defineProperty(process, 'platform', { value: 'win32' });
      expect(getModifierKeyName()).toBe('Ctrl');
    });

    it('should return "Ctrl" on Linux', () => {
      Object.defineProperty(process, 'platform', { value: 'linux' });
      expect(getModifierKeyName()).toBe('Ctrl');
    });
  });

  describe('formatShortcut', () => {
    it('should format shortcuts for macOS', () => {
      Object.defineProperty(process, 'platform', { value: 'darwin' });

      expect(formatShortcut('Ctrl+C')).toBe('⌘C');
      expect(formatShortcut('Alt+Tab')).toBe('⌥Tab');
      expect(formatShortcut('Shift+Enter')).toBe('⇧Enter');
    });

    it('should not modify shortcuts on Windows/Linux', () => {
      Object.defineProperty(process, 'platform', { value: 'win32' });
      expect(formatShortcut('Ctrl+C')).toBe('Ctrl+C');
    });
  });

  describe('checkPipeWireAvailable', () => {
    it('should return false on non-Linux', () => {
      Object.defineProperty(process, 'platform', { value: 'darwin' });
      expect(checkPipeWireAvailable()).toBe(false);
    });

    it('should check systemctl on Linux', async () => {
      Object.defineProperty(process, 'platform', { value: 'linux' });

      const childProcess = await import('child_process');
      vi.mocked(childProcess.execSync).mockReturnValue(Buffer.from('active'));

      expect(checkPipeWireAvailable()).toBe(true);
    });

    it('should return false if PipeWire is not running', async () => {
      Object.defineProperty(process, 'platform', { value: 'linux' });

      const childProcess = await import('child_process');
      vi.mocked(childProcess.execSync).mockImplementation(() => {
        throw new Error('inactive');
      });

      expect(checkPipeWireAvailable()).toBe(false);
    });
  });

  describe('isAppleSilicon', () => {
    it('should return false on non-macOS', () => {
      Object.defineProperty(process, 'platform', { value: 'linux' });
      expect(isAppleSilicon()).toBe(false);
    });

    it('should return true on arm64 macOS', () => {
      Object.defineProperty(process, 'platform', { value: 'darwin' });
      Object.defineProperty(process, 'arch', { value: 'arm64' });
      expect(isAppleSilicon()).toBe(true);
    });

    it('should return false on x64 macOS', () => {
      Object.defineProperty(process, 'platform', { value: 'darwin' });
      Object.defineProperty(process, 'arch', { value: 'x64' });
      expect(isAppleSilicon()).toBe(false);
    });
  });
});

describe('Menu Module', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should initialize menu', async () => {
    const { Menu } = await import('electron');

    const callbacks = {
      onAbout: vi.fn(),
      onPreferences: vi.fn(),
      onNewSession: vi.fn(),
      onEndSession: vi.fn(),
    };

    initializeMenu(callbacks);

    expect(Menu.buildFromTemplate).toHaveBeenCalled();
    expect(Menu.setApplicationMenu).toHaveBeenCalled();
  });
});
