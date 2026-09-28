import { expect, it, vi, type Mock } from 'vitest';
import { MicrophoneController } from './microphone.js';

function fixture(): {
  port: {
    setEnabled: Mock<(enabled: boolean) => Promise<unknown>>;
    silence: Mock;
    stop: Mock;
    changed: Mock;
  };
  mic: MicrophoneController;
} {
  const port = {
    setEnabled: vi.fn<(enabled: boolean) => Promise<unknown>>().mockResolvedValue(undefined),
    silence: vi.fn(),
    stop: vi.fn(),
    changed: vi.fn(),
  };
  return { port, mic: new MicrophoneController(port) };
}
it('only reports enabled after successful publication', async () => {
  const { port, mic } = fixture();
  let resolve!: () => void;
  port.setEnabled.mockImplementationOnce(
    () =>
      new Promise<void>((r) => {
        resolve = r;
      })
  );
  const work = mic.setEnabled(true);
  await Promise.resolve();
  expect(port.changed).not.toHaveBeenCalled();
  resolve();
  await work;
  expect(port.changed).toHaveBeenLastCalledWith(true, true);
});
it('a later mute wins over pending permission and immediately silences existing audio', async () => {
  const { port, mic } = fixture();
  let resolve!: () => void;
  port.setEnabled.mockImplementationOnce(
    () =>
      new Promise<void>((r) => {
        resolve = r;
      })
  );
  const enabling = mic.setEnabled(true);
  await Promise.resolve();
  const muting = mic.setEnabled(false);
  expect(port.silence).toHaveBeenCalledOnce();
  resolve();
  await enabling;
  await muting;
  expect(port.changed).not.toHaveBeenCalledWith(true, true);
  expect(port.setEnabled).toHaveBeenLastCalledWith(false);
});
it('disposal stops tracks acquired after unmount without publishing enabled state', async () => {
  const { port, mic } = fixture();
  let resolve!: () => void;
  port.setEnabled.mockImplementationOnce(
    () =>
      new Promise<void>((r) => {
        resolve = r;
      })
  );
  const work = mic.setEnabled(true);
  await Promise.resolve();
  mic.dispose();
  resolve();
  await work;
  expect(port.stop).toHaveBeenCalledTimes(2);
  expect(port.setEnabled).toHaveBeenLastCalledWith(false);
  expect(port.changed).not.toHaveBeenCalled();
  await mic.setEnabled(true);
  expect(port.setEnabled).toHaveBeenCalledTimes(2);
});
it('catches enable and mute failures without an optimistic active mic', async () => {
  for (const enabled of [true, false]) {
    const { port, mic } = fixture();
    port.setEnabled.mockRejectedValueOnce(new Error('device unavailable'));
    await expect(mic.setEnabled(enabled)).resolves.toBeUndefined();
    expect(port.stop).toHaveBeenCalled();
    expect(port.changed).toHaveBeenLastCalledWith(false, false);
    await mic.setEnabled(true);
    expect(port.changed).toHaveBeenLastCalledWith(true, true);
  }
});
it('does not report a device error after disposal while permission was pending', async () => {
  const { port, mic } = fixture();
  let reject!: (error: Error) => void;
  port.setEnabled.mockImplementationOnce(
    () =>
      new Promise<void>((_, fail) => {
        reject = fail;
      })
  );
  const work = mic.setEnabled(true);
  await Promise.resolve();
  mic.dispose();
  reject(new Error('late permission denial'));
  await expect(work).resolves.toBeUndefined();
  expect(port.stop).toHaveBeenCalledTimes(2);
  expect(port.changed).not.toHaveBeenCalled();
});
it('does not publish stale muted state when disposed during the corrective SDK mute', async () => {
  const { port, mic } = fixture();
  let allow!: () => void;
  let muted!: () => void;
  port.setEnabled
    .mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          allow = resolve;
        })
    )
    .mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          muted = resolve;
        })
    );
  const enabling = mic.setEnabled(true);
  await Promise.resolve();
  const muting = mic.setEnabled(false);
  allow();
  await vi.waitFor(() => expect(port.setEnabled).toHaveBeenCalledTimes(2));
  expect(port.setEnabled).toHaveBeenLastCalledWith(false);
  port.changed.mockClear();
  mic.dispose();
  muted();
  await enabling;
  await muting;
  expect(port.changed).not.toHaveBeenCalled();
});
it('coalesces same-frame toggles to the latest intent', async () => {
  const { port, mic } = fixture();
  const a = mic.setEnabled(true);
  const b = mic.setEnabled(false);
  await a;
  await b;
  expect(port.setEnabled).not.toHaveBeenCalledWith(true);
});
it('a successful mute does not turn a failed device into an available microphone', async () => {
  const { port, mic } = fixture();
  port.setEnabled.mockRejectedValueOnce(new Error('permission denied'));
  await mic.setEnabled(true);
  port.changed.mockClear();
  await mic.setEnabled(false);
  expect(port.changed.mock.calls).toEqual([
    [false, false],
    [false, false],
  ]);
  await mic.setEnabled(true);
  expect(port.changed).toHaveBeenLastCalledWith(true, true);
});
it('flushes an SDK mute before a same-frame local re-enable', async () => {
  let sdkMuted = true;
  let audioEnabled = false;
  const { port, mic } = fixture();
  port.silence.mockImplementation(() => {
    audioEnabled = false;
  });
  port.setEnabled.mockImplementation(async (enabled) => {
    // LiveKit LocalAudioTrack.unmute is a no-op when isMuted is already false.
    if (sdkMuted !== !enabled) {
      sdkMuted = !enabled;
      audioEnabled = enabled;
    }
  });
  await mic.setEnabled(true);
  const muting = mic.setEnabled(false);
  const enabling = mic.setEnabled(true);
  await muting;
  await enabling;
  expect(port.setEnabled.mock.calls.map((call) => call[0])).toEqual([true, false, true]);
  expect(audioEnabled).toBe(true);
});
