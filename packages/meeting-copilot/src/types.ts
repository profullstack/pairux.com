/** Shapes shared by the server, the web and desktop panels and the CLI. */

export const COPILOT_ROLES = [
  'general',
  'sales',
  'recruiter',
  'product',
  'founder',
  'success',
  'engineer',
] as const;
export type CopilotRole = (typeof COPILOT_ROLES)[number];

/**
 * Where the models run.
 * auto:  free self-hosted models, paid cloud (own key, else PAYG) when they fail.
 * free:  self-hosted models only; never charged.
 * byok:  the owner's own keys first, then free models; never charged by us.
 * cloud: own key, else PAYG cloud first; free models as the fallback.
 */
export const COPILOT_MODES = ['auto', 'free', 'byok', 'cloud'] as const;
export type CopilotMode = (typeof COPILOT_MODES)[number];

export const isCopilotRole = (value: unknown): value is CopilotRole =>
  typeof value === 'string' && (COPILOT_ROLES as readonly string[]).includes(value);
export const isCopilotMode = (value: unknown): value is CopilotMode =>
  typeof value === 'string' && (COPILOT_MODES as readonly string[]).includes(value);

export interface TranscriptLine {
  id: string;
  /** Participant id (LiveKit identity). */
  participant: string;
  name: string;
  text: string;
  /** Epoch ms. */
  at: number;
  until: number;
  language?: string;
}

export interface ActionItem {
  text: string;
  owner?: string;
  due?: string;
}

export interface CopilotNotes {
  summary: string;
  keyPoints: string[];
  decisions: string[];
  actionItems: ActionItem[];
}

export interface CopilotSuggestion {
  id: string;
  question: string;
  reason: string;
  /** The transcript line it came from. */
  lineId?: string;
  at: number;
}

export interface OpenQuestion {
  id: string;
  text: string;
  status: 'open' | 'answered';
  answer?: string;
  lineId?: string;
  at: number;
}

export const FIGURE_KINDS = ['number', 'money', 'date', 'name', 'commitment'] as const;
export type FigureKind = (typeof FIGURE_KINDS)[number];
export interface KeyFigure {
  id: string;
  kind: FigureKind;
  value: string;
  context: string;
  lineId?: string;
}

export interface CopilotFollowUps {
  actionItems: ActionItem[];
  /** A recap message ready to paste into email or chat. */
  message: string;
}

export interface CopilotReview {
  /** True when the transcript is too short to judge; the rest is then empty. */
  thin: boolean;
  focusArea: string;
  feedback: string[];
  /** Share of spoken seconds, 0..1. */
  talkListen: { you: number; others: number };
  questions: { asked: number; answered: number };
  followUpClarity: 'clear' | 'partial' | 'unclear';
  note?: string;
}

export interface CopilotProviders {
  /** e.g. "whisper (free)", "elevenlabs (pay as you go)". */
  stt?: string;
  llm?: string;
}

export interface CopilotState {
  id: string;
  sessionId: string;
  role: CopilotRole;
  mode: CopilotMode;
  status: 'live' | 'ended';
  notes: CopilotNotes;
  suggestions: CopilotSuggestion[];
  openQuestions: OpenQuestion[];
  figures: KeyFigure[];
  transcript: TranscriptLine[];
  followUps: CopilotFollowUps | null;
  review: CopilotReview | null;
  providers: CopilotProviders;
  /** Something the owner should know: a paused provider, no credit, nobody heard. */
  notice: string;
  startedAt: string;
  endedAt: string | null;
}

/** What the copilot event stream sends. */
export type CopilotEvent =
  | { type: 'state'; state: CopilotState }
  | { type: 'line'; line: TranscriptLine }
  | {
      type: 'notes';
      notes: CopilotNotes;
      openQuestions: OpenQuestion[];
      figures: KeyFigure[];
      providers: CopilotProviders;
    }
  | { type: 'suggestion'; suggestion: CopilotSuggestion }
  | { type: 'notice'; message: string }
  | { type: 'ended'; state: CopilotState };

/** GET /api/sessions/:id/copilot */
export interface CopilotStatus {
  /** The server has a copilot runtime. */
  available: boolean;
  /** This caller may start one (Pro/Team or admin). */
  eligible: boolean;
  /** Upgrade link when not eligible. */
  upgradeUrl: string | null;
  /** Everyone in the meeting sees who has a copilot listening. */
  active: { name: string }[];
  /** The caller's own copilot in this meeting, if any. */
  mine: CopilotState | null;
  mode: CopilotMode;
  role: CopilotRole;
}

/** Where an invite to one of your agents stands. */
export type AgentInviteStatus = 'pending' | 'accepted' | 'declined' | 'expired' | 'left';

/** One of your (or your orgs') agents, as GET /api/sessions/:id/agents lists it. */
export interface MeetingAgent {
  id: string;
  name: string;
  handle: string;
  description: string | null;
  online: boolean;
  invite: { id: string; status: AgentInviteStatus } | null;
}

/** How any other agent joins this meeting (join code, CLI command, API). */
export interface AnyAgentJoin {
  joinCode: string;
  command: string;
  api: string;
}

export const emptyNotes = (): CopilotNotes => ({
  summary: '',
  keyPoints: [],
  decisions: [],
  actionItems: [],
});
