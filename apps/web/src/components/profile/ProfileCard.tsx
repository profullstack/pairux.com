'use client';

import { useEffect, useState, useTransition } from 'react';
import { ProfileFields } from '@profullstack/profile/react';
import type { ProfileField } from '@profullstack/profile';

type Values = Partial<Record<ProfileField, string | null>>;
const FIELDS: ProfileField[] = [
  'email',
  'first_name',
  'last_name',
  'company_domain',
  'job_title',
  'linkedin_url',
];

// Profile fields shared across Profullstack properties, read and written
// through /api/v1/me/profile.
export function ProfileCard() {
  const [values, setValues] = useState<Values>({});
  const [errors, setErrors] = useState<Partial<Record<ProfileField, string>>>({});
  const [loaded, setLoaded] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  useEffect(() => {
    fetch('/api/v1/me/profile', { credentials: 'same-origin' })
      .then((r) => (r.ok ? (r.json() as Promise<{ profile?: Values }>) : null))
      .then((body) => {
        const p: Values = body?.profile ?? {};
        setValues(Object.fromEntries(FIELDS.map((k) => [k, p[k] ?? ''])) as Values);
      })
      .catch(() => {
        setError('Could not load your profile.');
      })
      .finally(() => {
        setLoaded(true);
      });
  }, []);

  return (
    <form
      className="rounded-xl border border-gray-200 bg-white p-6"
      onSubmit={(e) => {
        e.preventDefault();
        setSaved(false);
        setError(null);
        setErrors({});
        start(async () => {
          const r = await fetch('/api/v1/me/profile', {
            method: 'PATCH',
            credentials: 'same-origin',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify(values),
          });
          const body = (await r.json().catch(() => ({}))) as {
            error?: string;
            errors?: Partial<Record<ProfileField, string>>;
          };
          if (r.ok) setSaved(true);
          else {
            setErrors(body.errors ?? {});
            setError(body.error ?? 'Could not save.');
          }
        });
      }}
    >
      <h2 className="mb-4 font-semibold text-gray-900">Profile</h2>
      <ProfileFields
        idPrefix="settings-"
        values={values}
        onChange={setValues}
        errors={errors}
        disabled={!loaded}
      />
      {error && <p className="mt-3 text-sm text-red-600">{error}</p>}
      <div className="mt-4 flex items-center gap-3">
        <button
          type="submit"
          disabled={pending || !loaded}
          className="bg-primary-600 hover:bg-primary-700 rounded-lg px-4 py-2 text-sm font-medium text-white transition-colors disabled:opacity-50"
        >
          {pending ? 'Saving...' : 'Save profile'}
        </button>
        {saved && <span className="text-sm text-green-600">Saved.</span>}
      </div>
    </form>
  );
}
