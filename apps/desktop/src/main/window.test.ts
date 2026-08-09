import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('fs', () => ({
  existsSync: vi.fn().mockReturnValue(false),
  default: { existsSync: vi.fn().mockReturnValue(false) },
}));

const mockWindowInstance = {
  loadURL: vi.fn().mockResolvedValue(undefined),
  loadFile: vi.fn().mockResolvedValue(undefined),
  on: vi.fn(),
  once: vi.fn(),
  show: vi.fn(),
  webContents: {
    session: {
      setDisplayMediaRequestHandler: vi.fn(),
      setPermissionRequestHandler: vi.fn(),
      setPermissionCheckHandler: vi.fn(),
    },
    setWindowOpenHandler: vi.fn(),
    setWebRTCIPHandlingPolicy: vi.fn(),
    on: vi.fn(),
    once: vi.fn(),
    openDevTools: vi.fn(),
  },
};

const BrowserWindowMock = vi.fn().mockImplementation(() => mockWindowInstance);

vi.mock('electron', () => ({
  BrowserWindow: BrowserWindowMock,
  app: {
    getName: vi.fn().mockReturnValue('PairUX'),
    getAppPath: vi.fn().mockReturnValue('/app'),
    isPackaged: false,
  },
  shell: { openExternal: vi.fn() },
  nativeImage: {
    createFromPath: vi.fn().mockReturnValue({ isEmpty: () => false }),
    createEmpty: vi.fn().mockReturnValue({ isEmpty: () => true }),
  },
  desktopCapturer: { getSources: vi.fn().mockResolvedValue([]) },
  session: {
    defaultSession: {
      setDisplayMediaRequestHandler: vi.fn(),
      setPermissionRequestHandler: vi.fn(),
      setPermissionCheckHandler: vi.fn(),
    },
  },
  screen: { getPrimaryDisplay: vi.fn().mockReturnValue({ workAreaSize: {} }) },
}));

beforeEach(() => {
  BrowserWindowMock.mockClear();
  // Only set in a packaged app; window.ts resolves the icon path against it.
  Object.defineProperty(process, 'resourcesPath', {
    value: '/resources',
    configurable: true,
  });
});

describe('createMainWindow', () => {
  it('keeps the renderer unthrottled in the background', async () => {
    const { createMainWindow } = await import('./window');
    await createMainWindow(false);

    const options = BrowserWindowMock.mock.calls[0]?.[0] as {
      webPreferences: { backgroundThrottling?: boolean };
    };

    // A screen share runs while this window sits behind whatever is being
    // shared. Letting Chromium throttle it stalls the compositor loop that
    // produces the shared frames, and the picture freezes on its last frame
    // until the window is focused again.
    expect(options.webPreferences.backgroundThrottling).toBe(false);
  });
});
