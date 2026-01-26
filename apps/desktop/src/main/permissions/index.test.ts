import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mock electron before imports
vi.mock('electron', () => ({
  systemPreferences: {
    isTrustedAccessibilityClient: vi.fn(),
    getMediaAccessStatus: vi.fn(),
  },
  dialog: {
    showMessageBox: vi.fn(),
  },
  shell: {
    openExternal: vi.fn(),
  },
}));

import { systemPreferences, dialog, shell } from 'electron';
import {
  checkAccessibilityPermission,
  requestAccessibilityPermission,
  checkScreenCapturePermission,
  requestScreenCapturePermission,
  getPermissionStatus,
  requestAllPermissions,
} from './index';

describe('Permissions', () => {
  const originalPlatform = process.platform;

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    Object.defineProperty(process, 'platform', { value: originalPlatform });
  });

  describe('checkAccessibilityPermission', () => {
    it('should return true on non-darwin platforms', () => {
      Object.defineProperty(process, 'platform', { value: 'linux' });

      const result = checkAccessibilityPermission();

      expect(result).toBe(true);
      expect(systemPreferences.isTrustedAccessibilityClient).not.toHaveBeenCalled();
    });

    it('should check accessibility on macOS', () => {
      Object.defineProperty(process, 'platform', { value: 'darwin' });
      vi.mocked(systemPreferences.isTrustedAccessibilityClient).mockReturnValue(true);

      const result = checkAccessibilityPermission();

      expect(result).toBe(true);
      expect(systemPreferences.isTrustedAccessibilityClient).toHaveBeenCalledWith(false);
    });

    it('should return false when not trusted on macOS', () => {
      Object.defineProperty(process, 'platform', { value: 'darwin' });
      vi.mocked(systemPreferences.isTrustedAccessibilityClient).mockReturnValue(false);

      const result = checkAccessibilityPermission();

      expect(result).toBe(false);
    });
  });

  describe('requestAccessibilityPermission', () => {
    it('should return true on non-darwin platforms', async () => {
      Object.defineProperty(process, 'platform', { value: 'win32' });

      const result = await requestAccessibilityPermission();

      expect(result).toBe(true);
    });

    it('should return true if already granted on macOS', async () => {
      Object.defineProperty(process, 'platform', { value: 'darwin' });
      vi.mocked(systemPreferences.isTrustedAccessibilityClient).mockReturnValue(true);

      const result = await requestAccessibilityPermission();

      expect(result).toBe(true);
      expect(dialog.showMessageBox).not.toHaveBeenCalled();
    });

    it('should prompt user and open settings when not granted', async () => {
      Object.defineProperty(process, 'platform', { value: 'darwin' });
      vi.mocked(systemPreferences.isTrustedAccessibilityClient)
        .mockReturnValueOnce(false) // First check
        .mockReturnValueOnce(false); // Second check with prompt
      vi.mocked(dialog.showMessageBox).mockResolvedValue({ response: 0, checkboxChecked: false });

      const result = await requestAccessibilityPermission();

      expect(result).toBe(false);
      expect(dialog.showMessageBox).toHaveBeenCalled();
      expect(shell.openExternal).toHaveBeenCalledWith(
        'x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility'
      );
    });

    it('should not open settings if user clicks Later', async () => {
      Object.defineProperty(process, 'platform', { value: 'darwin' });
      vi.mocked(systemPreferences.isTrustedAccessibilityClient)
        .mockReturnValueOnce(false)
        .mockReturnValueOnce(false);
      vi.mocked(dialog.showMessageBox).mockResolvedValue({ response: 1, checkboxChecked: false });

      await requestAccessibilityPermission();

      expect(shell.openExternal).not.toHaveBeenCalled();
    });
  });

  describe('checkScreenCapturePermission', () => {
    it('should return true on non-darwin platforms', () => {
      Object.defineProperty(process, 'platform', { value: 'linux' });

      const result = checkScreenCapturePermission();

      expect(result).toBe(true);
    });

    it('should return true when granted on macOS', () => {
      Object.defineProperty(process, 'platform', { value: 'darwin' });
      vi.mocked(systemPreferences.getMediaAccessStatus).mockReturnValue('granted');

      const result = checkScreenCapturePermission();

      expect(result).toBe(true);
      expect(systemPreferences.getMediaAccessStatus).toHaveBeenCalledWith('screen');
    });

    it('should return false when not granted on macOS', () => {
      Object.defineProperty(process, 'platform', { value: 'darwin' });
      vi.mocked(systemPreferences.getMediaAccessStatus).mockReturnValue('denied');

      const result = checkScreenCapturePermission();

      expect(result).toBe(false);
    });
  });

  describe('requestScreenCapturePermission', () => {
    it('should return true on non-darwin platforms', async () => {
      Object.defineProperty(process, 'platform', { value: 'win32' });

      const result = await requestScreenCapturePermission();

      expect(result).toBe(true);
    });

    it('should return true when already granted on macOS', async () => {
      Object.defineProperty(process, 'platform', { value: 'darwin' });
      vi.mocked(systemPreferences.getMediaAccessStatus).mockReturnValue('granted');

      const result = await requestScreenCapturePermission();

      expect(result).toBe(true);
    });

    it('should show dialog and open settings when denied', async () => {
      Object.defineProperty(process, 'platform', { value: 'darwin' });
      vi.mocked(systemPreferences.getMediaAccessStatus).mockReturnValue('denied');
      vi.mocked(dialog.showMessageBox).mockResolvedValue({ response: 0, checkboxChecked: false });

      const result = await requestScreenCapturePermission();

      expect(result).toBe(false);
      expect(dialog.showMessageBox).toHaveBeenCalled();
      expect(shell.openExternal).toHaveBeenCalledWith(
        'x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture'
      );
    });

    it('should return false when status is not-determined', async () => {
      Object.defineProperty(process, 'platform', { value: 'darwin' });
      vi.mocked(systemPreferences.getMediaAccessStatus).mockReturnValue('not-determined');

      const result = await requestScreenCapturePermission();

      expect(result).toBe(false);
      expect(dialog.showMessageBox).not.toHaveBeenCalled();
    });
  });

  describe('getPermissionStatus', () => {
    it('should return status for both permissions', () => {
      Object.defineProperty(process, 'platform', { value: 'darwin' });
      vi.mocked(systemPreferences.isTrustedAccessibilityClient).mockReturnValue(true);
      vi.mocked(systemPreferences.getMediaAccessStatus).mockReturnValue('granted');

      const status = getPermissionStatus();

      expect(status).toEqual({
        accessibility: true,
        screenCapture: true,
      });
    });

    it('should return correct status when permissions not granted', () => {
      Object.defineProperty(process, 'platform', { value: 'darwin' });
      vi.mocked(systemPreferences.isTrustedAccessibilityClient).mockReturnValue(false);
      vi.mocked(systemPreferences.getMediaAccessStatus).mockReturnValue('denied');

      const status = getPermissionStatus();

      expect(status).toEqual({
        accessibility: false,
        screenCapture: false,
      });
    });
  });

  describe('requestAllPermissions', () => {
    it('should request both permissions', async () => {
      Object.defineProperty(process, 'platform', { value: 'darwin' });
      vi.mocked(systemPreferences.isTrustedAccessibilityClient).mockReturnValue(true);
      vi.mocked(systemPreferences.getMediaAccessStatus).mockReturnValue('granted');

      const result = await requestAllPermissions();

      expect(result).toEqual({
        accessibility: true,
        screenCapture: true,
      });
    });
  });
});
