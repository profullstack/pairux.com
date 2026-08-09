import { accessSync, constants, existsSync, statSync } from 'fs';

const SETUID_BIT = 0o4000;
const OTHER_EXECUTE_BIT = 0o0001;

export function hasRequiredSandboxPermissions(stats: { uid: number; mode: number }): boolean {
  return (
    stats.uid === 0 && (stats.mode & SETUID_BIT) !== 0 && (stats.mode & OTHER_EXECUTE_BIT) !== 0
  );
}

export function canUseLinuxSandbox(sandboxPath: string): boolean {
  if (!existsSync(sandboxPath)) return false;

  try {
    accessSync(sandboxPath, constants.X_OK);
    return hasRequiredSandboxPermissions(statSync(sandboxPath));
  } catch {
    return false;
  }
}
