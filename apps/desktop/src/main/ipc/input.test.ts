import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { InputEvent } from '@pairux/shared-types';

// Mock the injector module
vi.mock('../input/injector', () => ({
  initInputInjector: vi.fn().mockResolvedValue(undefined),
  injectInput: vi.fn().mockResolvedValue(undefined),
  enableInjection: vi.fn().mockReturnValue(true),
  disableInjection: vi.fn(),
  isInjectionEnabled: vi.fn().mockReturnValue(false),
  getInjectionDiagnostics: vi.fn().mockReturnValue({
    enabled: false,
    backend: 'nut-js',
    backendSupported: true,
    stats: { received: 0, injected: 0, rejected: 0, errors: 0 },
    heldButtons: 0,
    heldKeys: 0,
  }),
  updateScreenSize: vi.fn(),
  emergencyStop: vi.fn().mockResolvedValue(undefined),
}));

// Mock electron
const mockIpcMainHandlers = new Map<string, (...args: unknown[]) => unknown>();
const mockBrowserWindows: { webContents: { send: ReturnType<typeof vi.fn> } }[] = [];

vi.mock('electron', () => ({
  ipcMain: {
    handle: vi.fn((channel: string, handler: (...args: unknown[]) => unknown) => {
      mockIpcMainHandlers.set(channel, handler);
    }),
  },
  globalShortcut: {
    register: vi.fn().mockReturnValue(true),
    unregister: vi.fn(),
  },
  app: {
    on: vi.fn(),
  },
  BrowserWindow: {
    getAllWindows: vi.fn(() => mockBrowserWindows),
  },
}));

import { ipcMain, globalShortcut, app } from 'electron';
import {
  initInputInjector,
  injectInput,
  enableInjection,
  disableInjection,
  getInjectionDiagnostics,
  updateScreenSize,
  emergencyStop,
} from '../input/injector';
import { registerInputHandlers } from './input';

describe('IPC Input Handlers', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockIpcMainHandlers.clear();
    mockBrowserWindows.length = 0;
    registerInputHandlers();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('registerInputHandlers', () => {
    it('should register all input handlers', () => {
      expect(ipcMain.handle).toHaveBeenCalledWith('input:init', expect.any(Function));
      expect(ipcMain.handle).toHaveBeenCalledWith('input:enable', expect.any(Function));
      expect(ipcMain.handle).toHaveBeenCalledWith('input:disable', expect.any(Function));
      expect(ipcMain.handle).toHaveBeenCalledWith('input:status', expect.any(Function));
      expect(ipcMain.handle).toHaveBeenCalledWith('input:updateScreenSize', expect.any(Function));
      expect(ipcMain.handle).toHaveBeenCalledWith('input:inject', expect.any(Function));
      expect(ipcMain.handle).toHaveBeenCalledWith('input:injectBatch', expect.any(Function));
      expect(ipcMain.handle).toHaveBeenCalledWith('input:emergencyStop', expect.any(Function));
    });

    it('should register app quit handler', () => {
      expect(app.on).toHaveBeenCalledWith('will-quit', expect.any(Function));
    });
  });

  describe('input:init handler', () => {
    it('should initialize input injector', async () => {
      const handler = mockIpcMainHandlers.get('input:init')!;

      const result = await handler();

      expect(initInputInjector).toHaveBeenCalled();
      expect(result).toEqual({ success: true });
    });
  });

  describe('input:enable handler', () => {
    it('should enable injection and register emergency shortcut', () => {
      vi.mocked(getInjectionDiagnostics).mockReturnValueOnce({
        enabled: true,
        backend: 'nut-js',
        backendSupported: true,
        stats: { received: 0, injected: 0, rejected: 0, errors: 0 },
        heldButtons: 0,
        heldKeys: 0,
      });
      const handler = mockIpcMainHandlers.get('input:enable')!;

      const result = handler();

      expect(enableInjection).toHaveBeenCalled();
      expect(globalShortcut.register).toHaveBeenCalledWith(
        'CommandOrControl+Shift+Escape',
        expect.any(Function)
      );
      expect(getInjectionDiagnostics).toHaveBeenCalled();
      expect(result).toMatchObject({ success: true, enabled: true, backend: 'nut-js' });
    });
  });

  describe('input:disable handler', () => {
    it('should disable injection', () => {
      const handler = mockIpcMainHandlers.get('input:disable')!;

      const result = handler();

      expect(disableInjection).toHaveBeenCalled();
      expect(result).toEqual({ success: true, enabled: false });
    });
  });

  describe('input:status handler', () => {
    it('should return injection status', () => {
      vi.mocked(getInjectionDiagnostics).mockReturnValueOnce({
        enabled: true,
        backend: 'nut-js',
        backendSupported: true,
        stats: { received: 1, injected: 1, rejected: 0, errors: 0 },
        heldButtons: 0,
        heldKeys: 0,
      });
      const handler = mockIpcMainHandlers.get('input:status')!;

      const result = handler();

      expect(getInjectionDiagnostics).toHaveBeenCalled();
      expect(result).toMatchObject({ enabled: true, backend: 'nut-js' });
    });
  });

  describe('input:updateScreenSize handler', () => {
    it('should update screen size', () => {
      const handler = mockIpcMainHandlers.get('input:updateScreenSize')!;

      const result = handler({}, { width: 2560, height: 1440 });

      expect(updateScreenSize).toHaveBeenCalledWith(2560, 1440);
      expect(result).toEqual({ success: true });
    });
  });

  describe('input:inject handler', () => {
    it('should inject input event', async () => {
      const handler = mockIpcMainHandlers.get('input:inject')!;
      const event: InputEvent = {
        type: 'mouse',
        action: 'move',
        x: 0.5,
        y: 0.5,
      };

      const result = await handler({}, { event });

      expect(injectInput).toHaveBeenCalledWith(event);
      expect(result).toEqual({ success: true });
    });
  });

  describe('input:injectBatch handler', () => {
    it('should inject multiple events', async () => {
      const handler = mockIpcMainHandlers.get('input:injectBatch')!;
      const events: InputEvent[] = [
        { type: 'mouse', action: 'move', x: 0.5, y: 0.5 },
        { type: 'mouse', action: 'click', button: 'left', x: 0.5, y: 0.5 },
      ];

      const result = await handler({}, { events });

      expect(injectInput).toHaveBeenCalledTimes(2);
      expect(result).toEqual({ success: true, count: 2 });
    });
  });

  describe('input:emergencyStop handler', () => {
    it('should trigger emergency stop', async () => {
      const handler = mockIpcMainHandlers.get('input:emergencyStop')!;

      const result = await handler();

      expect(emergencyStop).toHaveBeenCalled();
      expect(result).toEqual({ success: true });
    });
  });

  // Note: Emergency shortcut registration is already tested in 'input:enable handler'
  // The callback behavior involves async dynamic imports which are difficult to test
  // in isolation due to module state persistence between tests.
  // The emergency stop functionality is covered by 'input:emergencyStop handler' test.
});
