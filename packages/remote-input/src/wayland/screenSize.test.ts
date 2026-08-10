import { describe, expect, it, vi } from 'vitest';
import {
  detectWaylandScreenSize,
  parseKscreenDoctor,
  parseMutterCurrentState,
  parseWlrRandr,
} from './screenSize.js';

// Real `wlr-randr` output: every supported mode is listed, and the one in use
// is the one tagged `current` — not the first, which is the largest.
const WLR_RANDR = `DP-1 "Dell Inc. DELL U2415 7MT0159G1EGL"
  Make: Dell Inc.
  Model: DELL U2415
  Enabled: yes
  Modes:
    2560x1440 px, 59.951000 Hz
    1920x1200 px, 59.950001 Hz (preferred, current)
    1280x720 px, 60.000000 Hz
  Position: 0,0
  Transform: normal
  Scale: 1.000000
`;

describe('parseWlrRandr', () => {
  it('takes the mode flagged current, not the first listed', () => {
    expect(parseWlrRandr(WLR_RANDR)).toEqual({ width: 1920, height: 1200 });
  });

  it('divides a scaled output down to logical pixels', () => {
    const hidpi = WLR_RANDR.replace('Scale: 1.000000', 'Scale: 2.000000');
    expect(parseWlrRandr(hidpi)).toEqual({ width: 960, height: 600 });
  });

  it('skips a disabled output and uses the next enabled one', () => {
    const raw = `DP-1 "Off Screen"
  Enabled: no
  Modes:
    3840x2160 px, 60.000000 Hz (current)
  Scale: 1.000000
eDP-1 "Laptop Panel"
  Enabled: yes
  Modes:
    1366x768 px, 60.000000 Hz (preferred, current)
  Scale: 1.000000
`;
    expect(parseWlrRandr(raw)).toEqual({ width: 1366, height: 768 });
  });

  it('returns null when no mode is current', () => {
    expect(
      parseWlrRandr('DP-1 "x"\n  Enabled: yes\n  Modes:\n    1920x1080 px, 60 Hz\n')
    ).toBeNull();
  });

  it('returns null for unrelated output', () => {
    expect(parseWlrRandr('command not found')).toBeNull();
  });
});

describe('parseKscreenDoctor', () => {
  const payload = JSON.stringify({
    outputs: [
      {
        name: 'eDP-1',
        enabled: true,
        currentModeId: '2',
        scale: 1,
        modes: [
          { id: '1', size: { width: 3840, height: 2160 } },
          { id: '2', size: { width: 2560, height: 1440 } },
        ],
      },
    ],
  });

  it('resolves currentModeId rather than taking the first mode', () => {
    expect(parseKscreenDoctor(payload)).toEqual({ width: 2560, height: 1440 });
  });

  it('applies the output scale', () => {
    const scaled = payload.replace('"scale":1', '"scale":2');
    expect(parseKscreenDoctor(scaled)).toEqual({ width: 1280, height: 720 });
  });

  it('skips disabled outputs', () => {
    const raw = JSON.stringify({
      outputs: [
        {
          enabled: false,
          currentModeId: '1',
          modes: [{ id: '1', size: { width: 9999, height: 9999 } }],
        },
        {
          enabled: true,
          currentModeId: '1',
          modes: [{ id: '1', size: { width: 1600, height: 900 } }],
        },
      ],
    });
    expect(parseKscreenDoctor(raw)).toEqual({ width: 1600, height: 900 });
  });

  it('returns null on non-JSON output', () => {
    expect(parseKscreenDoctor('kscreen-doctor: command not found')).toBeNull();
  });

  it('returns null when the payload has no usable outputs', () => {
    expect(parseKscreenDoctor('{"outputs":[]}')).toBeNull();
  });
});

// Abbreviated but structurally faithful `gdbus call … GetCurrentState` output.
const MUTTER = `((1, [(('eDP-1', 'Sharp', 'panel', '0x00000000'), [('3840x2160@60.000', 3840, 2160, 60.0, 1.0, [1.0, 2.0], {'is-preferred': <true>}), ('2560x1440@60.000', 2560, 1440, 60.0, 1.0, [1.0], {'is-current': <true>})], {'is-builtin': <true>})], [(0, 0, 2.0, 0, true, [('eDP-1', '2560x1440@60.000')], {})], {}),)
`;

describe('parseMutterCurrentState', () => {
  it('takes the mode marked is-current and applies the logical scale', () => {
    expect(parseMutterCurrentState(MUTTER)).toEqual({ width: 1280, height: 720 });
  });

  it('returns null when nothing is marked current', () => {
    expect(parseMutterCurrentState(MUTTER.replace("'is-current': <true>", ''))).toBeNull();
  });

  it('returns null when DisplayConfig is not available', () => {
    expect(
      parseMutterCurrentState('Error: GDBus.Error:org.freedesktop.DBus.Error.ServiceUnknown')
    ).toBeNull();
  });
});

describe('detectWaylandScreenSize', () => {
  it('uses the first tool that answers', async () => {
    const run = vi.fn(async (command: string) => {
      if (command === 'wlr-randr') throw new Error('ENOENT');
      if (command === 'kscreen-doctor') return JSON.stringify({ outputs: [] });
      return MUTTER;
    });

    await expect(detectWaylandScreenSize(run)).resolves.toEqual({ width: 1280, height: 720 });
    expect(run).toHaveBeenCalledTimes(3);
  });

  it('stops probing as soon as one succeeds', async () => {
    const run = vi.fn(async () => WLR_RANDR);

    await expect(detectWaylandScreenSize(run)).resolves.toEqual({ width: 1920, height: 1200 });
    expect(run).toHaveBeenCalledTimes(1);
  });

  it('resolves null when no compositor tool works', async () => {
    const run = vi.fn(() => Promise.reject(new Error('ENOENT')));

    await expect(detectWaylandScreenSize(run)).resolves.toBeNull();
  });
});
