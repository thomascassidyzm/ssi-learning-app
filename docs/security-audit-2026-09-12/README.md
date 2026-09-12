# Security & vulnerability audit — 2026-09-12

The **ninth** security audit of this repo. Branch `cs/297-reset-eve-security-tests`, cut from
`origin/dev` at `a1ee6815`. One session, no fan-out.

**Rules this audit ran under:** findings and tests only. No production behaviour was changed, no fix
was applied, nothing was promoted, no money moved, no email or OTP was sent, no TTS was generated,
nothing was deleted.

**Outward contact: NONE.** No live database was read or probed, no external service was called, no
`pnpm audit` was run. That is the honest gap and it bounds every finding below: each is derived from
repo source — handlers, `supabase/migrations/**`, `supabase/schema.sql` — not from live state. Two
findings say explicitly which side of the apply line they sit on.

Tests: `api/_security/sec0912-a-org-tenancy.security.test.ts` (11) and
`api/_security/sec0912-b-support-channel.security.test.ts` (18). Both ride `pnpm test:api`, both are
pure (no DB, no network, no child process), and both are pinned in the machinery roster.

---

## 0. What chose the scope

The 2026-09-05 audit's base was `92954eb2`. Since then the repo grew five security-relevant
subsystems that no audit has seen:

| Subsystem | Files |
|---|---|
| The admin **intel** surface | `api/intel/*` (8 endpoints), `_utils/realLearnerPopulation.ts`, `_utils/entitlementCohort.ts` |
| The **org intel** lens for leaders | `api/org/intel.ts` |
| The in-app **support channel** | `api/support/*`, `supabase/migrations/20260911{,b}_*.sql`, `api/cron/support-doorbell.ts` |
| The **org-enrolment** money path | `api/org/{enrol,enrolment-cancellation,funder-export,subscription}.ts`, `_utils/org*.ts`, two new crons |
| **copy-teacher-play** (a cross-account write) | `api/school/copy-teacher-play/*`, `_utils/classProgressCopy.ts` |

Plus the Resend delivery webhook (`api/auth/resend-delivery-webhook.ts` + `_utils/svixSignature.ts`)
and the account-claim rule (`_utils/unclaimedMint.ts`, `api/auth/claim-account.ts`).

---

## 1. Findings

### SEC0912-A-01 — MEDIUM — `is_govt_admin_over_group()` still decides the subtree on a name-derived path string

