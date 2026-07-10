# PairUX Premium — "$1/month, up to 100 listeners"

**Status:** proposed · **Owner:** anthony · **Date:** 2026-07-10

Next-step monetization plan for a cheap, high-value **audience tier**: for **$1/month**
a host can run a room with **up to 100 concurrent listeners**, versus **5** on Free.

This is deliberately a small, shippable increment. It **reuses** the billing plumbing
already built on the `feat/paid-multistream-plugin` branch (CoinPay invoices,
`profiles.plan`, `plan_payments`, `grant_plan()`, checkout + webhook, `usePlan` hook,
pricing page). The only genuinely new concept is a **capacity entitlement** — a
per-plan listener cap — layered on top of that scaffold.

---

## 1. Where we are today

- **Stack:** Next.js web (`apps/web`), Electron desktop (`apps/desktop`), mobile,
  **LiveKit** SFU (`apps/livekit`) + coturn (`apps/turn`). Supabase auth/DB.
- **Rooms are room-centric.** `SessionMode` is `p2p` (Free) or `sfu` (LiveKit relay).
- **There are THREE hard ceilings today, none plan-aware — all must be raised:**
  1. `apps/web/src/lib/validations.ts:77` — `maxParticipants: z.number().min(1).max(10).default(5)` (web input cap).
  2. `join_session` RPC (`supabase/migrations/20250126000003_fix_join_session_race_condition.sql:50-80`)
     — reads `settings->>'maxParticipants'` and `RAISE EXCEPTION 'Session is full'` at count ≥ max.
     **This is the real server-side gate**, and it applies to SFU too (LiveKit join requires being a joined participant).
  3. `apps/livekit/livekit.yaml:25` (and `setup-livekit-server.sh:351`) — `max_participants: 20`
     on the **SFU server itself**. 100 listeners is impossible until this is raised.
     Marketing copy (`pricing/page.tsx`, `public/llms.txt:25`) claims Free "5 viewers" / SFU "100k" but is **not** wired to any of these.
- **SFU join:** `apps/web/src/app/api/livekit/token/route.ts` mints a LiveKit
  `AccessToken`. It currently **requires the joiner to be an authenticated
  session participant** (403 otherwise) — so there is no "anonymous listener" path yet.
- **No "listener" concept exists** in code today — this tier introduces the term. Closest
  existing concept: `viewer_count`, already computed per public room by the `list_public_rooms`
  RPC (from the shipped `/live` directory) — the natural place to display/enforce the count.
- **Billing (unmerged, on `feat/paid-multistream-plugin`):**
  - `profiles.plan` ∈ {`free`,`pro`,`team`} + `plan_expires_at` (migrations
    `20260611120000`, `20260611130000`), `plan_payments` table, `grant_plan(user,plan,days)` RPC.
  - `effectivePlan(plan, expiresAt)` in `packages/shared-types/src/database.ts` — lapses paid → free on expiry.
  - `apps/web/src/lib/plans.ts` catalog (`pro` $12, `team` $49, `TERM_DAYS=31`).
  - `apps/desktop/src/shared/entitlements.ts` — today gates **streaming platforms**, not capacity.
  - Checkout `POST /api/billing/checkout`, webhook `POST /api/webhooks/coinpay` (idempotent).
  - Pricing page `apps/web/src/app/pricing/page.tsx`, `usePlan` hook.

**Gap:** the existing tiers gate _which streaming platforms you can fan out to_. They do
**not** gate _how many people can be in your room_. This plan adds that second dimension.

---

## 2. Product decision: what "$1 / 100 listeners" means

**A "listener" = a read-only SFU subscriber** (`canPublish:false, canSubscribe:true`) —
someone who joins to watch/hear the host but does not present. This mirrors a Twitter
Space / Discord Stage "audience" role.

### Economic reality (important)

100 **video** viewers at $1/mo is bandwidth-negative on a relay. 100 **audio** listeners
is cheap and sustainable. So the tier is framed **audio-first**:

- The **100 cap applies to audio+screen-share listeners** (Opus audio + the host's single
  screen track fanned out — the cheap, common case: teaching, standups, watch-alongs).
- **Video is not the headline.** Free/Plus keep the existing low interactive-video cap;
  large _video_ rooms remain a future Pro/Team lever (or metered viewer-hours, which the
  pricing FAQ already anticipates).

This keeps $1 honest while still being a real 20× jump (5 → 100).

### Tier ladder (proposed)

