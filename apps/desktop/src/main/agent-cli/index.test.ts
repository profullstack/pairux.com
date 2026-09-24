import { describe, expect, it } from 'vitest';
import { parseAgentArgv } from './index';

describe('parseAgentArgv', () => {
  it('picks up an agent command from the packaged app argv', () => {
    expect(
      parseAgentArgv(['/opt/PairUX/pairux', 'join', 'ABC123', '--name', 'Claude'], true)
    ).toEqual(['join', 'ABC123', '--name', 'Claude']);
  });

  it('skips switches a wrapper prepends (AppImage --no-sandbox)', () => {
    expect(parseAgentArgv(['/tmp/.mount/pairux', '--no-sandbox', 'say', 'hi'], true)).toEqual([
      'say',
      'hi',
    ]);
  });

  it('accounts for the app path in dev argv', () => {
    expect(parseAgentArgv(['electron', '.', 'listen', '--json'], false)).toEqual([
      'listen',
      '--json',
    ]);
  });

  it('leaves normal launches, the daemon and deep links alone', () => {
    expect(parseAgentArgv(['/opt/PairUX/pairux'], true)).toBeNull();
    expect(parseAgentArgv(['/opt/PairUX/pairux', 'daemon'], true)).toBeNull();
    expect(parseAgentArgv(['/opt/PairUX/pairux', 'pairux://join/ABC123'], true)).toBeNull();
    expect(parseAgentArgv(['/opt/PairUX/pairux', '--daemon'], true)).toBeNull();
  });
});
