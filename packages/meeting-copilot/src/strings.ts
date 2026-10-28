/**
 * The copilot panel's English strings. The web app carries the same tree as
 * the `copilot` namespace in messages/<locale>.json (a test keeps en.json equal
 * to this); the desktop app, which is not localized, renders these directly.
 * Placeholders use ICU {name} syntax.
 */
export const COPILOT_STRINGS_EN = {
  title: 'AI copilot',
  listeningFor: 'AI copilot is listening for {names}',
  consent: 'Let everyone know an AI copilot is listening; it transcribes what is said.',
  open: 'Open AI copilot',
  close: 'Close',
  proOnly:
    'The AI copilot sits in your call, takes notes, suggests questions and writes your follow-ups. It is part of PairUX Pro.',
  upgrade: 'Upgrade to Pro',
  signIn: 'Sign in to use the AI copilot.',
  role: 'Who are you in this meeting?',
  listensFor: 'Listens for',
  mode: 'Models',
  modes: {
    auto: 'Free models, paid cloud as fallback',
    free: 'Free self-hosted models only',
    byok: 'My own API keys',
    cloud: 'Best quality cloud (pay as you go)',
  },
  pricingNote:
    'Free models run on our servers at no cost. Cloud models are pay as you go at provider cost + 10%, or free with your own keys.',
  settings: 'Keys and credit',
  start: 'Start copilot',
  stop: 'Stop and write follow-ups',
  stopping: 'Writing follow-ups…',
  live: 'Listening',
  providers: 'Speech: {stt} · AI: {llm}',
  waiting: 'waiting',
  recap: 'Recap last 30 s',
  recapTitle: 'Last 30 seconds',
  suggested: 'Suggested question',
  jump: 'Show where',
  dismiss: 'Dismiss',
  tabs: {
    notes: 'Notes',
    questions: 'Questions',
    transcript: 'Transcript',
    ask: 'Ask',
  },
  summary: 'Summary',
  keyPoints: 'Key points',
  decisions: 'Decisions',
  actionItems: 'Action items',
  figures: 'Key figures and dates',
  owner: 'Owner: {owner}',
  nothingYet: 'Nothing yet. Notes appear as people talk.',
  noQuestions: 'No open questions yet.',
  answered: 'Answered',
  noTranscript: 'Nobody has been heard yet. Speech appears here a few seconds after it is said.',
  askPlaceholder: 'Ask privately: “What was the budget again?”',
  askSend: 'Ask',
  askHint: 'Only you see this. Answers come from what was said.',
  followUps: 'Follow-ups',
  message: 'Recap message',
  copy: 'Copy',
  copied: 'Copied',
  review: 'Conversation review',
  focusArea: 'Focus area',
  talkListen: 'You talked {you}% of the time',
  questionsResolved: '{answered} of {asked} questions answered',
  clarity: {
    clear: 'Follow-ups are clear',
    partial: 'Follow-ups are partly clear',
    unclear: 'Follow-ups are unclear',
  },
  thin: 'The transcript is too short to review this conversation fairly.',
  fullReport: 'Open full notes',
  restart: 'Start again',
  roles: {
    general: { label: 'General', meetings: 'Any meeting.' },
    sales: { label: 'Sales', meetings: 'Discovery calls, demos and follow-ups.' },
    recruiter: { label: 'Recruiter', meetings: 'Screens, interviews and candidate debriefs.' },
    product: {
      label: 'Product Manager',
      meetings: 'User interviews, planning and stakeholder syncs.',
    },
    founder: { label: 'Founder', meetings: 'Customer calls, investor chats and partner meetings.' },
    success: { label: 'Customer Success', meetings: 'Check-ins, renewals and escalations.' },
    engineer: { label: 'Engineer', meetings: 'Requirements, standups, design reviews and 1:1s.' },
  },
};

export type CopilotStrings = typeof COPILOT_STRINGS_EN;
/** A translate function over the tree above: dotted keys, ICU-style {values}. */
export type CopilotT = (key: string, values?: Record<string, string | number>) => string;

/** A CopilotT over a string tree (the desktop app uses the English one). */
export function copilotTranslator(strings: object = COPILOT_STRINGS_EN): CopilotT {
  return (key, values) => {
    let node: unknown = strings;
    for (const part of key.split('.')) {
      node = node && typeof node === 'object' ? (node as Record<string, unknown>)[part] : undefined;
    }
    const text = typeof node === 'string' ? node : key;
    return values
      ? text.replace(/\{(\w+)\}/g, (match, name: string) =>
          name in values ? String(values[name]) : match
        )
      : text;
  };
}