Insert **Plus** between Free and Pro. Capacity becomes a first-class entitlement:

| Plan | Price  | Max concurrent listeners | Mode              | Notes                      |
| ---- | ------ | ------------------------ | ----------------- | -------------------------- |
| Free | $0     | **5**                    | P2P               | unchanged, forever         |
| Plus | **$1** | **100**                  | SFU (LiveKit)     | the new headline tier      |
| Pro  | $12    | 500                      | SFU + multistream | existing streaming unlocks |
| Team | $49    | 2000                     | SFU + multistream | existing                   |

(Pro/Team caps are placeholders — set to whatever ops wants. Only Free=5 and Plus=100 are load-bearing for this milestone.)

---

## 3. Design: capacity as an entitlement

Add one pure function and thread it through the three enforcement points.

```ts
// packages/shared-types/src/entitlements.ts  (new, shared web+desktop)
export const LISTENER_CAP: Record<Plan, number> = {
  free: 5,
  plus: 100,
  pro: 500,
  team: 2000,
};
export function maxListeners(plan: Plan): number {
  return LISTENER_CAP[plan] ?? LISTENER_CAP.free;
}
```

Always resolve against `effectivePlan(profile.plan, profile.plan_expires_at)` so a lapsed
Plus room silently falls back to the Free cap of 5 (existing paid rooms don't get cut
mid-session — enforce at _join_, not by kicking).

---

## 4. Phased implementation

### Phase 0 — Land the billing rails (prerequisite)

