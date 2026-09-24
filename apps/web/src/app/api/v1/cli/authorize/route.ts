import { z } from 'zod';
import { createClient, getAuthenticatedUser } from '@/lib/supabase/server';
import { serviceClient } from '@/lib/supabase/service';
import { successResponse, errorResponse, handleApiError } from '@/lib/api';
import { CliAuthError, createAuthCode } from '@/lib/cli-auth';

const bodySchema = z.object({
  codeChallenge: z.string(),
  codeChallengeMethod: z.literal('S256'),
  redirectUri: z.string(),
  state: z.string().min(8).max(200),
  clientName: z
    .string()
    .max(60)
    .regex(/^[\w .@()-]+$/)
    .optional(),
});

/**
 * POST /api/v1/cli/authorize
 *
 * Called by the /cli/authorize consent page once the signed-in user clicks
 * Allow. Mints a one-time code bound to the PKCE challenge and the loopback
 * redirect, and returns the URL the browser should go to next.
 */
export async function POST(request: Request) {
  try {
    const supabase = await createClient();
    const { user } = await getAuthenticatedUser(supabase);
    if (!user) return errorResponse('Sign in to authorize the PairUX CLI', 401);

    const body = bodySchema.parse(await request.json().catch(() => ({})));
    const code = await createAuthCode(serviceClient(), {
      userId: user.id,
      codeChallenge: body.codeChallenge,
      redirectUri: body.redirectUri,
      clientName: body.clientName ?? null,
    });

    const redirect = new URL(body.redirectUri);
    redirect.searchParams.set('code', code);
    redirect.searchParams.set('state', body.state);
    return successResponse({ redirect: redirect.toString() });
  } catch (error) {
    if (error instanceof CliAuthError) return errorResponse(error.message, 400);
    return handleApiError(error);
  }
}
