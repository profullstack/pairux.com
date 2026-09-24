import { Sparkles } from 'lucide-react';
import type { SessionSettings } from '@pairux/shared-types';

/**
 * Told to everyone in a call whose host turned on AI call analysis. Stays up
 * for the whole call: consent to being recorded has to remain visible.
 * (Web twin: apps/web/src/components/session/RecordingNotice.tsx.)
 */
export function RecordingNotice({ settings }: { settings: SessionSettings | null | undefined }) {
  const analysis = settings?.analysis;
  if (analysis?.enabled !== true) return null;
  return (
    <div
      role="status"
      data-testid="recording-notice"
      className="flex items-center gap-2 rounded-lg bg-violet-600/20 px-3 py-2 text-xs text-violet-200"
    >
      <Sparkles className="h-3.5 w-3.5 flex-shrink-0" />
      This call is being recorded for AI analysis by the host
      {analysis.keepRecording ? ', who will keep the recording' : ''}. Leave the call if you do not
      want to take part.
    </div>
  );
}
