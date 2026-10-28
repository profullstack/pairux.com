import { useEffect, useMemo, useRef, useState } from 'react';
import { Bot, Check, Copy, MessageSquare, Square, Timer, Users, X } from 'lucide-react';
import {
  COPILOT_ROLES,
  COPILOT_MODES,
  type CopilotMode,
  type CopilotRole,
  type CopilotState,
  type MeetingAgent,
} from './types.js';
import type { CopilotT } from './strings.js';
import type { MeetingCopilot } from './useMeetingCopilot.js';
import type { MeetingAgents } from './useMeetingAgents.js';

type Tab = 'notes' | 'questions' | 'transcript' | 'ask' | 'agents';

const section = 'text-[11px] font-semibold uppercase tracking-wide text-gray-400';
const button =
  'rounded bg-gray-800 px-2 py-1 text-xs text-gray-100 hover:bg-gray-700 disabled:opacity-50';
const primary =
  'rounded bg-violet-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-violet-500 disabled:opacity-50';

function List({ items }: { items: string[] }) {
  return (
    <ul className="list-disc space-y-0.5 pl-4 text-xs text-gray-200">
      {items.map((item, index) => (
        <li key={index}>{item}</li>
      ))}
    </ul>
  );
}

function CopyButton({ text, t }: { text: string; t: CopilotT }) {
  const [done, setDone] = useState(false);
  return (
    <button
      type="button"
      className={button}
      onClick={() => {
        void navigator.clipboard.writeText(text).then(() => {
          setDone(true);
          setTimeout(() => {
            setDone(false);
          }, 1500);
        });
      }}
    >
      {done ? <Check className="inline h-3 w-3" /> : <Copy className="inline h-3 w-3" />}{' '}
      {done ? t('copied') : t('copy')}
    </button>
  );
}

/** One agent you can invite, with where its invite stands. */
function AgentRow({
  agent,
  agents,
  t,
}: {
  agent: MeetingAgent;
  agents: MeetingAgents;
  t: CopilotT;
}) {
  const status = agent.invite?.status;
  const open = status === 'pending' || status === 'accepted';
  return (
    <li className="flex items-center justify-between gap-2 text-xs">
      <span className="min-w-0 truncate" title={agent.description ?? undefined}>
        <span
          role="img"
          aria-label={agent.online ? t('agents.online') : t('agents.offline')}
          className={`mr-1.5 inline-block h-1.5 w-1.5 rounded-full ${agent.online ? 'bg-green-400' : 'bg-gray-600'}`}
        />
        <span className="font-medium text-gray-100">{agent.name}</span>{' '}
        <span className="text-gray-400">@{agent.handle}</span>
      </span>
      <span className="flex shrink-0 items-center gap-1">
        {status === 'pending' && (
          <span className="rounded bg-amber-500/15 px-1.5 py-0.5 text-[11px] text-amber-200">
            {t('agents.invited')}
          </span>
        )}
        {status === 'accepted' && (
          <span className="rounded bg-green-500/15 px-1.5 py-0.5 text-[11px] text-green-300">
            {t('agents.inMeeting')}
          </span>
        )}
        {status && !open && (
          <span className="text-[11px] text-gray-500">{t(`agents.${status}`)}</span>
        )}
        {!open && (
          <button
            type="button"
            className={button}
            disabled={agents.busy}
            onClick={() => void agents.invite(agent.id)}
          >
            {status ? t('agents.reinvite') : t('agents.invite')}
          </button>
        )}
      </span>
    </li>
  );
}

/**
 * Invite your own agents (and your orgs') into the meeting, or any agent by
 * join code. Free for everyone; the live transcript for agents needs Pro.
 */
