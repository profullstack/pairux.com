'use client';

import { useEffect, useRef, useState } from 'react';
import type { ChatMessage } from '@pairux/shared-types';

const STORAGE_KEY = 'pairux.chat.translateTo';

/** The reader's chat language ('' = off), remembered per browser. */
export function useChatTranslateTo(): [string, (to: string) => void] {
  const [to, setTo] = useState('');
  useEffect(() => {
    try {
      setTo(localStorage.getItem(STORAGE_KEY) ?? '');
    } catch {
      /* storage blocked: stay off */
    }
  }, []);
  const choose = (next: string) => {
    setTo(next);
    try {
      if (next) localStorage.setItem(STORAGE_KEY, next);
      else localStorage.removeItem(STORAGE_KEY);
    } catch {
      /* storage blocked: the choice lasts this page */
    }
  };
  return [to, choose];
}

/**
 * Other people's chat messages in the reader's language. Returns message id →
 * translated text; untranslated (or own/system) messages are absent. Asks the
 * server in batches; the server caches per text and language for everyone.
 */
export function useChatTranslation({
  sessionId,
  participantId,
  messages,
  to,
  isOwn,
}: {
  sessionId: string;
  participantId?: string | undefined;
  messages: ChatMessage[];
  to: string;
  isOwn: (message: ChatMessage) => boolean;
}): { translated: Map<string, string>; error: string | null } {
  const cache = useRef(new Map<string, Map<string, string>>());
  const inFlight = useRef(new Set<string>());
  const [, setVersion] = useState(0);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!to) return;
    const done = cache.current.get(to) ?? new Map<string, string>();
    cache.current.set(to, done);
    const wanted = messages
      .filter((message) => message.message_type !== 'system' && !isOwn(message))
      .filter((message) => !done.has(message.id) && !inFlight.current.has(`${to}|${message.id}`))
      .slice(-50);
    if (!wanted.length) return;
    wanted.forEach((message) => inFlight.current.add(`${to}|${message.id}`));
    void (async () => {
      try {
        const response = await fetch('/api/chat/translate', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            sessionId,
            participantId,
            to,
            messages: wanted.map((message) => ({ id: message.id, content: message.content })),
          }),
        });
        const body = (await response.json().catch(() => ({}))) as {
          data?: { translations: { id: string; content: string }[] };
          error?: string;
        };
        if (!response.ok || !body.data)
          throw new Error(body.error ?? 'Chat translation is unavailable.');
        body.data.translations.forEach((one) => done.set(one.id, one.content));
        setError(null);
        setVersion((value) => value + 1);
      } catch (failure) {
        setError(failure instanceof Error ? failure.message : 'Chat translation is unavailable.');
      } finally {
        wanted.forEach((message) => inFlight.current.delete(`${to}|${message.id}`));
      }
    })();
  }, [messages, to, sessionId, participantId, isOwn]);

  const translated = new Map<string, string>();
  const done = to ? cache.current.get(to) : undefined;
  if (done) {
    for (const message of messages) {
      const text = done.get(message.id);
      if (text !== undefined && text.trim() !== message.content.trim())
        translated.set(message.id, text);
    }
  }
  return { translated, error };
}
