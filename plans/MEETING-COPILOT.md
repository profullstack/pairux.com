# PRD: PairUX Copilot (in-call AI agent)

Status: building (2026-10-28). Owner: riotcoder. Reference product: Roofle
("Listen. Note. Coach.", roofle.app/features), a Mac-only meeting copilot.

## 1. Problem

People in a PairUX meeting either listen or type. The ones who type miss the
conversation; the ones who listen lose the details, forget to ask the follow-up
question and spend an hour afterwards writing the recap. PairUX already hears
every participant (live translation taps each participant's track on the
server) and already writes a report after a call (call analysis), but nothing
helps **during** the call.

## 2. What we are building

An optional AI agent that sits in a PairUX meeting for one person (its owner)
and works privately for them:

| #   | Feature (Roofle parity) | What it does in PairUX                                                                                                                                                                                                   |
| --- | ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 1   | Role presets            | The owner picks who they are in the room: Sales, Recruiter, Product Manager, Founder, Customer Success, Engineer, or General. The role changes what the agent listens for, what it suggests and how it reviews the call. |
| 2   | Live transcription      | Every participant's speech, tagged with who said it (one line per phrase, source-language).                                                                                                                              |
| 3   | Suggested questions     | Spots gaps and vague answers ("it is kind of slow") and suggests the next question, with the reason and a jump to the exact transcript line it came from.                                                                |
| 4   | Live notes              | One short document rewritten as the call moves: summary, key points, decisions, action items (with owner when said).                                                                                                     |
| 5   | Open questions          | Questions that were asked or are worth asking stay visible until someone answers them; the agent marks them answered when it hears the answer, the owner can too.                                                        |
| 6   | Key figures and dates   | Numbers, money, dates, names and commitments pulled out of the transcript so nothing is misquoted.                                                                                                                       |
| 7   | Recap on demand         | "Zoned out?" One click: what was said in the last 30 seconds.                                                                                                                                                            |
| 8   | Follow-ups in one click | When the call ends: follow-up action items plus a ready-to-send recap message.                                                                                                                                           |
| 9   | Conversation review     | After the call: a focus area, plain-language feedback, talk/listen balance, questions resolved, follow-up clarity. If the transcript is too thin to judge, it says so instead of guessing.                               |
| 10  | Ask the agent ("PM it") | The owner can message the agent privately mid-call: "what did she say the budget was?", "draft a reply". Answers come only from the transcript and notes.                                                                |
| 11  | Honest when unsure      | Every model prompt requires "say so when unsure"; empty or thin input never produces invented notes.                                                                                                                     |

Deliberate differences from Roofle:

- **It sits in the call, in the open.** Roofle hides ("no bot on the call"). In
  PairUX every participant sees an "AI copilot is listening for <name>" notice
  (consent, same rule as RecordingNotice). Suggestions, notes and asks stay
  private to the owner.
- **Server-side, every surface.** Web, desktop, CLI, API and MCP, not one Mac app.
- **Free open-source models first** (see §4), paid cloud models as fallback or override.

## 3. Who can use it (paid tier only)

- The owner must be signed in and on **Pro or Team** (own plan or org plan, the
  same `resolveUserPlan` rule as translation). PairUX admins always may.
- Plus and Free see the feature with an upgrade prompt (`/upgrade/pro`).
- Any eligible participant may run their own copilot in any live meeting they
  are in (host or guest). Several copilots in one meeting share one transcript.
- Requires an SFU meeting (that is where participant audio is tapped).

## 4. Providers and billing: free first, then PAYG at cost + 10%, or BYOK

Anthony, 2026-10-28: "anything we can do server side with open source for free
should be our default path with fallback/override for paid services" and "pay
us 10% markup or bring your own keys. pay as you go for cloud".

Two capabilities, each a provider chain:

| Capability                            | Free default (self-hosted, open source)                                                                                              | Paid fallback (our key, PAYG)                                         | BYOK override                        |
| ------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------- | ------------------------------------ |
| Speech to text                        | Whisper (whisper.cpp / speaches, OpenAI-compatible `/v1/audio/transcriptions`) at `COPILOT_STT_URL`                                  | ElevenLabs Scribe v2                                                  | the owner's ElevenLabs or OpenAI key |
| Notes, questions, recap, review, asks | Open LLM on Ollama (OpenAI-compatible `/v1/chat/completions`) at `COPILOT_LLM_URL`, model `COPILOT_LLM_MODEL` (default `qwen2.5:7b`) | Claude (`COPILOT_CLOUD_MODEL`, default `claude-opus-5-5`, effort low) | the owner's Anthropic or OpenAI key  |

The owner picks a **mode** (saved per user):

- `auto` (default): free model; if it is down or fails, fall back to the paid
  cloud provider: their own key when they have one, else ours (PAYG, needs credit).
