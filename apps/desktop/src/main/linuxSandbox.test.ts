import { describe, expect, it } from 'vitest';
import { hasRequiredSandboxPermissions } from './linuxSandbox';

describe('hasRequiredSandboxPermissions', () => {
  it('accepts a root-owned setuid helper executable by other users', () => {
    expect(hasRequiredSandboxPermissions({ uid: 0, mode: 0o104755 })).toBe(true);
  });

  it('rejects an executable helper without the setuid bit', () => {
    expect(hasRequiredSandboxPermissions({ uid: 0, mode: 0o100755 })).toBe(false);
  });

  it('rejects a setuid helper that is not owned by root', () => {
    expect(hasRequiredSandboxPermissions({ uid: 1000, mode: 0o104755 })).toBe(false);
  });

  it('rejects a setuid helper that other users cannot execute', () => {
    expect(hasRequiredSandboxPermissions({ uid: 0, mode: 0o104750 })).toBe(false);
  });
});
