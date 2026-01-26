import { describe, it, expect, vi, beforeEach } from 'vitest';

// Store handlers map at module scope - it's accessed by both mock and tests
const mockIpcMainHandlers = new Map<string, (...args: unknown[]) => unknown>();

// Mock the tray module
vi.mock('../tray', () => ({
  setTraySession: vi.fn(),
  setTrayStatus: vi.fn(),
  getTrayStatus: vi.fn().mockReturnValue('idle'),
  getTraySession: vi.fn().mockReturnValue(null),
  showTrayNotification: vi.fn(),
  flashTrayIcon: vi.fn(),
}));

// Mock electron - all mock values must be inline
vi.mock('electron', () => {
  const mockWindow = {
    hide: vi.fn(),
  };

  return {
    ipcMain: {
      handle: vi.fn((channel: string, handler: (...args: unknown[]) => unknown) => {
        mockIpcMainHandlers.set(channel, handler);
      }),
    },
    clipboard: {
      writeText: vi.fn(),
    },
    BrowserWindow: {
      getAllWindows: vi.fn().mockReturnValue([mockWindow]),
    },
  };
});

import { ipcMain, clipboard, BrowserWindow } from 'electron';
import {
  setTraySession,
  setTrayStatus,
  getTrayStatus,
  getTraySession,
  showTrayNotification,
  flashTrayIcon,
} from '../tray';
import { registerTrayHandlers } from './tray';

describe('IPC Tray Handlers', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockIpcMainHandlers.clear();
    registerTrayHandlers();
  });

  describe('registerTrayHandlers', () => {
    it('should register all tray handlers', () => {
      expect(ipcMain.handle).toHaveBeenCalledWith('tray:setSession', expect.any(Function));
      expect(ipcMain.handle).toHaveBeenCalledWith('tray:setStatus', expect.any(Function));
      expect(ipcMain.handle).toHaveBeenCalledWith('tray:getStatus', expect.any(Function));
      expect(ipcMain.handle).toHaveBeenCalledWith('tray:copyJoinCode', expect.any(Function));
      expect(ipcMain.handle).toHaveBeenCalledWith('tray:notify', expect.any(Function));
      expect(ipcMain.handle).toHaveBeenCalledWith('tray:flash', expect.any(Function));
      expect(ipcMain.handle).toHaveBeenCalledWith('tray:minimize', expect.any(Function));
    });
  });

  describe('tray:setSession handler', () => {
    it('should set session info', () => {
      const handler = mockIpcMainHandlers.get('tray:setSession')!;
      const session = {
        id: 'session-123',
        joinCode: 'ABC123',
        participantCount: 2,
        status: 'active' as const,
        role: 'host' as const,
      };

      const result = handler({}, { session });

      expect(setTraySession).toHaveBeenCalledWith(session);
      expect(result).toEqual({ success: true });
    });

    it('should handle null session', () => {
      const handler = mockIpcMainHandlers.get('tray:setSession')!;

      const result = handler({}, { session: null });

      expect(setTraySession).toHaveBeenCalledWith(null);
      expect(result).toEqual({ success: true });
    });
  });

  describe('tray:setStatus handler', () => {
    it('should set tray status', () => {
      const handler = mockIpcMainHandlers.get('tray:setStatus')!;

      const result = handler({}, { status: 'active' });

      expect(setTrayStatus).toHaveBeenCalledWith('active');
      expect(result).toEqual({ success: true });
    });

    it('should handle all status types', () => {
      const handler = mockIpcMainHandlers.get('tray:setStatus')!;
      const statuses = ['idle', 'active', 'paused', 'error'] as const;

      for (const status of statuses) {
        handler({}, { status });
        expect(setTrayStatus).toHaveBeenCalledWith(status);
      }
    });
  });

  describe('tray:getStatus handler', () => {
    it('should return current status and session', () => {
      const handler = mockIpcMainHandlers.get('tray:getStatus')!;

      const result = handler();

      expect(getTrayStatus).toHaveBeenCalled();
      expect(getTraySession).toHaveBeenCalled();
      expect(result).toEqual({
        status: 'idle',
        session: null,
      });
    });

    it('should return active session info', () => {
      const session = {
        id: 'session-123',
        joinCode: 'ABC123',
        participantCount: 2,
        status: 'active' as const,
        role: 'host' as const,
      };

      vi.mocked(getTrayStatus).mockReturnValueOnce('active');
      vi.mocked(getTraySession).mockReturnValueOnce(session);

      const handler = mockIpcMainHandlers.get('tray:getStatus')!;
      const result = handler();

      expect(result).toEqual({
        status: 'active',
        session,
      });
    });
  });

  describe('tray:copyJoinCode handler', () => {
    it('should copy join code to clipboard', () => {
      const handler = mockIpcMainHandlers.get('tray:copyJoinCode')!;

      const result = handler({}, { joinCode: 'XYZ789' });

      expect(clipboard.writeText).toHaveBeenCalledWith('XYZ789');
      expect(result).toEqual({ success: true });
    });
  });

  describe('tray:notify handler', () => {
    it('should show tray notification', () => {
      const handler = mockIpcMainHandlers.get('tray:notify')!;

      const result = handler({}, { title: 'Test Title', content: 'Test Content' });

      expect(showTrayNotification).toHaveBeenCalledWith('Test Title', 'Test Content');
      expect(result).toEqual({ success: true });
    });
  });

  describe('tray:flash handler', () => {
    it('should flash tray icon', () => {
      const handler = mockIpcMainHandlers.get('tray:flash')!;

      const result = handler();

      expect(flashTrayIcon).toHaveBeenCalled();
      expect(result).toEqual({ success: true });
    });
  });

  describe('tray:minimize handler', () => {
    it('should hide the main window', () => {
      const handler = mockIpcMainHandlers.get('tray:minimize')!;

      const result = handler();

      expect(BrowserWindow.getAllWindows).toHaveBeenCalled();
      expect(result).toEqual({ success: true });
    });

    it('should handle no windows gracefully', () => {
      vi.mocked(BrowserWindow.getAllWindows).mockReturnValueOnce([]);
      const handler = mockIpcMainHandlers.get('tray:minimize')!;

      const result = handler();

      expect(result).toEqual({ success: true });
    });
  });
});
