import type { Metadata } from 'next';
import { Header } from '@/components/header';
import { Footer } from '@/components/footer';

export const metadata: Metadata = {
  title: 'Terms of Service',
  description: 'PairUX terms of service and acceptable use policy.',
};

export default function TermsPage() {
  return (
    <div className="flex min-h-screen flex-col">
      <Header />

      <main className="flex-1">
        <section className="gradient-bg py-20">
          <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
            <div className="text-center">
              <h1 className="text-4xl font-bold tracking-tight text-gray-900 sm:text-5xl">
                Terms of Service
              </h1>
              <p className="mx-auto mt-4 max-w-2xl text-lg text-gray-600">
                Last updated: January 2025
              </p>
            </div>
          </div>
        </section>

        <section className="py-20">
          <div className="mx-auto max-w-3xl px-4 sm:px-6 lg:px-8">
            <div className="prose prose-lg max-w-none">
              <h2>1. Acceptance of Terms</h2>
              <p>
                By accessing or using PairUX, you agree to be bound by these Terms of Service. If
                you do not agree to these terms, please do not use our services.
              </p>

              <h2>2. Description of Service</h2>
              <p>
                PairUX provides collaborative screen sharing software with remote control
                capabilities. Our services include desktop applications, web-based viewers, and
                cloud infrastructure for relay connections.
              </p>

              <h2>3. User Accounts</h2>
              <p>
                To access certain features, you may need to create an account. You are responsible
                for maintaining the security of your account and for all activities that occur under
                your account.
              </p>

              <h2>4. Acceptable Use</h2>
              <p>You agree not to use PairUX to:</p>
              <ul>
                <li>Violate any applicable laws or regulations</li>
                <li>Infringe on the rights of others</li>
                <li>Transmit malware or other harmful code</li>
                <li>Attempt to gain unauthorized access to our systems</li>
                <li>Interfere with or disrupt our services</li>
                <li>Share content that is illegal, harmful, or offensive</li>
              </ul>

              <h2>5. Privacy</h2>
              <p>
                Your use of PairUX is subject to our Privacy Policy, which describes how we collect,
                use, and protect your information.
              </p>

              <h2>6. Intellectual Property</h2>
              <p>
                PairUX is open source software released under the MIT license. You may use, modify,
                and distribute the software in accordance with the license terms. The PairUX name
                and logo are trademarks and may not be used without permission.
              </p>

              <h2>7. Payment Terms</h2>
              <p>
                For paid services, you agree to pay all applicable fees. We may change our pricing
                at any time with reasonable notice. Refunds are provided at our discretion.
              </p>

              <h2>8. Disclaimer of Warranties</h2>
              <p>
                PairUX is provided &quot;as is&quot; without warranties of any kind. We do not
                guarantee that the service will be uninterrupted, secure, or error-free.
              </p>

              <h2>9. Limitation of Liability</h2>
              <p>
                To the maximum extent permitted by law, PairUX shall not be liable for any indirect,
                incidental, special, consequential, or punitive damages arising from your use of our
                services.
              </p>

              <h2>10. Changes to Terms</h2>
              <p>
                We may modify these terms at any time. Continued use of PairUX after changes
                constitutes acceptance of the new terms.
              </p>

              <h2>11. Contact</h2>
              <p>
                Questions about these terms? Contact us at{' '}
                <a href="mailto:legal@pairux.com" className="text-primary-600 hover:underline">
                  legal@pairux.com
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
