import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Store the mock objects at module level so we can access them in tests
const mockMenuTemplate: unknown[] = [];

vi.mock('electron', () => {
  const mockMenu = {
    items: [],
  };

  return {
    app: {
      getName: vi.fn().mockReturnValue('PairUX'),
      isPackaged: false,
      showAboutPanel: vi.fn(),
    },
    Menu: {
      buildFromTemplate: vi.fn((template: unknown[]) => {
        mockMenuTemplate.length = 0;
        mockMenuTemplate.push(...template);
        return mockMenu;
      }),
      setApplicationMenu: vi.fn(),
      getApplicationMenu: vi.fn().mockReturnValue(mockMenu),
    },
    shell: {
      openExternal: vi.fn().mockResolvedValue(undefined),
    },
    BrowserWindow: {
      getFocusedWindow: vi.fn().mockReturnValue(null),
      getAllWindows: vi.fn().mockReturnValue([]),
    },
  };
});

describe('Menu Module', () => {
  const originalPlatform = process.platform;

  beforeEach(() => {
    vi.clearAllMocks();
    mockMenuTemplate.length = 0;
  });

  afterEach(() => {
    Object.defineProperty(process, 'platform', { value: originalPlatform });
  });

  describe('initializeMenu', () => {
    it('should create macOS-style menu on darwin', async () => {
      Object.defineProperty(process, 'platform', { value: 'darwin' });

      vi.resetModules();
      const { initializeMenu } = await import('./menu');
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

      // Check that the app menu exists (first item on macOS)
      const template = vi.mocked(Menu.buildFromTemplate).mock.calls[0][0];
      expect(template).toBeInstanceOf(Array);
      expect(template.length).toBeGreaterThan(0);

      // On macOS, first menu should be the app menu with the app name
      const appMenu = template[0] as { label: string };
      expect(appMenu.label).toBe('PairUX');
    });

    it('should create Windows/Linux-style menu on win32', async () => {
      Object.defineProperty(process, 'platform', { value: 'win32' });

      vi.resetModules();
      const { initializeMenu } = await import('./menu');
      const { Menu } = await import('electron');

      const callbacks = {
        onAbout: vi.fn(),
        onPreferences: vi.fn(),
        onNewSession: vi.fn(),
        onEndSession: vi.fn(),
      };

      initializeMenu(callbacks);

      expect(Menu.buildFromTemplate).toHaveBeenCalled();

      // On Windows/Linux, first menu should be File
      const template = vi.mocked(Menu.buildFromTemplate).mock.calls[0][0];
      const fileMenu = template[0] as { label: string };
      expect(fileMenu.label).toBe('File');
    });

    it('should create Windows/Linux-style menu on linux', async () => {
      Object.defineProperty(process, 'platform', { value: 'linux' });

      vi.resetModules();
      const { initializeMenu } = await import('./menu');
      const { Menu } = await import('electron');

      const callbacks = {
        onAbout: vi.fn(),
        onPreferences: vi.fn(),
        onNewSession: vi.fn(),
        onEndSession: vi.fn(),
      };

      initializeMenu(callbacks);

      const template = vi.mocked(Menu.buildFromTemplate).mock.calls[0][0];
      const fileMenu = template[0] as { label: string };
      expect(fileMenu.label).toBe('File');
    });
  });

  describe('menu items', () => {
    it('should include standard edit menu items', async () => {
      Object.defineProperty(process, 'platform', { value: 'darwin' });

      vi.resetModules();
      const { initializeMenu } = await import('./menu');
      const { Menu } = await import('electron');

      initializeMenu({
        onAbout: vi.fn(),
        onPreferences: vi.fn(),
        onNewSession: vi.fn(),
        onEndSession: vi.fn(),
      });

      const template = vi.mocked(Menu.buildFromTemplate).mock.calls[0][0] as {
        label: string;
        submenu?: { label?: string; role?: string }[];
      }[];
      const editMenu = template.find((m) => m.label === 'Edit');

      expect(editMenu).toBeDefined();
      expect(editMenu?.submenu).toBeInstanceOf(Array);

      const submenuLabels = editMenu?.submenu?.map((item) => item.role ?? item.label);
      expect(submenuLabels).toContain('undo');
      expect(submenuLabels).toContain('redo');
      expect(submenuLabels).toContain('cut');
      expect(submenuLabels).toContain('copy');
      expect(submenuLabels).toContain('paste');
    });

    it('should include view menu with developer tools in development', async () => {
      Object.defineProperty(process, 'platform', { value: 'darwin' });

      vi.resetModules();

      // Ensure isPackaged is false
      const electron = await import('electron');
      Object.defineProperty(electron.app, 'isPackaged', { value: false });

      const { initializeMenu } = await import('./menu');
      const { Menu } = await import('electron');

      initializeMenu({
        onAbout: vi.fn(),
        onPreferences: vi.fn(),
        onNewSession: vi.fn(),
        onEndSession: vi.fn(),
      });

      const template = vi.mocked(Menu.buildFromTemplate).mock.calls[0][0] as {
        label: string;
        submenu?: { label?: string; role?: string }[];
      }[];
      const viewMenu = template.find((m) => m.label === 'View');

      expect(viewMenu).toBeDefined();
      expect(viewMenu?.submenu).toBeInstanceOf(Array);

      // DevTools should be present in development
      const hasDevTools = viewMenu?.submenu?.some((item) => item.role === 'toggleDevTools');
      expect(hasDevTools).toBe(true);
    });

    it('should include Help menu with documentation link', async () => {
      Object.defineProperty(process, 'platform', { value: 'darwin' });

      vi.resetModules();
      const { initializeMenu } = await import('./menu');
      const { Menu, shell } = await import('electron');

      initializeMenu({
        onAbout: vi.fn(),
        onPreferences: vi.fn(),
        onNewSession: vi.fn(),
        onEndSession: vi.fn(),
      });

      const template = vi.mocked(Menu.buildFromTemplate).mock.calls[0][0] as {
        label: string;
        submenu?: { label?: string; click?: () => void }[];
      }[];
      const helpMenu = template.find((m) => m.label === 'Help');

      expect(helpMenu).toBeDefined();

      // Find and click the help item
      const helpItem = helpMenu?.submenu?.find((item) => item.label === 'PairUX Help');
      expect(helpItem).toBeDefined();

      if (helpItem?.click) {
        helpItem.click();
      }
      expect(vi.mocked(shell.openExternal)).toHaveBeenCalledWith('https://pairux.com/docs');
    });
  });

  describe('showAboutDialog', () => {
    it('should show about panel on macOS', async () => {
      Object.defineProperty(process, 'platform', { value: 'darwin' });

      vi.resetModules();
      const { showAboutDialog } = await import('./menu');
      const electron = await import('electron');

      showAboutDialog();

      expect(vi.mocked(electron.app.showAboutPanel)).toHaveBeenCalled();
    });

    it('should not show native about panel on Windows', async () => {
      Object.defineProperty(process, 'platform', { value: 'win32' });

      vi.resetModules();
      const { showAboutDialog } = await import('./menu');
      const electron = await import('electron');

      showAboutDialog();

      // On Windows, should not call showAboutPanel (navigates to settings instead)
      expect(vi.mocked(electron.app.showAboutPanel)).not.toHaveBeenCalled();
    });
  });
});
