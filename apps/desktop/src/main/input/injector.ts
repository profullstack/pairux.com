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
import { resolveCaptureBoundsForSource } from '../capture/captureDisplay';

export type InputInjectionDiagnostics = InputDiagnostics;

let injector: RemoteInputInjector | null = null;
const REJECTION_LOG_INTERVAL_MS = 5_000;
let lastRejectionLogAt = 0;

function getInjector(): RemoteInputInjector {
  const selection = getInputBackendSelection();

  injector ??= new RemoteInputInjector({
    // Platform facts come from the app's Electron-aware detection.
    selection,
    // Remote input always drives the host's one real pointer. The host and
    // guest take turns by simply moving that shared cursor.
    // Keep remote input one pixel off the screen edge on Linux: GNOME's
    // Activities hot-corner fires from the corner pixel, so a guest brushing
    // it would take over the host's desktop. One pixel is enough to miss the
    // barrier while leaving corner UI (Start button, menu bar) clickable.
    // Other platforms get the guest's exact coordinates.
    edgeMarginPx: selection.platform === 'linux' ? 1 : 0,
    // This is a second, process-side guard after renderer coalescing. It also
    // protects IPC callers that bypass the normal host hook.
    maxEventsPerSecond: 120,
    onRejected: (reason, event, detail) => {
      const now = Date.now();
      if (now - lastRejectionLogAt < REJECTION_LOG_INTERVAL_MS) return;
      lastRejectionLogAt = now;
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
  lastRejectionLogAt = 0;
  backendPrimary = null;
  captureSourceId = null;
}

/**
 * The primary display's size as the backend measured it, captured once at init.
 *
 * Kept here rather than read back from the injector because
 * `updateCaptureBounds` replaces the injector's idea of the surface with the
 * shared display — so asking it later would return the second monitor's size
 * and scale every subsequent resolution against the wrong reference.
 */
let backendPrimary: { width: number; height: number } | null = null;
/** The latest source requested, retained until backend dimensions are known. */
let captureSourceId: string | null = null;

export async function initInputInjector(): Promise<void> {
  const injector = getInjector();
  await injector.init();
  backendPrimary = injector.getScreenSize();
  await updateCaptureBounds();
}

/**
 * Point the injector at whichever display the guest is actually watching.
 *
 * Called whenever the shared source changes. A source that cannot be resolved
 * to a display falls back to the primary one, which is the behaviour every
 * single-monitor host has always had.
 */
export async function setCaptureSource(sourceId: string | null): Promise<void> {
  captureSourceId = sourceId;
  await updateCaptureBounds();
}

/** Re-resolve once both the selected source and backend geometry are available. */
async function updateCaptureBounds(): Promise<void> {
  const bounds = await resolveCaptureBoundsForSource(captureSourceId, backendPrimary);
  getInjector().updateCaptureBounds(bounds);
}

/** Enable injection. False means this host cannot inject — surface it. */
export async function enableInjection(): Promise<boolean> {
  return getInjector().enableWithAuthorization();
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

/**
 * Shut down injection on quit.
 *
 * Backends use this to release held input and close any OS resources.
 */
export async function disposeInputInjector(): Promise<void> {
  if (!injector) return;
  await injector.dispose();
  injector = null;
}
