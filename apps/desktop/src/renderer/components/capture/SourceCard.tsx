import { Monitor, AppWindow } from 'lucide-react';
import type { CaptureSource } from '@pairux/shared-types';

interface SourceCardProps {
  source: CaptureSource;
  onSelect: (source: CaptureSource) => void;
}

export function SourceCard({ source, onSelect }: SourceCardProps) {
  const isScreen = source.type === 'screen';

  return (
    <button
      onClick={() => { onSelect(source); }}
      className="group flex flex-col overflow-hidden rounded-lg border border-border bg-card transition-all hover:border-primary hover:ring-2 hover:ring-primary/20"
    >
      {/* Thumbnail */}
      <div className="relative aspect-video w-full overflow-hidden bg-muted">
        {source.thumbnail ? (
          <img
            src={source.thumbnail}
            alt={source.name}
            className="h-full w-full object-cover transition-transform group-hover:scale-105"
          />
        ) : (
          <div className="flex h-full items-center justify-center">
            {isScreen ? (
              <Monitor className="h-12 w-12 text-muted-foreground" />
            ) : (
              <AppWindow className="h-12 w-12 text-muted-foreground" />
            )}
          </div>
        )}

        {/* Overlay on hover */}
        <div className="absolute inset-0 flex items-center justify-center bg-black/50 opacity-0 transition-opacity group-hover:opacity-100">
          <span className="rounded-full bg-primary px-4 py-2 text-sm font-medium text-primary-foreground">
            Select
          </span>
        </div>
      </div>

      {/* Name */}
      <div className="flex items-center gap-2 p-3">
        {isScreen ? (
          <Monitor className="h-4 w-4 shrink-0 text-muted-foreground" />
        ) : (
          <AppWindow className="h-4 w-4 shrink-0 text-muted-foreground" />
        )}
        <span className="truncate text-sm font-medium">{source.name}</span>
      </div>
    </button>
  );
}
