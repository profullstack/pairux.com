import { expect, it } from 'vitest';
import { microphoneFailure } from './microphone';
it.each([
  { name: 'NotAllowedError' },
  { name: 'PermissionDeniedError' },
  { name: 'SecurityError', message: 'Permission denied.' },
  { name: 'DOMException', message: 'NotAllowedError' },
  { name: 'DOMException', message: 'PermissionDeniedError' },
])('recognizes a specific denied-permission shape: %j', (error) => {
  expect(microphoneFailure(error)).toBe('permission');
});
it.each([
  null,
  undefined,
  'Permission denied.',
  {},
  { name: 'DeviceError' },
  { name: 'SecurityError', message: 'Unknown failure' },
  { name: 'DOMException', message: 'AbortError' },
  { name: 'Error', message: 'NotAllowedError' },
])('does not label an unknown error as permission denial: %j', (error) => {
  expect(microphoneFailure(error)).toBe('unavailable');
});
