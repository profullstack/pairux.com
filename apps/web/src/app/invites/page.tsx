import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { Header } from '@/components/header';
import { Footer } from '@/components/footer';
import { InvitesManager } from '@/components/credits/InvitesManager';
import { createClient } from '@/lib/supabase/server';

export const dynamic = 'force-dynamic';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('credits.invites');
  return { title: `${t('title')} - PairUX`, robots: { index: false, follow: false } };
}

export default async function InvitesPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect('/login?redirect=/invites');
  const t = await getTranslations('credits.invites');

  return (
    <div className="flex min-h-screen flex-col bg-gray-50">
      <Header />
      <main className="flex-1 py-10">
        <div className="mx-auto max-w-2xl px-4 sm:px-6">
          <h1 className="text-3xl font-bold text-gray-900">{t('title')}</h1>
          <p className="mt-2 mb-8 text-gray-600">{t('subtitle')}</p>
          <InvitesManager />
        </div>
      </main>
      <Footer />
    </div>
  );
}
