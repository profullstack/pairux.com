/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/prefer-nullish-coalescing, @typescript-eslint/no-misused-promises */
'use client';

import { useState } from 'react';
import Link from 'next/link';
import { Mail, Loader2, AlertCircle, CheckCircle, ArrowLeft } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { trackPasswordReset } from '@/lib/analytics';

export function ForgotPasswordForm() {
  const t = useTranslations('auth');
  const [email, setEmail] = useState('');
  const [error, setError] = useState('');
  const [success, setSuccess] = useState(false);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    setLoading(true);

    try {
      const res = await fetch('/api/auth/forgot-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email }),
      });

      const data = await res.json();

      if (!res.ok) {
        setError(data.error || t('forgot.failed'));
        return;
      }

      trackPasswordReset();
      setSuccess(true);
    } catch {
      setError(t('errors.unexpected'));
    } finally {
      setLoading(false);
    }
  }

  if (success) {
    return (
      <div className="text-center">
        <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-green-100">
          <CheckCircle className="h-6 w-6 text-green-600" />
        </div>
        <h3 className="mt-4 text-lg font-semibold text-gray-900">{t('checkEmail')}</h3>
        <p className="mt-2 text-sm text-gray-600">
          {t.rich('forgot.sent', {
            email,
            strong: (chunks) => <strong>{chunks}</strong>,
          })}
        </p>
        <Link
          href="/login"
          className="text-primary-600 hover:text-primary-500 mt-6 inline-flex items-center gap-2 text-sm font-medium"
        >
          <ArrowLeft className="h-4 w-4" />
          {t('backToSignIn')}
        </Link>
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      {error && (
        <div className="flex items-center gap-2 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-600">
          <AlertCircle className="h-4 w-4 flex-shrink-0" />
          {error}
        </div>
      )}

      <div>
        <label htmlFor="email" className="block text-sm font-medium text-gray-700">
          {t('fields.email')}
        </label>
        <div className="relative mt-1">
          <div className="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-3">
            <Mail className="h-5 w-5 text-gray-400" />
          </div>
          <input
            id="email"
            type="email"
            value={email}
            onChange={(e) => {
              setEmail(e.target.value);
            }}
            required
            autoComplete="email"
            className="focus:border-primary-500 focus:ring-primary-500 block w-full rounded-lg border border-gray-300 py-2.5 pr-3 pl-10 text-gray-900 placeholder:text-gray-400 focus:ring-1 focus:outline-none"
            placeholder={t('fields.emailPlaceholder')}
          />
        </div>
      </div>

      <button
        type="submit"
        disabled={loading}
        className="bg-primary-600 hover:bg-primary-700 focus:ring-primary-500 flex w-full items-center justify-center gap-2 rounded-lg px-4 py-2.5 text-sm font-semibold text-white shadow transition-all focus:ring-2 focus:ring-offset-2 focus:outline-none disabled:cursor-not-allowed disabled:opacity-50"
      >
        {loading && <Loader2 className="h-4 w-4 animate-spin" />}
        {loading ? t('forgot.submitting') : t('forgot.submit')}
      </button>

      <Link
        href="/login"
        className="flex items-center justify-center gap-2 text-sm font-medium text-gray-600 hover:text-gray-500"
      >
        <ArrowLeft className="h-4 w-4" />
        {t('backToSignIn')}
      </Link>
    </form>
  );
}
