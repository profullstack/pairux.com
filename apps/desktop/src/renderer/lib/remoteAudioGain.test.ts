import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { DEFAULT_REMOTE_AUDIO_GAIN, MAX_REMOTE_AUDIO_GAIN } from '@pairux/shared-types';
import type * as RemoteAudioGainModule from './remoteAudioGain';

/** Minimal Web Audio stand-in that records how the graph was wired. */
function createAudioContextMock() {
  const connections: string[] = [];
  const gainParam = { value: 0, setTargetAtTime: vi.fn() };

  const node = (name: string) => ({
    name,
    connect: vi.fn((target: { name: string }) => {
      connections.push(`${name}->${target.name}`);
    }),
    disconnect: vi.fn(),
  });

  const destinationStream = { id: 'amplified' } as unknown as MediaStream;

  return {
    connections,
    gainParam,
    destinationStream,
    ctx: {
      state: 'running',
      currentTime: 0,
      resume: vi.fn(() => Promise.resolve()),
      createMediaStreamSource: vi.fn(() => node('source')),
      createGain: vi.fn(() => ({ ...node('gain'), gain: gainParam })),
      createDynamicsCompressor: vi.fn(() => ({
        ...node('limiter'),
        threshold: { value: 0 },
        knee: { value: 0 },
        ratio: { value: 0 },
        attack: { value: 0 },
        release: { value: 0 },
      })),
      createMediaStreamDestination: vi.fn(() => ({
        ...node('destination'),
        stream: destinationStream,
      })),
    },
  };
}

const track = { kind: 'audio', id: 'remote-track' } as unknown as MediaStreamTrack;

let mock: ReturnType<typeof createAudioContextMock>;

/**
 * The module caches one AudioContext for the lifetime of the page, which is
 * what we want in production but would leak the first test's mock into every
 * later case. Re-import per test so each starts from a clean module state.
 */
async function loadModule(): Promise<typeof RemoteAudioGainModule> {
  return import('./remoteAudioGain');
}

beforeEach(() => {
  vi.resetModules();
  mock = createAudioContextMock();
  vi.stubGlobal(
    'AudioContext',
    vi.fn(() => mock.ctx)
  );
  vi.stubGlobal(
    'MediaStream',
    vi.fn(function (this: Record<string, unknown>, tracks: MediaStreamTrack[]) {
      this.id = 'passthrough';
      this.tracks = tracks;
    })
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('amplifyRemoteAudio', () => {
  it('returns a replacement stream, not the raw track', async () => {
    const { amplifyRemoteAudio } = await loadModule();
    const amplified = amplifyRemoteAudio(track);
    expect(amplified.stream).toBe(mock.destinationStream);
  });

  it('wires source through gain and a limiter to the destination', async () => {
    const { amplifyRemoteAudio } = await loadModule();
    amplifyRemoteAudio(track);
    expect(mock.connections).toEqual(['source->gain', 'gain->limiter', 'limiter->destination']);
  });

  it('boosts above unity by default, which an element cannot do alone', async () => {
    const { amplifyRemoteAudio } = await loadModule();
    amplifyRemoteAudio(track);
    expect(mock.gainParam.value).toBe(DEFAULT_REMOTE_AUDIO_GAIN);
    expect(mock.gainParam.value).toBeGreaterThan(1);
  });

  it('limits above the boost so peaks do not clip', async () => {
    const { amplifyRemoteAudio } = await loadModule();
    amplifyRemoteAudio(track);
    const limiter = mock.ctx.createDynamicsCompressor.mock.results[0]?.value as {
      ratio: { value: number };
      threshold: { value: number };
    };
    expect(limiter.ratio.value).toBeGreaterThan(1);
    expect(limiter.threshold.value).toBeLessThan(0);
  });

  it('ramps gain changes rather than jumping, to avoid a click', async () => {
    const { amplifyRemoteAudio } = await loadModule();
    const amplified = amplifyRemoteAudio(track);
    amplified.setGain(1.5);
    expect(mock.gainParam.setTargetAtTime).toHaveBeenCalledWith(1.5, 0, expect.any(Number));
  });

  it('clamps a gain beyond the supported range', async () => {
    const { amplifyRemoteAudio } = await loadModule();
    const amplified = amplifyRemoteAudio(track);
    amplified.setGain(99);
    expect(mock.gainParam.setTargetAtTime).toHaveBeenCalledWith(
      MAX_REMOTE_AUDIO_GAIN,
      0,
      expect.any(Number)
    );
  });

  it('ignores gain changes after disposal', async () => {
    const { amplifyRemoteAudio } = await loadModule();
    const amplified = amplifyRemoteAudio(track);
    amplified.dispose();
    amplified.setGain(1.5);
    expect(mock.gainParam.setTargetAtTime).not.toHaveBeenCalled();
  });

  it('tolerates being disposed twice', async () => {
    const { amplifyRemoteAudio } = await loadModule();
    const amplified = amplifyRemoteAudio(track);
    amplified.dispose();
    expect(() => {
      amplified.dispose();
    }).not.toThrow();
  });

  it('resumes a context suspended before a user gesture', async () => {
    mock.ctx.state = 'suspended';
    const { amplifyRemoteAudio } = await loadModule();
    amplifyRemoteAudio(track);
    expect(mock.ctx.resume).toHaveBeenCalled();
  });
});
