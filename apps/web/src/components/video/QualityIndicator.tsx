'use client';

'use client';

import { useState } from 'react';
import {
  type LucideIcon,
  SignalHigh,
  SignalMedium,
  SignalLow,
  SignalZero,
  ChevronUp,
  ChevronDown,
} from 'lucide-react';
import type { QualityMetrics, NetworkQuality } from '@pairux/shared-types';

interface QualityIndicatorProps {
  metrics: QualityMetrics | null;
  networkQuality: NetworkQuality;
}

const qualityConfig: Record<NetworkQuality, { icon: LucideIcon; color: string; label: string }> = {
  excellent: {
    icon: SignalHigh,
    color: 'text-green-400',
    label: 'Excellent',
  },
  good: {
    icon: SignalMedium,
    color: 'text-green-400',
    label: 'Good',
  },
  poor: {
    icon: SignalLow,
    color: 'text-yellow-400',
    label: 'Poor',
  },
  bad: {
    icon: SignalZero,
    color: 'text-red-400',
    label: 'Bad',
  },
};

function formatBitrate(bitrate: number): string {
  if (bitrate >= 1_000_000) {
    return `${(bitrate / 1_000_000).toFixed(1)} Mbps`;
  }
  if (bitrate >= 1_000) {
    return `${(bitrate / 1_000).toFixed(0)} Kbps`;
  }
  return `${String(bitrate)} bps`;
}

export function QualityIndicator({ metrics, networkQuality }: QualityIndicatorProps) {
  const [isExpanded, setIsExpanded] = useState(false);
  const config = qualityConfig[networkQuality];
  const Icon = config.icon;

  return (
    <div className="relative">
      {/* Collapsed view - just icon */}
      <button
        type="button"
        onClick={() => {
          setIsExpanded(!isExpanded);
        }}
        className={`flex items-center gap-1.5 rounded-lg bg-white/10 px-2 py-1.5 text-sm transition-colors hover:bg-white/20 ${config.color}`}
        title={`Connection: ${config.label}`}
      >
        <Icon className="h-4 w-4" />
        <span className="text-white/80">{config.label}</span>
        {isExpanded ? (
          <ChevronDown className="h-3 w-3 text-white/60" />
        ) : (
          <ChevronUp className="h-3 w-3 text-white/60" />
        )}
      </button>

      {/* Expanded view - detailed metrics */}
      {isExpanded && metrics && (
        <div className="absolute bottom-full left-0 mb-2 min-w-48 rounded-lg bg-gray-900/95 p-3 text-sm shadow-lg">
          <div className="mb-2 border-b border-gray-700 pb-2 text-xs font-semibold tracking-wide text-gray-400 uppercase">
            Connection Details
          </div>
          <div className="space-y-1.5">
            <MetricRow label="Quality" value={config.label} valueColor={config.color} />
            <MetricRow label="Bitrate" value={formatBitrate(metrics.bitrate)} />
            <MetricRow label="Frame Rate" value={`${metrics.frameRate.toFixed(0)} fps`} />
            <MetricRow
              label="Latency"
              value={`${metrics.roundTripTime.toFixed(0)} ms`}
              valueColor={
                metrics.roundTripTime < 50
                  ? 'text-green-400'
                  : metrics.roundTripTime < 150
                    ? 'text-yellow-400'
                    : 'text-red-400'
              }
            />
            <MetricRow
              label="Packet Loss"
              value={`${metrics.packetLoss.toFixed(1)}%`}
              valueColor={
                metrics.packetLoss < 1
                  ? 'text-green-400'
                  : metrics.packetLoss < 5
                    ? 'text-yellow-400'
                    : 'text-red-400'
              }
            />
          </div>
        </div>
      )}
    </div>
  );
}

function MetricRow({
  label,
  value,
  valueColor = 'text-white',
}: {
  label: string;
  value: string;
  valueColor?: string;
}) {
  return (
    <div className="flex items-center justify-between gap-4">
      <span className="text-gray-400">{label}</span>
      <span className={`font-medium ${valueColor}`}>{value}</span>
    </div>
  );
}
