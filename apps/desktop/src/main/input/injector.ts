/**
 * Input injection for the desktop host.
 *
 * A thin module-level facade over @profullstack/remote-input, which owns the
 * OS backends plus the validation, rate limiting and emergency-stop behaviour.
 * The singleton exists because the IPC handlers are themselves module-level.
 */

import { RemoteInputInjector, type InputDiagnostics } from '@profullstack/remote-input';
import type { InputEvent } from '@pairux/shared-types';
import { getInputBackendSelection } from './backendFactory';

export type InputInjectionDiagnostics = InputDiagnostics;

let injector: RemoteInputInjector | null = null;

function getInjector(): RemoteInputInjector {
  injector ??= new RemoteInputInjector({
    // Platform facts come from the app's Electron-aware detection.
    selection: getInputBackendSelection(),
    onRejected: (reason, event, detail) => {
      console.warn('[InputInjector] Rejected input event', {
        reason,
        detail,
        type: event.type,
        action: 'action' in event ? event.action : undefined,
      });
    },
  });
  return injector;
}

/** Test seam: drop the singleton so the next call re-selects a backend. */
export function resetInputInjector(): void {
  injector = null;
}

export async function initInputInjector(): Promise<void> {
  await getInjector().init();
}

/** Enable injection. False means this host cannot inject — surface it. */
export function enableInjection(): boolean {
  return getInjector().enable();
}

export function disableInjection(): void {
  getInjector().disable();
}

export function isInjectionEnabled(): boolean {
  return getInjector().isEnabled;
}

export function getInjectionDiagnostics(): InputInjectionDiagnostics {
  return getInjector().getDiagnostics();
}

export function updateScreenSize(width: number, height: number): void {
  getInjector().updateScreenSize(width, height);
  console.log(`[InputInjector] Screen size updated: ${String(width)}x${String(height)}`);
}

export async function injectInput(event: InputEvent): Promise<void> {
  await getInjector().inject(event);
}

/** Release every held key and button, and stop accepting input. */
export async function emergencyStop(): Promise<void> {
  await getInjector().emergencyStop();
}
