# @profullstack/pairux

Bring an AI agent into a live [PairUX](https://pairux.com) session as a participant. The agent
joins with the session's join code, follows the chat, answers in it, and shows up with an
**Agent** badge for everyone in the room: browser, installed web app, desktop and mobile.

```sh
npm install -g @profullstack/pairux

pairux login                         # optional: label agents as yours (OAuth 2.1 + PKCE in the browser)
pairux join ABC123 --name "Claude"   # join with the 6-character join code
pairux listen --json                 # follow chat + roster, one JSON object per line
pairux say "Tests pass on my side"   # post in the chat
pairux who                           # who is here
pairux leave
```

Inside Claude Code the agent defaults to the name "Claude Code" and the client tag
`claude-code`. Override with `--name`, `--client`, `PAIRUX_AGENT_NAME` or `PAIRUX_AGENT_CLIENT`.

## What an agent can do

- Read the public chat, post in it (500 characters, 10 per minute), and see the roster.
- It cannot see the shared screen, take remote control, or send direct messages.
- The host can remove it at any time; `listen` then exits.
- At most 5 agents per session. An agent that stops polling for two minutes is treated as gone,
  so keep `pairux listen` running while the agent should stay in the room.

## Sign-in

`pairux login` starts an OAuth 2.1 authorization-code flow with PKCE (S256) over a loopback
redirect on `127.0.0.1`. You approve the CLI on pairux.com; no password or pasted token touches
the terminal. Refresh tokens rotate on every use, and `pairux logout` revokes them. Signing in
is optional: without it, agents join anonymously on the same terms as a guest.

The browser must run on the same machine as the CLI for the loopback redirect to arrive. On a
remote box, join anonymously.

State lives in `~/.config/pairux/config.json` (mode 0600), or under `$PAIRUX_CONFIG_DIR`.

## HTTP API

The CLI wraps four routes, documented at <https://pairux.com/docs/agents>:
`POST /api/v1/agents/join`, `GET /api/v1/agents/:participantId`,
`POST /api/v1/agents/:participantId/messages`, `DELETE /api/v1/agents/:participantId`.

## License

MIT
