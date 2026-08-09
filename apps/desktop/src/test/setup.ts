import { vi } from 'vitest';
import '@testing-library/jest-dom';

// Mock the electron API with the correct property name
const mockElectronAPI = {
  invoke: vi.fn(),
  on: vi.fn(),
  off: vi.fn(),
};

// Make electron API available globally using the correct property name
Object.defineProperty(window, 'electronAPI', {
  writable: true,
  configurable: true,
  value: mockElectronAPI,
});

// Export for test access
export { mockElectronAPI };

// jsdom implements neither Web Audio nor MediaStream, but the renderer uses
// both to put a gain stage in front of remote playback. Provide them here so
// components exercise the real code path instead of the production code having
// to carry a "browser might not have this" branch.
//
// Assigned straight onto globalThis rather than via vi.stubGlobal: the teardown
// below calls vi.unstubAllGlobals(), which would otherwise strip these after
// the first test in a file.
class FakeAudioParam {
  value = 0;
  setTargetAtTime(target: number): void {
    this.value = target;
  }
  setValueAtTime(value: number): void {
    this.value = value;
  }
  linearRampToValueAtTime(value: number): void {
    this.value = value;
  }
  exponentialRampToValueAtTime(value: number): void {
    this.value = value;
  }
}

/** Records when each note was scheduled so tests can assert the figure. */
class FakeOscillator {
  type = 'sine';
  frequency = new FakeAudioParam();
  startTime = 0;
  connect(): void {
    // Graph shape is asserted with a purpose-built mock where it matters.
  }
  disconnect(): void {
    // As above.
  }
  start(when = 0): void {
    this.startTime = when;
  }
  stop(): void {
    // Nothing to tear down.
  }
}

class FakeAudioNode {
  connect(): void {
    // Graph shape is asserted in remoteAudioGain.test.ts with its own mock.
  }
  disconnect(): void {
    // As above.
  }
}

class FakeMediaStream {
  private readonly tracks: unknown[];
  id = 'fake-stream';
  constructor(tracks: unknown[] = []) {
    this.tracks = [...tracks];
  }
  getTracks(): unknown[] {
    return this.tracks;
  }
  getAudioTracks(): unknown[] {
    return this.tracks;
  }
  getVideoTracks(): unknown[] {
    return [];
  }
  addTrack(track: unknown): void {
    this.tracks.push(track);
  }
}

class FakeAudioContext {
  state = 'running';
  currentTime = 0;
  destination = new FakeAudioNode();
  readonly createdOscillators: FakeOscillator[] = [];
  resume(): Promise<void> {
    return Promise.resolve();
  }
  close(): Promise<void> {
    return Promise.resolve();
  }
  createMediaStreamSource(): FakeAudioNode {
    return new FakeAudioNode();
  }
  createGain(): FakeAudioNode & { gain: FakeAudioParam } {
    return Object.assign(new FakeAudioNode(), { gain: new FakeAudioParam() });
  }
  createOscillator(): FakeOscillator {
    const oscillator = new FakeOscillator();
    this.createdOscillators.push(oscillator);
    return oscillator;
  }
  createDynamicsCompressor(): FakeAudioNode & {
    threshold: FakeAudioParam;
    knee: FakeAudioParam;
    ratio: FakeAudioParam;
    attack: FakeAudioParam;
    release: FakeAudioParam;
  } {
    return Object.assign(new FakeAudioNode(), {
      threshold: new FakeAudioParam(),
      knee: new FakeAudioParam(),
      ratio: new FakeAudioParam(),
      attack: new FakeAudioParam(),
      release: new FakeAudioParam(),
    });
  }
  createMediaStreamDestination(): FakeAudioNode & { stream: FakeMediaStream } {
    return Object.assign(new FakeAudioNode(), { stream: new FakeMediaStream() });
  }
}

Object.assign(globalThis, {
  AudioContext: FakeAudioContext,
  MediaStream: FakeMediaStream,
});
