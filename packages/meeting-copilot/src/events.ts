import type { CopilotEvent, CopilotState } from './types.js';

/** Most recent transcript lines a client keeps (the server keeps the whole call). */
export const CLIENT_TRANSCRIPT_LINES = 400;

/** Fold one stream event into the owner's copilot state. */
export function applyCopilotEvent(
  current: CopilotState | null,
  event: CopilotEvent
): CopilotState | null {
  switch (event.type) {
    case 'state':
    case 'ended':
      return event.state;
    case 'line':
      if (!current || current.transcript.some((line) => line.id === event.line.id)) return current;
      return {
        ...current,
        transcript: [...current.transcript, event.line].slice(-CLIENT_TRANSCRIPT_LINES),
      };
    case 'notes':
      if (!current) return current;
      return {
        ...current,
        notes: event.notes,
        openQuestions: event.openQuestions,
        figures: event.figures,
        providers: event.providers,
      };
    case 'suggestion':
      if (!current || current.suggestions.some((one) => one.id === event.suggestion.id))
        return current;
      return { ...current, suggestions: [...current.suggestions, event.suggestion].slice(-50) };
    case 'notice':
      return current ? { ...current, notice: event.message } : current;
  }
}

/** Parse a text/event-stream body into its `data:` JSON payloads. */
export async function* readSseEvents<T>(body: ReadableStream<Uint8Array>): AsyncGenerator<T> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let split = buffer.indexOf('\n\n');
      while (split >= 0) {
        const block = buffer.slice(0, split);
        buffer = buffer.slice(split + 2);
        const data = block
          .split('\n')
          .filter((line) => line.startsWith('data:'))
          .map((line) => line.slice(5).trimStart())
          .join('\n');
        if (data) {
          try {
            yield JSON.parse(data) as T;
          } catch {
            /* a malformed event is skipped, not fatal */
          }
        }
        split = buffer.indexOf('\n\n');
      }
    }
  } finally {
    reader.releaseLock();
  }
}
