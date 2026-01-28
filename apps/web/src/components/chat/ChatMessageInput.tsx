'use client';

import { useState, useCallback, useRef, useEffect } from 'react';
import { Send, Loader2 } from 'lucide-react';
import type { SessionParticipant } from '@pairux/shared-types';
import { MentionAutocomplete } from './MentionAutocomplete';
import { getMentionQuery } from '@/lib/parseMentions';
import type { ChatMessageInputProps } from './types';

const DEFAULT_MAX_LENGTH = 500;

export function ChatMessageInput({
  onSend,
  disabled = false,
  maxLength = DEFAULT_MAX_LENGTH,
  participants = [],
  onTyping,
  onStopTyping,
}: ChatMessageInputProps) {
  const [content, setContent] = useState('');
  const [isSending, setIsSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showMentions, setShowMentions] = useState(false);
  const [mentionQuery, setMentionQuery] = useState('');
  const [mentionStartIndex, setMentionStartIndex] = useState(0);
  const [selectedMentionIndex, setSelectedMentionIndex] = useState(0);
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

  // Handle text change and mention detection
  const handleContentChange = useCallback(
    (e: React.ChangeEvent<HTMLTextAreaElement>) => {
      const newContent = e.target.value;
      const cursorPos = e.target.selectionStart;
      setContent(newContent);

      // Check for mention query
      if (participants.length > 0) {
        const mentionInfo = getMentionQuery(newContent, cursorPos);
        if (mentionInfo) {
          setShowMentions(true);
          setMentionQuery(mentionInfo.query);
          setMentionStartIndex(mentionInfo.startIndex);
          setSelectedMentionIndex(0);
        } else {
          setShowMentions(false);
        }
      }

      onTyping?.();
    },
    [participants, onTyping]
  );

  // Handle mention selection
  const handleMentionSelect = useCallback(
    (participant: SessionParticipant) => {
      const before = content.slice(0, mentionStartIndex);
      const after = content.slice(mentionStartIndex + 1 + mentionQuery.length);
      const newContent = `${before}@${participant.display_name} ${after}`;
      setContent(newContent);
      setShowMentions(false);

      // Focus back on textarea
      if (textareaRef.current) {
        textareaRef.current.focus();
        const newCursorPos = mentionStartIndex + participant.display_name.length + 2;
        textareaRef.current.setSelectionRange(newCursorPos, newCursorPos);
      }
    },
    [content, mentionStartIndex, mentionQuery]
  );

  // Close mention autocomplete
  const handleMentionClose = useCallback(() => {
    setShowMentions(false);
  }, []);

  const handleSubmit = useCallback(
    async (e?: React.FormEvent) => {
      e?.preventDefault();

      const trimmedContent = content.trim();
      if (!trimmedContent || isSending || disabled) return;

      setIsSending(true);
      setError(null);

      try {
        await onSend(trimmedContent);
        onStopTyping?.();
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
    [content, isSending, disabled, onSend, onStopTyping]
  );

  // Get filtered participants for autocomplete
  const filteredParticipants = participants.filter((p) =>
    p.display_name.toLowerCase().includes(mentionQuery.toLowerCase())
  );

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      // Handle mention autocomplete navigation
      if (showMentions && filteredParticipants.length > 0) {
        if (e.key === 'ArrowDown') {
          e.preventDefault();
          setSelectedMentionIndex((prev) =>
            prev < filteredParticipants.length - 1 ? prev + 1 : 0
          );
          return;
        }
        if (e.key === 'ArrowUp') {
          e.preventDefault();
          setSelectedMentionIndex((prev) =>
            prev > 0 ? prev - 1 : filteredParticipants.length - 1
          );
          return;
        }
        if (e.key === 'Enter' || e.key === 'Tab') {
          e.preventDefault();
          const selected = filteredParticipants[selectedMentionIndex];
          if (selected) {
            handleMentionSelect(selected);
          }
          return;
        }
        if (e.key === 'Escape') {
          e.preventDefault();
          setShowMentions(false);
          return;
        }
      }

      // Enter to send, Shift+Enter for newline
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        void handleSubmit();
      }
    },
    [handleSubmit, showMentions, filteredParticipants, selectedMentionIndex, handleMentionSelect]
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
    <form onSubmit={handleFormSubmit} className="border-t border-gray-700 p-3">
      {error && (
        <div className="mb-2 rounded bg-red-900/30 px-3 py-2 text-sm text-red-400">{error}</div>
      )}

      <div className="flex items-end gap-2">
        <div className="relative flex-1">
          <textarea
            ref={textareaRef}
            value={content}
            onChange={handleContentChange}
            onKeyDown={handleKeyDown}
            disabled={disabled || isSending}
            placeholder="Type a message... (use @ to mention)"
            rows={1}
            className="focus:border-primary-500 focus:ring-primary-500 block w-full resize-none rounded-lg border border-gray-600 bg-gray-800 px-3 py-2 text-sm text-white placeholder:text-gray-500 focus:ring-1 focus:outline-none disabled:cursor-not-allowed disabled:bg-gray-800 disabled:opacity-50"
            data-testid="chat-input"
          />

          {/* Mention autocomplete */}
          {showMentions && participants.length > 0 && (
            <MentionAutocomplete
              participants={participants}
              query={mentionQuery}
              onSelect={handleMentionSelect}
              onClose={handleMentionClose}
              selectedIndex={selectedMentionIndex}
              onSelectedIndexChange={setSelectedMentionIndex}
            />
          )}

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

      <p className="mt-1 text-xs text-gray-500">Press Enter to send, Shift+Enter for new line</p>
    </form>
  );
}
