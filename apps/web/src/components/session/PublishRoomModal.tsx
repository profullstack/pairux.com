'use client';

import { useState, useEffect, useCallback, type FormEvent } from 'react';
import Link from 'next/link';
import { X, Globe, Loader2, Check, Copy, ExternalLink, AtSign } from 'lucide-react';

interface Props {
  sessionId: string;
  /** Whether the room is currently public */
  initialIsPublic: boolean;
  initialSubject?: string | null;
  initialDescription?: string | null;
  onClose: () => void;
  /** Called after a successful publish/unpublish with the new public state */
  onSaved: (state: {
    isPublic: boolean;
    subject: string | null;
    description: string | null;
  }) => void;
}

interface ApiEnvelope<T> {
  data?: T;
  error?: string;
}

export function PublishRoomModal({
  sessionId,
  initialIsPublic,
  initialSubject,
  initialDescription,
  onClose,
  onSaved,
}: Props) {
  const [subject, setSubject] = useState(initialSubject ?? '');
  const [description, setDescription] = useState(initialDescription ?? '');
  const [isPublic, setIsPublic] = useState(initialIsPublic);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Username state (for the /u/<username> link shown after publishing)
  const [username, setUsername] = useState<string | null>(null);
  const [usernameInput, setUsernameInput] = useState('');
  const [savingUsername, setSavingUsername] = useState(false);
  const [usernameError, setUsernameError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  // Load the host's current username on open
  useEffect(() => {
    let cancelled = false;
    async function loadUsername() {
      try {
        const res = await fetch('/api/profile/username');
        if (!res.ok) return;
        const json = (await res.json()) as ApiEnvelope<{ username: string | null }>;
        if (!cancelled) setUsername(json.data?.username ?? null);
      } catch {
        // best-effort
      }
    }
    void loadUsername();
    return () => {
      cancelled = true;
    };
  }, []);

  const origin = typeof window !== 'undefined' ? window.location.origin : 'https://pairux.com';
  const profileUrl = username ? `${origin}/u/${username}` : null;

  const handlePublish = useCallback(
    async (e: FormEvent) => {
      e.preventDefault();
      setError(null);
      setIsSaving(true);
      try {
        const res = await fetch(`/api/sessions/${sessionId}/visibility`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            isPublic: true,
            subject: subject.trim(),
            description: description.trim() || undefined,
          }),
        });
        const json = (await res.json()) as ApiEnvelope<unknown>;
        if (!res.ok) {
          setError(json.error ?? 'Failed to publish room');
          return;
        }
        setIsPublic(true);
        onSaved({
          isPublic: true,
          subject: subject.trim(),
          description: description.trim() || null,
        });
      } catch {
        setError('Network error. Please try again.');
      } finally {
        setIsSaving(false);
      }
    },
    [sessionId, subject, description, onSaved]
  );

  const handleUnpublish = useCallback(async () => {
    setError(null);
    setIsSaving(true);
    try {
      const res = await fetch(`/api/sessions/${sessionId}/visibility`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ isPublic: false }),
      });
      const json = (await res.json()) as ApiEnvelope<unknown>;
      if (!res.ok) {
        setError(json.error ?? 'Failed to unpublish room');
        return;
      }
      setIsPublic(false);
      onSaved({
        isPublic: false,
        subject: subject.trim() || null,
        description: description.trim() || null,
      });
    } catch {
      setError('Network error. Please try again.');
    } finally {
      setIsSaving(false);
    }
  }, [sessionId, subject, description, onSaved]);

  const handleSaveUsername = useCallback(async () => {
    setUsernameError(null);
    setSavingUsername(true);
    try {
      const res = await fetch('/api/profile/username', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: usernameInput.trim() }),
      });
      const json = (await res.json()) as ApiEnvelope<{ username: string }>;
      if (!res.ok) {
        setUsernameError(json.error ?? 'Failed to save username');
        return;
      }
      setUsername(json.data?.username ?? usernameInput.trim());
    } catch {
      setUsernameError('Network error. Please try again.');
    } finally {
      setSavingUsername(false);
    }
  }, [usernameInput]);

  const copyProfileLink = useCallback(async () => {
    if (!profileUrl) return;
    try {
      await navigator.clipboard.writeText(profileUrl);
      setCopied(true);
      setTimeout(() => {
        setCopied(false);
      }, 2000);
    } catch {
      // ignore
    }
  }, [profileUrl]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 px-4">
      <div className="w-full max-w-lg rounded-2xl bg-white shadow-2xl">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-gray-100 px-6 py-4">
          <div className="flex items-center gap-2">
            <Globe className="h-5 w-5 text-indigo-600" />
            <h2 className="text-lg font-semibold text-gray-900">
              {isPublic ? 'Room is public' : 'Publish to /live'}
            </h2>
          </div>
          <button
            onClick={onClose}
            className="rounded-lg p-1.5 text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-600"
            aria-label="Close"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="space-y-5 px-6 py-5">
          {error && (
            <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
              {error}
            </div>
          )}

          {!isPublic ? (
            /* ---- Publish form ---- */
            <form onSubmit={(e) => void handlePublish(e)} className="space-y-5">
              <p className="text-sm text-gray-600">
                Listing your room on{' '}
                <span className="font-medium text-gray-900">pairux.com/live</span> lets anyone
                discover and join it — no invite link required.
              </p>

              <div>
                <label className="mb-1.5 block text-sm font-medium text-gray-700">
                  Subject <span className="text-red-500">*</span>
                </label>
                <input
                  type="text"
                  value={subject}
                  onChange={(e) => {
                    setSubject(e.target.value);
                  }}
                  placeholder="e.g. Building a Next.js app live"
                  required
                  minLength={3}
                  maxLength={120}
                  className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 focus:outline-none"
                />
              </div>

              <div>
                <label className="mb-1.5 block text-sm font-medium text-gray-700">
                  Description <span className="text-gray-400">(optional)</span>
                </label>
                <textarea
                  value={description}
                  onChange={(e) => {
                    setDescription(e.target.value);
                  }}
                  placeholder="What's happening in this room?"
                  rows={3}
                  maxLength={500}
                  className="w-full resize-none rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 focus:outline-none"
                />
              </div>

              <div className="flex items-center justify-end gap-3 pt-1">
                <button
                  type="button"
                  onClick={onClose}
                  className="rounded-lg px-4 py-2 text-sm font-medium text-gray-600 hover:bg-gray-100"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isSaving || subject.trim().length < 3}
                  className="flex items-center gap-2 rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-indigo-700 disabled:opacity-50"
                >
                  {isSaving ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <Globe className="h-4 w-4" />
                  )}
                  Publish
                </button>
              </div>
            </form>
          ) : (
            /* ---- Published: show links + username claim ---- */
            <div className="space-y-5">
              <div className="flex items-start gap-3 rounded-lg border border-green-200 bg-green-50 px-4 py-3">
                <Check className="mt-0.5 h-5 w-5 flex-shrink-0 text-green-600" />
                <div className="text-sm text-green-800">
                  Your room is live in the public directory.
                  <Link
                    href="/live"
                    target="_blank"
                    className="ml-1 inline-flex items-center gap-1 font-medium underline hover:text-green-900"
                  >
                    View /live <ExternalLink className="h-3 w-3" />
                  </Link>
                </div>
              </div>

              {/* Profile link / username claim */}
              <div>
                <p className="mb-1.5 text-sm font-medium text-gray-700">Your profile link</p>
                {profileUrl ? (
                  <div className="flex items-center gap-2 rounded-lg border border-gray-200 bg-gray-50 px-3 py-2">
                    <Link
                      href={`/u/${username ?? ''}`}
                      target="_blank"
                      className="flex-1 truncate text-sm text-indigo-600 hover:underline"
                    >
                      {profileUrl}
                    </Link>
                    <button
                      type="button"
                      onClick={() => void copyProfileLink()}
                      className="flex items-center gap-1 rounded-md bg-white px-2 py-1 text-xs font-medium text-gray-600 ring-1 ring-gray-200 hover:bg-gray-100"
                    >
                      {copied ? (
                        <>
                          <Check className="h-3.5 w-3.5 text-green-600" /> Copied
                        </>
                      ) : (
                        <>
                          <Copy className="h-3.5 w-3.5" /> Copy
                        </>
                      )}
                    </button>
                  </div>
                ) : (
                  <div className="rounded-lg border border-gray-200 bg-gray-50 p-3">
                    <p className="mb-2 text-xs text-gray-500">
                      Claim a username to get a shareable profile page at{' '}
                      <span className="font-mono">pairux.com/u/&lt;username&gt;</span>.
                    </p>
                    <div className="flex items-center gap-2">
                      <div className="flex flex-1 items-center rounded-lg border border-gray-300 bg-white px-2 focus-within:border-indigo-500 focus-within:ring-1 focus-within:ring-indigo-500">
                        <AtSign className="h-4 w-4 text-gray-400" />
                        <input
                          type="text"
                          value={usernameInput}
                          onChange={(e) => {
                            setUsernameInput(e.target.value);
                          }}
                          placeholder="username"
                          maxLength={30}
                          className="w-full bg-transparent px-1.5 py-2 text-sm focus:outline-none"
                        />
                      </div>
                      <button
                        type="button"
                        onClick={() => void handleSaveUsername()}
                        disabled={savingUsername || usernameInput.trim().length < 3}
                        className="flex items-center gap-1.5 rounded-lg bg-indigo-600 px-3 py-2 text-sm font-semibold text-white hover:bg-indigo-700 disabled:opacity-50"
                      >
                        {savingUsername && <Loader2 className="h-4 w-4 animate-spin" />}
                        Claim
                      </button>
                    </div>
                    {usernameError && (
                      <p className="mt-1.5 text-xs text-red-600">{usernameError}</p>
                    )}
                  </div>
                )}
              </div>

              <div className="flex items-center justify-between border-t border-gray-100 pt-4">
                <button
                  type="button"
                  onClick={() => void handleUnpublish()}
                  disabled={isSaving}
                  className="flex items-center gap-2 rounded-lg border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50"
                >
                  {isSaving && <Loader2 className="h-4 w-4 animate-spin" />}
                  Make private
                </button>
                <button
                  type="button"
                  onClick={onClose}
                  className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-700"
                >
                  Done
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
