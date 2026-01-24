/**
 * Platform permission handling for input injection
 * Particularly important for macOS which requires Accessibility permissions
 */

import { systemPreferences, dialog, shell } from 'electron';

export interface PermissionStatus {
  accessibility: boolean;
  screenCapture: boolean;
}

/**
 * Check if accessibility permission is granted (macOS only)
 * Returns true on other platforms
 */
export function checkAccessibilityPermission(): boolean {
  if (process.platform !== 'darwin') {
    return true; // Not needed on Windows/Linux
  }

  return systemPreferences.isTrustedAccessibilityClient(false);
}

/**
 * Request accessibility permission (macOS only)
 * Opens System Preferences if not granted
 */
export async function requestAccessibilityPermission(): Promise<boolean> {
  if (process.platform !== 'darwin') {
    return true;
  }

  // Check if already granted
  if (systemPreferences.isTrustedAccessibilityClient(false)) {
    return true;
  }

  // Prompt the user - this will trigger the system dialog
  const isTrusted = systemPreferences.isTrustedAccessibilityClient(true);

  if (!isTrusted) {
    // Show our own dialog explaining what to do
    const result = await dialog.showMessageBox({
      type: 'info',
      title: 'Accessibility Permission Required',
      message: 'PairUX needs Accessibility permission to control mouse and keyboard.',
      detail:
        'Please enable PairUX in System Preferences → Security & Privacy → Privacy → Accessibility.\n\nClick "Open Settings" to go there now.',
      buttons: ['Open Settings', 'Later'],
      defaultId: 0,
    });

    if (result.response === 0) {
      // Open System Preferences to Accessibility
      await shell.openExternal(
        'x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility'
      );
    }
  }

  return isTrusted;
}

/**
 * Check screen capture permission (macOS 10.15+ only)
 * Returns true on other platforms
 */
export function checkScreenCapturePermission(): boolean {
  if (process.platform !== 'darwin') {
    return true;
  }

  // getMediaAccessStatus available in macOS 10.14+
  const status = systemPreferences.getMediaAccessStatus('screen');
  return status === 'granted';
}

/**
 * Request screen capture permission (macOS only)
 */
export async function requestScreenCapturePermission(): Promise<boolean> {
  if (process.platform !== 'darwin') {
    return true;
  }

  const status = systemPreferences.getMediaAccessStatus('screen');

  if (status === 'granted') {
    return true;
  }

  if (status === 'denied') {
    // User has explicitly denied - need to go to settings
    const result = await dialog.showMessageBox({
      type: 'info',
      title: 'Screen Recording Permission Required',
      message: 'PairUX needs Screen Recording permission to share your screen.',
      detail:
        'Please enable PairUX in System Preferences → Security & Privacy → Privacy → Screen Recording.\n\nYou may need to restart the app after granting permission.',
      buttons: ['Open Settings', 'Later'],
      defaultId: 0,
    });

    if (result.response === 0) {
      await shell.openExternal(
        'x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture'
      );
    }
    return false;
  }

  // Status is 'not-determined' or 'restricted'
  // The permission dialog will be shown when we try to capture
  return false;
}

/**
 * Get all permission statuses
 */
export function getPermissionStatus(): PermissionStatus {
  return {
    accessibility: checkAccessibilityPermission(),
    screenCapture: checkScreenCapturePermission(),
  };
}

/**
 * Request all required permissions
 * Returns true if all permissions are granted
 */
export async function requestAllPermissions(): Promise<PermissionStatus> {
  const accessibility = await requestAccessibilityPermission();
  const screenCapture = await requestScreenCapturePermission();

  return {
    accessibility,
    screenCapture,
  };
}
