import { PlayCircle, Sparkles } from 'lucide-react';
import { useTranslations } from 'next-intl';
import type { CallAnalysisSettings, ReplayVisibility } from '@pairux/shared-types';

/**
 * Told to everyone in a call that is being recorded: AI call analysis (and by
 * whom), and/or a scheduled meeting whose replay goes on the host's channel
 * page. Shown for the whole call, not dismissable, because consent to being
 * recorded has to stay visible.
 */
export function RecordingNotice({
  settings,
}: {
  settings:
    | { analysis?: CallAnalysisSettings | undefined; replay?: ReplayVisibility | undefined }
    | null
    | undefined;
}) {
  const t = useTranslations('session.recordingNotice');
  const analysis = settings?.analysis?.enabled === true ? settings.analysis : null;
  const replay = settings?.replay;
  if (!analysis && !replay) return null;
  return (
    <>
      {replay && (
        <div
          role="status"
          data-testid="replay-notice"
          className="flex items-center justify-center gap-2 bg-red-900/70 px-4 py-1.5 text-center text-xs text-red-50"
        >
          <PlayCircle className="h-3.5 w-3.5 flex-shrink-0" aria-hidden="true" />
          {replay === 'public' ? t('replayPublic') : t('replayPrivate')}
        </div>
      )}
      {analysis && (
        <div
          role="status"
          data-testid="recording-notice"
          className="flex items-center justify-center gap-2 bg-violet-900/70 px-4 py-1.5 text-center text-xs text-violet-100"
        >
          <Sparkles className="h-3.5 w-3.5 flex-shrink-0" aria-hidden="true" />
          {analysis.keepRecording ? t('recordedKept') : t('recorded')}
        </div>
      )}
    </>
  );
}
