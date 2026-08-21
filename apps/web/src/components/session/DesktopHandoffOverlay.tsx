'use client';

import Link from 'next/link';
import { Loader2, Monitor, Download } from 'lucide-react';
import type { HandoffState } from '@/hooks/useDesktopHandoff';

interface Props {
  state: HandoffState;
  onContinueInBrowser: () => void;
}

/**
 * Shown while a session is being handed to the desktop app.
 *
 * Two seconds of a page doing nothing reads as a broken button, and if the app
 * does open, this tab is left behind with no explanation — so say what is
 * happening, and keep the browser one click away.
 */
export function DesktopHandoffOverlay({ state, onContinueInBrowser }: Props) {
  if (state === 'idle') return null;

  const launched = state === 'launched';

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-gray-900/60 p-4">
      <div className="w-full max-w-sm rounded-xl bg-white p-6 text-center shadow-xl">
        <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-indigo-50">
          {launched ? (
            <Monitor className="h-6 w-6 text-indigo-600" />
          ) : (
            <Loader2 className="h-6 w-6 animate-spin text-indigo-600" />
          )}
        </div>

        <h2 className="mt-4 text-base font-semibold text-gray-900">
          {launched ? 'Opened in the desktop app' : 'Opening the PairUX desktop app…'}
        </h2>
        <p className="mt-1 text-sm text-gray-500">
          {launched
            ? 'Your meeting is running in the desktop app, where guests can be given control.'
            : 'The desktop app can share control of your screen. The browser can only show it.'}
        </p>

        <button
          type="button"
          onClick={onContinueInBrowser}
          className="mt-5 w-full rounded-lg border border-gray-200 px-4 py-2 text-sm font-medium text-gray-700 transition-colors hover:bg-gray-50"
        >
          Continue in this browser
        </button>

        <Link
          href="/download"
          className="mt-3 inline-flex items-center gap-1.5 text-xs font-medium text-indigo-600 hover:text-indigo-700"
        >
          <Download className="h-3.5 w-3.5" />
          Don&apos;t have the app? Download it
        </Link>
      </div>
    </div>
  );
}
