import { afterEach, describe, expect, it, vi } from 'vitest';
import { Platform } from 'react-native';
import { emitAppStateChange } from '../test/setup';
import {
  isAndroidNativePromptActive,
  runAndroidNativePrompt,
  subscribeAndroidNativePrompt,
} from './android-native-prompt';

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

describe('runAndroidNativePrompt', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('keeps the prompt active until Android returns to the foreground', async () => {
    Object.assign(Platform, { OS: 'android', Version: 34 });
    const action = deferred<string>();
    const states: boolean[] = [];
    const unsubscribe = subscribeAndroidNativePrompt((active) => states.push(active));

    const resultPromise = runAndroidNativePrompt(() => action.promise);
    expect(isAndroidNativePromptActive()).toBe(true);

    emitAppStateChange('background');
    action.resolve('allowed');
    await Promise.resolve();
    expect(isAndroidNativePromptActive()).toBe(true);
    emitAppStateChange('active');

    await expect(resultPromise).resolves.toEqual({ value: 'allowed', resumed: true });
    expect(isAndroidNativePromptActive()).toBe(false);
    expect(states).toEqual([true, false]);
    unsubscribe();
  });

  it('reports a real background when Android does not resume after the prompt', async () => {
    vi.useFakeTimers();
    Object.assign(Platform, { OS: 'android', Version: 34 });
    const action = deferred<string>();

    const resultPromise = runAndroidNativePrompt(() => action.promise);
    emitAppStateChange('background');
    action.resolve('allowed');
    await Promise.resolve();
    await vi.advanceTimersByTimeAsync(1_500);

    await expect(resultPromise).resolves.toEqual({ value: 'allowed', resumed: false });
    expect(isAndroidNativePromptActive()).toBe(false);
  });
});
