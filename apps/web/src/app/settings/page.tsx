import type { Metadata } from 'next';
import { createClient } from '@/lib/supabase/server';
import type { UserData } from '@/components/header';
import { SettingsContent } from './settings-content';

export const metadata: Metadata = {
  title: 'Settings - PairUX',
  description: 'Manage your PairUX settings.',
};

export const dynamic = 'force-dynamic';

export default async function SettingsPage() {
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
    // Supabase not configured — user stays null
  }

  return <SettingsContent user={user} />;
}
