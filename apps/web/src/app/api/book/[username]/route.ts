import { serviceClient } from '@/lib/supabase/service';
import { successResponse, errorResponse, handleApiError } from '@/lib/api';
import { findHostByUsername, listActivePages, publicHost, publicPage } from '@/lib/booking';

interface RouteParams {
  params: Promise<{ username: string }>;
}

/**
 * GET /api/book/[username] — a host's booking pages, for anyone.
 *
 * Anonymous by design: this is the link a host hands out. Only active pages
 * are shown, and only the fields a guest needs to pick one.
 */
export async function GET(_request: Request, { params }: RouteParams) {
  try {
    const { username } = await params;
    const svc = serviceClient();

    const host = await findHostByUsername(svc, username);
    if (!host) return errorResponse('No such user', 404);

    const pages = await listActivePages(svc, host.id);
    return successResponse({ host: publicHost(host), pages: pages.map(publicPage) });
  } catch (error) {
    return handleApiError(error);
  }
}
