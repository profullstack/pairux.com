import { Sparkles } from 'lucide-react';
import type { CallAnalysisSettings } from '@pairux/shared-types';

/**
 * Told to everyone in a call whose host turned on AI call analysis: the call
 * is recorded and analysed, and by whom. Shown for the whole call, not
 * dismissable, because consent to being recorded has to stay visible.
 */
export function RecordingNotice({
  settings,
}: {
  settings: { analysis?: CallAnalysisSettings | undefined } | null | undefined;
}) {
  const analysis = settings?.analysis;
  if (analysis?.enabled !== true) return null;
  return (
    <div
      role="status"
      data-testid="recording-notice"
      className="flex items-center justify-center gap-2 bg-violet-900/70 px-4 py-1.5 text-center text-xs text-violet-100"
    >
      <Sparkles className="h-3.5 w-3.5 flex-shrink-0" aria-hidden="true" />
      This call is being recorded for AI analysis by the host
      {analysis.keepRecording ? ', who will keep the recording' : ''}. Leave the call if you do not
      want to take part.
    </div>
  );
}
