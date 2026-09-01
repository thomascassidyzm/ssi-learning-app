# Security audit — learning app, Supabase, Paddle, Vercel (2026-09-01b)

*The eighth audit of this repo in three weeks, and the first to ask the live database what its
policies actually are. Read-only and report-only throughout: no writes, no Paddle contact, no emails,
no deploys. Branch `security/audit-2026-09-01b`, cut from `origin/dev`.*

---

## Verdict (read this cold)

**The app is in good shape, and this audit did not overturn that.** Seven prior audits swept the code
paths hard, the money path is signature-checked, the learner-data spine and the six schools org tables
are genuinely locked to own-row / own-tenant, and self-granting an entitlement through the database is
not possible. What I did that they couldn't is read the **live** Postgres catalogue — every table's RLS
state, every policy predicate, every function grant — instead of reasoning about it from source.

That surfaced **one finding worth acting on before `main`**: a database function, `find_learner_by_email`,
that **any logged-in user can call with anyone else's email address to get that person's account record**
(name, role, internal IDs, preferences) — a targeted privacy leak that defeats the own-row lock on the
`learners` table and is the missing first step that makes an already-known finding (SEC0901-X-04) worse.
It is a small, contained fix. Everything else I found is lower and mostly confirms the existing picture.

**Severity scale** (flagged so you can push back on the frame): plain four levels — **Critical / High /
Medium / Low** — judged by *blast radius* × *how little the attacker needs*, not CVSS arithmetic. Every
finding is tagged **EXPLOITABLE** (a concrete attack path exists) or **THEORETICAL** (no path, listed for
completeness). Where a finding restates prior work I cite the original ID.

---

## Ranked findings

### 1. `find_learner_by_email` turns any email into a person's account record · **HIGH · EXPLOITABLE · new**

**What it is.** `find_learner_by_email(text)` is a `SECURITY DEFINER` database function — it runs with the
owner's rights and so **bypasses row-level security**. It is granted to every `authenticated` user and has
**no auth check inside it**. Given an email address it returns that learner's `id`, `user_id` (their login
identity), `display_name`, `platform_role`, `educational_role`, and `preferences`.

**Attack path.** The attacker is anyone who can make an account — sign-up is open OTP, so that's anyone
with an email address. They log in, open dev-tools, and call
`supabase.rpc('find_learner_by_email', { lookup_email: 'someone@example.com' })`. If that email belongs to
a learner, they get back that learner's full record. No tenant boundary is checked: it works for any user
in any school, any government tenant, any staff or admin account, given only their email.

**Why it's real, and why it's the headline.** The `learners` table itself is correctly locked — a direct
read returns `401 permission denied` to anyone but the row's owner (I confirmed this live with the public
anon key). This function is a hole cut *around* that lock. Two consequences:
- **Targeted de-anonymisation / PII.** Turn an email you already hold into a real name, role, and settings.
  It's targeted (you must know the exact email — no wildcard harvest), which is the one thing keeping this
  off "Critical", but a leaked or guessed email list becomes a roster of who's an SSi learner and who they
  are.
- **It unlocks SEC0901-X-04.** That still-open finding lets a signed-in caller read a known learner's
  per-course practice minutes *if they already know the learner's UUID* — and was rated only Medium partly
  because "how would you get the UUID?" This function is the answer: email → this call → the UUID.

**How it got here.** It exists for a legitimate reason — when you sign in and have no learner row yet, the
app looks you up by *your own* just-authenticated email to re-link your account (`useAuth.ts:302`). The bug
is that it trusts the `lookup_email` the client passes instead of deriving it from the caller's own token.
The very next step (`claim_learner`) *is* gated on the email being yours, so this is **not** account
takeover — it's an information leak only. Prior audits touched this function once (08-25, to harden its
`search_path`) but never checked that it's callable against arbitrary emails.

**Remedy sketch (not applied).** Make it derive the address from the session, mirroring the sibling
function `sync_my_verified_emails` which the codebase already uses and describes as *"derives the address
from auth.users instead of trusting the caller."* Either look up on `auth.email()` inside the function, or
gate that `lookup_email` is in the caller's own `verified_emails`. One function body.