function AgentsSection({
  agents,
  t,
  open,
}: {
  agents: MeetingAgents;
  t: CopilotT;
  open: (url: string) => void;
}) {
  if (!agents.agents) return null;
  return (
    <div className="space-y-2">
      <p className="text-[11px] text-gray-400">{t('agents.intro')}</p>
      {agents.error && <p className="text-[11px] text-red-300">{agents.error}</p>}
      {agents.noTranscript && (
        <p className="text-[11px] text-amber-300">
          {t('agents.transcriptNeedsPro', { name: agents.noTranscript })}
        </p>
      )}
      {agents.agents.length ? (
        <ul className="space-y-1.5">
          {agents.agents.map((agent) => (
            <AgentRow key={agent.id} agent={agent} agents={agents} t={t} />
          ))}
        </ul>
      ) : (
        <p className="text-xs text-gray-400">{t('agents.noAgents')}</p>
      )}
      {agents.any && (
        <div className="space-y-1 rounded bg-gray-800/60 p-2">
          <div className={section}>{t('agents.anyTitle')}</div>
          <p className="text-[11px] text-gray-400">{t('agents.anyHint')}</p>
          <p className="text-xs text-gray-200">
            {t('agents.joinCode', { code: agents.any.joinCode })}
          </p>
          <div className="flex items-center gap-1">
            <code className="min-w-0 flex-1 truncate rounded bg-gray-950 px-1.5 py-1 text-[11px] text-gray-100">
              {agents.any.command}
            </code>
            <CopyButton text={agents.any.command} t={t} />
          </div>
        </div>
      )}
      <button
        type="button"
        className="text-[11px] text-gray-400 underline hover:text-gray-200"
        onClick={() => {
          open('/settings/agents');
        }}
      >
        {t('agents.manage')}
      </button>
    </div>
  );
}

/** The picker shown before the copilot starts, and your agents below it. */
function StartView({
  copilot,
  agents,
  t,
  settingsUrl,
}: {
  copilot: MeetingCopilot;
  agents: MeetingAgents | undefined;
  t: CopilotT;
  settingsUrl: string;
}) {
  const agentsBlock = agents?.agents ? (
    <div className="space-y-1 border-t border-gray-800 pt-2">
      <div className={section}>
        <Users className="mr-1 inline h-3 w-3" />
        {t('agents.title')}
      </div>
      <AgentsSection agents={agents} t={t} open={copilot.open} />
    </div>
  ) : null;
  return (
    <div className="min-h-0 space-y-3 overflow-y-auto">
      {copilot.status?.available && (
        <CopilotStart copilot={copilot} t={t} settingsUrl={settingsUrl} />
      )}
      {agentsBlock}
    </div>
  );
}

/** Role and model pickers and the Start button (or the upgrade note). */
function CopilotStart({
  copilot,
  t,
  settingsUrl,
}: {
  copilot: MeetingCopilot;
  t: CopilotT;
  settingsUrl: string;
}) {
  const status = copilot.status;
  const [role, setRole] = useState<CopilotRole>(status?.role ?? 'general');
  const [mode, setMode] = useState<CopilotMode>(status?.mode ?? 'auto');
  // The saved defaults arrive with the first status poll.
  const savedRole = status?.role;
  const savedMode = status?.mode;
  useEffect(() => {
    if (savedRole) setRole(savedRole);
    if (savedMode) setMode(savedMode);
  }, [savedRole, savedMode]);
  if (!status?.eligible)
    return (
      <div className="space-y-2 text-xs text-gray-200">
        <p>{t('proOnly')}</p>
        {status?.upgradeUrl && (
          <button
            type="button"
            className={primary}
            onClick={() => {
              copilot.open(status.upgradeUrl ?? '/upgrade/pro');
            }}
          >
            {t('upgrade')}
          </button>
        )}
      </div>
    );
  return (
    <div className="space-y-3">
      <label className="block space-y-1">
        <span className={section}>{t('role')}</span>
        <select
          value={role}
          onChange={(event) => {
            setRole(event.target.value as CopilotRole);
          }}
          className="w-full rounded bg-gray-800 px-2 py-1 text-xs text-gray-100"
        >
          {COPILOT_ROLES.map((id) => (
            <option key={id} value={id}>
              {t(`roles.${id}.label`)}
            </option>
          ))}
        </select>
        <span className="block text-[11px] text-gray-400">{t(`roles.${role}.meetings`)}</span>
      </label>
      <label className="block space-y-1">
        <span className={section}>{t('mode')}</span>
        <select
          value={mode}
          onChange={(event) => {
            setMode(event.target.value as CopilotMode);
          }}
          className="w-full rounded bg-gray-800 px-2 py-1 text-xs text-gray-100"
        >
          {COPILOT_MODES.map((id) => (
            <option key={id} value={id}>
              {t(`modes.${id}`)}
            </option>
          ))}
        </select>
        <span className="block text-[11px] text-gray-400">{t('pricingNote')}</span>
      </label>
      <p className="text-[11px] text-amber-300/90">{t('consent')}</p>
      <div className="flex items-center justify-between gap-2">
        <button
          type="button"
          className={primary}
          disabled={copilot.busy}
          onClick={() => void copilot.start(role, mode)}
        >
          {t('start')}
        </button>
        <button
          type="button"
          className="text-[11px] text-gray-400 underline hover:text-gray-200"
          onClick={() => {
            copilot.open(settingsUrl);
          }}
        >
          {t('settings')}
        </button>
      </div>
    </div>
  );
}

