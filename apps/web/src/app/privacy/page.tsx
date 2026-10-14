import type { Metadata } from 'next';
import { useFormatter, useLocale, useTranslations } from 'next-intl';
import { getTranslations } from 'next-intl/server';
import { Header } from '@/components/header';
import { Footer } from '@/components/footer';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('legal.privacy');
  return { title: t('title'), description: t('description') };
}

/** Date this document was last revised (YYYY-MM), shown in the reader's language. */
const LAST_UPDATED = '2025-01';

export default function PrivacyPage() {
  const t = useTranslations('legal');
  const format = useFormatter();
  const locale = useLocale();
  return (
    <div className="flex min-h-screen flex-col">
      <Header />

      <main className="flex-1">
        <section className="gradient-bg py-20">
          <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
            <div className="text-center">
              <h1 className="text-4xl font-bold tracking-tight text-gray-900 sm:text-5xl">
                {t('privacy.title')}
              </h1>
              <p className="mx-auto mt-4 max-w-2xl text-lg text-gray-600">
                {t('lastUpdated', {
                  date: format.dateTime(new Date(`${LAST_UPDATED}-01T00:00:00Z`), {
                    month: 'long',
                    year: 'numeric',
                    timeZone: 'UTC',
                  }),
                })}
              </p>
            </div>
          </div>
        </section>

        <section className="py-20">
          <div className="mx-auto max-w-3xl px-4 sm:px-6 lg:px-8">
            {locale !== 'en' && (
              <p className="mb-8 rounded-lg bg-gray-50 p-4 text-sm text-gray-600">
                {t('englishOnly')}
              </p>
            )}
            <div lang="en" className="prose prose-lg max-w-none">
              <h2>Overview</h2>
              <p>
                PairUX is committed to protecting your privacy. This policy explains how we collect,
                use, and protect your information when you use our services.
              </p>

              <h2>Data We Collect</h2>
              <h3>Account Information</h3>
              <p>
                When you create an account, we collect your email address, name, and password
                (securely hashed). This information is used to authenticate you and provide our
                services.
              </p>

              <h3>Usage Data</h3>
              <p>
                We collect anonymized usage data to improve our services, including session
                duration, feature usage, and error reports. This data cannot be used to identify you
                personally.
              </p>

              <h3>Screen Sharing Sessions</h3>
              <p>
                Screen sharing data is transmitted in real-time using WebRTC and is end-to-end
                encrypted. We do not record, store, or have access to the content of your screen
                sharing sessions.
              </p>

              <h2>How We Use Your Data</h2>
              <ul>
                <li>To provide and maintain our services</li>
                <li>To notify you about changes to our services</li>
                <li>To provide customer support</li>
                <li>To improve our services through anonymized analytics</li>
                <li>To process payments (if applicable)</li>
              </ul>

              <h2>Data Security</h2>
              <p>
                We implement industry-standard security measures to protect your data, including:
              </p>
              <ul>
                <li>End-to-end encryption for all screen sharing sessions</li>
                <li>Secure password hashing using bcrypt</li>
                <li>HTTPS for all communications</li>
                <li>Regular security audits</li>
              </ul>

              <h2>Third-Party Services</h2>
              <p>
                We may use third-party services for authentication, payment processing, and
                analytics. These services have their own privacy policies governing the use of your
                information.
              </p>

              <h2>Your Rights</h2>
              <p>You have the right to:</p>
              <ul>
                <li>Access your personal data</li>
                <li>Correct inaccurate data</li>
                <li>Delete your account and associated data</li>
                <li>Export your data</li>
                <li>Opt out of marketing communications</li>
              </ul>

              <h2>Contact Us</h2>
              <p>
                If you have questions about this privacy policy, please contact us at{' '}
                <a href="mailto:privacy@pairux.com" className="text-primary-600 hover:underline">
                  privacy@pairux.com
                </a>
                .
              </p>
            </div>
          </div>
        </section>
      </main>

      <Footer />
    </div>
  );
}
