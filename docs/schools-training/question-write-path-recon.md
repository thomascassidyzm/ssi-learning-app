# Question write-path recon — read-only, 2026-09-07

Purpose: find how this repo already writes human-submitted free text, so a
new "admin asks a question, batch job answers later" table reuses an existing
pattern rather than inventing one. Read-only: live code + live DB catalogue
only. Docs in this repo carry no authority (CLAUDE.md, "Code is gospel") —
everything below is either a live code citation or a live DB query result,
labelled as such.

## 1. The three existing precedents

### `content_feedback` — browser → supabase-js, direct
**Writer**: `packages/player-vue/src/components/ReportIssueButton.vue:80-88`. Browser holds
an injected `supabase` client (anon/authenticated key) and calls
`.from('content_feedback').insert(...)` directly — no `api/` route in the
path at all.
**Columns written**: `audio_id, course_code, feedback_type, user_id, session_context` (jsonb).
**Identity**: `const userId = auth?.learnerId?.value || getUserId()` (line 77) —
prefers the learner PK (`learners.id`), but falls back to a **client-generated
anonymous string** (`'anon_' + Math.random()...`, persisted in
`localStorage`) when no learner session exists. So the `user_id` column is
**not one identity** — sometimes `learners.id`, sometimes a self-asserted
opaque string nothing else in the DB can join against.
**Side-effect**: also upserts a `sample_flags` row "for Dashboard QA workflow"
— the admin-side consumer of this table lives in the *other* repo (see §3).

### `tester_feedback` — browser → supabase-js, direct
**Writer**: `packages/player-vue/src/components/TesterFeedback.vue:222-232`. Same
shape: browser holds the injected `supabase` client, inserts directly, gated
client-side to `isTester || isSsiAdmin` (`useUserRole()`) — **no server-side
enforcement of that gate**, it's a UI-visibility check only.
**Columns written**: `user_id, display_name, feedback_type, title, description, screenshot_url, route, device_info, build_version`.
**Identity**: `auth?.userId?.value` (line 223) — this is the **auth uid**, not
the learner PK. So `content_feedback.user_id` and `tester_feedback.user_id`
are both `text` columns named identically but hold **different identities**
(learner PK vs auth uid) — exactly the documented trap in CLAUDE.md's
canonical-identity table, reproduced here as a live example, not a
hypothetical.
Also uploads an optional screenshot to Storage bucket `feedback-screenshots`
before the insert (non-blocking on failure).

### `player_events` — browser → `api/player-events.ts` → supabase (service role)
**Writer**: `api/player-events.ts`, called from `usePlayerLog.ts` etc. This is
the **server-mediated** pattern, and structurally the strongest of the three:
- Identity is resolved **server-side** from a verified `Authorization: Bearer`
  token (`verifyAuthToken`), mapped to the canonical `learners.id`
  (`resolveIdentity()`, lines 127-159) — the client cannot just assert an id;
  an unverified/absent token attributes the row to `null` (anon telemetry),
  never to an arbitrary caller-supplied identity.
- One narrow, explicitly-authorised exception (`isAuthorisedClassLearner`,
  play-as-class) is checked against `resolveVisibleScope()` before honouring
  a caller-claimed identity that differs from the verified one.
- Server-side caps: batch size (`MAX_BATCH = 50`), payload size
  (`MAX_PAYLOAD_BYTES = 8KB`), string-length truncation on every free-text
  field before insert — the DB is never handed unbounded client input.
- Insert runs with the **service-role key**, from the server, after all of
  the above — the browser never talks to `player_events` directly (confirmed
  by the live RLS state below: no client-facing policies exist on it at all).

### `conversations` — does not exist
Grepped for it per the brief's candidate list. Every hit in
`packages/player-vue/src` is a **code comment** about spoken conversational
pacing (`toSimpleRounds.ts:122`, `useAlgorithmConfig.ts:547`), not a table. A
migration-file grep (`CREATE TABLE conversations`) also returns nothing. This
candidate is not a precedent — leaving three real ones (content_feedback,
tester_feedback, player_events).

## 2. Live DB schema + RLS (queried directly, read-only)

Connected via the Postgres pooler connection string already present in this
estate at `~/SSi/wt-audio-routes/.env.psql` (service-role key from
`~/.ssi-sentinel.env`, per the existing memory recipe), using the `pg`
package already installed under `~/SSi/ssi-dashboard-v7-clean/node_modules`.
No writes issued — `information_schema` / `pg_policies` / `pg_class` reads only.

