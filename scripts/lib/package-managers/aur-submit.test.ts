/**
 * AUR submission resilience tests
 *
 * aur.archlinux.org goes into maintenance without notice. When it does, it
 * still accepts the SSH connection but refuses the git operation, which used
 * to fail the entire release even though every other package manager had
 * already published.
 *
 * These live in their own file because they mock node:child_process, which the
 * shared package-managers suite deliberately does not.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { execSync } from 'node:child_process';
import type { ReleaseInfo, Logger } from './types.js';
import { AURPackageManager } from './aur.js';

vi.mock('node:child_process', () => ({ execSync: vi.fn() }));

vi.mock('node:fs', () => ({
  writeFileSync: vi.fn(),
  mkdirSync: vi.fn(),
  rmSync: vi.fn(),
  existsSync: vi.fn(() => false),
}));

const mockExecSync = vi.mocked(execSync);
const mockFetch = vi.fn();
global.fetch = mockFetch as unknown as typeof fetch;

const MAINTENANCE_STDERR =
  'The AUR is down due to maintenance. We will be back soon.\n' +
  'fatal: Could not read from remote repository.';

const CONNECTION_CLOSED_STDERR =
  'Connection closed by 209.126.35.78 port 22\n' + 'fatal: Could not read from remote repository.';

function createMockLogger(): Logger {
  return {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    success: vi.fn(),
    debug: vi.fn(),
  };
}

/** Mimic what execSync throws when stdio is piped: message hides the detail. */
function execFailure(command: string, stderr: string): Error {
  const error = new Error(`Command failed: ${command}`) as Error & { stderr: Buffer };
  error.stderr = Buffer.from(stderr);
  return error;
}

function createRelease(version = '1.0.0'): ReleaseInfo {
  return {
    version,
    tagName: `v${version}`,
    assets: [
      {
        name: `PairUX-${version}-x86_64.AppImage`,
        downloadUrl: `https://github.com/profullstack/pairux.com/releases/download/v${version}/PairUX-${version}-x86_64.AppImage`,
        size: 95000000,
        contentType: 'application/octet-stream',
        sha256: 'JKL012ABCDEF0123456789ABCDEF0123456789ABCDEF0123456789ABCDEF012345',
      },
    ],
    checksums: new Map(),
    releaseUrl: 'https://github.com/profullstack/pairux.com/releases/tag/v1.0.0',
  } as ReleaseInfo;
}

/** Commands issued to git, in order, ignoring the temp-dir noise. */
function gitCalls(): string[] {
  return mockExecSync.mock.calls.map(([command]) => command);
}

function callsMatching(fragment: string): string[] {
  return gitCalls().filter((command) => command.includes(fragment));
}

describe('AURPackageManager.submit resilience', () => {
  let aur: AURPackageManager;
  let logger: Logger;

  beforeEach(() => {
    vi.useFakeTimers();
    logger = createMockLogger();
    aur = new AURPackageManager({ enabled: true }, logger);

    mockExecSync.mockReset();
    mockExecSync.mockImplementation(() => Buffer.from(''));

    mockFetch.mockReset();
    // Package is not yet at this version, so submit proceeds.
    mockFetch.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ results: [] }),
    });

    process.env.AUR_SSH_KEY = Buffer.from('fake-key').toString('base64');
  });

  afterEach(() => {
    vi.useRealTimers();
    delete process.env.AUR_SSH_KEY;
  });

  async function submit(release = createRelease()) {
    const pending = aur.submit(release);
    await vi.runAllTimersAsync();
    return pending;
  }

  it('skips rather than fails when AUR is in maintenance', async () => {
    mockExecSync.mockImplementation((command) => {
      if (command.startsWith('git clone')) {
        throw execFailure(command, MAINTENANCE_STDERR);
      }
      return Buffer.from('');
    });

    const result = await submit();

    expect(result.status).toBe('skipped');
    expect(result.message).toContain('AUR unreachable');
    // The release must not be reported as failed over a third-party outage.
    expect(result.status).not.toBe('failed');
  });

  it('does not mistake an outage for a package that does not exist yet', async () => {
    mockExecSync.mockImplementation((command) => {
      if (command.startsWith('git clone')) {
        throw execFailure(command, MAINTENANCE_STDERR);
      }
      return Buffer.from('');
    });

    await submit();

    // Creating an empty repo here would have pushed a fresh history over the
    // real package once AUR came back.
    expect(callsMatching('git init')).toHaveLength(0);
    expect(callsMatching('git push')).toHaveLength(0);
  });

  it('retries a dropped push and succeeds when AUR recovers', async () => {
    let pushAttempts = 0;
    mockExecSync.mockImplementation((command) => {
      if (command.startsWith('git push')) {
        pushAttempts += 1;
        if (pushAttempts < 3) {
          throw execFailure(command, CONNECTION_CLOSED_STDERR);
        }
      }
      return Buffer.from('');
    });

    const result = await submit();

    expect(pushAttempts).toBe(3);
    expect(result.status).toBe('success');
    expect(logger.warn).toHaveBeenCalled();
  });

  it('gives up and skips after exhausting push retries', async () => {
    mockExecSync.mockImplementation((command) => {
      if (command.startsWith('git push')) {
        throw execFailure(command, CONNECTION_CLOSED_STDERR);
      }
      return Buffer.from('');
    });

    const result = await submit(createRelease('2.5.0'));

    expect(callsMatching('git push')).toHaveLength(3);
    expect(result.status).toBe('skipped');
    expect(result.message).toContain('2.5.0');
  });

  it('still fails hard on a real error, without retrying', async () => {
    mockExecSync.mockImplementation((command) => {
      if (command.startsWith('git push')) {
        throw execFailure(command, 'Permission denied (publickey).');
      }
      return Buffer.from('');
    });

    const result = await submit();

    // A bad key is our problem and must not be quietly skipped.
    expect(result.status).toBe('failed');
    expect(callsMatching('git push')).toHaveLength(1);
    expect(result.message).toContain('Permission denied');
  });

  it('surfaces the stderr that execSync hides behind "Command failed"', async () => {
    mockExecSync.mockImplementation((command) => {
      if (command.startsWith('git push')) {
        throw execFailure(command, 'Permission denied (publickey).');
      }
      return Buffer.from('');
    });

    const result = await submit();

    expect(result.message).toContain('Command failed: git push origin master');
    expect(result.message).toContain('Permission denied (publickey).');
  });
});
