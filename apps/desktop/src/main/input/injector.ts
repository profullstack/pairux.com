/**
 * Input injection coordinator
 *
 * Delegates OS-specific input injection to a backend selected at runtime.
 * Keeps a small public API used by IPC handlers while providing consistent
 * logging/telemetry across platforms.
 */

import type { InputEvent } from '@pairux/shared-types';
import { createInputBackend, getInputBackendSelection } from './backendFactory';
import type { InputBackend } from './backends/types';

let injectionEnabled = false;
let backend: InputBackend | null = null;
let backendName = 'uninitialized';

const inputStats = {
  received: 0,
  injected: 0,
  errors: 0,
};

export interface InputInjectionDiagnostics {
  enabled: boolean;
  backend: string;
  backendSupported: boolean;
  reason?: string;
  details?: Record<string, unknown>;
  stats: {
    received: number;
    injected: number;
    errors: number;
  };
}

function getBackend(): InputBackend {
  if (backend) return backend;

  const selection = getInputBackendSelection();
  backend = createInputBackend(selection);
  backendName = backend.name;

  console.log('[InputInjector] Backend selected', {
    backend: selection.kind,
    impl: backend.name,
    platform: selection.platform,
    displayServer: selection.displayServer,
    supported: backend.supported,
    reason: backend.reason,
  });

  return backend;
}

/**
 * Initialize the input injector and get screen dimensions
 */
export async function initInputInjector(): Promise<void> {
  try {
    const activeBackend = getBackend();
    const result = await activeBackend.init();

    if (!result) return;

    if (result.screenWidth && result.screenHeight) {
      console.log(
        `[InputInjector] Screen size: ${String(result.screenWidth)}x${String(result.screenHeight)}`
      );
    }
  } catch (error) {
    console.error('[InputInjector] Failed to initialize backend:', error);
  }
}

/**
 * Enable input injection (called when control is granted)
 */
export function enableInjection(): boolean {
  const activeBackend = getBackend();
  if (!activeBackend.supported) {
    injectionEnabled = false;
    console.warn('[InputInjector] Cannot enable input injection: backend unsupported', {
      backend: activeBackend.name,
      reason: activeBackend.reason,
    });
    return false;
  }

  injectionEnabled = true;
  console.log('[InputInjector] Input injection enabled', { backend: activeBackend.name });
  return true;
}

/**
 * Disable input injection (called when control is revoked)
 */
export function disableInjection(): void {
  injectionEnabled = false;
  console.log('[InputInjector] Input injection disabled');
}

/**
 * Check if injection is currently enabled
 */
export function isInjectionEnabled(): boolean {
  return injectionEnabled;
}

export function getInjectionDiagnostics(): InputInjectionDiagnostics {
  const activeBackend = getBackend();
  return {
    enabled: injectionEnabled,
    backend: activeBackend.name,
    backendSupported: activeBackend.supported,
    reason: activeBackend.reason,
    details: activeBackend.details,
    stats: { ...inputStats },
  };
}

/**
 * Update screen dimensions (called when capture source changes)
 */
export function updateScreenSize(width: number, height: number): void {
  getBackend().updateScreenSize(width, height);
  console.log(`[InputInjector] Screen size updated: ${String(width)}x${String(height)}`);
}

function logInputProgress(event: InputEvent): void {
  if (inputStats.received <= 3 || inputStats.received % 100 === 0) {
    console.log('[InputInjector] Input event received', {
      count: inputStats.received,
      backend: backendName,
      type: event.type,
      action: 'action' in event ? event.action : undefined,
      injected: inputStats.injected,
      errors: inputStats.errors,
    });
  }
}

/**
 * Inject an input event
 * Main entry point for processing incoming input events
 */
export async function injectInput(event: InputEvent): Promise<void> {
  inputStats.received += 1;
  logInputProgress(event);

  if (!injectionEnabled) {
    console.warn('[InputInjector] Input injection not enabled, ignoring event', {
      backend: backendName,
      type: event.type,
      action: 'action' in event ? event.action : undefined,
    });
    return;
  }

  try {
    await getBackend().inject(event);
    inputStats.injected += 1;
  } catch (error) {
    inputStats.errors += 1;
    console.error('[InputInjector] Failed to inject input:', {
      backend: backendName,
      type: event.type,
      action: 'action' in event ? event.action : undefined,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

/**
 * Emergency stop - release all keys and buttons
 */
export async function emergencyStop(): Promise<void> {
  console.log('[InputInjector] Emergency stop triggered');
  disableInjection();

  try {
    await getBackend().emergencyStop();
  } catch (error) {
    console.error('[InputInjector] Error during emergency stop:', error);
  }
}
