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
      onClick={() => {
        onSelect(source);
      }}
      className="group rounded-lg border-border bg-card hover:border-primary hover:ring-primary/20 flex flex-col overflow-hidden border transition-all hover:ring-2"
    >
      {/* Thumbnail */}
      <div className="aspect-video bg-muted relative w-full overflow-hidden">
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
        <div className="inset-0 bg-black/50 absolute flex items-center justify-center opacity-0 transition-opacity group-hover:opacity-100">
          <span className="bg-primary px-4 py-2 text-sm font-medium text-primary-foreground rounded-full">
            Select
          </span>
        </div>
      </div>

      {/* Name */}
      <div className="gap-2 p-3 flex items-center">
        {isScreen ? (
          <Monitor className="h-4 w-4 text-muted-foreground shrink-0" />
        ) : (
          <AppWindow className="h-4 w-4 text-muted-foreground shrink-0" />
        )}
        <span className="text-sm font-medium truncate">{source.name}</span>
      </div>
    </button>
  );
}
