'use client';

import { useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { Monitor, Loader2, AlertCircle, ArrowRight, Shield, Settings } from 'lucide-react';
import type { ReactNode } from 'react';
import { useTranslations } from 'next-intl';
import { DesktopHandoffOverlay } from '@/components/session/DesktopHandoffOverlay';
import { useDesktopHandoff } from '@/hooks/useDesktopHandoff';
import { CallAnalysisOptions, DEFAULT_ANALYSIS } from '@/components/session/CallAnalysisOptions';
import { UpgradePrompt } from '@/components/billing/UpgradePrompt';
import { WorkspacePicker, useMyOrgs, type Workspace } from '@/components/orgs/WorkspacePicker';
import type { CallAnalysisSettings } from '@pairux/shared-types';

interface SessionData {
  id: string;
  join_code: string;
  status: string;
}

interface ApiResponse<T> {
  data?: T;
  error?: string;
}

export function StartHost({ header }: { header: ReactNode }) {
  const t = useTranslations('hostStart');
  const router = useRouter();
  const [isCreating, setIsCreating] = useState(false);
  const [error, setError] = useState('');
  const [needsPro, setNeedsPro] = useState(false);
  const [analysis, setAnalysis] = useState<CallAnalysisSettings>(DEFAULT_ANALYSIS);
  const orgs = useMyOrgs();
  const [workspace, setWorkspace] = useState<Workspace>({});
  // allowGuestControl is always false for web hosting (disabled)
  const allowGuestControl = false;
  // Guest control is exactly what the desktop app adds, so try it first and
  // only host in this tab if nothing answers.
  const {
    state: handoffState,
    openSession,
    continueInBrowser,
  } = useDesktopHandoff({
    navigate: (path) => {
      router.push(path);
    },
  });

  const createSession = useCallback(async () => {
    setIsCreating(true);
    setError('');
    setNeedsPro(false);

    try {
      const res = await fetch('/api/sessions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          allowGuestControl,
          ...(analysis.enabled ? { analysis } : {}),
          ...(workspace.orgId ? { orgId: workspace.orgId } : {}),
          ...(workspace.teamId ? { teamId: workspace.teamId } : {}),
        }),
      });

      const data = (await res.json()) as ApiResponse<SessionData>;

      if (!res.ok) {
        if (res.status === 401) {
          // Redirect to login
          router.push('/login?redirect=/host');
          return;
        }
        if (res.status === 403 && analysis.enabled) {
          // A Pro feature on a lower plan: the upgrade moment, not an error.
          setNeedsPro(true);
          return;
        }
        setError(data.error ?? t('createFailed'));
        return;
      }

      if (data.data) {
        // Hand off to the desktop app, falling back to the host session page.
        openSession(data.data.id);
      }
    } catch {
      setError(t('createFailedRetry'));
    } finally {
      setIsCreating(false);
    }
  }, [router, openSession, allowGuestControl, analysis, workspace, t]);

  return (
    <div className="flex min-h-screen flex-col bg-gray-50">
      {header}

      <DesktopHandoffOverlay state={handoffState} onContinueInBrowser={continueInBrowser} />

      <main className="flex flex-1 items-center justify-center px-4 py-12">
        <div className="w-full max-w-md">
          {/* Header */}
          <div className="mb-8 text-center">
            <div className="bg-primary-100 mx-auto flex h-16 w-16 items-center justify-center rounded-2xl">
              <Monitor className="text-primary-600 h-8 w-8" />
            </div>
            <h1 className="mt-4 text-2xl font-bold text-gray-900">{t('title')}</h1>
            <p className="mt-2 text-gray-600">{t('subtitle')}</p>
          </div>

          {/* Settings Card */}
          <div className="rounded-xl border border-gray-200 bg-white p-6 shadow-sm">
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-semibold text-gray-900">{t('sessionSettings')}</h2>
              <Link
                href="/settings"
                className="flex items-center gap-1 text-sm text-gray-500 hover:text-gray-700"
              >
                <Settings className="h-4 w-4" />
                {t('defaults')}
              </Link>
            </div>

            {/* AI call analysis needs Pro: name it, price it, one click to checkout */}
            {needsPro && (
              <div className="mt-4">
                <UpgradePrompt
                  reason="proFeature"
                  plan="pro"
                  returnTo="/host"
                  onDismiss={() => {
                    setNeedsPro(false);
                  }}
                />
              </div>
            )}

            {/* Error message */}
            {error && (
              <div className="mt-4 flex items-center gap-2 rounded-lg bg-red-50 p-3 text-sm text-red-600">
                <AlertCircle className="h-4 w-4 flex-shrink-0" />
                {error}
              </div>
            )}

            {/* Room size comes from your plan (Free: 2 participants + 20
                listeners); the server ignores any number sent from here. */}

            {/* Guest control toggle - disabled for web hosting */}
            <div className="mt-6">
              <label className="flex items-center gap-2 text-sm font-medium text-gray-700">
                <Shield className="h-4 w-4 text-gray-400" />
                {t('remoteControl')}
              </label>
              <div className="mt-2 flex items-center gap-3">
                <button
                  type="button"
                  disabled
                  className={`relative inline-flex h-6 w-11 flex-shrink-0 cursor-not-allowed rounded-full border-2 border-transparent bg-gray-200 transition-colors`}
                >
                  <span className="sr-only">{t('enableGuestControl')}</span>
                  <span
                    className={`inline-block h-5 w-5 translate-x-0 transform rounded-full bg-white shadow ring-0 transition-transform`}
                  />
                </button>
                <span className="text-sm text-gray-500">{t('notAvailableWeb')}</span>
              </div>
              <p className="mt-2 text-xs text-gray-400">
                {t.rich('remoteControlRequires', {
                  link: (chunks) => (
                    <Link href="/download" className="text-primary-600 hover:underline">
                      {chunks}
                    </Link>
                  ),
                })}
              </p>
            </div>

            {/* Workspace: a team call shares its analysis report with the team */}
            <WorkspacePicker
              orgs={orgs}
              value={workspace}
              onChange={setWorkspace}
              label={t('workspaceLabel')}
              className="mt-6 font-medium"
            />

            {/* AI call analysis: decided before the call starts */}
            <div className="mt-6">
              <CallAnalysisOptions value={analysis} onChange={setAnalysis} />
            </div>

            {/* Start button */}
            <button
              type="button"
              onClick={() => void createSession()}
              disabled={isCreating}
              className="bg-primary-600 hover:bg-primary-700 mt-8 flex w-full items-center justify-center gap-2 rounded-lg px-4 py-3 font-semibold text-white transition-colors disabled:cursor-not-allowed disabled:opacity-50"
            >
              {isCreating ? (
                <>
                  <Loader2 className="h-5 w-5 animate-spin" />
                  {t('creating')}
                </>
              ) : (
                <>
                  {t('startSharing')}
                  <ArrowRight className="h-5 w-5" />
                </>
              )}
            </button>
          </div>

          {/* Info note */}
          <div className="mt-6 rounded-lg border border-yellow-200 bg-yellow-50 p-4">
            <p className="text-sm text-yellow-800">
              {t.rich('viewOnlyNote', { strong: (chunks) => <strong>{chunks}</strong> })}
            </p>
          </div>

          {/* Link to join instead */}
          <p className="mt-6 text-center text-sm text-gray-500">
            {t.rich('joinInstead', {
              link: (chunks) => (
                <Link href="/join" className="text-primary-600 hover:underline">
                  {chunks}
                </Link>
              ),
            })}
          </p>
        </div>
      </main>
    </div>
  );
}
