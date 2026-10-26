import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { Header } from '@/components/header';
import { Footer } from '@/components/footer';
import { InviteLanding } from '@/components/credits/InviteLanding';
import { createClient } from '@/lib/supabase/server';
import { INVITE_COOKIE } from '@/lib/credits';

export const dynamic = 'force-dynamic';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('credits.landing');
  return { title: `${t('title')} - PairUX`, description: t('body'), robots: { index: false } };
}

/** /i/<code>: an invite link. Visiting it uses nothing up; joining does. */
export default async function InvitePage({ params }: { params: Promise<{ code: string }> }) {
  const { code: raw } = await params;
  const code = decodeURIComponent(raw).trim().slice(0, 64);
  let signedIn = false;
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    signedIn = Boolean(user);
  } catch {
    signedIn = false;
  }

  return (
    <div className="flex min-h-screen flex-col bg-gray-50">
      <Header />
      <main className="flex-1 px-4 py-16">
        <InviteLanding code={code} signedIn={signedIn} cookieName={INVITE_COOKIE} />
      </main>
      <Footer />
    </div>
  );
}