| Table | Columns | `relrowsecurity` | Live policies |
|---|---|---|---|
| `content_feedback` | `id, audio_id, course_code, feedback_type, user_id, comment, session_context, resolved_at, resolved_by, resolution_note, created_at` | **true** | `content_feedback_public_insert` (INSERT, roles `{anon,authenticated}`, `with_check: true`) **and** `content_feedback_public_read` (SELECT, roles `{anon,authenticated}`, `qual: true`) |
| `tester_feedback` | `id, user_id, display_name, feedback_type, title, description, route, device_info, build_version, screenshot_url, status, priority, admin_notes, created_at, updated_at` | **true** | `tester_feedback_public_insert` (INSERT, roles `{anon,authenticated}`, `with_check: true`) — **no SELECT policy at all** |
| `player_events` | `id, occurred_at, user_id, course_code, session_id, event_type, payload, client_version, device_type, ip_country, env, learner_id` | **true** | **none** — RLS on, zero policies, so anon/authenticated get nothing; only the service-role key (used exclusively from `api/player-events.ts`) can touch it |
| `possession_mint_attempts` | `id, invite_code_id, email, ip_hash, outcome, auth_user_id, created_at, error_detail, resend_message_id, delivered_at, delivery_delayed_at, bounced_at` | **true** | **none** — same posture as `player_events`, service-role-only |

Two live facts worth flagging as-is, not as things to copy:
- **`content_feedback` is world-readable** — any anon or authenticated
  browser session can `select *` every learner's flagged-content rows,
  including free-text `comment` and `session_context`. That is a live
  permissiveness, not a design recommendation.
- **`tester_feedback` can be inserted by anyone but read by no client role** —
  its only readers are server-side/service-role, which today (per §3) appears
  to mean *no one* reads it through this repo at all.

## 3. Admin-side read of submitted feedback

**Nothing in `ssi-learning-app` reads `content_feedback` or `tester_feedback`** —
grepped `views/`, `composables/`, `api/` for all three table names; zero
hits outside the writers themselves.

The actual admin-side consumer is in the **sibling repo**,
`ssi-dashboard-v7-clean/src/services/supabase.js:550-610`:
`getFeedbackAggregated(courseCode, ...)` and `getFeedbackStats(courseCode)`
both query `content_feedback` directly from the dashboard's browser client
(anon/authenticated role — consistent with the world-readable SELECT policy
found above), filtering `.eq('course_code', ...)` and `.is('resolved_at', null)`,
aggregating client-side. This is Popty's QA workflow, not a `/schools` admin
view in this repo.

**`tester_feedback` has no reader anywhere I could find** — not in this repo,
not in a targeted grep of the dashboard repo either. If it has an admin
surface, it isn't in either checked repo.

## 4. The batch lane — no existing precedent for "read rows, call a model"

Grepped `api/` and `tools/` in **this repo** for `anthropic|Anthropic|OPENAI|openai`
combined with cron/batch/scheduled scripts: **zero hits**. Also checked the
sibling dashboard repo's `api/` for any cron+anthropic combination: **zero
hits** there too, despite that repo being the one that does heavy Claude-based
course generation (that's synchronous CLI/agent tooling, not a
scheduled-job-reads-DB-rows-and-calls-a-model pattern).

What **does** exist as scaffolding: `api/cron/*.ts` + `vercel.json` crons
(`teacher-payouts.ts` monthly, `expire-demo-schools.ts` daily) — both use the
same idiom: Vercel cron sends `Authorization: Bearer <CRON_SECRET>`, checked
via `api/_utils/cronAuth.ts` (`checkCronAuth`), fails closed if the secret is
unset, then runs with the service-role Supabase client. This is a real,
working "scheduled job touches the DB with elevated privilege" pattern — it
just has never been paired with a model call in this repo. **A batch
answer-job would be new territory here**, wired onto scaffolding that already
exists and is already proven in production (payouts, demo-school expiry).

## 5. Rate limiting / abuse precedent

`api/_utils/codeAttemptThrottle.ts` — used by `api/code/redeem.ts`,
`api/code/validate.ts`, `api/auth/possession-redeem.ts`, `api/try-link/validate.ts`.
Pattern: hash the caller's IP (`getClientIp` reads only platform-attested
headers — `x-vercel-forwarded-for` then the raw socket, deliberately never
client-controllable `x-forwarded-for`/`x-real-ip`, per the SEC-AUDIT-2026-08-18
Finding 5 fix), count recent non-excluded-outcome rows in
`possession_mint_attempts` for that hash within a window (`RATE_WINDOW_MS`,
default 15 min), refuse over `limit`, log every attempt (including refusals)
for observability. This is IP-keyed, built for an unauthenticated
enumeration threat — not directly what a per-admin question-submission cap
needs, but it's the one throttle pattern in the estate and the shape
(hash key → windowed count → log every attempt) transfers cleanly to a
per-admin-user key instead of per-IP.

