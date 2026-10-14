/**
 * Use-case workflows shown on /use-cases. The copy (title, audience,
 * description, scenario, outcome and the three steps) lives in the message
 * catalogs under `useCases.items.<key>` so it can be translated.
 */
export type UseCaseKey =
  | 'agenticPairProgramming'
  | 'aiCodeReview'
  | 'debuggingWithAgents'
  | 'contractorOnboarding'
  | 'productDesignReview'
  | 'remoteSupport'
  | 'liveAiWorkshops'
  | 'aiNoteTaker';

export interface UseCase {
  slug: string;
  /** Message key: `useCases.items.<key>.*`. */
  key: UseCaseKey;
  planned?: boolean;
}

/** Each use case has three steps: `useCases.items.<key>.steps.<s0|s1|s2>`. */
export const USE_CASE_STEP_KEYS = ['s0', 's1', 's2'] as const;

export const aiNotesContact =
  'mailto:hello@pairux.com?subject=AI%20note%20taker%20for%20premium%20plans';

export const useCases: UseCase[] = [
  { slug: 'agentic-pair-programming', key: 'agenticPairProgramming' },
  { slug: 'ai-code-review', key: 'aiCodeReview' },
  { slug: 'debugging-with-agents', key: 'debuggingWithAgents' },
  { slug: 'contractor-onboarding', key: 'contractorOnboarding' },
  { slug: 'product-design-review', key: 'productDesignReview' },
  { slug: 'remote-support', key: 'remoteSupport' },
  { slug: 'live-ai-workshops', key: 'liveAiWorkshops' },
  { slug: 'ai-note-taker', key: 'aiNoteTaker' },
];
