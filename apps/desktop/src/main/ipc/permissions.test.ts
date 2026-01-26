import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock the permissions module
vi.mock('../permissions', () => ({
  getPermissionStatus: vi.fn().mockReturnValue({
    accessibility: true,
    screenCapture: true,
  }),
  requestAccessibilityPermission: vi.fn().mockResolvedValue(true),
  requestScreenCapturePermission: vi.fn().mockResolvedValue(true),
  requestAllPermissions: vi.fn().mockResolvedValue({
    accessibility: true,
    screenCapture: true,
  }),
}));

// Mock electron
const mockIpcMainHandlers = new Map<string, (...args: unknown[]) => unknown>();

vi.mock('electron', () => ({
  ipcMain: {
    handle: vi.fn((channel: string, handler: (...args: unknown[]) => unknown) => {
      mockIpcMainHandlers.set(channel, handler);
    }),
  },
}));

import { ipcMain } from 'electron';
import {
  getPermissionStatus,
  requestAccessibilityPermission,
  requestScreenCapturePermission,
  requestAllPermissions,
} from '../permissions';
import { registerPermissionHandlers } from './permissions';

describe('IPC Permission Handlers', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockIpcMainHandlers.clear();
    registerPermissionHandlers();
  });

  describe('registerPermissionHandlers', () => {
    it('should register all permission handlers', () => {
      expect(ipcMain.handle).toHaveBeenCalledWith('permissions:status', expect.any(Function));
      expect(ipcMain.handle).toHaveBeenCalledWith(
        'permissions:requestAccessibility',
        expect.any(Function)
      );
      expect(ipcMain.handle).toHaveBeenCalledWith(
        'permissions:requestScreenCapture',
        expect.any(Function)
      );
      expect(ipcMain.handle).toHaveBeenCalledWith('permissions:requestAll', expect.any(Function));
    });
  });

  describe('permissions:status handler', () => {
    it('should return permission status', () => {
      const handler = mockIpcMainHandlers.get('permissions:status')!;

      const result = handler();

      expect(getPermissionStatus).toHaveBeenCalled();
      expect(result).toEqual({
        accessibility: true,
        screenCapture: true,
      });
    });
  });

  describe('permissions:requestAccessibility handler', () => {
    it('should request accessibility permission and return granted status', async () => {
      const handler = mockIpcMainHandlers.get('permissions:requestAccessibility')!;

      const result = await handler();

      expect(requestAccessibilityPermission).toHaveBeenCalled();
      expect(result).toEqual({ granted: true });
    });

    it('should return denied when permission not granted', async () => {
      vi.mocked(requestAccessibilityPermission).mockResolvedValueOnce(false);
      const handler = mockIpcMainHandlers.get('permissions:requestAccessibility')!;

      const result = await handler();

      expect(result).toEqual({ granted: false });
    });
  });

  describe('permissions:requestScreenCapture handler', () => {
    it('should request screen capture permission and return granted status', async () => {
      const handler = mockIpcMainHandlers.get('permissions:requestScreenCapture')!;

      const result = await handler();

      expect(requestScreenCapturePermission).toHaveBeenCalled();
      expect(result).toEqual({ granted: true });
    });

    it('should return denied when permission not granted', async () => {
      vi.mocked(requestScreenCapturePermission).mockResolvedValueOnce(false);
      const handler = mockIpcMainHandlers.get('permissions:requestScreenCapture')!;

      const result = await handler();

      expect(result).toEqual({ granted: false });
    });
  });

  describe('permissions:requestAll handler', () => {
    it('should request all permissions', async () => {
      const handler = mockIpcMainHandlers.get('permissions:requestAll')!;

      const result = await handler();

      expect(requestAllPermissions).toHaveBeenCalled();
      expect(result).toEqual({
        accessibility: true,
        screenCapture: true,
      });
    });

    it('should return partial grants', async () => {
      vi.mocked(requestAllPermissions).mockResolvedValueOnce({
        accessibility: true,
        screenCapture: false,
      });
      const handler = mockIpcMainHandlers.get('permissions:requestAll')!;

      const result = await handler();

      expect(result).toEqual({
        accessibility: true,
        screenCapture: false,
      });
    });
  });
});
