/**
 * Per-event input tracing, off unless `PAIRUX_DEBUG_INPUT=1`.
 *
 * Exists to answer questions that cannot be settled by reading the code —
 * above all, whether the pointer is actually where we asked it to be by the
 * time a remote click's button event goes down. The OS applies synthetic
 * moves on its own schedule, so that ordering is only observable at runtime.
 *
 * Off by default: it reads the cursor position on every button event, which
 * is a round trip into the window server, and it prints the coordinates of
 * everything the remote peer clicks.
 */
export function isInputDebugEnabled(): boolean {
  return process.env.PAIRUX_DEBUG_INPUT === '1';
}
