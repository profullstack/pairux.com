'use client';

import { MousePointer2, Hand, Loader2 } from 'lucide-react';
import { useTranslations } from 'next-intl';
import type { ControlStateUI } from '@pairux/shared-types';

interface ControlRequestButtonProps {
  controlState: ControlStateUI;
  dataChannelReady: boolean;
  onRequestControl: () => void;
  onReleaseControl: () => void;
  className?: string;
}

export function ControlRequestButton({
  controlState,
  dataChannelReady,
  onRequestControl,
  onReleaseControl,
  className = '',
}: ControlRequestButtonProps) {
  const t = useTranslations('control.request');
  const isDisabled = !dataChannelReady;

  if (controlState === 'granted') {
    return (
      <button
        type="button"
        onClick={onReleaseControl}
        disabled={isDisabled}
        className={`flex items-center gap-2 rounded-lg bg-green-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-green-700 disabled:cursor-not-allowed disabled:opacity-50 ${className}`}
        title={t('releaseTitle')}
      >
        <MousePointer2 className="h-4 w-4" />
        <span>{t('inControl')}</span>
      </button>
    );
  }

  if (controlState === 'requested') {
    return (
      <button
        type="button"
        disabled
        className={`flex items-center gap-2 rounded-lg bg-yellow-600 px-4 py-2 text-sm font-medium text-white ${className}`}
        title={t('waitingApproval')}
      >
        <Loader2 className="h-4 w-4 animate-spin" />
        <span>{t('requesting')}</span>
      </button>
    );
  }

  // view-only state
  return (
    <button
      type="button"
      onClick={onRequestControl}
      disabled={isDisabled}
      className={`flex items-center gap-2 rounded-lg bg-gray-700 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-gray-600 disabled:cursor-not-allowed disabled:opacity-50 ${className}`}
      title={isDisabled ? t('waitingConnection') : t('requestTitle')}
    >
      <Hand className="h-4 w-4" />
      <span>{t('requestControl')}</span>
    </button>
  );
}
