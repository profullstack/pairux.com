/**
 * The video editor: trim a recording down to what matters, add an intro and
 * outro (title card, clip or image), fade in and out, export, and publish
 * privately to c0mpute.
 *
 * Opened from the File menu (Edit Video…), from "Edit recording" after a
 * recording stops (`/editor?path=…`), or by the web/mobile apps via
 * `pairux://edit?url=…` for a cloud recording (`/editor?url=…&title=…`).
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import {
  ArrowLeft,
  Check,
  Download,
  Film,
  FolderOpen,
  Loader2,
  Pause,
  Play,
  PlayCircle,
  Plus,
  Scissors,
  SkipBack,
  Trash2,
  X,
} from 'lucide-react';
import {
  formatTime,
  keptDuration,
  parseTime,
  validatePlan,
  type KeepRange,
  type MediaInfo,
} from '@pairux/video-edit';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ErrorBanner } from '@/components/ui/error-banner';
import { Timeline } from '@/components/editor/Timeline';
import { BumperPanel, FadeSlider } from '@/components/editor/BumperPanel';
import { PublishPanel } from '@/components/editor/PublishPanel';
import { getElectronAPI } from '@/lib/ipc';
import type { EditorRecordingFile } from '../../preload/api';
import {
  addToKept,
  applyOutMark,
  buildPlan,
  clamp,
  cutSelection,
  emptyBumper,
  formatBytes,
  keepOnly,
  marksToSelection,
  previewPosition,
  removeSegment,
  type BumperState,
} from '@/lib/editorTimeline';

interface OpenFile {
  sourcePath: string;
  editPath: string;
  url: string;
  info: MediaInfo;
  name: string;
}

interface ExportResult {
  output: string;
  duration: number;
  size: number;
}

const FRAME = 1 / 30;

function bumperLength(b: BumperState, probe: Record<string, number | null>): number {
  if (b.mode === 'title' || b.mode === 'image') return b.duration;
  if (b.mode === 'file' && b.source) return probe[b.source] ?? 0;
  return 0;
}

export function EditorPage() {
  const api = getElectronAPI();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const videoRef = useRef<HTMLVideoElement>(null);

  const [recordings, setRecordings] = useState<EditorRecordingFile[] | null>(null);
  const [file, setFile] = useState<OpenFile | null>(null);
  const [loading, setLoading] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [duration, setDuration] = useState(0);
  const [currentTime, setCurrentTime] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [previewKept, setPreviewKept] = useState(false);

  const [keep, setKeep] = useState<KeepRange[]>([]);
  const [inMark, setInMark] = useState<number | null>(null);
  const [outMark, setOutMark] = useState<number | null>(null);
  const [selectedSegment, setSelectedSegment] = useState<number | null>(null);
  const [fadeIn, setFadeIn] = useState(1);
  const [fadeOut, setFadeOut] = useState(1);
  const [intro, setIntro] = useState<BumperState>(() => emptyBumper(''));
  const [outro, setOutro] = useState<BumperState>(() => emptyBumper('Thanks for watching'));
  const [clipLengths, setClipLengths] = useState<Record<string, number | null>>({});

  const [format, setFormat] = useState<'mp4' | 'webm'>('mp4');
  const [quality, setQuality] = useState<'fast' | 'balanced' | 'high'>('balanced');
  const [exporting, setExporting] = useState(false);
  const [progress, setProgress] = useState(0);
  const [exported, setExported] = useState<ExportResult | null>(null);

  const selection = marksToSelection(inMark, outMark);

  // ---- Opening -------------------------------------------------------------
  const openPath = useCallback(
    async (path: string) => {
      setLoading('Opening…');
      setError(null);
      const r = await api.invoke('editor:open', { path });
      setLoading(null);
      if (!r.success) {
        setError(r.error);
        return;
      }
      const name = r.sourcePath.split(/[\\/]/).pop() ?? r.sourcePath;
      setFile({ sourcePath: r.sourcePath, editPath: r.editPath, url: r.url, info: r.info, name });
      setDuration(r.info.duration ?? 0);
      setKeep(r.info.duration ? [{ start: 0, end: r.info.duration }] : []);
      setInMark(null);
      setOutMark(null);
      setSelectedSegment(null);
      setExported(null);
      setCurrentTime(0);
      setIntro((b) => ({
        ...b,
        text: b.text || name.replace(/\.[^.]+$/, '').replace(/[-_]+/g, ' '),
      }));
    },
    [api]
  );

  useEffect(() => {
    void api.invoke('editor:listRecordings', undefined).then((r) => {
      setRecordings(r.files);
    });
  }, [api]);

  // Deep links and "Edit recording": ?path= opens a local file; ?url= first
  // downloads a cloud recording into the recordings folder.
  const handledParams = useRef<string | null>(null);
  useEffect(() => {
    const key = params.toString();
    if (!key || handledParams.current === key) return;
    handledParams.current = key;
    const path = params.get('path');
    const url = params.get('url');
    if (path) {
      void openPath(path);
    } else if (url) {
      void (async () => {
        setLoading('Downloading recording…');
        setError(null);
        const off = api.on('editor:downloadProgress', ({ received, total }) => {
          setLoading(
            total
              ? `Downloading recording… ${String(Math.round((received / total) * 100))}%`
              : `Downloading recording… ${formatBytes(received)}`
          );
        });
        const r = await api.invoke('editor:downloadCloud', { url, title: params.get('title') });
        off();
        setLoading(null);
        if (!r.success) setError(r.error);
        else await openPath(r.path);
      })();
    }
  }, [params, api, openPath]);

  // ---- Playback ------------------------------------------------------------
  useEffect(() => {
    const v = videoRef.current;
    if (!v || !playing) return;
    let raf = 0;
    const tick = () => {
      if (previewKept) {
        const target = previewPosition(keep, v.currentTime);
        if (target === null) {
          v.pause();
          setPreviewKept(false);
        } else if (Math.abs(target - v.currentTime) > 0.05) {
          v.currentTime = target;
        }
      }
      setCurrentTime(v.currentTime);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(raf);
    };
  }, [playing, previewKept, keep]);

  const seek = useCallback(
    (t: number) => {
      const v = videoRef.current;
      const target = clamp(t, 0, duration || 0);
      if (v) v.currentTime = target;
      setCurrentTime(target);
    },
    [duration]
  );

  const togglePlay = useCallback(() => {
    const v = videoRef.current;
    if (!v) return;
    if (v.paused) void v.play();
    else v.pause();
  }, []);

  const playKept = () => {
    const v = videoRef.current;
    if (!v || keep.length === 0) return;
    const first = keep[0];
    setPreviewKept(true);
    const pos = previewPosition(keep, v.currentTime);
    v.currentTime = pos ?? first.start;
    void v.play();
  };

  // ---- Marks and ranges ----------------------------------------------------
  const markIn = useCallback(() => {
    setInMark(currentTime);
    if (outMark !== null && outMark <= currentTime) setOutMark(null);
  }, [currentTime, outMark]);

  const markOut = useCallback(() => {
    const start = inMark ?? 0;
    const sel = marksToSelection(start, currentTime);
    if (inMark === null) setInMark(0);
    setOutMark(currentTime);
    if (sel) setKeep((k) => applyOutMark(k, duration, sel));
  }, [inMark, currentTime, duration]);

  const clearMarks = () => {
    setInMark(null);
    setOutMark(null);
  };

  const deleteSelectedSegment = useCallback(() => {
    if (selectedSegment === null) return;
    setKeep((k) => removeSegment(k, selectedSegment));
    setSelectedSegment(null);
  }, [selectedSegment]);

  // ---- Keyboard ------------------------------------------------------------
  useEffect(() => {
    if (!file) return;
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (
        target &&
        (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)
      )
        return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const big = e.shiftKey ? 10 : 1;
      switch (e.key) {
        case ' ':
          e.preventDefault();
          togglePlay();
          break;
        case 'i':
        case 'I':
          markIn();
          break;
        case 'o':
        case 'O':
          markOut();
          break;
        case 'ArrowLeft':
          e.preventDefault();
          seek(currentTime - big);
          break;
        case 'ArrowRight':
          e.preventDefault();
          seek(currentTime + big);
          break;
        case ',':
          seek(currentTime - FRAME);
          break;
        case '.':
          seek(currentTime + FRAME);
          break;
        case 'Home':
          seek(0);
          break;
        case 'End':
          seek(duration);
          break;
        case 'Delete':
        case 'Backspace':
          deleteSelectedSegment();
          break;
        case 'Escape':
          clearMarks();
          setSelectedSegment(null);
          break;
      }
    };
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
    };
  }, [file, togglePlay, markIn, markOut, seek, currentTime, duration, deleteSelectedSegment]);

  // Probe imported clips for their length (shown in the totals).
  useEffect(() => {
    for (const b of [intro, outro]) {
      if (b.mode !== 'file' || !b.source || b.source in clipLengths) continue;
      const src = b.source;
      setClipLengths((m) => ({ ...m, [src]: null }));
      void api.invoke('editor:probe', { path: src }).then((r) => {
        if (r.success) setClipLengths((m) => ({ ...m, [src]: r.info.duration }));
        else setError(`Can't use that clip: ${r.error}`);
      });
    }
  }, [intro, outro, clipLengths, api]);

  // ---- Export --------------------------------------------------------------
  const plan = useMemo(
    () => buildPlan({ keep, fadeIn, fadeOut, intro, outro, format }),
    [keep, fadeIn, fadeOut, intro, outro, format]
  );
  const planError = useMemo(() => {
    if (!file) return null;
    try {
      validatePlan(plan, duration || null);
      return null;
    } catch (e) {
      return e instanceof Error ? e.message : String(e);
    }
  }, [plan, duration, file]);

  const kept = keptDuration(keep);
  const total = kept + bumperLength(intro, clipLengths) + bumperLength(outro, clipLengths);

  useEffect(
    () =>
      api.on('editor:progress', (p) => {
        if (p.fraction !== null) setProgress(p.fraction);
      }),
    [api]
  );

  const runExport = async (saveAs: boolean) => {
    if (!file || planError) return;
    let output: string | null = null;
    if (saveAs) {
      const base = file.sourcePath.replace(/\.[^.]+$/, '');
      const picked = await api.invoke('editor:pickOutput', {
        format,
        suggested: `${base}-edit.${format}`,
      });
      if (!picked) return;
      output = picked.path;
    }
    videoRef.current?.pause();
    setExporting(true);
    setProgress(0);
    setError(null);
    setExported(null);
    const r = await api.invoke('editor:render', {
      plan,
      source: file.editPath,
      sourcePath: file.sourcePath,
      output,
      quality,
      sourceDuration: duration || null,
    });
    setExporting(false);
    if (r.success) {
      setExported({ output: r.output, duration: r.duration, size: r.size });
      void api.invoke('editor:listRecordings', undefined).then((l) => {
        setRecordings(l.files);
      });
    } else if (!r.cancelled) {
      setError(r.error);
    }
  };

  const setSelectionField = (which: 'in' | 'out', text: string) => {
    try {
      const t = clamp(parseTime(text), 0, duration);
      if (which === 'in') setInMark(t);
      else setOutMark(t);
    } catch {
      // Ignore half-typed values; the field shows what was last valid.
    }
  };

  // ---- Render --------------------------------------------------------------
  if (!file) {
    return (
      <div className="mx-auto flex w-full max-w-3xl flex-1 flex-col p-6">
        <div className="mb-4 flex items-center gap-3">
          <Button variant="ghost" size="icon" onClick={() => void navigate('/')} title="Back">
            <ArrowLeft />
          </Button>
          <div>
            <h1 className="text-xl font-semibold">Edit a video</h1>
            <p className="text-sm text-muted-foreground">
              Trim a recording to the part you need, add an intro and outro, and export.
            </p>
          </div>
        </div>
        {error && (
          <ErrorBanner
            message={error}
            onDismiss={() => {
              setError(null);
            }}
            className="mb-4"
          />
        )}
        {loading ? (
          <div className="flex flex-1 items-center justify-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-5 w-5 animate-spin" />
            {loading}
          </div>
        ) : (
          <>
            <Button
              variant="outline"
              className="mb-4 self-start"
              onClick={() =>
                void api.invoke('editor:pickFile', { kind: 'video' }).then((p) => {
                  if (p) void openPath(p.path);
                })
              }
            >
              <FolderOpen />
              Open file…
            </Button>
            <h2 className="mb-2 text-sm font-medium text-muted-foreground">Your recordings</h2>
            {recordings === null ? (
              <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
            ) : recordings.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                No recordings yet. Record from a session and it will show up here.
              </p>
            ) : (
              <ul className="divide-y divide-border overflow-hidden rounded-lg border border-border">
                {recordings.map((r) => (
                  <li key={r.path}>
                    <button
                      type="button"
                      onClick={() => void openPath(r.path)}
                      className="flex w-full items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-muted"
                    >
                      <Film className="h-4 w-4 shrink-0 text-muted-foreground" />
                      <span className="min-w-0 flex-1 truncate text-sm">{r.name}</span>
                      <span className="shrink-0 text-xs text-muted-foreground">
                        {formatBytes(r.size)} · {new Date(r.modifiedAt).toLocaleString()}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </>
        )}
      </div>
    );
  }

  return (
    <div className="flex flex-1 flex-col gap-4 p-4 lg:flex-row">
      <section className="flex min-w-0 flex-1 flex-col gap-3">
        <div className="flex items-center gap-2">
          <Button
            variant="ghost"
            size="icon"
            title="Choose another video"
            onClick={() => {
              videoRef.current?.pause();
              setFile(null);
              setParams({});
            }}
          >
            <ArrowLeft />
          </Button>
          <h1 className="min-w-0 flex-1 truncate text-sm font-semibold" title={file.sourcePath}>
            {file.name}
          </h1>
          <span className="text-xs text-muted-foreground">
            {formatTime(currentTime)} / {formatTime(duration)}
          </span>
        </div>

        {error && (
          <ErrorBanner
            message={error}
            onDismiss={() => {
              setError(null);
            }}
          />
        )}

        <div className="relative overflow-hidden rounded-lg bg-black">
          <video
            ref={videoRef}
            src={file.url}
            className="mx-auto max-h-[52vh] w-full"
            preload="auto"
            onLoadedMetadata={(e) => {
              const d = e.currentTarget.duration;
              if (Number.isFinite(d) && d > 0 && !duration) {
                setDuration(d);
                setKeep([{ start: 0, end: d }]);
              }
            }}
            onPlay={() => {
              setPlaying(true);
            }}
            onPause={() => {
              setPlaying(false);
              setPreviewKept(false);
            }}
            onSeeked={(e) => {
              setCurrentTime(e.currentTarget.currentTime);
            }}
            onClick={togglePlay}
          />
          {previewKept && (
            <span className="absolute left-3 top-3 rounded bg-primary px-2 py-0.5 text-xs font-medium text-primary-foreground">
              Previewing kept parts
            </span>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Button size="sm" variant="secondary" onClick={togglePlay} title="Play / pause (Space)">
            {playing ? <Pause /> : <Play />}
          </Button>
          <Button
            size="sm"
            variant="ghost"
            onClick={() => {
              seek(0);
            }}
            title="To start (Home)"
          >
            <SkipBack />
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={playKept}
            disabled={keep.length === 0}
            title="Play only what you're keeping"
          >
            <PlayCircle />
            Preview edit
          </Button>
          <div className="mx-1 h-6 w-px bg-border" />
          <Button size="sm" variant="outline" onClick={markIn} title="Mark in (I)">
            [ In <kbd className="text-[10px] text-muted-foreground">I</kbd>
          </Button>
          <Button size="sm" variant="outline" onClick={markOut} title="Mark out and keep (O)">
            Out ] <kbd className="text-[10px] text-muted-foreground">O</kbd>
          </Button>
          {selection && (
            <>
              <Button
                size="sm"
                variant="secondary"
                onClick={() => {
                  setKeep(keepOnly(selection));
                }}
                title="Keep only the selection"
              >
                <Check />
                Keep only this
              </Button>
              <Button
                size="sm"
                variant="secondary"
                onClick={() => {
                  setKeep((k) => addToKept(k, selection));
                }}
                title="Also keep the selection"
              >
                <Plus />
                Add
              </Button>
              <Button
                size="sm"
                variant="secondary"
                onClick={() => {
                  setKeep((k) => cutSelection(k, selection));
                }}
                title="Cut the selection out"
              >
                <Scissors />
                Cut out
              </Button>
              <Button size="sm" variant="ghost" onClick={clearMarks} title="Clear marks (Esc)">
                <X />
              </Button>
            </>
          )}
          {selectedSegment !== null && (
            <Button
              size="sm"
              variant="ghost"
              className="text-destructive"
              onClick={deleteSelectedSegment}
              title="Remove segment (Delete)"
            >
              <Trash2 />
              Remove segment
            </Button>
          )}
          <Button
            size="sm"
            variant="ghost"
            className="ml-auto"
            disabled={duration <= 0}
            onClick={() => {
              setKeep([{ start: 0, end: duration }]);
              clearMarks();
              setSelectedSegment(null);
            }}
            title="Keep the whole recording again"
          >
            Reset
          </Button>
        </div>

        {duration > 0 ? (
          <Timeline
            duration={duration}
            currentTime={currentTime}
            keep={keep}
            selection={selection}
            inMark={inMark}
            outMark={outMark}
            selectedSegment={selectedSegment}
            onSeek={seek}
            onSelectSegment={setSelectedSegment}
          />
        ) : (
          <p className="text-xs text-muted-foreground">Reading the recording…</p>
        )}

        <div className="flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
          <span>
            Selection
            <Input
              key={`in-${String(inMark)}`}
              defaultValue={inMark === null ? '' : formatTime(inMark)}
              placeholder="in"
              className="ml-2 inline-flex h-7 w-24 font-mono text-xs"
              onBlur={(e) => {
                setSelectionField('in', e.target.value);
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter') setSelectionField('in', e.currentTarget.value);
              }}
            />
            {' – '}
            <Input
              key={`out-${String(outMark)}`}
              defaultValue={outMark === null ? '' : formatTime(outMark)}
              placeholder="out"
              className="inline-flex h-7 w-24 font-mono text-xs"
              onBlur={(e) => {
                setSelectionField('out', e.target.value);
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter') setSelectionField('out', e.currentTarget.value);
              }}
            />
          </span>
          <span>
            Keeping <strong className="text-foreground">{formatTime(kept, 0)}</strong> in{' '}
            {keep.length} {keep.length === 1 ? 'part' : 'parts'} of {formatTime(duration, 0)}
          </span>
          <span className="hidden xl:inline">
            Keys: Space play · I/O mark · ←/→ 1s (Shift 10s) · , . frame · Del remove segment
          </span>
        </div>
      </section>

      <aside className="flex w-full shrink-0 flex-col gap-3 lg:w-80">
        <div className="rounded-lg border border-border bg-card p-3">
          <h3 className="mb-2 text-sm font-semibold">Fades</h3>
          <div className="space-y-1.5">
            <FadeSlider label="Fade in" value={fadeIn} onChange={setFadeIn} disabled={exporting} />
            <FadeSlider
              label="Fade out"
              value={fadeOut}
              onChange={setFadeOut}
              disabled={exporting}
            />
          </div>
        </div>
        <BumperPanel label="Intro" value={intro} onChange={setIntro} disabled={exporting} />
        <BumperPanel label="Outro" value={outro} onChange={setOutro} disabled={exporting} />

        <div className="rounded-lg border border-border bg-card p-3">
          <div className="mb-2 flex items-center justify-between">
            <h3 className="text-sm font-semibold">Export</h3>
            <span className="text-xs text-muted-foreground">{formatTime(total, 0)} long</span>
          </div>
          <div className="mb-3 flex gap-2">
            <select
              value={format}
              disabled={exporting}
              onChange={(e) => {
                setFormat(e.target.value as 'mp4' | 'webm');
              }}
              className="h-8 flex-1 rounded-md border border-input bg-background px-2 text-xs"
            >
              <option value="mp4">MP4 (H.264)</option>
              <option value="webm">WebM (VP9)</option>
            </select>
            <select
              value={quality}
              disabled={exporting}
              onChange={(e) => {
                setQuality(e.target.value as 'fast' | 'balanced' | 'high');
              }}
              className="h-8 flex-1 rounded-md border border-input bg-background px-2 text-xs"
            >
              <option value="fast">Fastest</option>
              <option value="balanced">Balanced</option>
              <option value="high">Smallest file</option>
            </select>
          </div>
          {exporting ? (
            <div className="space-y-2">
              <div className="h-2 overflow-hidden rounded-full bg-muted">
                <div
                  className="h-full bg-primary transition-[width]"
                  style={{ width: `${String(Math.round(progress * 100))}%` }}
                />
              </div>
              <div className="flex items-center justify-between text-xs text-muted-foreground">
                <span>Exporting… {Math.round(progress * 100)}%</span>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => void api.invoke('editor:cancelRender', undefined)}
                >
                  Cancel
                </Button>
              </div>
            </div>
          ) : (
            <div className="flex gap-2">
              <Button
                size="sm"
                className="flex-1"
                disabled={Boolean(planError)}
                onClick={() => void runExport(false)}
              >
                <Download />
                Export
              </Button>
              <Button
                size="sm"
                variant="outline"
                disabled={Boolean(planError)}
                onClick={() => void runExport(true)}
              >
                Save as…
              </Button>
            </div>
          )}
          {planError && <p className="mt-2 text-xs text-destructive">{planError}</p>}
          {exported && (
            <div className="mt-3 rounded-md bg-muted p-2 text-xs">
              <p className="mb-2 flex items-center gap-1 font-medium">
                <Check className="h-3.5 w-3.5 text-green-500" />
                Saved {formatTime(exported.duration, 0)} · {formatBytes(exported.size)}
              </p>
              <p className="mb-2 truncate text-muted-foreground" title={exported.output}>
                {exported.output}
              </p>
              <div className="flex gap-2">
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => void api.invoke('editor:openFile', { path: exported.output })}
                >
                  Open
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => void api.invoke('editor:showInFolder', { path: exported.output })}
                >
                  <FolderOpen />
                  Show in folder
                </Button>
              </div>
            </div>
          )}
        </div>

        {exported && <PublishPanel file={exported.output} />}
      </aside>
    </div>
  );
}
