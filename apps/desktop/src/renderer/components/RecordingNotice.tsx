import { PlayCircle, Sparkles } from 'lucide-react';
import type { SessionSettings } from '@pairux/shared-types';

/**
 * Told to everyone in a call that is being recorded: AI call analysis, and/or a
 * scheduled meeting whose replay goes on the host's channel page. Stays up for
 * the whole call: consent to being recorded has to remain visible.
 * (Web twin: apps/web/src/components/session/RecordingNotice.tsx.)
 */
export function RecordingNotice({ settings }: { settings: SessionSettings | null | undefined }) {
  const analysis = settings?.analysis?.enabled === true ? settings.analysis : null;
  const replay = settings?.replay;
  if (!analysis && !replay) return null;
  return (
    <div className="flex flex-col gap-1.5">
      {replay && (
        <div
          role="status"
          data-testid="replay-notice"
          className="flex items-center gap-2 rounded-lg bg-red-600/20 px-3 py-2 text-xs text-red-100"
        >
          <PlayCircle className="h-3.5 w-3.5 flex-shrink-0" />
          {replay === 'public'
            ? 'This meeting is being recorded. The replay will be published on the host’s channel page after it ends.'
            : 'This meeting is being recorded. The host will keep the replay on their channel, visible only to them.'}{' '}
          Leave the call if you do not want to take part.
        </div>
      )}
      {analysis && (
        <div
          role="status"
          data-testid="recording-notice"
          className="flex items-center gap-2 rounded-lg bg-violet-600/20 px-3 py-2 text-xs text-violet-200"
        >
          <Sparkles className="h-3.5 w-3.5 flex-shrink-0" />
          This call is being recorded for AI analysis by the host
          {analysis.keepRecording ? ', who will keep the recording' : ''}. Leave the call if you do
          not want to take part.
        </div>
      )}
    </div>
  );
}
