import type { SessionParticipant } from '@pairux/shared-types';

export interface ParsedMention {
  displayName: string;
  participantId?: string | undefined;
  startIndex: number;
  endIndex: number;
}

export interface MentionSegment {
  type: 'text' | 'mention';
  content: string;
  participantId?: string | undefined;
  isCurrentUser?: boolean | undefined;
}

// Regex to match @mentions - matches @ followed by text until whitespace or end
const MENTION_REGEX = /@([^\s@]+)/g;

/**
 * Parse @mentions from message content
 */
export function parseMentions(
  content: string,
  participants: SessionParticipant[]
): ParsedMention[] {
  const mentions: ParsedMention[] = [];
  let match: RegExpExecArray | null;

  // Reset regex lastIndex
  MENTION_REGEX.lastIndex = 0;

  while ((match = MENTION_REGEX.exec(content)) !== null) {
    const displayName = match[1];
    if (!displayName) continue;

    // Try to find a matching participant
    const participant = participants.find(
      (p) => p.display_name.toLowerCase() === displayName.toLowerCase()
    );

    mentions.push({
      displayName,
      participantId: participant?.id,
      startIndex: match.index,
      endIndex: match.index + match[0].length,
    });
  }

  return mentions;
}

/**
 * Parse content into segments of text and mentions
 */
export function parseContentWithMentions(
  content: string,
  participants: SessionParticipant[],
  currentUserDisplayName?: string
): MentionSegment[] {
  const segments: MentionSegment[] = [];
  const mentions = parseMentions(content, participants);

  if (mentions.length === 0) {
    return [{ type: 'text', content }];
  }

  let lastIndex = 0;

  for (const mention of mentions) {
    // Add text before this mention
    if (mention.startIndex > lastIndex) {
      segments.push({
        type: 'text',
        content: content.slice(lastIndex, mention.startIndex),
      });
    }

    // Add the mention
    const isCurrentUser = currentUserDisplayName
      ? mention.displayName.toLowerCase() === currentUserDisplayName.toLowerCase()
      : false;

    segments.push({
      type: 'mention',
      content: `@${mention.displayName}`,
      participantId: mention.participantId,
      isCurrentUser,
    });

    lastIndex = mention.endIndex;
  }

  // Add remaining text after last mention
  if (lastIndex < content.length) {
    segments.push({
      type: 'text',
      content: content.slice(lastIndex),
    });
  }

  return segments;
}

/**
 * Check if current user is mentioned in the content
 */
export function isUserMentioned(
  content: string,
  currentUserDisplayName: string,
  participants: SessionParticipant[]
): boolean {
  const mentions = parseMentions(content, participants);
  return mentions.some((m) => m.displayName.toLowerCase() === currentUserDisplayName.toLowerCase());
}

/**
 * Get the mention query from cursor position (returns text after @ if within a mention)
 */
export function getMentionQuery(
  content: string,
  cursorPosition: number
): { query: string; startIndex: number } | null {
  // Look backwards from cursor to find @
  let startIndex = cursorPosition - 1;

  while (startIndex >= 0) {
    const char = content[startIndex];
    if (char === '@') {
      // Found @, extract query
      const query = content.slice(startIndex + 1, cursorPosition);
      // Make sure there's no whitespace in the query
      if (!/\s/.test(query)) {
        return { query, startIndex };
      }
      return null;
    }
    if (char === ' ' || char === '\n') {
      // Hit whitespace before finding @
      return null;
    }
    startIndex--;
  }

  return null;
}
