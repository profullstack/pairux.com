import { Radio } from 'lucide-react';
import { formatDuration } from '@/hooks/useRTMPStreaming';

interface StreamIndicatorProps {
  activeCount: number;
  totalDuration: number;
}

export function StreamIndicator({ activeCount, totalDuration }: StreamIndicatorProps) {
  return (
    <div className="flex items-center gap-2 rounded-full bg-blue-600/90 px-3 py-1.5">
      <Radio className="h-3 w-3 animate-pulse text-white" />
      <span className="font-mono text-xs font-medium text-white">
        LIVE{activeCount > 1 ? ` (${String(activeCount)})` : ''} {formatDuration(totalDuration)}
      </span>
    </div>
  );
}
