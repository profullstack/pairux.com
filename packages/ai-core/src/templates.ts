/**
 * Built-in summary templates. The PRD ships three at launch; the guidance text
 * is injected into the summarization system prompt to steer what the notes emphasize.
 */
export const SESSION_TEMPLATE_IDS = ['pair-programming', 'support-session', 'user-interview'] as const;
export type SessionTemplateId = (typeof SESSION_TEMPLATE_IDS)[number];

export interface SessionTemplateSpec {
  readonly label: string;
  readonly guidance: string;
}

export const SESSION_TEMPLATES: Readonly<Record<SessionTemplateId, SessionTemplateSpec>> = {
  'pair-programming': {
    label: 'Pair Programming',
    guidance:
      'Focus on technical decisions, the approaches chosen and rejected, bugs found and fixed, and concrete TODOs with the engineer responsible.',
  },
  'support-session': {
    label: 'Support Session',
    guidance:
      'Focus on the reported problem, the diagnostic steps taken, the resolution applied, and any follow-up owed to the customer.',
  },
  'user-interview': {
    label: 'User Interview',
    guidance:
      'Focus on the user’s goals and pain points, notable quoted reactions, feature requests, and hypotheses to follow up on.',
  },
};

export const DEFAULT_TEMPLATE: SessionTemplateId = 'pair-programming';

export function getTemplate(id: SessionTemplateId | undefined): SessionTemplateSpec {
  return SESSION_TEMPLATES[id ?? DEFAULT_TEMPLATE];
}