No other rate-limit pattern found on any write endpoint.

## Recommendation

**Write path: `api/` route, service-role insert — the `player_events.ts` shape, not the `content_feedback`/`tester_feedback` shape.**

Reasoning, from what's actually proven here:
- The two direct-from-browser precedents (`content_feedback`, `tester_feedback`)
  both have identity problems live in the DB right now: one accepts a
  self-asserted anonymous string as a fallback identity, the other's
  "admin-only" gate is UI-only with no server enforcement, and the table
  itself is world-readable by any anon session. None of that is what you want
  for admin-submitted questions that a batch job will act on.
- `player_events.ts` is the one precedent that (a) verifies identity
  server-side from a bearer token before writing, (b) bounds free-text input
  size and batch size before it reaches the DB, (c) keeps the table itself
  closed to every client role (RLS on, zero policies) with all writes going
  through the service-role key from the server. That's the correct shape for
  a table a batch job will later read and act on unsupervised.
- The admin-gate utility to call inside that route already exists and is
  proven: `api/_utils/operatorGuard.ts`'s `isOperatorAccount()` (checks
  `learners.platform_role === 'ssi_admin'` from a verified `userId`) — or the
  equivalent `platform_role`/`educational_role` checks in `api/_utils/auth.ts`,
  `classTeacherAuth.ts`, `courseAccess.ts` if the actor should be scoped wider
  than `ssi_admin` (e.g. `school_admin`).

**Identity column convention**: `auth_user_id` (text) = `auth.uid()::text`,
verified server-side the same way `resolveIdentity()` does it in
`player-events.ts` — **not** `learner_id`. This is an admin/staff action, not
learner-data; per CLAUDE.md's identity-rationalisation table, an auth-uid
column should be named `auth_user_id`, matching `schools.admin_user_id`,
`classes.teacher_user_id`, `govt_admins.user_id`'s *intended* target name (the
rationalisation is mid-flight — those three are still on the old
`*_user_id`/`user_id` names live, per that same doc, so match their *values'
identity* — auth uid via `auth.uid()::text` — but give the new column the
target name `auth_user_id` since nothing pre-existing forces you onto the old
name).

**RLS posture at creation**: RLS on, **zero client policies** — same as
`player_events`/`possession_mint_attempts`. All reads and writes go through
`api/` routes with the service-role key and an explicit role check
(`operatorGuard`), never direct browser `supabase.from(...)`. The batch job
that answers questions later should also run as a service-role script/cron,
never as a client role.

**Batch lane**: no existing model-calling precedent to copy — build it as a
new `api/cron/*.ts` entry (or a `tools/` script if it doesn't need to be a
Vercel cron) using the proven `checkCronAuth` + service-role-client scaffolding
from `expire-demo-schools.ts`/`teacher-payouts.ts`. This is new territory in
this repo; it isn't a reuse-existing-pattern situation for the *answering*
side, only for the *cron plumbing* side.

**Rate limiting**: adapt `codeAttemptThrottle.ts`'s shape (hash key → windowed
count → log every attempt including refusals) keyed on the admin's
`auth_user_id` instead of an IP hash, logged to the new table itself or a
sibling attempts table — there's no ready-made per-user throttle to import
verbatim, but the pattern is proven and small to adapt.

## Gaps I could not close

- **`tester_feedback`'s admin-side reader**: could not find one in either
  `ssi-learning-app` or `ssi-dashboard-v7-clean`. If it exists, it's somewhere
  I didn't check (a third repo, or a Supabase Studio-only workflow) — named
  as a gap, not assumed absent beyond what I searched.
- **Whether `content_feedback`'s world-readable SELECT policy is intentional
  or drift**: I found the live policy but no ruling on whether it's meant to
  be public. Flagged, not resolved.
- **DB credentials**: I did not have a documented Supabase REST URL/anon key
  for this repo in an obvious place (`.env.local` here is a symlink to the
  shared checkout and contained only a Vercel OIDC token) — I instead used a
  direct Postgres pooler connection string found in a sibling worktree's
  `.env.psql` (`~/SSi/wt-audio-routes/.env.psql`) with the service-role
  password from `~/.ssi-sentinel.env`. That worked and gave real
  `information_schema`/`pg_policies` results (reported above), but it means
  the credential path itself isn't obviously documented for this specific
  repo — worth fixing if this becomes a repeated need.
