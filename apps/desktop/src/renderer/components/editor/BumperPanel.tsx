import { FileVideo, Image as ImageIcon, Type, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { getElectronAPI } from '@/lib/ipc';
import type { BumperMode, BumperState } from '@/lib/editorTimeline';
import { cn } from '@/lib/utils';

interface BumperPanelProps {
  label: 'Intro' | 'Outro';
  value: BumperState;
  onChange: (next: BumperState) => void;
  disabled?: boolean;
}

const MODES: { mode: BumperMode; label: string }[] = [
  { mode: 'none', label: 'None' },
  { mode: 'title', label: 'Title card' },
  { mode: 'file', label: 'Clip' },
  { mode: 'image', label: 'Image' },
];

export function FadeSlider({
  label,
  value,
  onChange,
  max = 5,
  disabled,
}: {
  label: string;
  value: number;
  onChange: (v: number) => void;
  max?: number;
  disabled?: boolean;
}) {
  return (
    <label className="flex items-center gap-2 text-xs text-muted-foreground">
      <span className="w-16 shrink-0">{label}</span>
      <input
        type="range"
        min={0}
        max={max}
        step={0.25}
        value={value}
        disabled={disabled}
        onChange={(e) => {
          onChange(Number(e.target.value));
        }}
        className="flex-1 accent-primary"
      />
      <span className="w-10 text-right font-mono">
        {value.toFixed(2).replace(/\.?0+$/, '') || '0'}s
      </span>
    </label>
  );
}

export function BumperPanel({ label, value, onChange, disabled }: BumperPanelProps) {
  const set = (patch: Partial<BumperState>) => {
    onChange({ ...value, ...patch });
  };

  const pick = async (kind: 'video' | 'image') => {
    const picked = await getElectronAPI().invoke('editor:pickFile', { kind });
    if (picked)
      set({ source: picked.path, sourceName: picked.path.split(/[\\/]/).pop() ?? picked.path });
  };

  return (
    <div className="rounded-lg border border-border bg-card p-3">
      <div className="mb-2 flex items-center justify-between">
        <h3 className="text-sm font-semibold">{label}</h3>
        <div className="flex rounded-md bg-muted p-0.5">
          {MODES.map((m) => (
            <button
              key={m.mode}
              type="button"
              disabled={disabled}
              onClick={() => {
                set({ mode: m.mode });
              }}
              className={cn(
                'rounded px-2 py-1 text-xs transition-colors',
                value.mode === m.mode
                  ? 'bg-background font-medium shadow-sm'
                  : 'text-muted-foreground hover:text-foreground'
              )}
            >
              {m.label}
            </button>
          ))}
        </div>
      </div>

      {value.mode === 'title' && (
        <div className="space-y-2">
          <div
            className="flex aspect-video w-full flex-col items-center justify-center rounded-md px-3 text-center"
            style={{ background: value.background, color: value.color }}
          >
            <Type className="mb-1 h-3 w-3 opacity-40" />
            <p className="text-sm font-semibold leading-tight">{value.text || 'Title'}</p>
            {value.subtitle && <p className="mt-1 text-[10px] opacity-75">{value.subtitle}</p>}
          </div>
          <Input
            value={value.text}
            maxLength={120}
            placeholder="Title"
            disabled={disabled}
            onChange={(e) => {
              set({ text: e.target.value });
            }}
          />
          <Input
            value={value.subtitle}
            maxLength={120}
            placeholder="Subtitle (optional)"
            disabled={disabled}
            onChange={(e) => {
              set({ subtitle: e.target.value });
            }}
          />
          <div className="flex items-center gap-3 text-xs text-muted-foreground">
            <label className="flex items-center gap-1">
              Background
              <input
                type="color"
                value={value.background}
                disabled={disabled}
                onChange={(e) => {
                  set({ background: e.target.value });
                }}
                className="h-6 w-8 cursor-pointer rounded border border-border bg-transparent"
              />
            </label>
            <label className="flex items-center gap-1">
              Text
              <input
                type="color"
                value={value.color}
                disabled={disabled}
                onChange={(e) => {
                  set({ color: e.target.value });
                }}
                className="h-6 w-8 cursor-pointer rounded border border-border bg-transparent"
              />
            </label>
          </div>
        </div>
      )}

      {(value.mode === 'file' || value.mode === 'image') && (
        <div className="flex items-center gap-2">
          <Button
            size="sm"
            variant="outline"
            disabled={disabled}
            onClick={() => void pick(value.mode === 'image' ? 'image' : 'video')}
          >
            {value.mode === 'image' ? <ImageIcon /> : <FileVideo />}
            {value.source ? 'Change…' : value.mode === 'image' ? 'Choose image…' : 'Import clip…'}
          </Button>
          {value.sourceName && (
            <span className="flex min-w-0 items-center gap-1 text-xs text-muted-foreground">
              <span className="truncate">{value.sourceName}</span>
              <button
                type="button"
                title="Remove"
                onClick={() => {
                  set({ source: null, sourceName: null });
                }}
              >
                <X className="h-3 w-3" />
              </button>
            </span>
          )}
        </div>
      )}

      {value.mode !== 'none' && (
        <div className="mt-3 space-y-1.5">
          {(value.mode === 'title' || value.mode === 'image') && (
            <FadeSlider
              label="Length"
              value={value.duration}
              max={15}
              disabled={disabled}
              onChange={(v) => {
                set({ duration: Math.max(0.5, v) });
              }}
            />
          )}
          <FadeSlider
            label="Fade in"
            value={value.fadeIn}
            disabled={disabled}
            onChange={(v) => {
              set({ fadeIn: v });
            }}
          />
          <FadeSlider
            label="Fade out"
            value={value.fadeOut}
            disabled={disabled}
            onChange={(v) => {
              set({ fadeOut: v });
            }}
          />
        </div>
      )}
    </div>
  );
}
