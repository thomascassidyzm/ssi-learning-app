# Area G — identity transfer, account deletion, and the unauthenticated intake

Part of the **tenth** security audit (see `README.md` in this directory). Branch
`cs/441-reset-eve-security-tests`, cut from `origin/dev` at `e558b43ee`.

**Rules this area ran under:** findings and tests only. No production behaviour changed, no fix
applied, no migration written, no live database read, no external service called, no email or OTP
sent, nothing deleted, nothing promoted.

**Tests:** `api/_security/sec0912t-g-identity-transfer.security.test.ts` (20 assertions). Pure — no
DB, no network, no child process. Rides `pnpm test:api`; pinned in the machinery roster.

## Scope

The census that opened this audit found 68 of 152 API handlers named by no existing security test.
Area G took the ones about **who you are** and the ones that accept input from **nobody in
particular**:

| | |
|---|---|
| Identity transfer | `api/auth/cascade-user-id.ts`, `public.relink_user_tags()` (its SQL twin) |
| Account lifecycle | `api/account/delete.ts` |
| Admin doors not previously audited | `api/admin/{codes,invites,mint-learner,set-learner-flags,set-trial,update-user-role}.ts` |
| Self-service money-adjacent reads | `api/subscription/{cancel,change-plan,portal,index}.ts`, `api/entitlement/{create,grant,grants,list,user,offline-lease}.ts` |
| Own-data reads | `api/me/*` (7 handlers), `api/access/list-grants.ts`, `api/welcome/played.ts` |
| Unauthenticated / machine intake | `api/report/bug.ts`, `api/auth/resend-delivery-webhook.ts`, `api/cron/*` (5) |

---

## 1. Findings

### SEC0912T-G-01 — HIGH — orphaned-identity absorption: a departed colleague's memberships are claimable by anyone who knows their auth uid

**Where.**
- `supabase/schema.sql` — `CREATE FUNCTION public.relink_user_tags(old_user_id text)`, `SECURITY
  DEFINER`, `GRANT ALL … TO anon, authenticated`.
- `api/auth/cascade-user-id.ts` — the same shape in TypeScript, over `govt_admins`, on the
  service-role client.
- `api/account/delete.ts` — the orphan factory.

**What the guard is.** Both doors refuse unless `old_user_id` is **orphaned**: no `learners` row
still holds it. Neither asks whether the **caller** ever owned it. `cascade-user-id.ts` states this
in its own header — *"A future `previous_user_id` history column would let us prove the caller once
owned old_user_id and tighten more."* So the security of both rests entirely on an auth uid being
hard to guess — a UUID treated as a secret by a system that does not treat it as one.

**Why that is reachable, in three steps.**

1. **Deleting an account manufactures the orphan.** `account/delete.ts` deletes the `learners` row
   and relies on `learner_id … ON DELETE CASCADE` reaching every learner-scoped table. But
   `user_tags.user_id` and `govt_admins.user_id` are **TEXT auth-uid columns with no foreign key at
   all** — `user_tags` has no foreign keys whatsoever. Both rows survive the delete, and from that
   instant satisfy the orphan test. The handler then removes the Supabase Auth identity too, so the
   uid left standing in those rows can never again be reclaimed by its owner signing in.

2. **A peer already knows the uid.** The `user_tags` SELECT policy admits every row whose
   `tag_value` is in `my_readable_tag_values()` — for a class teacher, their own classes. `user_id`
   and `role_in_context` come with the row, straight out of PostgREST with the anon key that ships in
   the client bundle. No endpoint is needed and no admin is involved.

3. **The transfer is unscoped.** `relink_user_tags` runs `UPDATE public.user_tags SET user_id =
   auth.uid() WHERE user_id = old_user_id` — no `tag_value` bound, no `role_in_context` bound, no
   restriction to tags the caller could already manage. **Every** tag the departed identity held
   moves, including ones at schools, classes and orgs the caller has never touched.

**Reachability is not theoretical.** `packages/player-vue/src/composables/useAuth.ts:325` calls
`supabase.rpc('relink_user_tags', { old_user_id })` **from the browser**, with the user's own
session — the function is a client-facing RPC, not a server-mediated one — and then `fetch`es
`/api/auth/cascade-user-id` beside it. Whatever the function permits, any signed-in caller permits
themselves, by editing one argument.

**Blast radius.** The caller acquires `role_in_context = 'admin'` rows — which the `user_tags`
INSERT policy and the self-branch of its UPDATE policy both explicitly forbid anyone granting
themselves (`role_in_context IS DISTINCT FROM 'admin'`, twice). A `SECURITY DEFINER` function runs
past the policy that states the rule. On the `govt_admins` side the prize is a whole org's
leadership; `govt_admins_user_id_key` is UNIQUE, so the theft is limited to one row and fails for a
caller who already holds one — a size limit, not an authorisation check.

**Honest gap.** Whether an orphaned `user_tags` or `govt_admins` row exists in the live project
*today* is a query this audit did not run (no live DB read). What the repo establishes is that the
code path which creates one is a supported, user-initiated feature, and that nothing cleans up
after it.

