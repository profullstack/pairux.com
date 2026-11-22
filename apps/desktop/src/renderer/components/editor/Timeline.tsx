import { useCallback, useRef } from 'react';
import { formatTime, type KeepRange } from '@pairux/video-edit';
import { clamp, type Selection } from '@/lib/editorTimeline';
import { cn } from '@/lib/utils';

interface TimelineProps {
  duration: number;
  currentTime: number;
  keep: KeepRange[];
  selection: Selection | null;
  inMark: number | null;
  outMark: number | null;
  selectedSegment: number | null;
  onSeek: (t: number) => void;
  onSelectSegment: (index: number | null) => void;
}

function pct(t: number, duration: number): string {
  return `${String(duration > 0 ? clamp((t / duration) * 100, 0, 100) : 0)}%`;
}

/** Tick spacing that gives roughly ten labels across the track. */
function tickStep(duration: number): number {
  const steps = [1, 2, 5, 10, 15, 30, 60, 120, 300, 600, 900, 1800, 3600];
  return steps.find((s) => duration / s <= 12) ?? 3600;
}

export function Timeline({
  duration,
  currentTime,
  keep,
  selection,
  inMark,
  outMark,
  selectedSegment,
  onSeek,
  onSelectSegment,
}: TimelineProps) {
  const trackRef = useRef<HTMLDivElement>(null);
  const dragging = useRef(false);

  const timeAt = useCallback(
    (clientX: number) => {
      const el = trackRef.current;
      if (!el || duration <= 0) return 0;
      const rect = el.getBoundingClientRect();
      return clamp(((clientX - rect.left) / rect.width) * duration, 0, duration);
    },
    [duration]
  );

  const step = tickStep(duration);
  const ticks: number[] = [];
  for (let t = 0; t <= duration; t += step) ticks.push(t);

  return (
    <div className="select-none">
      <div className="relative mb-1 h-4 text-[10px] text-muted-foreground">
        {ticks.map((t) => (
          <span key={t} className="absolute -translate-x-1/2" style={{ left: pct(t, duration) }}>
            {formatTime(t, 0)}
          </span>
        ))}
      </div>
      <div
        ref={trackRef}
        role="slider"
        aria-label="Timeline"
        aria-valuemin={0}
        aria-valuemax={duration}
        aria-valuenow={currentTime}
        tabIndex={0}
        className="relative h-16 cursor-pointer overflow-hidden rounded-md border border-border bg-muted/60"
        onPointerDown={(e) => {
          dragging.current = true;
          e.currentTarget.setPointerCapture(e.pointerId);
          onSeek(timeAt(e.clientX));
        }}
        onPointerMove={(e) => {
          if (dragging.current) onSeek(timeAt(e.clientX));
        }}
        onPointerUp={(e) => {
          dragging.current = false;
          e.currentTarget.releasePointerCapture(e.pointerId);
        }}
      >
        {/* Cut-away footage reads as a hatched gap; kept footage as solid segments. */}
        <div
          className="absolute inset-0 opacity-40"
          style={{
            backgroundImage:
              'repeating-linear-gradient(135deg, transparent 0 6px, hsl(var(--border)) 6px 8px)',
          }}
        />
        {keep.map((r, i) => (
          <button
            key={`${String(r.start)}-${String(r.end)}`}
            type="button"
            title={`Kept ${formatTime(r.start)} – ${formatTime(r.end)} (click to select, Delete to remove)`}
            className={cn(
              'absolute inset-y-2 rounded-sm border bg-primary/70 transition-colors hover:bg-primary/85',
              selectedSegment === i ? 'border-foreground ring-2 ring-ring' : 'border-primary'
            )}
            style={{ left: pct(r.start, duration), width: pct(r.end - r.start, duration) }}
            onPointerDown={(e) => {
              e.stopPropagation();
              onSelectSegment(selectedSegment === i ? null : i);
              onSeek(timeAt(e.clientX));
            }}
          />
        ))}
        {selection && (
          <div
            className="pointer-events-none absolute inset-y-0 border-x-2 border-amber-400 bg-amber-400/25"
            style={{
              left: pct(selection.start, duration),
              width: pct(selection.end - selection.start, duration),
            }}
          />
        )}
        {inMark !== null && !selection && (
          <div
            className="pointer-events-none absolute inset-y-0 w-0.5 bg-amber-400"
            style={{ left: pct(inMark, duration) }}
          />
        )}
        {outMark !== null && !selection && (
          <div
            className="pointer-events-none absolute inset-y-0 w-0.5 bg-amber-400"
            style={{ left: pct(outMark, duration) }}
          />
        )}
        <div
          className="pointer-events-none absolute inset-y-0 w-0.5 bg-red-500 shadow-[0_0_0_1px_rgba(0,0,0,0.3)]"
          style={{ left: pct(currentTime, duration) }}
        >
          <div className="absolute -left-1.5 -top-0.5 h-2 w-3.5 rounded-sm bg-red-500" />
        </div>
      </div>
    </div>
  );
}