The scaffold exists but is unmerged and is _streaming_-shaped. Rebase/merge
`feat/paid-multistream-plugin` to `master` **first**, or cherry-pick the plumbing
(migrations, `plans.ts`, checkout, webhook, `plan_payments`, `grant_plan`, `usePlan`).
Deploys from `master` only (feature branches aren't live).

- [ ] Merge/rebase billing branch to master; confirm CoinPay env wired
      (`COINPAY_*`, webhook secret) in Railway.
- [ ] Confirm business has a wallet/settle target on CoinPayPortal (the goldvpn blocker
      — a $1 tier is worthless if payments can't settle).

### Phase 1 — Data model: add the `plus` plan

- [ ] Migration: widen the CHECK constraints to include `'plus'`:
      `profiles.plan` CHECK and `plan_payments.plan` CHECK → `('free','plus','pro','team')`.
      (New migration file, e.g. `20260710_add_plus_plan.sql` — do **not** edit the shipped ones.)
- [ ] `packages/shared-types`: extend `Plan` union with `'plus'`; add
      `entitlements.ts` (`maxListeners`, `LISTENER_CAP`) + unit tests; barrel-export.
- [ ] `apps/web/src/lib/plans.ts`: add `plus: { id:'plus', label:'PairUX Plus', priceUsd: 1 }`;
      `getPlanDef` already returns null for unknown ids — extend the guard.

### Phase 2 — Enforce the cap (server-side, the load-bearing part)

**Four** gates, all resolving `effectivePlan` for the **room owner**:

1. **SFU server ceiling** — `apps/livekit/livekit.yaml:25` + `setup-livekit-server.sh:351`.
   Raise `max_participants: 20` → e.g. `2100` (highest tier + headroom). This is infra config,
   not per-room; the per-room cap is enforced in app logic (gates 2–4). **Redeploy the LiveKit
   server** or 100 listeners is physically impossible regardless of app changes.
2. **Session creation** — `apps/web/src/app/api/sessions/route.ts` + `validations.ts:77`.
   Replace the static `.max(10)` with a server check: clamp/validate `maxParticipants`
   against `maxListeners(ownerPlan)`. Free caps at 5, Plus at 100. Return 400 (or clamp
   with a warning) when a Free user requests > 5.
3. **`join_session` RPC** — `supabase/migrations/.../fix_join_session_race_condition.sql`.
   This is the authoritative server-side "Session is full" gate. It already reads
   `settings->>'maxParticipants'`, so as long as gate 2 writes the plan-derived cap into
   `settings.maxParticipants` at create-time, this RPC enforces it **for free** — no RPC
   change needed _if_ the cap is baked into settings. (If you'd rather derive live from the
   owner's plan, a new migration would join `profiles.plan` here.)
4. **LiveKit token mint** — `apps/web/src/app/api/livekit/token/route.ts` (belt-and-suspenders
   for the anonymous path, which bypasses `join_session`). Before issuing a subscriber token,
   count active room occupancy (`session_participants` where `left_at IS NULL`, or LiveKit
   `RoomServiceClient.listParticipants`) and **reject with 403 "Room is full (N/limit)"** at/over cap.
5. **Anonymous listener path (new capability Plus needs).** Today the token route 403s
   non-participants, so a "public 100-person audience" is impossible. Add a **listen-only
   token** for rooms flagged public in the `/live` directory: `canPublish:false`,
   `canSubscribe:true`, no session-participant requirement, still counted against the cap.
   Gate this behind `session.is_public` + owner plan ≥ Plus.

### Phase 3 — Surface it (web)

- [ ] `apps/web/src/app/pricing/page.tsx`: add the **Plus $1/mo** card
      ("Host up to 100 listeners · Public /live room · SFU relay"). Reword the Free card to
      "up to 5 listeners". `UpgradeButton` already posts to checkout — extend the
      checkout `Body` enum (`z.enum(['pro','team'])` → add `'plus'`) in
      `apps/web/src/app/api/billing/checkout/route.ts`.
- [ ] Join/host UI capacity display: `join/[joinCode]/page.tsx:442` already renders
      `count / maxParticipants` — point it at the plan cap; show "Room full — the host can
      upgrade to Plus for 100 listeners" on the 403.
- [ ] `/live` directory: badge Plus rooms, show live listener counts, and let a Plus host
      mark a room public (ties into the SECURITY-DEFINER public-read RPCs already used by `/live`).

### Phase 4 — Desktop

- [ ] `apps/desktop/src/shared/entitlements.ts` + `usePlan` hook: expose `maxListeners`
      so the host UI shows the cap and an "Upgrade to Plus" prompt when they hit it.
      No new billing UI needed — desktop deep-links to the web `/pricing` checkout.

### Phase 5 — Guardrails & polish

- [ ] Enforce **audio-first**: for Plus rooms over ~10 occupants, don't auto-subscribe
      remote _video_ on listeners (audio + host screen-share only) to hold the unit economics.
- [ ] Metrics: log peak concurrent listeners per session (PostHog is already a dep on the
      branch) to watch cost per $1 room.
- [ ] Copy/FAQ: define "listener" on the pricing page; note video-heavy rooms are Pro/Team.

---

## 5. Enforcement-point cheat sheet

| Concern                       | File                                                          | Change                                                                    |
| ----------------------------- | ------------------------------------------------------------- | ------------------------------------------------------------------------- |
| Plan union / cap fn           | `packages/shared-types/src/{database,entitlements}.ts`        | add `plus`, `maxListeners()`                                              |
| Plan catalog                  | `apps/web/src/lib/plans.ts`                                   | add `plus` @ $1                                                           |
| **SFU server ceiling**        | `apps/livekit/livekit.yaml:25`, `setup-livekit-server.sh:351` | raise `max_participants: 20` → 2100 + redeploy                            |
| Create-room cap               | `apps/web/src/lib/validations.ts:77`, `api/sessions/route.ts` | plan-driven max, not static 10                                            |
| **`join_session` full-check** | `supabase/migrations/*join_session*` RPC                      | already reads `settings.maxParticipants` — free if create writes plan cap |
| **SFU token cap**             | `apps/web/src/app/api/livekit/token/route.ts`                 | occupancy check + reject at cap                                           |
| Anonymous listeners           | same token route                                              | listen-only grant for public rooms                                        |
| DB constraint                 | new `supabase/migrations/*_add_plus_plan.sql`                 | widen CHECK to include `plus`                                             |
| Checkout                      | `apps/web/src/app/api/billing/checkout/route.ts`              | accept `plus`                                                             |
| Pricing UI                    | `apps/web/src/app/pricing/page.tsx`                           | Plus card                                                                 |
| Capacity UI                   | `join/[joinCode]/page.tsx:442`, host page                     | show `n / cap`, full-room upsell                                          |

---

## 6. Open questions

1. **Listener definition on the cap** — audio-only vs audio+screen-share vs full video?
   (Recommendation: audio + host screen-share counts; listener video off by default.)
2. **Pro/Team caps** — 500 / 2000 are placeholders; confirm with ops + LiveKit cost model.
3. **Anonymous vs signed-in listeners** — does a public 100-listener room require accounts,
   or allow ephemeral guests? (Anonymous maximizes reach for the $1 audience pitch.)
4. **Billing cadence** — CoinPay is invoice-per-term (31 days), not a true auto-renew
   subscription. "$1/month" = pay-again-monthly. Acceptable, or do we want card auto-renew?

```

```