- `free`: self-hosted models only, never charged. If they are down the copilot pauses.
- `byok`: their own keys first, then free models. Never charged by us.
- `cloud`: best quality: their own key, else ours PAYG; the free model is the fallback.

**PAYG.** Charge = provider list cost x 1.10, rounded up to the micro-dollar,
drawn from a prepaid `copilot_wallets` balance. Top-ups of $5, $20 or $50 go
through the existing CoinPay checkout (every coin + PayPal). Every charge is a
`copilot_usage` row (provider, kind, units, cost, charge). With no credit left
the paid path is skipped and the copilot says so; the free path keeps working.
Rates: Claude per MTok as published (Opus 5.5 $4/$20, Sonnet 5.5 $2/$10, Haiku
5.5 $0.10/$0.50); Scribe $0.22 per submitted hour (live-translate
`translationCost`). Admins are never charged.

**BYOK.** Keys are encrypted at rest (AES-256-GCM, server secret
`COPILOT_KEYS_SECRET`), never returned (only the last 4 characters), usable only
by their owner's copilot. Deleting a key deletes the ciphertext.

## 5. Architecture

```
participants' clients ──2 s PCM──▶ /translation/feed ──▶ copilot RoomTranslator (per meeting, payer = first owner)
                                                          │  hear(): LocalWhisperVoice → ElevenLabs fallback
                                                          ▼
                                             CopilotMeeting (shared transcript)
                                                          │ every ~20 s of new speech, per owner
                                                          ▼
                                    CopilotAgent ── LLM chain (local → cloud/BYOK) ──▶ notes / suggestions / open questions / figures
                                                          │
                                         SSE /api/sessions/:id/copilot/stream ──▶ owner's panel (web, desktop), CLI `watch`
```

- **Reuse, don't fork, the audio path.** The copilot is an invisible listener in
  its own `RoomTranslator` (live-translate 0.3) choosing `{to: '', text: true,
audio: false}` for every participant, so the existing feeder lease and the
  clients' existing uploads work unchanged. `/translation/feed` feeds both rooms
  and the status endpoint's `listening` counts both, so web and desktop clients
  that predate the copilot start uploading as soon as one is on.
