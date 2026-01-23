'use client';

import { Eye, MousePointer2, Clock } from 'lucide-react';
import type { ControlStateUI } from '@pairux/shared-types';

interface ControlStatusIndicatorProps {
  controlState: ControlStateUI;
  className?: string;
}

const stateConfig: Record<
  ControlStateUI,
  { bg: string; text: string; icon: typeof Eye; label: string }
> = {
  'view-only': {
    bg: 'bg-gray-700/50',
    text: 'text-gray-400',
    icon: Eye,
    label: 'View Only',
  },
  requested: {
    bg: 'bg-yellow-900/50',
    text: 'text-yellow-400',
    icon: Clock,
    label: 'Pending',
  },
  granted: {
    bg: 'bg-green-900/50',
    text: 'text-green-400',
    icon: MousePointer2,
    label: 'Controlling',
  },
};

export function ControlStatusIndicator({
  controlState,
  className = '',
}: ControlStatusIndicatorProps) {
  const config = stateConfig[controlState];
  const Icon = config.icon;

  return (
    <div
      className={`flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium ${config.bg} ${config.text} ${className}`}
      title={`Control state: ${config.label}`}
    >
      <Icon className="h-3 w-3" />
      {config.label}
    </div>
  );
}
