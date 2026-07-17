# Plan 010: Harden player-events — trusted identity, per-event validation, no error leak

> **Executor instructions**: Follow step by step; run every verification command.
> Honor STOP conditions. Update `plans/README.md` when done.
>
> **Drift check (run first)**: `git diff --stat 5fb4a42f..HEAD -- api/player-events.ts`
> If it changed, re-read the handler before editing.

## Status

- **Priority**: P2
- **Effort**: M
- **Risk**: MED (tightening identity could drop legitimate guest/anon events if done
  carelessly — guests are a real, supported case)
- **Depends on**: none
- **Category**: security / bug
- **Planned at**: commit `5fb4a42f`, 2026-07-17

## Why this matters

`POST /api/player-events` is unauthenticated (CORS `*`) and derives the learner
identity from a client-set `ssi-user-id` cookie, validated only as a UUID shape, then
dual-writes it into both `user_id` and `learner_id` of every row under the service
role. Three problems:
1. **Identity spoofing**: any client can set `ssi-user-id` to an arbitrary learner PK
   and inject analytics attributed to that learner — poisoning `player_events`, which
   `CLAUDE.md` names as the source of truth for learner activity and the schools
   dashboards.
2. **Batch poisoning**: one malformed event (e.g. a non-timestamp `occurred_at`, a
   non-UUID `session_id`) fails the entire 50-row insert; a client retrying the same
   buffer loses that learner's telemetry permanently.
3. **Error leak**: on failure the handler returns the raw PostgREST/Postgres
   `error.message` to an unauthenticated caller.

## Current state

`api/player-events.ts:95-134`:

```ts
  const rawUserId = (req.cookies?.['ssi-user-id'] as string | undefined) || null
  const userId = rawUserId && UUID_RE.test(rawUserId) ? rawUserId : null   // shape-only
  ...
  const rows = events
    .filter((e) => e && typeof e.event_type === 'string' && e.event_type.length > 0)
    .map((e) => ({
      occurred_at: e.occurred_at || new Date().toISOString(),   // trusts arbitrary client string
      user_id: userId,
      learner_id: userId,
      course_code: e.course_code || null,
      session_id: e.session_id || null,                          // unvalidated (uuid column)
      event_type: e.event_type.slice(0, 64),
      payload: e.payload ?? null,                                // unbounded size
      ...
    }))
  ...
  // on error:  return res.status(...).json({ error: error.message })   // leaks raw DB text
```

There is an existing `UUID_RE` in the file (used for the cookie). Guests legitimately
log with `null` identity (a `guest-<uuid>` cookie is intentionally coerced to null).

## Commands you will need

| Purpose      | Command                                        | Expected |
|--------------|------------------------------------------------|----------|
| Install      | `pnpm install`                                 | exit 0   |
| Test file    | `pnpm test:api -- api/player-events`           | pass     |
| All API tests| `pnpm test:api`                                | all pass |
| API typecheck| `pnpm typecheck:api`                            | exit 0   |

## Scope

**In scope**:
- `api/player-events.ts` — trusted identity when a bearer is present; per-event
  sanitization; bounded payload; generic error response.
- `api/player-events.test.ts` (exists) — extend with the new cases.

**Out of scope**:
- Removing guest/anon logging — guests must still log with `null` identity.
- Changing the `player_events` schema or the dual-write (`user_id`+`learner_id`) —
  the Identity Phase-1 expand is deliberate (see the comment at `:108-112`); keep it.
- Client code that sends events (a separate change; server must stay tolerant).

## Git workflow

- Branch: `advisor/010-player-events-hardening` from `dev`.
- Commit style: `fix(security): trust JWT identity + validate events in player-events`.

## Steps

### Step 1: Prefer verified identity when a bearer is present

If the request carries an `Authorization: Bearer` token, verify it (reuse the
project's auth helper — see how other handlers verify, e.g. `api/_utils/auth`'s
`verifyAuthToken`), map the auth uid → `learners.id` (the canonical learner PK — see
`current_learner_id()` / the `learners.user_id = auth.uid()` mapping described in
`CLAUDE.md`), and use **that** as the identity, ignoring the cookie. Only when there
is no bearer do you fall back to the cookie/null (guest) path. Reject an event whose
client-claimed id contradicts the verified session (or simply overwrite with the
verified id — overwrite is simpler and safe).

**Verify**: `pnpm typecheck:api` exits 0.

### Step 2: Per-event sanitization (don't poison the batch)

Sanitize each event independently rather than trusting client strings:
- `occurred_at`: accept only a valid ISO timestamp; otherwise default to
  `new Date().toISOString()` (never pass an arbitrary string to the uuid/timestamp
  columns).
- `session_id`: keep only if it matches `UUID_RE`, else `null` (same hazard the cookie
  guard already handles).
- `payload`: cap serialized size (e.g. drop or truncate if `JSON.stringify(payload)`
  exceeds a sane limit like 8 KB).
Drop invalid **fields**, not the whole batch. Only skip an event entirely if it has no
valid `event_type` (already the case).

**Verify**: `pnpm typecheck:api` exits 0.

### Step 3: Generic error response

On insert failure, `console.warn`/`error` the real detail server-side but return a
generic `{ error: 'insert failed' }` (no `error.message`) to the client.

**Verify**: `pnpm typecheck:api` exits 0.

### Step 4: Tests

Extend `api/player-events.test.ts`:
- A bearer token's verified identity overrides a conflicting `ssi-user-id` cookie.
- No bearer + guest cookie → identity `null` (guest path still works).
- A batch with one bad `occurred_at`/`session_id` still inserts the valid events
  (the bad fields are nulled/defaulted, the batch is not rejected).
- An insert error returns `{ error: 'insert failed' }`, not raw DB text.

**Verify**: `pnpm test:api -- api/player-events` passes.

### Step 5: Full suite green

**Verify**: `pnpm test:api` all pass; `pnpm typecheck:api` exits 0.

## Test plan

- New cases as in Step 4. Pattern: existing `api/player-events.test.ts` +
  `api/code/redeem.test.ts` for the auth mock.
- Verification: `pnpm test:api` all pass.

## Done criteria

ALL must hold:

- [ ] When a valid bearer is present, the persisted identity comes from the JWT, not
      the cookie (test proves override).
- [ ] Guest (no bearer) events still persist with `null` identity.
- [ ] A single malformed event no longer fails the whole batch (test proves it).
- [ ] Error responses never contain raw DB text.
- [ ] `pnpm test:api` all pass; `pnpm typecheck:api` exits 0.
- [ ] `plans/README.md` status row updated.

## STOP conditions

Stop and report if:
- There is no server-side helper to verify a Supabase JWT and map to `learners.id`
  within the api layer — report; do not hand-roll JWT verification.
- Requiring a bearer would break the primary client, which currently sends events
  without one — the design here keeps the guest fallback precisely to avoid that, but
  if the client *authenticated* path can't attach a token yet, land Steps 2-3
  (validation + no leak) and report Step 1 as blocked on client token attachment.
- The handler doesn't match the excerpt (drift).

## Maintenance notes

- Full closure of the spoofing vector depends on the client attaching a bearer to
  event posts; until then Step 1 hardens authenticated posts and Steps 2-3 harden all.
- This interacts with the Identity-rationalisation work in `CLAUDE.md` — when
  `player_events.user_id` is renamed to `learner_id` (expand-contract), keep the
  verified-identity write pointed at the canonical column.
- Reviewer: confirm guests can still log (regression risk is dropping anon events).