- The room's STT goes through `CopilotVoice`: local Whisper first; ElevenLabs
  (our key, metered by `CopilotMeter`, or the owner's key) as fallback.
- One process (the dev2 web instance), in-memory meetings, persisted to
  `meeting_copilots` every 30 s and on stop; history survives restarts.
- When the owner stops it, leaves for 2 minutes, or the meeting ends, the agent
  finalises: follow-ups and review are written and stored.

## 6. Data

- `meeting_copilots` (id, session_id, user_id, role, mode, status live|ended,
  notes jsonb, suggestions jsonb, open_questions jsonb, figures jsonb,
  transcript jsonb, follow_ups jsonb, review jsonb, providers jsonb,
  started_at, ended_at, updated_at); unique (session_id, user_id). RLS: owner reads own rows.
- `copilot_settings` (user_id pk, mode, role, keys: anthropic/openai/elevenlabs ciphertexts + last4).
  No client read access; the API returns masked values.
- `copilot_wallets` (user_id pk, balance_micros), `copilot_usage` (ledger).
- RPCs (service role only, explicit GRANT): `copilot_charge`, `copilot_credit_payment`.

## 7. Surfaces

- **API** (cookie or Bearer, incl. CLI `pux_at_` tokens):
  `GET/POST/DELETE /api/sessions/:id/copilot` (status, start {role, mode}, stop),
  `POST …/copilot/stream` (SSE), `POST …/copilot/ask`, `POST …/copilot/recap`,
  `POST …/copilot/questions` (mark answered), `GET /api/copilot` (history),
  `GET /api/copilot/:id` (report), `POST /api/copilot/:id/follow-ups`,
  `POST /api/copilot/:id/review`, `GET/PUT /api/copilot/settings`,
  `GET /api/copilot/wallet`, `POST /api/billing/copilot-topup`.
- **MCP**: `POST /api/v1/mcp` (Streamable HTTP, JSON responses) with tools
  `copilot_list`, `copilot_report`, `copilot_ask`, `copilot_recap`, `copilot_follow_ups`.
- **Web**: Copilot panel on host, session and view pages; `/copilot` history;
  `/copilot/:id` report; settings (mode, keys, wallet) at `/settings/copilot`.
- **Desktop**: the same panel in the meeting views (shared hook in `@pairux/meeting-copilot`).
- **CLI**: `pairux copilot start|stop|watch|notes|ask|recap|followups|review|list` in the existing launcher.
- **Mobile**: phase 2 (mobile does not feed audio yet).

## 8. Non-goals (this release)

CRM sync, calendar-aware prep, sending the follow-up email for the user,
diarizing several people on one mic, mobile capture.

## 9. Success measures

- First suggestion within 60 s of speech on the free path; within 30 s on cloud.
- 80%+ of copilot minutes served by the free path (`copilot_usage` vs transcript minutes).
- Zero charges outside PAYG/BYOK rules (ledger audit), zero leaked key material.

## 10. Rollout

1. Migration applied by hand on dev2 (`pairux-com-supabase-db`), `notify pgrst`.
2. Free stack on dev2: compose project `pairux-copilot` (`~/www/pairux.com/docker-compose.copilot.yml`) on the app's
   network: `pairux-copilot-whisper` (speaches, faster-whisper-small int8, 8 CPUs/4 GB) and `pairux-copilot-llm`
   (Ollama, model `pairux-copilot` = qwen2.5:7b with num_ctx 8192 and num_thread 6, 12 CPUs/8 GB).
3. Env: `COPILOT_STT_URL`, `COPILOT_LLM_URL`, `COPILOT_LLM_MODEL`, `COPILOT_KEYS_SECRET` in vault `pairux-com--prod` and app.env.
4. Web deploy on merge; desktop on the next `v*` tag.

## 10a. Measured on dev2 (2026-10-28, CPU only, Ryzen 9 7950X3D)

- Whisper (faster-whisper-small int8): about 2.2 s per spoken phrase (~5 s of audio), words accurate;
  names are the weak spot ("Priya" heard as "PREA").
- Live notes update on the free LLM: qwen2.5:3b 5 s but empty notes and garbled follow-ups;
  **qwen2.5:7b 37 s** with an accurate summary, key points and one sensible next question; follow-ups
  and review 20 s. Generation is memory-bandwidth bound: 6 threads beat 12.
- Small models ramble without limits: one "suggestion" was a 30-question list until the token cap.
  Two fixes, both shipped: the local model gets a JSON schema with every string and array bounded
  (grammar-constrained decoding has to close fields), and every provider's output goes through guards
  (one question per suggestion, length caps, filler like "Not specified" read as empty, no answers on
  open questions).

## 11. Risks

- CPU-only models on dev2: latency and load. Mitigation: per-process caps
  (`COPILOT_MAX_MEETINGS`, default 6), ticks coalesced to one LLM call per owner
  per 20 s, `auto` falls back to cloud when the local model is slow (15 s timeout).
- A participant on a client that does not feed audio (mobile) is not transcribed;
  the panel shows who is not being heard.
- Consent: the notice is shown to everyone; the owner is told to inform people.

## 12. Your own agents (added 2026-10-28)

Anthony: "add the ai copilot the fleet captain (riotcoder) to our account and have that agent join too ... we should
be able to use pairux's agent or invite our own."

In a meeting, the Agents section of the copilot panel offers three ways in:

1. **PairUX copilot**: the built-in agent above (Pro/Team).
2. **Your agents**: agents registered on your account or shared with your org (`/settings/agents`), for example
   riotcoder, Profullstack's fleet captain. One click sends an invite; the agent joins as an agent participant owned by
   the account and is badged as an agent like any other.
3. **Any agent**: the join code and `pairux join <CODE> --name "..."` (or `POST /api/v1/agents/join`).

**Registry and keys.** `account_agents` (owner, optional org, name, @handle, description) with a per-agent key
`pux_ag_<id>_<secret>`, shown once, stored only as a SHA-256 hash, rotate or remove at any time. `agent_invites`
(pending, accepted, declined, expired after 15 minutes, left).

**Agent protocol.** `GET /api/v1/agent/invites` (Bearer agent key) lists invites and marks the agent online;
`POST /api/v1/agent/invites/:id {action}` accepts (joins via `join_session_as_agent`, owner = the account) or declines;
then the existing `/api/v1/agents/:participantId` poll, chat and leave. Messages carry `fromOwner` (sent by the account
that owns the agent) so an agent can trust its owner more than guests.

**Transcript.** When the inviter is on Pro/Team, the agent also reads the live transcript: the copilot room keeps
listening for "taps" (free self-hosted speech-to-text only), polled with `?transcriptCursor=N`. Everyone sees the agent
in the "listening" notice.

**Runner.** `scripts/agent-runner.mjs` (no dependencies) turns any command into a meeting agent: it accepts invites,
follows chat and transcript, and on `@handle` pipes the meeting and the question to `AGENT_EXEC` (or `AGENT_OWNER_EXEC`
for the owner's own messages) and posts the reply (split under the 500-character chat limit).

**riotcoder.** Registered on Anthony's account, shared with Profullstack, Inc.; key in vault `riotcoder--prod` and
`~/.config/riotcoder/pairux.env`. Runs on dev2 as the user service `riotcoder-pairux` with `riotcoder-pairux-reply`:
guests get Claude Code with no tools (meeting context only); Anthony's own messages get read-only tools (Read, Grep,
Glob, WebSearch, WebFetch) in `~/src/profullstack`. It never changes anything from a meeting; giving it write access is
Anthony's call.

**MCP.** `agents_list`, `agent_invite`.