**Fix shape (not applied).** Three independent repairs, any one of which breaks the chain:
- make `account/delete.ts` clear (or tombstone) `user_tags` and `govt_admins` for the deleted uid,
  in the same transaction — the cheapest and the most complete;
- bound `relink_user_tags` to tags the caller can already manage (`my_manageable_tag_values()`),
  so a transfer can never *widen* reach;
- record a `previous_user_id` at claim time and require the caller to prove it, as
  `cascade-user-id.ts` already proposes.

Under RLS doctrine rule 3 the function change is a canary-run change.

---

### SEC0912T-G-02 — MEDIUM — an identity transfer leaves no audit row

**Where.** `api/_utils/auditRole.ts` — `RoleChangeEntry['source']` is a closed union:
`'update-user-role' | 'invite-code' | 'entitlement-code' | 'email-allowlist' | 'grant-entitlement' |
'mint-learner' | 'set-learner-flags'`. Neither transfer door has a member, and
`cascade-user-id.ts` does not import the helper.

**Why it is a finding.** Every other path that moves privilege in this repo writes
`role_change_audit` — that is the estate's answer to "who made this person an admin". A leadership
moving between two people is exactly the event that table exists for, and the only record of it is
`console.log('[CascadeUserId] cascaded', …)` in a Vercel function log with the platform's retention,
not the product's. This is what makes G-01 hard to *detect* after the fact as well as to prevent.

**Fix shape (not applied).** Add `'cascade-user-id' | 'relink-user-tags'` to the source union and
call `auditRole` on both paths; for the SQL function, an insert in the same statement.

---

### SEC0912T-G-03 — LOW (latent) — `screenshot_url` is stored from an unauthenticated caller with no scheme allowlist

**Where.** `api/report/bug.ts:212` — `screenshot_url: str(body.screenshot_url, 600)`, where `str`
is trim-and-truncate and nothing else. The route accepts a report with **no bearer at all** (guest
reports are deliberate), so the writer is anonymous; the two throttles on that path are sound
(see below).

**Why it is reported as latent.** There is no renderer for the column in this repo — the only two
files that mention `screenshot_url` are the sender side (`useBugReport.ts`,
`TesterFeedback.vue`). If a triage view is added anywhere that puts the value in an `href` or an
`img src`, `javascript:` and `data:text/html` are admissible today. That sink is outside this
audit's reach, which is the honest gap; the input side is in scope and is unconstrained.

**Fix shape (not applied).** Constrain the scheme at intake — `https:` only — rather than at every
future renderer.

---

## 2. Checked and cleared

Each of these is pinned by an assertion in the test file so it cannot quietly regress.

- **Cron authentication.** All five crons (`expire-demo-schools`, `org-entitlement-reconcile`,
  `org-free-year-warnings`, `support-doorbell`, `teacher-payouts`) go through `checkCronAuth`, which
  is constant-time (`timingSafeEqual`) and fails **closed** on any deployed environment when
  `CRON_SECRET` is unset. This is a previously-audited fix holding.
- **The Resend delivery webhook.** `bodyParser: false`, Svix HMAC over the raw bytes, a
  five-minute timestamp tolerance so a captured signature does not stay valid forever, an empty
  secret refused rather than skipped, and constant-time comparison. Exemplary; nothing to add.
- **The bug-report throttle** buckets on `x-vercel-forwarded-for` — the peer Vercel attests — and
  never consults the client-supplied `x-forwarded-for`. A per-instance memory map is backed by a
  fleet-wide count of recent guest rows, so a cold lambda cannot reset the limit.
- **Account deletion takes no target.** No `req.body` is read at all; the only identity is the
  bearer. Family and class-entity links are `ON DELETE RESTRICT` and surface as a 409 rather than a
  partial delete.
- **The offline lease** resolves the learner from the bearer only, accepts a course list but
  validates each code against a regex with a hard cap, and sets `Cache-Control: no-store` so an
  entitlement answer is never edge-cached.
- **`api/entitlement/list.ts`** hand-rolls its admin check rather than calling `verifyAdmin` — a
  divergence worth noting, but the hand-rolled version is the *safer* of the two here: a failed
  learner lookup yields `null` and a 403, where `verifyAdmin` deliberately 500s. Not a finding.
- **`api/admin/codes.ts`** is a bare-authenticated door on an admin-named path; a non-admin caller
  gets their own created codes only (`.eq('created_by', userId)`) and is refused on every toggle
  they do not own. Correct.
- **`api/me/profile.ts`** is read-only — no write path, so no mass-assignment surface.
- The four subscription self-service routes take no caller-supplied subscription or learner id.

---

## 3. The honest gap

No live database was read and no endpoint was called. Every finding is derived from repo source, so
each is a statement about what the code permits, not about what has happened. Two consequences worth
stating plainly:

1. **G-01's precondition is unmeasured.** The audit shows the orphan-creating path and the
   orphan-claiming path exist and meet; it does not show that an orphaned row is sitting in the live
   project right now. The query that would settle it is one `SELECT` against `user_tags` and
   `govt_admins` anti-joined to `learners` — worth running under the live-DB rules, by someone with
   that access, before this is prioritised.
2. **G-03's sink is outside this repo.** If bug reports are triaged in a surface that lives
   elsewhere, that surface is where the XSS question is actually decided.
