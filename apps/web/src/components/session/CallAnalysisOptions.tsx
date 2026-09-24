'use client';

import Link from 'next/link';
import { Sparkles } from 'lucide-react';
import type { CallAnalysisKind, CallAnalysisSettings } from '@pairux/shared-types';

export const ANALYSIS_KIND_LABELS: Record<CallAnalysisKind, string> = {
  general: 'General call',
  interview: 'Interview',
  'team-sync': 'Team sync',
  presentation: 'Presentation',
};

export const DEFAULT_ANALYSIS: CallAnalysisSettings = {
  enabled: false,
  kind: 'general',
  keepRecording: true,
};

/**
 * AI call analysis, chosen before the call starts. Turning it on turns
 * "Record the call" on with it; the host can switch recording back off and
 * still get the report (the audio is then deleted once the report is made).
 */
export function CallAnalysisOptions({
  value,
  onChange,
}: {
  value: CallAnalysisSettings;
  onChange: (next: CallAnalysisSettings) => void;
}) {
  return (
    <div
      className="rounded-lg border border-violet-200 bg-violet-50/60 p-4"
      data-testid="analysis-options"
    >
      <div className="flex items-start justify-between gap-3">
        <div>
          <label
            htmlFor="analysis-enabled"
            className="flex items-center gap-2 text-sm font-semibold text-gray-900"
          >
            <Sparkles className="h-4 w-4 text-violet-600" aria-hidden="true" />
            AI call analysis
            <span className="rounded-full bg-violet-600 px-1.5 py-0.5 text-[10px] font-bold tracking-wide text-white uppercase">
              Pro
            </span>
          </label>
          <p className="mt-1 text-xs text-gray-600">
            Get feedback after the call: talk time, pace, filler words, what landed and what to
            practice. Decide now; it cannot be switched on once the call starts.
          </p>
        </div>
        <button
          id="analysis-enabled"
          type="button"
          role="switch"
          aria-checked={value.enabled}
          onClick={() => {
            onChange(
              value.enabled
                ? { ...value, enabled: false }
                : { ...value, enabled: true, keepRecording: true }
            );
          }}
          className={`relative inline-flex h-6 w-11 flex-shrink-0 rounded-full border-2 border-transparent transition-colors ${
            value.enabled ? 'bg-violet-600' : 'bg-gray-300'
          }`}
        >
          <span className="sr-only">Analyze this call</span>
          <span
            className={`inline-block h-5 w-5 transform rounded-full bg-white shadow transition-transform ${
              value.enabled ? 'translate-x-5' : 'translate-x-0'
            }`}
          />
        </button>
      </div>

      {value.enabled && (
        <div className="mt-4 space-y-3">
          <label className="block text-sm text-gray-700">
            What kind of call is it?
            <select
              value={value.kind}
              onChange={(e) => {
                onChange({ ...value, kind: e.target.value as CallAnalysisKind });
              }}
              className="mt-1 w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-gray-900"
            >
              {(Object.keys(ANALYSIS_KIND_LABELS) as CallAnalysisKind[]).map((kind) => (
                <option key={kind} value={kind}>
                  {ANALYSIS_KIND_LABELS[kind]}
                </option>
              ))}
            </select>
          </label>
          <label className="flex items-center gap-2 text-sm text-gray-700">
            <input
              type="checkbox"
              checked={value.keepRecording}
              onChange={(e) => {
                onChange({ ...value, keepRecording: e.target.checked });
              }}
              className="h-4 w-4 rounded border-gray-300"
            />
            Record the call and keep the recording
          </label>
          <p className="text-xs text-gray-500">
            Everyone who joins is told the call is recorded for AI analysis. Reports are private to
            you.{' '}
            <Link href="/features/call-analysis" className="text-violet-700 hover:underline">
              How it works
            </Link>
          </p>
        </div>
      )}
    </div>
  );
}
