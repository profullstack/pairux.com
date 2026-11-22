'use client';

import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { Check, Copy, KeyRound, Loader2, Lock, Upload } from 'lucide-react';
import {
  C0mputeStorageError,
  linkStatus,
  status as objectStatus,
  uploadSealed,
  type Identity,
} from '@profullstack/c0mpute-sealed';
import {
  disconnect,
  fetchRecording,
  loadToken,
  objectName,
  startConnect,
} from '@/lib/c0mpute-publish';
import { api, formatBytes, type RecordingItem } from '../../types';

/** Above this, warn that the tab holds the whole file while encrypting. */
const LARGE = 1.5 * 1024 ** 3;

type Stage =
  | { kind: 'idle' }
  | { kind: 'downloading'; pct: number }
  | { kind: 'hashing' | 'uploading'; pct: number }
  | { kind: 'publishing' }
  | { kind: 'done'; ref: string; link: string; copies: number; target: number }
  | { kind: 'error'; message: string };

function CopyButton({ value, label, done }: { value: string; label: string; done: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      onClick={() => {
        void navigator.clipboard.writeText(value).then(() => {
          setCopied(true);
          setTimeout(() => {
            setCopied(false);
          }, 1500);
        });
      }}
      className="inline-flex items-center gap-1 rounded-md border border-gray-300 px-2 py-1 text-xs hover:bg-gray-50 dark:border-gray-600 dark:hover:bg-gray-800"
    >
      {copied ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
      {copied ? done : label}
    </button>
  );
}

export function C0mputePublisher({ id, header }: { id: string; header: ReactNode }) {
  const t = useTranslations('recordings.publish');
  const [rec, setRec] = useState<RecordingItem | null>(null);
  const [loadError, setLoadError] = useState('');
  const [token, setToken] = useState<string | null>(null);
  const [ident, setIdent] = useState<Identity | { linked: false } | null>(null);
  const [identError, setIdentError] = useState('');
  const [stage, setStage] = useState<Stage>({ kind: 'idle' });
  const abort = useRef<AbortController | null>(null);

  useEffect(() => {
    setToken(loadToken());
    api<{ recording: RecordingItem }>(`/api/v1/recordings/${encodeURIComponent(id)}`)
      .then((d) => {
        setRec(d.recording);
      })
      .catch((e: unknown) => {
        setLoadError(e instanceof Error ? e.message : String(e));
      });
  }, [id]);

  const checkIdentity = useCallback(async () => {
    if (!token) return;
    setIdentError('');
    try {
      setIdent(await linkStatus({ token }));
    } catch (e) {
      if (e instanceof C0mputeStorageError && e.status === 401) {
        // Revoked or expired: connect again.
        disconnect();
        setToken(null);
        setIdent(null);
        return;
      }
      setIdentError(e instanceof Error ? e.message : String(e));
    }
  }, [token]);

  useEffect(() => {
    void checkIdentity();
  }, [checkIdentity]);

  const publish = async () => {
    if (!rec?.playback_url || !token) return;
    const controller = new AbortController();
    abort.current = controller;
    try {
      setStage({ kind: 'downloading', pct: 0 });
      const blob = await fetchRecording(
        rec.playback_url,
        (done, total) => {
          setStage({ kind: 'downloading', pct: total ? Math.round((done / total) * 100) : 0 });
        },
        controller.signal
      );
      const result = await uploadSealed(blob, {
        token,
        signal: controller.signal,
        fileName: objectName(rec.subject, rec.created_at),
        contentType: blob.type || 'video/mp4',
        onProgress: (p) => {
          if (p.phase === 'publishing') setStage({ kind: 'publishing' });
          else if (p.phase === 'hashing' || p.phase === 'uploading')
            setStage({ kind: p.phase, pct: p.total ? Math.round((p.done / p.total) * 100) : 0 });
        },
      });
      setStage({
        kind: 'done',
        ref: result.ref,
        link: result.link,
        copies: result.copies,
        target: 3,
      });
    } catch (e) {
      if (controller.signal.aborted) setStage({ kind: 'idle' });
      else setStage({ kind: 'error', message: e instanceof Error ? e.message : String(e) });
    } finally {
      abort.current = null;
    }
  };

  // Follow replication after publishing.
  const doneRef = stage.kind === 'done' ? stage.ref : null;
  useEffect(() => {
    if (!doneRef || !token) return;
    const timer = setInterval(() => {
      objectStatus(doneRef, { token })
        .then((s) => {
          setStage((prev) =>
            prev.kind === 'done' ? { ...prev, copies: s.copies, target: s.target } : prev
          );
          if (s.status === 'replicated') clearInterval(timer);
        })
        .catch(() => undefined);
    }, 10_000);
    return () => {
      clearInterval(timer);
    };
  }, [doneRef, token]);

  const busy =
    stage.kind === 'downloading' ||
    stage.kind === 'hashing' ||
    stage.kind === 'uploading' ||
    stage.kind === 'publishing';
  const linked = ident?.linked === true;

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-950">
      {header}
      <main className="mx-auto max-w-2xl px-4 py-10">
        <Link href="/recordings" className="text-sm text-blue-600 hover:underline">
          ← {t('back')}
        </Link>
        <h1 className="mt-3 flex items-center gap-2 text-2xl font-semibold text-gray-900 dark:text-white">
          <Lock className="h-6 w-6" aria-hidden="true" />
          {t('title')}
        </h1>
        <p className="mt-2 text-gray-600 dark:text-gray-300">{t('intro')}</p>

        {loadError && <p className="mt-6 text-red-600">{loadError}</p>}
        {!rec && !loadError && (
          <p className="mt-6 flex items-center gap-2 text-gray-500">
            <Loader2 className="h-4 w-4 animate-spin" /> {t('loading')}
          </p>
        )}

        {rec && (
          <div className="mt-6 space-y-6">
            <div className="rounded-lg border border-gray-200 bg-white p-4 dark:border-gray-800 dark:bg-gray-900">
              <p className="font-medium text-gray-900 dark:text-white">
                {rec.subject ?? objectName(null, rec.created_at)}
              </p>
              <p className="text-sm text-gray-500">{formatBytes(rec.size_bytes)}</p>
              {rec.status !== 'ready' && <p className="mt-2 text-amber-600">{t('notReady')}</p>}
            </div>

            <section className="rounded-lg border border-gray-200 bg-white p-4 dark:border-gray-800 dark:bg-gray-900">
              <h2 className="font-semibold text-gray-900 dark:text-white">{t('step1')}</h2>
              {token ? (
                <div className="mt-2 flex items-center gap-3 text-sm">
                  <span className="flex items-center gap-1 text-green-700 dark:text-green-400">
                    <Check className="h-4 w-4" /> {t('connected')}
                  </span>
                  <button
                    type="button"
                    className="text-gray-500 underline"
                    onClick={() => {
                      disconnect();
                      setToken(null);
                      setIdent(null);
                    }}
                  >
                    {t('disconnect')}
                  </button>
                </div>
              ) : (
                <>
                  <p className="mt-1 text-sm text-gray-600 dark:text-gray-300">{t('step1Body')}</p>
                  <button
                    type="button"
                    onClick={() => void startConnect(`/recordings/${id}/publish`)}
                    className="mt-3 inline-flex items-center gap-2 rounded-md bg-gray-900 px-4 py-2 text-sm font-medium text-white hover:bg-gray-800 dark:bg-white dark:text-gray-900"
                  >
                    <KeyRound className="h-4 w-4" /> {t('connect')}
                  </button>
                </>
              )}
            </section>

            {token && (
              <section className="rounded-lg border border-gray-200 bg-white p-4 dark:border-gray-800 dark:bg-gray-900">
                <h2 className="font-semibold text-gray-900 dark:text-white">{t('step2')}</h2>
                {identError && <p className="mt-2 text-sm text-red-600">{identError}</p>}
                {ident && !ident.linked && (
                  <div className="mt-2 text-sm text-gray-600 dark:text-gray-300">
                    <p>{t('notLinked')}</p>
                    <pre className="mt-2 overflow-x-auto rounded bg-gray-100 p-2 dark:bg-gray-800">
                      c0mpute storage key link
                    </pre>
                    <p className="mt-2">{t('notLinkedAfter')}</p>
                    <button
                      type="button"
                      onClick={() => void checkIdentity()}
                      className="mt-2 rounded-md border border-gray-300 px-3 py-1 dark:border-gray-600"
                    >
                      {t('checkAgain')}
                    </button>
                  </div>
                )}
                {linked && (
                  <p className="mt-2 text-sm break-all text-gray-600 dark:text-gray-300">
                    {t('linkedAs', {
                      identity: ident.fingerprint ?? `${ident.identity.slice(0, 20)}…`,
                    })}
                  </p>
                )}
              </section>
            )}

            {token && linked && rec.status === 'ready' && rec.playback_url && (
              <section className="rounded-lg border border-gray-200 bg-white p-4 dark:border-gray-800 dark:bg-gray-900">
                <h2 className="font-semibold text-gray-900 dark:text-white">{t('step3')}</h2>
                {(rec.size_bytes ?? 0) > LARGE && (
                  <p className="mt-2 text-sm text-amber-700 dark:text-amber-400">
                    {t('large', { size: formatBytes(rec.size_bytes) })}
                  </p>
                )}

                {stage.kind === 'idle' || stage.kind === 'error' ? (
                  <>
                    {stage.kind === 'error' && (
                      <p className="mt-2 text-sm text-red-600">
                        {t('error', { message: stage.message })}
                      </p>
                    )}
                    <button
                      type="button"
                      onClick={() => void publish()}
                      className="mt-3 inline-flex items-center gap-2 rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700"
                    >
                      <Upload className="h-4 w-4" /> {t('publish')}
                    </button>
                  </>
                ) : null}

                {busy && (
                  <div className="mt-3">
                    <p className="flex items-center gap-2 text-sm text-gray-700 dark:text-gray-200">
                      <Loader2 className="h-4 w-4 animate-spin" />
                      {stage.kind === 'downloading' && t('downloading', { percent: stage.pct })}
                      {stage.kind === 'hashing' && t('hashing', { percent: stage.pct })}
                      {stage.kind === 'uploading' && t('uploading', { percent: stage.pct })}
                      {stage.kind === 'publishing' && t('publishingStage')}
                    </p>
                    {'pct' in stage && (
                      <div className="mt-2 h-2 overflow-hidden rounded bg-gray-200 dark:bg-gray-800">
                        <div
                          className="h-full bg-blue-600"
                          style={{ width: `${String(stage.pct)}%` }}
                        />
                      </div>
                    )}
                    <button
                      type="button"
                      onClick={() => abort.current?.abort()}
                      className="mt-3 text-sm text-gray-500 underline"
                    >
                      {t('cancel')}
                    </button>
                  </div>
                )}

                {stage.kind === 'done' && (
                  <div className="mt-3 space-y-3 text-sm">
                    <p className="flex items-center gap-2 font-medium text-green-700 dark:text-green-400">
                      <Check className="h-4 w-4" /> {t('done')}
                    </p>
                    <div>
                      <p className="text-gray-600 dark:text-gray-300">{t('ref')}</p>
                      <div className="mt-1 flex items-center gap-2">
                        <code className="rounded bg-gray-100 px-2 py-1 break-all dark:bg-gray-800">
                          {stage.ref}
                        </code>
                        <CopyButton value={stage.ref} label={t('copy')} done={t('copied')} />
                      </div>
                      <p className="mt-1 text-gray-500">
                        {t('getHint')}{' '}
                        <code className="rounded bg-gray-100 px-1 dark:bg-gray-800">
                          c0mpute storage get {stage.ref} -o recording.mp4
                        </code>
                      </p>
                    </div>
                    <div>
                      <p className="text-gray-600 dark:text-gray-300">{t('link')}</p>
                      <div className="mt-1 flex items-center gap-2">
                        <code className="rounded bg-gray-100 px-2 py-1 break-all dark:bg-gray-800">
                          {stage.link}
                        </code>
                        <CopyButton value={stage.link} label={t('copy')} done={t('copied')} />
                      </div>
                      <p className="mt-1 text-amber-700 dark:text-amber-400">{t('linkWarn')}</p>
                    </div>
                    <p className="text-gray-500">
                      {t('replicating', { copies: stage.copies, target: stage.target })}
                    </p>
                  </div>
                )}
              </section>
            )}
          </div>
        )}
      </main>
    </div>
  );
}
