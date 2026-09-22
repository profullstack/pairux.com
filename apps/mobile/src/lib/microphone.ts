export type MicrophoneFailure = 'permission' | 'unavailable';

export function microphoneFailure(error: unknown): MicrophoneFailure {
  if (!error || typeof error !== 'object' || !('name' in error)) return 'unavailable';
  const message = 'message' in error ? error.message : undefined;
  // react-native-webrtc 124 rejects denied audio permission with this exact pair.
  const nativeDenied = error.name === 'SecurityError' && message === 'Permission denied.';
  const wrappedDenied =
    error.name === 'DOMException' &&
    (message === 'NotAllowedError' || message === 'PermissionDeniedError');
  if (
    nativeDenied ||
    wrappedDenied ||
    error.name === 'NotAllowedError' ||
    error.name === 'PermissionDeniedError'
  ) {
    return 'permission';
  }
  return 'unavailable';
}