function NotesTab({ state, t }: { state: CopilotState; t: CopilotT }) {
  const { notes, figures } = state;
  const empty =
    !notes.summary &&
    !notes.keyPoints.length &&
    !notes.decisions.length &&
    !notes.actionItems.length;
  if (empty && !figures.length) return <p className="text-xs text-gray-400">{t('nothingYet')}</p>;
  return (
    <div className="space-y-2">
      {notes.summary && (
        <div>
          <div className={section}>{t('summary')}</div>
          <p className="text-xs text-gray-200">{notes.summary}</p>
        </div>
      )}
      {notes.keyPoints.length > 0 && (
        <div>
          <div className={section}>{t('keyPoints')}</div>
          <List items={notes.keyPoints} />
        </div>
      )}
      {notes.decisions.length > 0 && (
        <div>
          <div className={section}>{t('decisions')}</div>
          <List items={notes.decisions} />
        </div>
      )}
      {notes.actionItems.length > 0 && (
        <div>
          <div className={section}>{t('actionItems')}</div>
          <List
            items={notes.actionItems.map((item) =>
              item.owner ? `${item.text} (${t('owner', { owner: item.owner })})` : item.text
            )}
          />
        </div>
      )}
      {figures.length > 0 && (
        <div>
          <div className={section}>{t('figures')}</div>
          <div className="mt-1 flex flex-wrap gap-1">
            {figures.map((figure) => (
              <span
                key={figure.id}
                title={figure.context}
                className="rounded bg-gray-800 px-1.5 py-0.5 text-[11px] text-gray-100"
              >
                {figure.value}
                {figure.context && <span className="text-gray-400"> · {figure.context}</span>}
              </span>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function QuestionsTab({
  copilot,
  state,
  t,
}: {
  copilot: MeetingCopilot;
  state: CopilotState;
  t: CopilotT;
}) {
  if (!state.openQuestions.length)
    return <p className="text-xs text-gray-400">{t('noQuestions')}</p>;
  const ordered = [...state.openQuestions].sort(
    (a, b) => Number(a.status === 'answered') - Number(b.status === 'answered')
  );
  return (
    <ul className="space-y-1.5">
      {ordered.map((question) => (
        <li key={question.id} className="flex items-start gap-2 text-xs">
          <input
            type="checkbox"
            aria-label={t('answered')}
            checked={question.status === 'answered'}
            disabled={state.status !== 'live'}
            onChange={(event) => void copilot.setQuestion(question.id, event.target.checked)}
            className="mt-0.5"
          />
          <span
            className={
              question.status === 'answered' ? 'text-gray-500 line-through' : 'text-gray-100'
            }
          >
            {question.text}
            {question.answer && (
              <span className="block text-gray-400 no-underline">→ {question.answer}</span>
            )}
          </span>
        </li>
      ))}
    </ul>
  );
}

function TranscriptTab({
  state,
  t,
  highlight,
}: {
  state: CopilotState;
  t: CopilotT;
  highlight: string;
}) {
  const end = useRef<HTMLDivElement>(null);
  const count = state.transcript.length;
  useEffect(() => {
    if (highlight)
      document.getElementById(`copilot-line-${highlight}`)?.scrollIntoView({ block: 'center' });
    else end.current?.scrollIntoView({ block: 'end' });
  }, [count, highlight]);
  if (!count) return <p className="text-xs text-gray-400">{t('noTranscript')}</p>;
  return (
    <div className="space-y-1">
      {state.transcript.map((line) => (
        <p
          key={line.id}
          id={`copilot-line-${line.id}`}
          className={`rounded px-1 text-xs ${line.id === highlight ? 'bg-violet-900/60' : ''}`}
        >
          <span className="font-medium text-violet-300">{line.name}:</span>{' '}
          <span className="text-gray-200">{line.text}</span>
        </p>
      ))}
      <div ref={end} />
    </div>
  );
}

function AskTab({ copilot, t }: { copilot: MeetingCopilot; t: CopilotT }) {
  const [question, setQuestion] = useState('');
  const [answers, setAnswers] = useState<{ question: string; answer: string }[]>([]);
  return (
    <div className="space-y-2">
      <p className="text-[11px] text-gray-400">{t('askHint')}</p>
      {answers.map((one, index) => (
        <div key={index} className="space-y-0.5 text-xs">
          <p className="text-gray-400">{one.question}</p>
          <p className="whitespace-pre-wrap text-gray-100">{one.answer}</p>
        </div>
      ))}
      <form
        className="flex gap-1"
        onSubmit={(event) => {
          event.preventDefault();
          const asked = question.trim();
          if (!asked) return;
          setQuestion('');
          void copilot.ask(asked).then((answer) => {
            if (answer) setAnswers((list) => [...list, { question: asked, answer }]);
          });
        }}
      >
        <input
          value={question}
          onChange={(event) => {
            setQuestion(event.target.value);
          }}
          placeholder={t('askPlaceholder')}
          className="min-w-0 flex-1 rounded bg-gray-800 px-2 py-1 text-xs text-gray-100 placeholder:text-gray-500"
        />
        <button type="submit" className={button} disabled={copilot.busy || !question.trim()}>
          {t('askSend')}
        </button>
      </form>
    </div>
  );
}

function EndedView({
  state,
  t,
  copilot,
  reportUrl,
}: {
  state: CopilotState;
  t: CopilotT;
  copilot: MeetingCopilot;
  reportUrl: string;
}) {
  const review = state.review;
  return (
    <div className="space-y-3">
      {state.followUps && (
        <div className="space-y-1">
          <div className={section}>{t('followUps')}</div>
          <List
            items={state.followUps.actionItems.map((item) =>
              [item.text, item.owner && t('owner', { owner: item.owner }), item.due]
                .filter(Boolean)
                .join(' · ')
            )}
          />
          {state.followUps.message && (
            <div className="space-y-1">
              <div className={section}>{t('message')}</div>
              <p className="whitespace-pre-wrap rounded bg-gray-800 p-2 text-xs text-gray-100">
                {state.followUps.message}
              </p>
              <CopyButton text={state.followUps.message} t={t} />
            </div>
          )}
        </div>
      )}
      {review && (
        <div className="space-y-1">
          <div className={section}>{t('review')}</div>
          {review.thin ? (
            <p className="text-xs text-gray-400">{t('thin')}</p>
          ) : (
            <>
              {review.focusArea && (
                <p className="text-xs text-gray-100">
                  <span className="font-medium">{t('focusArea')}:</span> {review.focusArea}
                </p>
              )}
              <List items={review.feedback} />
              <p className="text-[11px] text-gray-400">{t(`clarity.${review.followUpClarity}`)}</p>
            </>
          )}
          <p className="text-[11px] text-gray-400">
            {t('talkListen', { you: Math.round(review.talkListen.you * 100) })} ·{' '}
            {t('questionsResolved', {
              answered: review.questions.answered,
              asked: review.questions.asked,
            })}
          </p>
          {review.note && !review.thin && (
            <p className="text-[11px] text-gray-500">{review.note}</p>
          )}
        </div>
      )}
      <div className="flex items-center justify-between gap-2">
        <button
          type="button"
          className="text-[11px] text-violet-300 underline"
          onClick={() => {
            copilot.open(reportUrl);
          }}
        >
          {t('fullReport')}
        </button>
        <button
          type="button"
          className={button}
          disabled={copilot.busy}
          onClick={() => void copilot.start(state.role, state.mode)}
        >
          {t('restart')}
        </button>
      </div>
    </div>
  );
}

/**
 * The AI copilot for one meeting page. Everyone sees who has a copilot
 * listening; the owner gets the panel. With `agents`, it also invites your
 * own agents (or any agent) into the meeting, with or without the copilot.
 */
export function CopilotPanel({
  copilot,
  agents,
  t,
  settingsUrl = '/settings/copilot',
  reportUrl = (id) => `/copilot/${id}`,
  className = '',
}: {
  copilot: MeetingCopilot;
  agents?: MeetingAgents;
  t: CopilotT;
  settingsUrl?: string;
  reportUrl?: (id: string) => string;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState<Tab>('notes');
  const [highlight, setHighlight] = useState('');
  const [dismissed, setDismissed] = useState('');
  const [recap, setRecap] = useState('');
  const { status, state } = copilot;
  const suggestion = state?.status === 'live' ? state.suggestions.at(-1) : undefined;
  const others = useMemo(() => status?.active.map((one) => one.name) ?? [], [status?.active]);
  // A new suggestion opens the panel's attention dot until it is seen.
  const unseen = Boolean(suggestion && suggestion.id !== dismissed && !open);

  if (!status?.available && !agents?.agents) return null;

  const banner =
    others.length > 0 ? (
      <div className="rounded bg-amber-500/15 px-2 py-1 text-[11px] text-amber-200">
        <Bot className="mr-1 inline h-3 w-3" />
        {t('listeningFor', { names: others.join(', ') })}
      </div>
    ) : null;

  if (!open)
    return (
      <div className={`flex flex-col items-end gap-1 ${className}`}>
        {banner}
        <button
          type="button"
          aria-label={t('open')}
          onClick={() => {
            setOpen(true);
          }}
          className="relative flex items-center gap-1.5 rounded-full bg-gray-900/90 px-3 py-1.5 text-xs text-gray-100 shadow-lg ring-1 ring-gray-700 hover:bg-gray-800"
        >
          <Bot className="h-4 w-4 text-violet-300" />
          {t('title')}
          {state?.status === 'live' && <span className="h-2 w-2 rounded-full bg-red-500" />}
          {unseen && (
            <span className="absolute -right-0.5 -top-0.5 h-2.5 w-2.5 rounded-full bg-violet-400" />
          )}
        </button>
      </div>
    );

  const live = state?.status === 'live';
  const tabs: Tab[] = ['notes', 'questions', 'transcript', 'ask'];
  if (agents?.agents) tabs.push('agents');
  return (
    <div
      className={`flex max-h-[70vh] w-full flex-col gap-2 rounded-lg bg-gray-900/95 p-3 text-gray-100 shadow-xl ring-1 ring-gray-700 ${className}`}
    >
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-1.5 text-sm font-medium">
          <Bot className="h-4 w-4 text-violet-300" />
          {t('title')}
          {live && (
            <span className="flex items-center gap-1 text-[11px] font-normal text-red-300">
              <span className="h-1.5 w-1.5 rounded-full bg-red-500" />
              {t('live')}
            </span>
          )}
        </div>
        <button
          type="button"
          aria-label={t('close')}
          onClick={() => {
            setOpen(false);
          }}
          className="text-gray-400 hover:text-gray-100"
        >
          <X className="h-4 w-4" />
        </button>
      </div>
      {banner}
      {copilot.error && <p className="text-[11px] text-red-300">{copilot.error}</p>}

      {!state || (state.status === 'ended' && !state.followUps && !state.review) ? (
        <StartView copilot={copilot} agents={agents} t={t} settingsUrl={settingsUrl} />
      ) : state.status === 'ended' ? (
        <div className="min-h-0 overflow-y-auto">
          <EndedView state={state} t={t} copilot={copilot} reportUrl={reportUrl(state.id)} />
        </div>
      ) : (
        <>
          <p className="text-[11px] text-gray-400">
            {t('providers', {
              stt: state.providers.stt ?? t('waiting'),
              llm: state.providers.llm ?? t('waiting'),
            })}
          </p>
          {state.notice && <p className="text-[11px] text-amber-300">{state.notice}</p>}
          {suggestion && suggestion.id !== dismissed && (
            <div className="rounded bg-violet-900/40 p-2 text-xs ring-1 ring-violet-700">
              <div className={section}>{t('suggested')}</div>
              <p className="font-medium text-gray-50">{suggestion.question}</p>
              {suggestion.reason && (
                <p className="text-[11px] text-gray-300">{suggestion.reason}</p>
              )}
              <div className="mt-1 flex gap-1">
                {suggestion.lineId && (
                  <button
                    type="button"
                    className={button}
                    onClick={() => {
                      setTab('transcript');
                      setHighlight(suggestion.lineId ?? '');
                    }}
                  >
                    {t('jump')}
                  </button>
                )}
                <button
                  type="button"
                  className={button}
                  onClick={() => {
                    setDismissed(suggestion.id);
                  }}
                >
                  {t('dismiss')}
                </button>
              </div>
            </div>
          )}
          {recap && (
            <div className="rounded bg-gray-800 p-2 text-xs">
              <div className={section}>{t('recapTitle')}</div>
              <p className="text-gray-100">{recap}</p>
            </div>
          )}
          <div className="flex gap-1 border-b border-gray-800 pb-1">
            {tabs.map((id) => (
              <button
                key={id}
                type="button"
                onClick={() => {
                  setTab(id);
                  if (id !== 'transcript') setHighlight('');
                }}
                className={`rounded px-2 py-0.5 text-xs ${tab === id ? 'bg-gray-700 text-white' : 'text-gray-400 hover:text-gray-100'}`}
              >
                {id === 'ask' && <MessageSquare className="mr-0.5 inline h-3 w-3" />}
                {id === 'agents' && <Users className="mr-0.5 inline h-3 w-3" />}
                {t(`tabs.${id}`)}
                {id === 'questions' &&
                  state.openQuestions.some((one) => one.status === 'open') &&
                  ` (${String(state.openQuestions.filter((one) => one.status === 'open').length)})`}
              </button>
            ))}
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto pr-1">
            {tab === 'notes' && <NotesTab state={state} t={t} />}
            {tab === 'questions' && <QuestionsTab copilot={copilot} state={state} t={t} />}
            {tab === 'transcript' && <TranscriptTab state={state} t={t} highlight={highlight} />}
            {tab === 'ask' && <AskTab copilot={copilot} t={t} />}
            {tab === 'agents' && agents && (
              <AgentsSection agents={agents} t={t} open={copilot.open} />
            )}
          </div>
          <div className="flex justify-between gap-2">
            <button
              type="button"
              className={button}
              disabled={copilot.busy}
              onClick={() =>
                void copilot.recap(30).then((text) => {
                  if (text) setRecap(text);
                })
              }
            >
              <Timer className="mr-0.5 inline h-3 w-3" />
              {t('recap')}
            </button>
            <button
              type="button"
              className={button}
              disabled={copilot.busy}
              onClick={() => void copilot.stop()}
            >
              <Square className="mr-0.5 inline h-3 w-3" />
              {copilot.busy ? t('stopping') : t('stop')}
            </button>
          </div>
        </>
      )}
    </div>
  );
}
