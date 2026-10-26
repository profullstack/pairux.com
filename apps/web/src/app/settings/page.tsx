import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { createClient } from '@/lib/supabase/server';
import type { UserData } from '@/components/header';
import { Footer } from '@/components/footer';
import { SettingsContent } from './settings-content';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('settings.meta');
  return {
    title: t('title'),
    description: t('description'),
  };
}

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
        { first_name?: string; last_name?: string } | undefined;
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

  return <SettingsContent user={user} footer={<Footer />} />;
}