*Verification note:* confirmed from the live function definition + grant (`authenticated` has EXECUTE, no
internal gate) and the single client caller. Not executed against a live session — doing so needs a second
logged-in account, which needs an OTP email, which the audit rails forbid. The catalogue evidence is
conclusive on its own.

---

### 2. `groups` is fully readable by every logged-in user · **MEDIUM · EXPLOITABLE · new**

**What it is.** The `groups` table (the org hierarchy — schools, government tenants, their structure) has
exactly one RLS policy: `groups_authenticated_read` with predicate `USING (true)`. That means **any
authenticated user reads every row**. There is no membership or tenant check.

**Attack path.** Any logged-in learner calls `GET /rest/v1/groups?select=*` and receives all 57
organisations: each one's `name`, `type`, hierarchy `path`, `seats`, `platform_status`, and
`platform_expires_at`. That's the full customer/tenant list — 35 real organisations plus 22 demo — with
their seat counts and subscription status, handed to anyone who signs up.

**Blast radius, stated honestly.** The row also carries `provider_customer_id` and `provider_subscription_id`
(Paddle billing identifiers). Those columns are **exposed by the policy but currently empty** (0 of 57
populated), so today the leak is customer *enumeration* — names, seats, status — not live billing IDs. The
billing-ID exposure is **latent**: it fires the moment Paddle provisioning starts writing those columns,
with no further change. This is confidentiality only (no write, no minors' personal data in this table),
which is why it's Medium not High.

**Remedy sketch.** Scope the read to membership — the same helpers the neighbouring `schools`/`classes`
policies already use (`is_govt_admin_over_group`, school/tag membership) — instead of `USING (true)`; and
at minimum keep the two `provider_*` billing columns out of any broad read.

---

### 3. RLS-off + anon-writable content tables have grown from 5 to 22 · **MEDIUM · EXPLOITABLE · updates SEC25-D-03**

**What it is.** The 2026-08-25 audit filed **SEC25-D-03** (rated Low, judged by-design): five
content-pipeline tables have RLS switched off and `GRANT ALL` to `anon`, so a caller holding only the
public anon key can read *and write* them directly through PostgREST. Reading the live catalogue, **that
class is now 22 tables, not 5** — the five originals (`audio_clips`, `audio_convergence_log`,
`language_canonical`, `audio_clip_promotions`, `relink_refusals`) plus 17 newer staging tables
(`_canon_*`, `_fix_*`, `_converge_*`, `_divergence_partition`, `_audit_s3_touch`, `canonical_*`,
`voice_language_roles`). I confirmed anon can *read* them live (e.g. `audio_clips` returns 746,535 rows to
the anon key); anon *write* is certain from the grants (RLS off + `anon` holds INSERT/UPDATE/DELETE) but
was not executed — writing is forbidden by the rails.

**Attack path.** Copy the anon key from the app bundle (it's public by design), `POST`/`PATCH`/`DELETE`
against `/rest/v1/audio_clips` (or any of the 22). An anonymous internet caller can corrupt or mass-delete
production content-pipeline data — `relink_refusals` (14.5k rows), `audio_convergence_log` (204k),
`audio_clips` (746k).

**Why it's an update, not a rediscovery, and why it's Medium.** The *class* is known and accepted as
"content tables stay permissive by design" — but that ruling was about **read**, and it was scoped to 5
metadata tables. The new facts are (a) it now includes **write** to populated tables an anon can destroy,
and (b) it's **drifting upward unreviewed**: new content migrations keep landing tables RLS-off and
GRANT-ALL-to-anon by default, which is exactly what CLAUDE.md's own rule 7 ("every new table gets an
explicit posture at creation — never Supabase's grant-open default") exists to prevent. Blast radius is the
content-creation estate, not learner data, money, or the learner runtime (the app serves audio from
`course_audio`, which is RLS-on and anon read-only) — hence Medium, not High.

**Remedy sketch.** Decide the intended posture once and apply it to the whole class: either revoke anon
write (keep read if genuinely needed) or set these service-role-only; and add the RLS-posture check to
whatever lints content migrations, so the count stops climbing.

---

### 4. `entitlement_grants` readable by every logged-in user · **LOW · EXPLOITABLE · new**

`entitlement_grants` has one policy, `entitlement_grants_authenticated_read`, `USING (true)` — any
authenticated user reads all rows. Only 2 rows today, columns are tenant IDs + `granted_courses` +
`granted_by`, so low PII and low volume, but it's an unscoped cross-tenant read that will leak more as the
table fills. Anon is correctly blocked (confirmed 401 live). Remedy: scope to the caller's tenant like the
other org tables. Low because tiny and non-personal — but it's the same `USING (true)` anti-pattern as #2.

---

### 5. `content_feedback` readable and insertable by anonymous callers · **LOW · EXPLOITABLE · new**

`content_feedback` (2,110 rows) has `USING (true)` SELECT and `WITH CHECK (true)` INSERT for `anon`. An
unauthenticated caller with the public key reads every feedback row — including `user_id` and the free-text
`comment` field, which can contain anything a user typed — and can insert arbitrary rows (spam / content
injection into any surface that renders feedback). It's a content-pipeline table, so Low, but unlike the
metadata tables in #3 it carries user-authored text and an identifier and is anon-*readable*. Remedy:
revoke anon SELECT; gate INSERT behind a session or captcha.

---

### Lower / informational

- **8 content views run `security_invoker=off`** (`course_qa_*`, `human_clip_speakers`,
  `course_human_recorded_roles`, `voice_guide_in_use`) and are anon-readable. They bypass RLS but read
  content tables that are already public, so no learner data leaks — **INFO**. They violate the standing
  rule "every new view ships `security_invoker=on`"; worth cleaning up so the rule stays true. **THEORETICAL.**
- **`invite_codes` INSERT policies still use the legacy `auth.jwt()->>'sub'`** while sibling tables use
  `auth.uid()`. They evaluate identically today, so no bug — a note for the identity-rationalisation pass
  CLAUDE.md already tracks. **THEORETICAL.**

---

## The five still-live prior findings — current status

| ID | Status now | Note |
|---|---|---|
| **SEC0901-A-01** — `groups.path` slug drives an unfiltered hard-delete + auth-account deletion | **STILL LIVE** | Confirmed in code: `demoSchoolTeardown.ts` deletes `seed_progress`/`lego_progress`/`sessions`/`course_enrollments`/`class_sessions`/`user_tags`/`invite_codes`/`classes` by resolved ID with **no `is_demo`/`is_test` filter anywhere**. Today's audit's reframing is right — this fires by *accident* (a real org named like a demo org), no attacker needed. Highest-consequence item outstanding. |
| **SEC0901-D-02** — bundle cache never cleared on sign-out; paid course served to next user of a shared device | **STILL LIVE** | Client-side; one-line fix (`clearCachedBundle()` exists, has zero callers). Worst on school shared devices. |
| **SEC0901-D-01** — `audio/batch-urls` gates on authentication, not entitlement | **STILL LIVE (interim by design)** | Effective rule for bulk audio is "anyone with an email". Real remedy is the subscriber-token mint + `ENTITLEMENT_ENFORCE=strict`, not a patch — product sequencing, not a bug to hotfix. |
| **SEC0901-A-04b** — `mintRateLimit.ts` hand-rolls a spoofable `x-forwarded-for` key | **STILL LIVE** | Per-IP backstop only; the per-user limit is unspoofable. Low urgency. |
| **SEC0901-X-04** — signed-in caller reads a known learner's per-course practice minutes | **STILL LIVE — independently re-confirmed live** | `admin_practice_minutes_by_course` gates only the NULL (platform-wide) arg on admin; passing an explicit learner-UUID array stays open to any `authenticated` caller and bypasses RLS. **Finding #1 above supplies the UUID this needs** — treat the two together. |

---

## What held (don't re-sweep these)

Verified against the live catalogue, not just source:

- **The six schools org tables are RLS-on and correctly scoped.** `schools`/`classes`/`govt_admins`
  policies scope to `admin_user_id`/`teacher_user_id = auth.uid()`, school-admin membership, and govt-admin
  subtree; `invite_codes` is fully locked (no anon/auth SELECT; INSERT policies gate each code type to the
  right role). This **validates CLAUDE.md's 2026-08-06 claim** that all six carry RLS — which the 08-25
  audit had explicitly doubted. (`groups` and `entitlement_grants` are the two exceptions — findings #2/#4.)
- **You cannot self-grant an entitlement or a subscription via the database.** Despite loose table grants,
  every INSERT/UPDATE policy on `user_entitlements`, `entitlement_codes`, `subscriptions`, `courses`,
  `teacher_commissions`, `teacher_referrals` gates on `is_ssi_admin()`/`is_god_user()`. Anon confirmed 401.
- **The learner-data spine is own-row locked.** `learners`, `sessions`, `seed_progress`, `lego_progress`,
  `course_enrollments`, and the `learner_*` behavioural tables all tie writes to
  `learner_id = auth.uid()`'s own learner; anon returns 401. The anon *grants* on some are moot because the
  `WITH CHECK` ties every row to the caller.
- **The admin/analytics DEFINER functions are internally gated.** `admin_user_course_stats`,
  `admin_user_navigation`, `get_staff_with_emails`, and every `analytics_*` I sampled begin with
  `IF NOT is_ssi_admin() THEN RAISE` (or an equivalent). `find_learner_by_email` is the exception (#1).
- **Paddle webhook signature verification is present and correct** — `paddle.webhooks.unmarshal(rawBody,
  webhookSecret, signature)` over the raw body, `400` on missing / `401` on invalid signature; replay
  dedup rides `processed_webhook_events`, which is RLS-on and service-role-only. (Confirmed present, per the
  "done to death" note; deep money-path re-tracing was left to today's fresh audit and its four specs.)
- **No secrets in the client.** Every `VITE_`-prefixed var is public-safe (anon key, Paddle *client*
  token, price IDs, Popty base URL); the only `SERVICE_ROLE` mentions in client source are a comment and
  test files. No service-role key, JWT, or connection string reaches the bundle.

---

## Explicit gaps — what I could not reach, and how to close it later

- **No authenticated-session probing.** Findings #1, #2, #4 are proven from the live policy predicates and
  function grants, not executed with a real learner JWT — creating one needs an OTP email, which the rails
  forbid. The catalogue evidence is conclusive, but if you want an executed proof, run it from an existing
  test learner's token in a controlled environment.
- **Anon writes were not executed.** #3 and #5's write paths are certain from the grants (RLS off / `WITH
  CHECK (true)` + `anon` write privilege) but I did not perform a write. Safe way to prove: a single
  INSERT-then-DELETE from the anon key against one throwaway row, in a maintenance window.
- **No platform-console access.** I could not inspect Vercel project env-var scoping, the Paddle dashboard
  config (webhook endpoint list, IP allowlist, notification-secret rotation), the S3 bucket policy, or
  CORS as configured at the edge. All were assessed from source only. Close by a console review of each.
- **Client-side coverage is thin** — I did not run the player-vue suite and did not re-audit the money path
  in depth (both fresh in today's earlier audit).
- **The seat-race (SEC0901-B-02) remains unproven** — needs a concurrency harness nobody has built.
- **Deliberately not re-swept** (five audits already did): PostgREST injection as discovery, the
  privileged-gate roster, join-code entropy, the client XSS sinks, the DEFINER `search_path` posture.

---

## One line, since the commission mentioned it

Performance was explicitly out of scope for this job and I did not investigate it. One observation in
passing only: `find_learner_by_email` and several `analytics_*` functions scan `learners`/`player_events`
unindexed on some paths — worth a glance if those RPCs ever feel slow. Not investigated.
