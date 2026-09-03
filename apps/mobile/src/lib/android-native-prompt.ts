import { AppState, Platform } from 'react-native';

const ANDROID_PROMPT_RESUME_TIMEOUT_MS = 1_500;

type PromptStateListener = (active: boolean) => void;

let activePromptCount = 0;
const promptStateListeners = new Set<PromptStateListener>();

function notifyPromptState(): void {
  const active = activePromptCount > 0;
  for (const listener of promptStateListeners) {
    listener(active);
  }
}

function beginPrompt(): () => void {
  const wasInactive = activePromptCount === 0;
  activePromptCount += 1;
  if (wasInactive) notifyPromptState();

  let ended = false;
  return () => {
    if (ended) return;
    ended = true;
    activePromptCount = Math.max(0, activePromptCount - 1);
    if (activePromptCount === 0) notifyPromptState();
  };
}

function waitForAndroidForeground(): Promise<boolean> {
  if (AppState.currentState === 'active') return Promise.resolve(true);

  return new Promise((resolve) => {
    let settled = false;
    let subscription: { remove: () => void } | null = null;
    let timeout: ReturnType<typeof setTimeout> | null = null;

    const finish = (resumed: boolean) => {
      if (settled) return;
      settled = true;
      subscription?.remove();
      if (timeout) clearTimeout(timeout);
      resolve(resumed);
    };

    subscription = AppState.addEventListener('change', (nextState) => {
      if (nextState === 'active') finish(true);
    });
    timeout = setTimeout(() => {
      finish(false);
    }, ANDROID_PROMPT_RESUME_TIMEOUT_MS);

    // Close the gap between the initial read and listener registration.
    if (AppState.currentState === 'active') finish(true);
  });
}

export function isAndroidNativePromptActive(): boolean {
  return Platform.OS === 'android' && activePromptCount > 0;
}

export function subscribeAndroidNativePrompt(listener: PromptStateListener): () => void {
  promptStateListeners.add(listener);
  return () => {
    promptStateListeners.delete(listener);
  };
}

/**
 * Android permission and MediaProjection dialogs pause the host Activity and
 * emit AppState "background". Keep that transient pause distinct from the user
 * actually leaving the app, including the small gap between promise resolution
 * and the subsequent onHostResume event.
 */
export async function runAndroidNativePrompt<T>(
  action: () => Promise<T>
): Promise<{ value: T; resumed: boolean }> {
  if (Platform.OS !== 'android') {
    return { value: await action(), resumed: true };
  }

  const endPrompt = beginPrompt();
  let value!: T;
  let actionError: unknown;
  let failed = false;

  try {
    value = await action();
  } catch (error) {
    failed = true;
    actionError = error;
  }

  const resumed = await waitForAndroidForeground();
  endPrompt();

  if (failed) throw actionError;
  return { value, resumed };
}
