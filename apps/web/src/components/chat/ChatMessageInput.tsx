'use client';

import { useState, useCallback, useRef, useEffect } from 'react';
import { Send, Loader2 } from 'lucide-react';
import type { ChatMessageInputProps } from './types';

const DEFAULT_MAX_LENGTH = 500;

export function ChatMessageInput({
  onSend,
  disabled = false,
  maxLength = DEFAULT_MAX_LENGTH,
}: ChatMessageInputProps) {
  const [content, setContent] = useState('');
  const [isSending, setIsSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Auto-resize textarea
  useEffect(() => {
    const textarea = textareaRef.current;
    if (!textarea) return;

    // Reset height to auto to get correct scrollHeight
    textarea.style.height = 'auto';
    // Set to scrollHeight, but cap at 120px (about 5 lines)
    textarea.style.height = `${String(Math.min(textarea.scrollHeight, 120))}px`;
  }, [content]);

  const handleSubmit = useCallback(
    async (e?: React.FormEvent) => {
      e?.preventDefault();

      const trimmedContent = content.trim();
      if (!trimmedContent || isSending || disabled) return;

      setIsSending(true);
      setError(null);

      try {
        await onSend(trimmedContent);
        setContent('');
        // Reset textarea height
        if (textareaRef.current) {
          textareaRef.current.style.height = 'auto';
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to send message');
      } finally {
        setIsSending(false);
      }
    },
    [content, isSending, disabled, onSend]
  );

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      // Enter to send, Shift+Enter for newline
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        void handleSubmit();
      }
    },
    [handleSubmit]
  );

  const handleFormSubmit = useCallback(
    (e: React.FormEvent) => {
      void handleSubmit(e);
    },
    [handleSubmit]
  );

  const remainingChars = maxLength - content.length;
  const isOverLimit = remainingChars < 0;
  const showCharCount = content.length > maxLength * 0.8;

  return (
    <form onSubmit={handleFormSubmit} className="border-t border-gray-200 p-3">
      {error && (
        <div className="mb-2 rounded bg-red-50 px-3 py-2 text-sm text-red-600">{error}</div>
      )}

      <div className="flex items-end gap-2">
        <div className="relative flex-1">
          <textarea
            ref={textareaRef}
            value={content}
            onChange={(e) => {
              setContent(e.target.value);
            }}
            onKeyDown={handleKeyDown}
            disabled={disabled || isSending}
            placeholder="Type a message..."
            rows={1}
            className="focus:border-primary-500 focus:ring-primary-500 block w-full resize-none rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-900 placeholder:text-gray-400 focus:ring-1 focus:outline-none disabled:cursor-not-allowed disabled:bg-gray-50 disabled:opacity-50"
            data-testid="chat-input"
          />

          {/* Character count */}
          {showCharCount && (
            <span
              className={`absolute right-2 bottom-2 text-xs ${
                isOverLimit ? 'text-red-500' : 'text-gray-400'
              }`}
            >
              {remainingChars}
            </span>
          )}
        </div>

        <button
          type="submit"
          disabled={!content.trim() || isOverLimit || isSending || disabled}
          className="bg-primary-600 hover:bg-primary-700 focus:ring-primary-500 flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-lg text-white transition-colors focus:ring-2 focus:ring-offset-2 focus:outline-none disabled:cursor-not-allowed disabled:opacity-50"
          data-testid="chat-send-button"
        >
          {isSending ? <Loader2 className="h-5 w-5 animate-spin" /> : <Send className="h-5 w-5" />}
        </button>
      </div>

      <p className="mt-1 text-xs text-gray-400">Press Enter to send, Shift+Enter for new line</p>
    </form>
  );
}
