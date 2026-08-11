/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-explicit-any */
import type { serviceClient } from '@/lib/supabase/service';

type ServiceClient = ReturnType<typeof serviceClient>;

// Uppercase only — create_session() upper-cases whatever it is handed, so generating
// anything else here would desync the scheduled code from the live room's code.
const CODE_CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';

export function generateJoinCode(): string {
  let code = '';
  for (let i = 0; i < 6; i++) {
    code += CODE_CHARS.charAt(Math.floor(Math.random() * CODE_CHARS.length));
  }
  return code;
}

/**
 * Finds a code that is not already taken by a live session or another scheduled one.
 * Both tables have to be checked: a scheduled meeting's code is handed straight to
 * create_session() when the host starts it, and that insert fails on a collision.
 */
export async function getUniqueJoinCode(svc: ServiceClient): Promise<string> {
  for (let i = 0; i < 10; i++) {
    const code = generateJoinCode();

    const { data: inSessions } = await (svc as any)
      .from('sessions')
      .select('id')
      .eq('join_code', code)
      .maybeSingle();

    const { data: inScheduled } = await (svc as any)
      .from('scheduled_sessions')
      .select('id')
      .eq('join_code', code)
      .maybeSingle();

    if (!inSessions && !inScheduled) return code;
  }
  throw new Error('Failed to generate unique join code');
}

/**
 * Has the host already started this meeting? Once a live session exists under the
 * scheduled code, rotating the scheduled row no longer revokes anything — the live
 * room keeps its own copy of the code. Callers use this to avoid pretending a
 * removal revoked access when it did not.
 */
export async function liveSessionExistsForCode(
  svc: ServiceClient,
  joinCode: string
): Promise<boolean> {
  const { data } = await (svc as any)
    .from('sessions')
    .select('id')
    .eq('join_code', joinCode)
    .maybeSingle();

  return Boolean(data);
}
