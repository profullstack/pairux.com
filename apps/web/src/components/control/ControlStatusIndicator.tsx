'use client';

import { Eye, MousePointer2, Clock } from 'lucide-react';
import { useTranslations } from 'next-intl';
import type { ControlStateUI } from '@pairux/shared-types';

interface ControlStatusIndicatorProps {
  controlState: ControlStateUI;
  className?: string;
}

const stateConfig: Record<
  ControlStateUI,
  { bg: string; text: string; icon: typeof Eye; label: 'viewOnly' | 'pending' | 'controlling' }
> = {
  'view-only': {
    bg: 'bg-gray-700/50',
    text: 'text-gray-400',
    icon: Eye,
    label: 'viewOnly',
  },
  requested: {
    bg: 'bg-yellow-900/50',
    text: 'text-yellow-400',
    icon: Clock,
    label: 'pending',
  },
  granted: {
    bg: 'bg-green-900/50',
    text: 'text-green-400',
    icon: MousePointer2,
    label: 'controlling',
  },
};

export function ControlStatusIndicator({
  controlState,
  className = '',
}: ControlStatusIndicatorProps) {
  const t = useTranslations('control.status');
  const config = stateConfig[controlState];
  const label = t(config.label);
  const Icon = config.icon;

  return (
    <div
      className={`flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium ${config.bg} ${config.text} ${className}`}
      title={t('title', { state: label })}
    >
      <Icon className="h-3 w-3" />
      {label}
    </div>
  );
}
