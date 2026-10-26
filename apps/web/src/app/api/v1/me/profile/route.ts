import { createProfileHandlers } from '@profullstack/profile';
import { createClient, getAuthenticatedUser } from '@/lib/supabase/server';
import { profileStore } from '@/lib/profile';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// GET / PUT / PATCH /api/v1/me/profile: the signed-in user's profile fields.
const handlers = () =>
  createProfileHandlers({
    store: profileStore(),
    getUser: async () => {
      const supabase = await createClient();
      const { user } = await getAuthenticatedUser(supabase);
      return user ? { id: user.id, email: user.email ?? null } : null;
    },
  });

export const GET = (req: Request) => handlers().GET(req);
export const PUT = (req: Request) => handlers().PUT(req);
export const PATCH = (req: Request) => handlers().PATCH(req);
