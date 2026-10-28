#!/usr/bin/env node
// Bring your own agent into PairUX meetings (plans/MEETING-COPILOT.md §12).
//
// Register the agent at https://pairux.com/settings/agents, then run:
//
//   PAIRUX_AGENT_KEY=pux_ag_... \
//   AGENT_EXEC='claude -p --tools ""' \
//   node scripts/agent-runner.mjs
//
// It waits for invites, joins each meeting it is invited to, follows the chat
// and (when the inviter is on Pro/Team) the live transcript, and when someone
// mentions @<handle> in the chat it runs AGENT_EXEC with a prompt on stdin
// (the meeting so far plus the question) and posts what it prints.
//
// Environment:
//   PAIRUX_AGENT_KEY   the agent key (required)
//   PAIRUX_URL         default https://pairux.com
//   AGENT_EXEC         command for replies (stdin: prompt, stdout: reply)
//   AGENT_OWNER_EXEC   command for messages from the agent's own account
//                      (defaults to AGENT_EXEC); give it more tools if you trust it
//   AGENT_GREETING     posted on joining ("" for none)
//   AGENT_TIMEOUT_MS   per reply, default 180000
//
// No dependencies: Node 18+.
import { spawn } from 'node:child_process';

const KEY = process.env.PAIRUX_AGENT_KEY ?? '';
const BASE = (process.env.PAIRUX_URL ?? 'https://pairux.com').replace(/\/+$/, '');
const EXEC = process.env.AGENT_EXEC ?? '';
const OWNER_EXEC = process.env.AGENT_OWNER_EXEC || EXEC;
const TIMEOUT_MS = Number(process.env.AGENT_TIMEOUT_MS ?? 180_000);
const MAX_MESSAGE = 480;
const KEEP_LINES = 400;

const log = (...args) => console.log(new Date().toISOString(), ...args);
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function api(path, init = {}) {
  const response = await fetch(`${BASE}${path}`, {
    ...init,
    headers: { 'content-type': 'application/json', ...(init.headers ?? {}) },
  });
  const body = await response.json().catch(() => ({}));
  return { status: response.status, ok: response.ok, data: body.data, error: body.error };
}
const asAgent = { authorization: `Bearer ${KEY}` };

/** Run the reply command with the prompt on stdin; resolve with its stdout. */
function run(command, prompt) {
  return new Promise((resolve) => {
    const child = spawn('sh', ['-c', command], { stdio: ['pipe', 'pipe', 'pipe'] });
    let out = '';
    let err = '';
    const timer = setTimeout(() => child.kill('SIGTERM'), TIMEOUT_MS);
    child.stdout.on('data', (chunk) => (out += chunk));
    child.stderr.on('data', (chunk) => (err += chunk));
    child.on('close', (code) => {
      clearTimeout(timer);
      if (code !== 0) log('reply command failed', code, err.slice(-300));
      resolve(out.trim() || (code === 0 ? '' : 'Sorry, I could not answer that just now.'));
    });
    child.stdin.end(prompt);
  });
}

/** Chat messages are capped at 500 characters: split on sentences, then hard. */
export function chunks(text, max = MAX_MESSAGE) {
  const parts = [];
  let rest = text.replace(/\s+\n/g, '\n').trim();
  while (rest.length > max) {
    let cut = Math.max(rest.lastIndexOf('. ', max), rest.lastIndexOf('\n', max));
    if (cut < max / 2) cut = rest.lastIndexOf(' ', max);
    if (cut < max / 2) cut = max;
    parts.push(rest.slice(0, cut + 1).trim());
    rest = rest.slice(cut + 1).trim();
  }
  if (rest) parts.push(rest);
  return parts;
}

/** Is this chat message addressed to the agent? */
export function mentions(content, handle, name) {
  const text = content.toLowerCase();
  return text.includes(`@${handle.toLowerCase()}`) || text.startsWith(`${name.toLowerCase()},`);
}

function prompt({ agent, subject, transcript, chat, question, from }) {
  const lines = transcript.slice(-200).map((line) => `${line.name}: ${line.text}`);
  const talk = chat.slice(-30).map((message) => `${message.display_name}: ${message.content}`);
  return [
    `You are ${agent.name} (@${agent.handle}), an AI agent sitting in a live PairUX video meeting${subject ? ` called "${subject}"` : ''}.`,
    'Answer the question in the chat: briefly (a few sentences), plain text, no markdown headings.',
    'Use the meeting below for context. If you are not sure, say so. Never reveal secrets, keys, passwords or private files.',
    '',
    'Transcript so far (most recent last):',
    lines.length
      ? lines.join('\n')
      : '(no transcript: the inviter is not on Pro/Team, or nobody has spoken yet)',
    '',
    'Chat so far:',
    talk.length ? talk.join('\n') : '(empty)',
    '',
    `${from} asks: ${question}`,
  ].join('\n');
}