> **CLOSED 2026-09-12 (job #300).** `supabase/migrations/20260912b_is_govt_admin_over_group_by_parent_id.sql`, canary-applied live: the predicate walks `parent_id` up from the target and never reads `path`. Proof in `supabase/secfix-toolkit/canary_20260912_support_grant_and_govt_subtree.cjs` (32/32 green at commit; all 42 real govt_admins' visible sets identical before and after).

**Where.** `supabase/schema.sql`, the live definition:

```sql
WHERE ga.user_id = (auth.uid())::text
  AND (target_g.path = admin_g.path
       OR target_g.path LIKE admin_g.path || '/%')
```

**Why it is a finding.** The 2026-08-25 audit found this exact defect (TENANCY-02 / TENANCY-04 /
TENANCY-05) and fixed it — *in TypeScript*. `api/groups/[id]/rate-compare.ts` now carries the
repair and the reason in its own comment: *"Never by slug path (TENANCY-02, fixed 2026-08-25): slugs
are not unique, so two unrelated ROOT orgs with the same name get EQUAL paths, and comparing those
strings authorized a stranger — then the '/'-prefix half carried that grant across their whole
subtree."* **The fix stopped at the language boundary.** The SQL predicate was never repointed at
`parent_id`, and it is the gate on live policies.

**That the collision is reachable is the repo's own record.** `api/_utils/groupSlug.ts` exists
because Deborah ended up with two orgs both called "Deborah Testing", both slugging to
`deborah-testing`, *"which is what let a path-string subtree match count each org's people into the
other's rollup"*. Duplicates are a **warning, never a constraint** — the same request re-sent with
`confirm_duplicate: true` creates the second org. There is no unique index on `groups.path`.

**Blast radius (live).** `schools_select_admin_subtree` on `public.schools`, and the `classes`
select policy, both call it. **Blast radius (pending).** The support channel's two new policies —
`support_threads_own_read` and `support_messages_own_read` — make it the gate on a support
conversation too.

**Not a finding, checked:** the `LIKE` pattern cannot be wildcard-injected. `compute_group_path()`
slugs `[^a-zA-Z0-9]+` → `-`, so `%` and `_` cannot survive into a path.

**Fix shape (not applied):** repoint the function at a recursive `parent_id` walk, or at an
ancestry column names cannot change. Under RLS doctrine rule 3 that is a canary-run change.

---

### SEC0912-B-01 — MEDIUM — `support_messages` publishes every column to `authenticated`; the server's narrow projection is cosmetic

> **CLOSED 2026-09-12 (job #300).** Job #299 found the migration WAS applied live, not unapplied. `supabase/migrations/20260912a_support_messages_column_grant.sql`, canary-applied live: table-level SELECT revoked, column-level SELECT on exactly `MESSAGE_VIEW_COLUMNS` + `thread_id`. The table held 0 messages; nothing leaked. Same canary as A-01.

**Where.** `supabase/migrations/20260911_support_channel.sql`:

```sql
GRANT SELECT ON public.support_messages TO authenticated;
CREATE POLICY support_messages_own_read ON public.support_messages FOR SELECT TO authenticated USING (…);
```

A table-level grant is **column-blind**; RLS filters rows, never columns.

**What the server withholds and the grant does not.** `api/support/_shared.ts` projects
`MESSAGE_VIEW_COLUMNS` and says in prose *"the envelope stays server-side"*. Outside that
projection, and readable by any school admin through PostgREST under the bundled anon key and their
own JWT: `envelope`, **`draft_reply`** (the reply an agent drafted in Tom's name, before he has
seen it), `escalation_test`, `escalation_evidence`, `author_user_id`, `author_via`, `signal_key`,
`doorbell_sent_at`.

**The drift mechanism, already fired once.** `20260911b_support_loop.sql` adds `move`,
`move_reason`, `model_tier`, `model_ladder` — the sentinel's triage reasoning and the model-cost
ladder, *"Answers 'why did this cost a Fable call?'"* — with no new grant, because it needs none.
Every future column on this table is published to customers by default.

**Which side of the apply line.** `supabase/schema.sql` records the three support tables as
*"declared by hand … UNAPPLIED as of 2026-09-11"*, with no grants and no policies emitted. So this
is caught **before** it reaches the shared project — the cheap moment. Whether that is still true
today was not verified, because this audit read no live DB.

**Fix shape (not applied):** a column-scoped `GRANT SELECT (id, body, direction, author_source,
author_name, in_reply_to, escalated_at, escalation_resolved_at, answered_at, created_at)`, or move
the browser read behind a `security_invoker` view whose column list *is* `MESSAGE_VIEW_COLUMNS`.
The second is the better shape: it makes the projection one fact instead of two that can drift.

---

### SEC0912-A-02 — LOW/MEDIUM — write before authz: a read endpoint mutates another tenant's group tree

**Where.** `api/org/intel.ts`, `api/groups/[id]/home.ts`, `api/groups/[id]/rate-compare.ts`. All
three resolve `?nodeId=` → a node BEFORE the subtree gate, and that resolution calls
`ensureSchoolNode()`, which under the **service role** does:

```
INSERT INTO groups (name, type, parent_id, …)   -- the other tenant's school name, under their group
UPDATE schools SET node_group_id = … WHERE id = …
```

Any authenticated leader (school admin or govt admin of *anything*) can name any school id and force
those two writes; the very next line then answers 403. The behavioural test drives the real handler
and asserts the write order: `['insert groups', 'update schools']`, then 403.

**Severity is bounded, honestly.** The node would be minted eventually by a legitimate path, and the
insert is idempotent-on-second-call. What it is not is harmless: it is an unauthenticated-scope
mutation of another tenant's structure, it is unmetered, and it is a row-creation primitive reachable
by anyone with a leader account.

**Fix shape (not applied):** gate on the school's **own** id before minting its node, or defer the
mint until after `callerCanSeeGroup`.

---

### SEC0912-A-03 — LOW — id existence oracle on the same three endpoints

A `nodeId` matching no group, school or class answers **404**; one that exists but sits outside the
caller's subtree answers **403**. Same caller, same lack of authority, two different answers — so any
authenticated leader can test an arbitrary uuid for existence across the whole estate. Uuids are not
guessable, so this is an oracle for ids obtained elsewhere (a shared link, a screenshot, a log),
not an enumeration primitive.

---

### SEC0912-B-02 — LOW — raw database error text returned to callers, in new code

`api/support/{messages,thread,population}.ts` and `api/school/copy-teacher-play/{_shared,apply}.ts`
return `error.message` / `err.message` in their 500 bodies. This is the class
`api/groups/groupsErrorLeakage.security.test.ts` was written for; it recurs in new endpoints because
nothing gates it. PostgREST error strings name tables, columns and constraint names.

**Fix shape (not applied):** a shared `serverError(res, tag, err)` that logs the detail and returns a
fixed sentence — and, if it is to stop recurring, a lint rule or a test over the handler tree rather
than a memo.

---

## 2. Checked and cleared

Each of these is asserted in the test files, so a regression is loud rather than rediscovered.

| Area | Verdict |
|---|---|
| **Cron auth** — all five jobs, three new | Clear. Every one routes through `checkCronAuth`: constant-time compare, fails **closed** on any deployed environment. |
| **Resend delivery webhook** | Clear. Svix HMAC over the raw body with the body parser off, a ±5-minute timestamp window, and an unset secret refuses rather than passes. Only note: `readRawBody` has no size cap of its own and leans on the platform's. |
| **Account claim (`unclaimedMint` / `claim-account`)** | Clear. `getAuthUserId` verifies against GoTrue and the claims are then read from **that same verified token** — `readSessionId`'s unverified decode is never the authority. Allowlisted provenance, fails closed. |
| **Intel surface** (8 endpoints + `org/intel`) | Clear on gating: every one `verifyAdmin`s; `weak-points` and `where-and-what` carry a `K_FLOOR = 5` and null out below it. |
| **Support gate** | Clear. All three routes resolve scope from the verified JWT via `resolveVisibleScope`; a teacher gets 403, not a hidden button. |
| **Support population endpoint** | Clear. `populationShape()` can only emit `{ schools, since }` — a school id cannot be expressed in the return type. |
| **Support client envelope** | Clear. Allowlist of six keys, each length-bounded, identity fields dropped. |
| **Support message bodies** | Clear. Rendered as `{{ m.body }}`; no `v-html` anywhere in the support components. |
| **Published mailbox copy** (`usePublishedMailboxCopy`) | Clear. Remote markdown from Popty reaches text interpolation only, never an HTML sink. |
| **New-table RLS posture** | Clear. `class_progress_copy_audit`, `org_enrolment_policies`, `support_signals`, `support_handbook_precedents`, `support_settings` are all RLS-on, zero-policy, service-role-only. `org_enrolments` had the grant-open default closed a few minutes late by `20260908f`, deliberately and in writing. |
| **PostgREST filter injection** | Clear at `_utils/schoolDomain.ts` — `isDomainShaped()` bars every DSL character before the `.or()`. `class-progress.ts` and `admin/users.ts` already route through `_utils/postgrestFilter.ts`. |
| **`is_school_admin_of` / `is_govt_admin_over_group`** | `SECURITY DEFINER` with `search_path` pinned to `public, pg_temp`, JWT claims only, no `auth.users` reference. (The *predicate* is A-01; the *hygiene* is correct.) |
| **`admin/view-as` audit** | Clear. `action:'end'` is scoped to the caller's own row, so no admin can fabricate the end of another's session. |

---

## 3. Not re-audited

`api/_utils/actAsGuard.ts` remains client-advisory (`X-Ssi-View-As: 1` is a header the client
chooses to send) — already pinned by `actAsGuard.advisory.security.test.ts`, unchanged, not
re-litigated here. The CORS allowlist's Vercel-slug defect (SEC0905-B-01/02) is likewise unchanged
and still characterized by its own file.

The **money path itself** — `org/enrol.ts`, `org/funder-export.ts`, `subscription/*`, the Paddle and
Wise webhooks — was read for auth gating only. A proper money-path audit needs live-state
verification, which this run was forbidden. That is a gap, and it is the obvious scope for the tenth.
