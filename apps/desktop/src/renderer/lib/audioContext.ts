/**
 * The renderer's single AudioContext.
 *
 * Both the remote-audio gain stage and the session notification sounds need
 * Web Audio. Contexts are a limited resource and each carries its own device
 * connection, so everything shares one rather than opening a second output.
 */

let sharedContext: AudioContext | null = null;
let resumeArmed = false;

/** The shared context, created on first use. */
export function getAudioContext(): AudioContext {
  if (sharedContext && sharedContext.state !== 'closed') return sharedContext;
  sharedContext = new AudioContext();
  return sharedContext;
}

/**
 * Resume on the next user interaction, once.
 *
 * `resume()` on a gesture-locked context rejects, and nothing else in a call
 * necessarily touches Web Audio again — a participant's audio is wired up once
 * when they join. Without this the graph could stay suspended for the whole
 * session, which presents as everyone being silent rather than as an error.
 */
function armResumeOnGesture(ctx: AudioContext): void {
  if (resumeArmed) return;
  resumeArmed = true;

  const retry = (): void => {
    void ctx.resume().catch(() => undefined);
    window.removeEventListener('pointerdown', retry);
    window.removeEventListener('keydown', retry);
    resumeArmed = false;
  };

  window.addEventListener('pointerdown', retry, { once: true });
  window.addEventListener('keydown', retry, { once: true });
}

/**
 * Nudge a context that was created before any user gesture.
 *
 * Browsers start those suspended, and anything routed through the graph would
 * be silent until something resumes it. The rejection is caught because a
 * still-gesture-locked context is expected rather than exceptional — the next
 * interaction gets it instead.
 */
export function resumeAudioContext(ctx: AudioContext): void {
  if (ctx.state === 'suspended') {
    void ctx.resume().catch(() => undefined);
    armResumeOnGesture(ctx);
  }
}
