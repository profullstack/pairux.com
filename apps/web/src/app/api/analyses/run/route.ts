import { timingSafeEqual } from 'node:crypto';
import { NextResponse } from 'next/server';
import { serviceClient } from '@/lib/supabase/service';
import type { AnalysisRow } from '@/lib/call-analysis/store';

/**
 * POST /api/analyses/run — the report job's tick, called once a minute by
 * pg_cron (job `call-analysis`) with the same shared secret as the meeting
 * reminders. Claims at most one analysis and processes it in the background:
 * a report takes minutes, far longer than pg_net waits for a response.
 */

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/** One job at a time per server process: ffmpeg and the model are heavy. */
let busy = false;

function authorised(request: Request): boolean {
  const expected = process.env.REMINDERS_CRON_SECRET;
  if (!expected) return false;
  const header = request.headers.get('authorization') ?? '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : '';
  const a = Buffer.from(token);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

export async function POST(request: Request): Promise<NextResponse> {
  if (!authorised(request)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (busy) return NextResponse.json({ claimed: null, busy: true });

  const db = serviceClient();
  // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-explicit-any
  const { data, error } = await (db.rpc as any)('claim_call_analysis');
  if (error) return NextResponse.json({ error: 'Could not claim' }, { status: 500 });
  const row = (Array.isArray(data) ? data[0] : data) as AnalysisRow | null;
  if (!row?.id) return NextResponse.json({ claimed: null });

  busy = true;
  void import('@/lib/call-analysis/run')
    .then(({ processAnalysis }) => processAnalysis(db, row))
    .catch((e: unknown) => {
      console.error('[call-analysis] job crashed:', e);
    })
    .finally(() => {
      busy = false;
    });

  return NextResponse.json({ claimed: row.id }, { status: 202 });
}
