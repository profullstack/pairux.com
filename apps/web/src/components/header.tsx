import { createClient } from '@/lib/supabase/server';
import { HeaderClient } from './header-client';

export interface UserData {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
}

export async function Header() {
  let user: UserData | null = null;

  try {
    const supabase = await createClient();
    const {
      data: { user: supabaseUser },
    } = await supabase.auth.getUser();

    if (supabaseUser) {
      const metadata = supabaseUser.user_metadata as
        | { first_name?: string; last_name?: string }
        | undefined;
      user = {
        id: supabaseUser.id,
        email: supabaseUser.email ?? '',
        firstName: metadata?.first_name ?? '',
        lastName: metadata?.last_name ?? '',
      };
    }
  } catch {
    // If Supabase is not configured, user will be null
  }

  return <HeaderClient user={user} />;
}
