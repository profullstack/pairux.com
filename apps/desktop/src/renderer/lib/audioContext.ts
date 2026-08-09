/**
 * The renderer's single AudioContext.
 *
 * Both the remote-audio gain stage and the session notification sounds need
 * Web Audio. Contexts are a limited resource and each carries its own device
 * connection, so everything shares one rather than opening a second output.
 */

let sharedContext: AudioContext | null = null;

/** The shared context, created on first use. */
export function getAudioContext(): AudioContext {
  if (sharedContext && sharedContext.state !== 'closed') return sharedContext;
  sharedContext = new AudioContext();
  return sharedContext;
}

/**
 * Nudge a context that was created before any user gesture.
 *
 * Browsers start those suspended, and anything routed through the graph would
 * be silent until something resumes it. The rejection is caught because a
 * still-gesture-locked context is expected rather than exceptional — a later
 * call will get it once the user has interacted.
 */
export function resumeAudioContext(ctx: AudioContext): void {
  if (ctx.state === 'suspended') {
    void ctx.resume().catch(() => undefined);
  }
}
