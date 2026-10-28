import type { CopilotRole } from './types.js';

export interface CopilotRoleDef {
  id: CopilotRole;
  label: string;
  /** Which meetings it is for, one line. */
  meetings: string;
  /** What the copilot listens for (shown to the owner). */
  listensFor: string[];
  /** Example questions it might suggest (shown before the call). */
  examples: string[];
  /** The instruction the models get: what matters for this role. */
  focus: string;
}

/** Who the owner is in the room changes what the copilot listens for, suggests and reviews. */
export const COPILOT_ROLE_DEFS: Record<CopilotRole, CopilotRoleDef> = {
  general: {
    id: 'general',
    label: 'General',
    meetings: 'Any meeting.',
    listensFor: ['Decisions and owners', 'Open questions', 'Dates and numbers'],
    examples: ['Who owns this?', 'When do we need this by?', 'What is the next step?'],
    focus:
      'Track decisions, owners, dates and open questions. Suggest questions that pin down vague commitments.',
  },
  sales: {
    id: 'sales',
    label: 'Sales',
    meetings: 'Discovery calls, demos and follow-ups.',
    listensFor: [
      'Budget, timeline and decision-maker gaps',
      'What the buyer cares about',
      'Figures and dates in pricing talk',
    ],
    examples: [
      'Who else needs to approve this?',
      'What happens if you do nothing this quarter?',
      'When does the budget review take place?',
    ],
    focus:
      'You support a seller. Listen for budget, authority, need and timeline, and flag whichever is still unknown. Keep a list of what the buyer said they care about, and capture every price, figure and date exactly.',
  },
  recruiter: {
    id: 'recruiter',
    label: 'Recruiter',
    meetings: 'Screens, interviews and candidate debriefs.',
    listensFor: [
      'Experience, availability and salary expectations',
      'Vague answers worth a follow-up',
      'Topics not covered yet',
    ],
    examples: [
      'What was your specific role in that project?',
      'What are you looking for in your next team?',
      'What does your notice period look like?',
    ],
    focus:
      'You support an interviewer. Capture the candidate’s experience, availability, notice period and salary expectations as they come up. Flag vague or "we did" answers that need a specific follow-up, and the standard topics not covered yet.',
  },
  product: {
    id: 'product',
    label: 'Product Manager',
    meetings: 'User interviews, planning and stakeholder syncs.',
    listensFor: [
      'Vague claims worth probing ("it is kind of slow")',
      'Decisions, owners and open questions',
      'Dates and commitments agreed',
    ],
    examples: [
      'Can you walk me through the last time that happened?',
      'What did you do instead?',
      'Who owns this decision?',
    ],
    focus:
      'You support a product manager. In user interviews, flag vague statements and opinions that need a concrete story ("walk me through the last time"); never lead the user. In planning, keep decisions, owners, dates and open questions.',
  },
  founder: {
    id: 'founder',
    label: 'Founder',
    meetings: 'Customer calls, investor chats and partner meetings.',
    listensFor: [
      'Problems people mention and how to dig deeper',
      'Figures, asks and next steps',
      'Who agreed to do what',
    ],
    examples: [
      'How are you solving this today?',
      'What would make this a must-have for you?',
      'What is the next step on your side?',
    ],
    focus:
      'You support a founder in back-to-back calls. Notice the problems people describe and suggest how to dig deeper; capture every figure, ask and next step, and who agreed to do what.',
  },
  success: {
    id: 'success',
    label: 'Customer Success',
    meetings: 'Check-ins, renewals and escalations.',
    listensFor: [
      'Hesitation and churn risk',
      'Unresolved concerns and who signs off',
      'Commitments you made',
    ],
    examples: [
      'What would make this more useful for your team?',
      'Who else is involved in the renewal?',
      'What is the biggest blocker right now?',
    ],
    focus:
      'You support a customer success manager. Listen for hesitation, unresolved concerns and churn risk; track what the customer says works and what does not, who signs off on the renewal, and every commitment we made.',
  },
  engineer: {
    id: 'engineer',
    label: 'Engineer',
    meetings: 'Requirements, standups, design reviews and 1:1s.',
    listensFor: [
      'Unclear scope and unstated assumptions',
      'Decisions and who owns each follow-up',
      'Blockers and commitments',
    ],
    examples: [
      'What does done look like for this?',
      'What happens if that dependency slips?',
      'Who is reviewing this?',
    ],
    focus:
      'You support a software engineer. Flag unclear scope, unstated assumptions and missing acceptance criteria that cause rework; record decisions, owners, blockers and commitments.',
  },
};

export const roleDef = (role: CopilotRole): CopilotRoleDef => COPILOT_ROLE_DEFS[role];
