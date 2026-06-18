/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-explicit-any */
'use server';

import { revalidatePath } from 'next/cache';
import { marked } from 'marked';
import { createClient } from '@/lib/supabase/server';
import { serviceClient } from '@/lib/supabase/service';
import { createEmailer } from '@profullstack/emailer';

type Ok<T = undefined> = { ok: true } & (T extends undefined ? object : T);
interface Err {
  ok: false;
  error: string;
}

async function assertAdmin(): Promise<{ ok: true; userId: string } | Err> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: 'Not authenticated.' };

  const svc = serviceClient();
  const { data } = await (svc as any)
    .from('admin_users')
    .select('user_id')
    .eq('user_id', user.id)
    .maybeSingle();
  if (!data) return { ok: false, error: 'Admin only.' };
  return { ok: true, userId: user.id };
}

export async function sendBulkEmail(input: {
  subject: string;
  markdown: string;
  from?: string;
}): Promise<
  Ok<{ sent: number; failed: number; errors: { email: string; error: string }[] }> | Err
> {
  const adminCheck = await assertAdmin();
  if (!adminCheck.ok) return adminCheck;

  const subject = input.subject.trim();
  if (!subject) return { ok: false, error: 'Subject is required.' };
  const markdown = input.markdown.trim();
  if (!markdown) return { ok: false, error: 'Body is required.' };

  // The admin composes in Markdown; render to HTML for the email body and
  // keep the raw Markdown as a readable plain-text fallback.
  const html = await marked.parse(markdown, { async: true });
  const text = markdown;

  const resendApiKey = process.env.RESEND_API_KEY;
  if (!resendApiKey) return { ok: false, error: 'RESEND_API_KEY is not configured.' };

  const defaultFrom = process.env.EMAIL_FROM ?? 'PairUX <hello@pairux.com>';

  // Fetch all user emails via the admin auth API (service role bypasses RLS).
  const svc = serviceClient();
  const {
    data: { users },
    error: listErr,
  } = await (svc as any).auth.admin.listUsers({ perPage: 1000 });
  if (listErr) return { ok: false, error: listErr.message };

  const emails: string[] = (users ?? [])
    .map((u: any) => u.email as string | undefined)
    .filter((e: string | undefined): e is string => !!e);

  if (emails.length === 0) return { ok: false, error: 'No users found to email.' };

  const emailer = createEmailer({ resendApiKey, defaultFrom });
  const bulkOpts: Parameters<typeof emailer.sendBulk>[0] = {
    to: emails,
    subject,
    html,
    text,
  };
  if (input.from !== undefined) bulkOpts.from = input.from;
  const result = await emailer.sendBulk(bulkOpts);

  revalidatePath('/admin');
  return { ok: true, ...result };
}