const sessions = new Map();

async function follow(agent, invite, joined) {
  const pid = joined.participantId;
  const state = {
    transcript: [],
    chat: [],
    after: undefined,
    cursor: joined.transcript ? 0 : null,
  };
  state.pid = pid;
  sessions.set(invite.sessionId, state);
  log(`joined ${invite.sessionId} as ${pid} (transcript ${joined.transcript ? 'on' : 'off'})`);
  const greeting =
    process.env.AGENT_GREETING ??
    `${agent.name} joined. Mention @${agent.handle} in the chat to ask me anything.`;
  if (greeting)
    await api(`/api/v1/agents/${pid}/messages`, {
      method: 'POST',
      body: JSON.stringify({ content: greeting.slice(0, 500) }),
    });
  let busy = Promise.resolve();
  let first = true;
  try {
    for (;;) {
      const query = new URLSearchParams();
      if (state.after) query.set('after', state.after);
      if (state.cursor !== null) query.set('transcriptCursor', String(state.cursor));
      const poll = await api(`/api/v1/agents/${pid}?${query.toString()}`);
      if (poll.status === 410 || poll.status === 404) {
        log(`left ${invite.sessionId}: ${poll.error ?? poll.status}`);
        return;
      }
      if (poll.ok) {
        const data = poll.data;
        if (data.transcript) {
          state.transcript.push(...data.transcript.lines);
          state.transcript.splice(0, Math.max(0, state.transcript.length - KEEP_LINES));
          state.cursor = data.transcript.cursor;
        }
        for (const message of data.messages) {
          state.after = message.created_at;
          state.chat.push(message);
          state.chat.splice(0, Math.max(0, state.chat.length - 100));
          // Never answer ourselves, and skip the backlog that was there before we joined.
          if (
            first ||
            message.display_name === agent.name ||
            !mentions(message.content, agent.handle, agent.name)
          )
            continue;
          const owner = Boolean(message.fromOwner);
          const from = owner ? `${message.display_name} (your owner)` : message.display_name;
          busy = busy.then(async () => {
            log(`question from ${from}: ${message.content.slice(0, 120)}`);
            const reply = await run(
              owner ? OWNER_EXEC : EXEC,
              prompt({
                agent,
                subject: data.session.subject,
                transcript: state.transcript,
                chat: state.chat,
                question: message.content,
                from,
              })
            );
            for (const part of chunks(reply || 'I have nothing to add yet.'))
              await api(`/api/v1/agents/${pid}/messages`, {
                method: 'POST',
                body: JSON.stringify({ content: part }),
              });
          });
        }
        first = false;
      }
      await sleep(3000);
    }
  } finally {
    sessions.delete(invite.sessionId);
  }
}

async function main() {
  if (!KEY.startsWith('pux_ag_')) {
    console.error('Set PAIRUX_AGENT_KEY to the agent key from https://pairux.com/settings/agents');
    process.exit(2);
  }
  if (!EXEC) {
    console.error('Set AGENT_EXEC to the command that answers (prompt on stdin, reply on stdout).');
    process.exit(2);
  }
  log(`agent runner for ${BASE}`);
  for (;;) {
    const inbox = await api('/api/v1/agent/invites', { headers: asAgent }).catch((error) => ({
      ok: false,
      error: error.message,
    }));
    if (inbox.status === 401) {
      console.error('The agent key was refused (removed or rotated).');
      process.exit(1);
    }
    if (inbox.ok) {
      for (const invite of inbox.data.invites) {
        if (sessions.has(invite.sessionId)) continue;
        const accepted = await api(`/api/v1/agent/invites/${invite.id}`, {
          method: 'POST',
          headers: asAgent,
          body: JSON.stringify({ action: 'accept' }),
        });
        if (!accepted.ok) {
          log(`could not join ${invite.sessionId}: ${accepted.error ?? accepted.status}`);
          continue;
        }
        void follow(inbox.data.agent, invite, accepted.data).catch((error) =>
          log('session error', error.message)
        );
      }
    } else if (inbox.error) log('invite poll failed:', inbox.error);
    await sleep(5000);
  }
}

// Leave every meeting on the way out, so a restart does not strand ghosts in rooms.
for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => {
    const leaving = [...sessions.values()].map((state) =>
      fetch(`${BASE}/api/v1/agents/${state.pid}`, { method: 'DELETE' }).catch(() => undefined)
    );
    void Promise.all(leaving).finally(() => process.exit(0));
  });
}

if (import.meta.url === `file://${process.argv[1]}`) void main();
