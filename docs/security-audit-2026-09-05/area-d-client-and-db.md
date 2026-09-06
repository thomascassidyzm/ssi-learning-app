# Area D — the client and the database delta (2026-09-05 audit)

Branch `cs/555-sec-d-client-db`, in my own private worktree (`~/.cs-worktrees/ssi-learning-app/555-sec-d-client-db`),
off `origin/main` at `92954eb2`. Findings and tests only — no production behaviour changed, no migration
applied, no fix applied, nothing promoted, no live-DB contact (read-only source review of the migration
files, per the brief). The only local change outside the two deliverables was two additive symlinks inside
this worktree's own `packages/player-vue/node_modules/` (see §4, Verification) to work around a transient,
unrelated environment problem in the *shared* checkout — nothing outside my own worktree was touched.

This is the **eighth** security audit in four weeks. Per the coordinator brief, PostgREST injection,
join-code entropy, the privileged-gate roster, webhook signatures, the client XSS sinks and the
DEFINER/search_path posture were deliberately not re-swept wholesale — I checked the *delta* against each
where it applied and cite the original ID where a control I touched turned out to be one of those.

## Verdict table

| ID | Class | Severity | Verdict | Pinned by |
|---|---|---|---|---|
| **SEC0905-D-01** | `content_edit_events` SELECT policy has no own-row scoping — every signed-in learner in the shared DB can read the internal editorial audit log (staff identities + edit payloads) | **MEDIUM** | **CONFIRMED** (source) | `api/_security/sec0905-d-01-content-edit-identity-migrations.security.test.ts` |
| **SEC0905-D-02** | Attribution is DB-unenforced today — the `ENFORCE` migration is parked under a `.UNAPPLIED` filename; a writer that bypasses the application-layer choke point can still write `last_edit_event_id = NULL`, indistinguishable from a legitimate pre-2026-09-01 row | **MEDIUM** | **CONFIRMED** (source) | same file |
| **SEC0905-D-03** | `20260901_content_edit_identity.sql` never calls `NOTIFY pgrst, 'reload schema'`, despite CLAUDE.md's RLS doctrine rule 6 and despite the sibling migration in the same window doing it correctly | **LOW** (doctrine/process, not access-control) | **CONFIRMED** (source) | same file |
| SEC0901-D-02 | Shared-device cross-account paid-course-bundle leak (09-01 HIGH, LIVE) | — | **NOW CLOSED** — verified re-derived and re-wired in this window | `api/... ` n/a (client); regression-guarded below |
| `20260901_sector_helix.sql` | Two new tables (`course_sectors`, `enrollment_threads`) | — | **SECURE-ASSERTION — doctrine followed correctly**: RLS on, no policies, explicit REVOKE+GRANT in one file, `NOTIFY pgrst` present | pinned alongside SEC0905-D-03's test file, as contrast |
| `20260901b_audit_trigger_ignores_edit_event_stamp.sql` | `audit_content_change()` replacement | — | **SECURE-ASSERTION** — `SECURITY DEFINER` + `SET search_path` pin preserved (SEC25-D-01 regression guard); body otherwise byte-identical to the deployed function, confirmed against `supabase/schema.sql` | pinned |
| Client v-html/innerHTML/eval sweep | Whole `packages/player-vue/src` delta | — | **CLEAN — no new instance.** Both existing `v-html` sinks are unchanged since 8755d4c8 | `packages/player-vue/src/security/sec0905-d-clientDelta.security.test.ts` |
| Client postMessage sweep | Whole delta | — | **CLEAN — no new instance.** One `MessageChannel.port2.postMessage` (worker handoff, not cross-origin `window.postMessage`), file unchanged in this window | same |
| `platform/apiBase.ts` + `platform/capabilities.ts` (new) | Token/origin handling for the WebView shell | — | **SECURE — reviewed in full.** Inert on the web by construction; origin sourced only from an injected same-app global or a build-time env var, never a URL param or `postMessage`; requests pinned `credentials: 'omit'` | same |
| `auth/sendSignInCode.ts` (new) | Client half of the new sign-in-code mailer | — | **SECURE** — the one refusal it honours from the server (429) is never laundered through the Supabase fallback | same |
| `api/school/staff-signin-link.ts` client wiring (`NodeHomeView.vue`) | New "mint a teacher access code" admin action | — | **Client gate is backed by a real server check** (containment logic, out-of-scope-role refusal, rate limit) — confirmed by reading the endpoint; not re-tested here since `api/` is outside this area's file scope | — (context only) |

---

## PART 1 — Database

Scope confirmed with `git diff --name-status 8755d4c8 origin/main -- supabase`: **exactly the four files
named in the brief, nothing else.** All four read in full; no DB connection made.

### SEC0905-D-01 (MEDIUM) — `content_edit_events` is readable by every authenticated learner in the whole product

**File:** `supabase/migrations/20260901_content_edit_identity.sql:83-88`

```sql
CREATE POLICY "Authenticated users can view content_edit_events"
  ON public.content_edit_events FOR SELECT TO authenticated USING (true);
```

**The chain.** `content_edit_events` is new — it never existed before this window, so this is a genuinely
new exposure, not a pre-existing one I'm re-filing. It is an **internal editorial audit log**: `actor_id`
(a real Supabase auth uid), `actor_label` (the human name behind it — "Written by
services/shared/content-edit-log.cjs" per the file's own comment), `scope` (seed/lego/phrase ids touched)
and `detail` (jsonb before/after payloads for small edits — potentially pre-publish content). The DB behind
`ssi-learning-app` and `ssi-dashboard-v7-clean` (Popty) is **one shared Supabase project** (CLAUDE.md:
"dev/staging/prod share ONE DB"), and `authenticated` is not "Popty staff" — it is every signed-in Supabase
Auth session, including every ordinary learner and school pupil signed into this app. The anon key is
public in the client bundle by design, so any signed-in learner can `fetch` this table directly via
PostgREST (`GET .../rest/v1/content_edit_events?select=*`) with nothing else required.

**Why this isn't covered by the doctrine's existing carve-out.** CLAUDE.md's RLS section says "content
tables stay permissive by design" — but that carve-out is explicitly about the *learning content itself*
(`course_seeds`/`course_legos`/`course_practice_phrases`, verified below to carry only SELECT for
anon/authenticated, no write). `content_edit_events` is not learning content; it is a log of who did what
to that content, and it is new. RLS doctrine rule 1 ("RLS = is this my row? only; hierarchy authz =
endpoints") has no carve-out for it, and this policy has no row predicate at all.

**Failure scenario.** A pupil or a free/never-paid learner, signed into `saysomethingin.app`, opens
devtools and calls the PostgREST endpoint directly with their own session token and the app's public anon
key. They get back the full edit history for every course — which named colleague edited which seed, when,
and (via `detail`) what the before/after text was, potentially including content that hasn't been published
yet. No learner PII or payment data is exposed, so this is not a HIGH — but it is a real, new, checkable
information-disclosure hole: a staff-identity/internal-process leak reachable by anyone with a login.

**Fix I'd apply (not applied here):** either drop the `authenticated`-SELECT policy and serve this data only
through a server endpoint that knows the caller's actual authorisation, or narrow it to
`actor_id = auth.uid()` (an editor reading their own history) plus a separate service-side admin path.
Never `USING (true)`.

### SEC0905-D-02 (MEDIUM) — attribution is not enforced at the database layer today

**Files:** `supabase/migrations/20260901_content_edit_identity.sql` (adds `last_edit_event_id` as nullable,
no `CHECK`) and `20260901c_content_edit_identity_ENFORCE.sql.UNAPPLIED` (the constraint, parked).

This is the gap the brief predicted. `20260901c_...ENFORCE.sql.UNAPPLIED` carries the literal `.UNAPPLIED`
suffix — it is **not** a real migration on the timestamp-ordered path the migration runner picks up. As of
today, nothing at the database layer stops an `UPDATE`/`INSERT` on `course_seeds`, `course_legos` or
`course_practice_phrases` from leaving `last_edit_event_id` `NULL`, and `NULL` is defined (by the base
migration's own comment) to mean "no attribution was captured" — **exactly the same value a legitimate
pre-2026-09-01 legacy row carries.** So an unattributed write today is indistinguishable from a benign old
row, which is precisely the ambiguity the whole feature exists to remove.

**Calibrating the severity honestly (cross-repo check, outside this audit's file scope, done only to size
this residual — no file in `ssi-dashboard-v7-clean` was modified).** I read the referenced choke point in
the sibling dashboard repo to check whether the primary editing surface is actually exposed. It is not:
`services/shared/content-edit-gate.cjs` (that repo's commit `dd2c69fa4`, 2026-09-01, confirmed present on
its `main`) sits in front of **36 write routes** across `course-builder-api.cjs` and `production-api.cjs`
and — per that commit's own message — is verified by "a live probe on a course-builder instance refusing
unauthenticated, spoofed and garbage-token browser writes." So the HTTP-facing editing surface (the seed
editor, the translation UI, QA actions) is already gated at the application layer, independent of this DB
constraint.

**What the DB-level gap actually leaves open:** writers that bypass that HTTP surface entirely and connect
straight to Postgres with the service-role key — pipeline services, phase8 batch jobs, `tools/` sweeps.
This is exactly the population the ENFORCE migration's own precondition query (in its header comment) is
written to check for before it's safe to flip on
(`SELECT surface, count(*) FROM content_edit_events WHERE actor_id = 'undeclared-loopback' ...`). Until
that migration is applied, such a writer — buggy or malicious — leaves no trace distinguishing it from
history. This is a **non-repudiation/forensic gap for already-privileged internal writers**, not a new
access grant (anyone in that population already holds the service-role key, which is game-over on its own
terms) — which is why I'm calling it MEDIUM rather than HIGH.

**Fix I'd apply (not applied here):** run the two precondition queries the file already documents, set
`CONTENT_EDIT_IDENTITY_MODE=enforce` on both services, wait a few days as the comment specifies, then rename
off `.UNAPPLIED` and apply.

### SEC0905-D-03 (LOW, doctrine/process) — the base migration never reloads the PostgREST schema cache

`20260901_content_edit_identity.sql` creates a table, two policies and three new columns, and contains no
`NOTIFY pgrst, 'reload schema'` anywhere. CLAUDE.md's RLS doctrine rule 6 is explicit that every
policy/grant migration ends with this call. The sibling migration in the exact same window,
`20260901_sector_helix.sql`, does it correctly (`NOTIFY pgrst, 'reload schema';` as its last line) — so this
isn't an unfamiliar convention, it was just missed once. This is **not an access-control hole** (a stale
PostgREST cache fails toward "the new table isn't visible yet," not toward over-exposure) but it's a plain,
checkable doctrine violation worth catching before it becomes a habit — and it happens to sit in the same
file as SEC0905-D-01, so whoever fixes that policy should add the `NOTIFY` in the same pass.

### Secure-assertions from the same file set

- **`20260901_sector_helix.sql` follows the RLS doctrine cleanly.** Both new tables (`course_sectors`,
  `enrollment_threads`) get `ENABLE ROW LEVEL SECURITY` at creation, an explicit `REVOKE ALL ... FROM anon,
  authenticated` in the *same file* as the `GRANT ALL ... TO service_role`, zero `CREATE POLICY` statements
  (deny-by-default via RLS-on-with-no-policies rather than a hand-authored policy), and the file ends with
  `NOTIFY pgrst`. This is the doctrine's rule 7 ("never Supabase's grant-open default") applied exactly as
  written, and it is the direct contrast that makes SEC0905-D-03 legible as a miss rather than a house
  style question.
- **`20260901b_audit_trigger_ignores_edit_event_stamp.sql` preserves the search_path pin.** The
  `audit_content_change()` replacement keeps `SECURITY DEFINER` + `SET search_path = public, pg_temp`
  (SEC25-D-01's fix, unchanged) — I diffed the new body against `supabase/schema.sql`'s currently-deployed
  version and confirmed the only functional change is adding `last_edit_event_id` to the trigger's
  `ignore_cols` list, exactly as the migration's own comment claims.
- **Identity casts:** no new predicate in any of the four files compares a column against `auth.uid()` in a
  way that could hit the mixed-type/mixed-identity traps CLAUDE.md documents — `content_edit_events`'
  policies use `USING (true)`/`TO service_role` only (no cast at all, which is itself part of SEC0905-D-01),
  and `sector_helix`'s tables carry no RLS predicates to get wrong in the first place (deny-by-default).
- **Content tables remain write-locked to service_role only** (verified from `supabase/schema.sql`:
  `course_seeds`/`course_legos`/`course_practice_phrases` grant `SELECT,REFERENCES,TRIGGER,MAINTAIN` to
  `anon`/`authenticated` and `ALL` only to `service_role`) — pre-existing, unchanged by this window, but
  worth stating because it's what keeps SEC0905-D-02 a forensic gap rather than a content-tampering one: no
  ordinary learner can write to these tables at all, attributed or not.

### Explicit gap

I could not and did not connect to the live database, per the brief's rule. I cannot say from source alone
whether `20260901_content_edit_identity.sql`, `20260901_sector_helix.sql` or `20260901b_...` have actually
been applied to the live project — `supabase/schema.sql` (the dump) does **not** yet contain
`content_edit_events`, `course_sectors` or `enrollment_threads` at all, which either means the dump is stale
relative to an applied migration, or the migrations genuinely haven't run yet. Either way, this audit's
findings are about what the migration files as written would do/allow if and when applied, not a
live-state claim.

---

## PART 2 — Client (`packages/player-vue/src`)

Delta: 253 files, +21,890/−2,412, established via `git diff --stat 8755d4c8 origin/main -- packages/player-vue/src`.
Given the size, I worked the five priority categories from the brief in order rather than reading every
file; anything not named below was screened by grep against the whole delta and came back clean, or was
pure product logic / i18n text with no security surface (locale JSON files, playback-merge logic, copy
changes) and was set aside.

### 1. New v-html / innerHTML / eval / href-src-from-variable — CLEAN

Grepped the whole `packages/player-vue/src` tree (not just the delta) for
`v-html|innerHTML|outerHTML|document\.write|dangerouslySetInnerHTML`. Exactly two hits, both pre-existing
and unchanged in this window: `components/admin/HowThisWorks.vue` and `components/admin/WalkCard.vue`
(already covered by `htwPublishedContentXss.security.test.ts` from the 2026-08-25 audit). `HowThisWorks.vue`
changed 4 lines in this delta — both are doc-path comment updates (`docs/...` → `archive/docs-retired-2026-08-24/...`),
confirmed by full diff read, no behavioural change. No new sink anywhere in the delta.

### 2. URL query param / postMessage → routing, authz or request-building — CLEAN

- **postMessage:** one hit in the whole package, `providers/generateLearningScript.ts:385`
  (`ch.port2.postMessage(null)`) — a `MessageChannel` port used for a structured-clone worker handoff, not
  `window.postMessage`; no origin to check because it's same-realm. File unchanged in this delta.
- **`utils/deepLinkLocale.ts` (new, 84 lines)** — infers the UI locale from `?course=` for a deep link. Read
  in full: the inferred value is checked against `isSupportedLocale()` (a fixed allowlist) before being
  written through `setLocale(code, 'inferred')`, stands down the moment a person has made their own choice
  (`hasChosenLocale()`), and never drives navigation or an authorisation decision — it only ever picks a UI
  string. No injection surface.
- **`views/JoinWithCode.vue` (new, 287 lines)** — the `/join` teacher access-code redemption screen.
  `route.params.code` / `route.query.code` only *prefills* the input field (deliberately does not
  auto-submit — the code comment explains this is to stop a link-preview bot burning a single-use code); the
  actual redemption goes through `POST /api/auth/access-code-redeem` and the resulting session tokens are
  set via the SDK's own `setSession()`, never read back out of the URL. No open-redirect: on success it
  navigates to a hardcoded `/schools`, never an attacker-suppliable path.
- **The pre-existing open-redirect control** (`useAdminGate.ts` `deniedDestination` +
  `SchoolsContainer.vue`'s `adminNextTarget` regex, SEC0825-era, already pinned by
  `adminGateOpenRedirect.security.test.ts`) is **unchanged** in this window — confirmed via
  `git diff --stat` on both files. Not re-tested; citing it per the brief's "cite the ID" instruction.

### 3. Token/secret handling — reviewed in full, SECURE

**`platform/apiBase.ts` + `platform/capabilities.ts` (both new)** — the mechanism that lets a future
Android/iOS WebView shell route `/api/...` calls to a real origin instead of the WebView's own
`https://localhost`. This was the highest-value file to check, because if the configured origin were
attacker-influenceable, every `/api/*` call — including ones carrying `Authorization: Bearer <supabase
JWT>` set by caller code — would be silently redirectable to an attacker's server, since
`credentials: 'omit'` only suppresses cookies, not headers the caller explicitly set.

Traced `apiOrigin()` to its only two sources: `window.__SSI_PLATFORM__` (a global the native shell's own
wrapper injects before the app bundle evaluates — first-party, not page-script-settable) and the build-time
`VITE_API_ORIGIN` env var. Neither is a URL query param, a `postMessage` payload, or anything else a remote
page could influence. On the actual production web app (every learner today), both are unset: `shell` stays
`'web'`, `apiOrigin` stays `''`, and `installApiOriginRewrite()`'s very first line (`if (!origin) return
false`) makes the whole mechanism a documented no-op — verified by reading the function, not assumed from
the comment. Rewritten requests are pinned `credentials: 'omit'` explicitly, and the server side never
emits `Access-Control-Allow-Credentials` (the file's own comment cites `api/_utils/cors.ts` for this, which
I did not re-verify as it's outside this area's file scope).

**`auth/sendSignInCode.ts` (new)** — client half of the new Resend-backed sign-in-code mailer. Checked
whether its fallback-to-Supabase-on-any-non-200 could launder around an anti-abuse decision made by the new
`/api/auth/send-code` endpoint. Reading that endpoint (outside this area's file scope, checked only to
size this) shows it returns exactly four statuses: `400` (bad email format — Supabase's own validation
would also reject it, so falling through is a no-op, not a bypass), `503`/`502` (explicitly `fallback:
true` by the endpoint's own design — "FAILS SOFT, ALWAYS" is its stated contract), and `429` (the one status
the client explicitly does **not** fall through on — confirmed by source order: the `429` branch always
`return`s before the code ever reaches `client.auth.signInWithOtp`). There is no other abuse-decision status
for the fallback to bypass. No finding.

**No token in localStorage/URL/logs found in the delta.** Grepped for `localStorage.setItem` sites touching
anything token-shaped in the changed files — the only localStorage writes I found in scope were the audio
cache **owner marker** (an opaque uid used only as an identity-change tripwire, not a credential — see §5)
and the schools password-prompt dismissal flag (a boolean, keyed by user id, not a secret).

### 4. Client-side-only authorisation gates — the one new admin action checked, server-backed

`NodeHomeView.vue` gained a "mint a teacher access code" row action (`canAssignTeachers` gates the button's
visibility client-side, same as the pre-existing "Assign to a class" action). Its handler
(`useTeachersData.ts` → `createStaffSigninLink`) posts to `POST /api/school/staff-signin-link` with only
`target_user_id` in the body; the caller's own authorisation comes from the `Authorization` header, resolved
server-side. I read that endpoint (outside this area's file scope, checked only because the brief asks
"name the endpoint that should be gating and whether it does") and confirmed it resolves the caller's own
school from their verified identity (`schools.admin_user_id` / a `user_tags` admin tag — never from the
request body), and explicitly refuses a target who is out-of-school, a `govt_admin`, `ssi_admin`, or `god`
("CONTAINMENT is enforced, not assumed"). So this is not a client-only gate — the button is UX, the real
door is server-side. Not filed as a finding; not independently re-tested since `api/` is outside this
area's file scope, but I read the source rather than trusting its own header comment's claim.

### 5. Offline/cache identity-scoping — SEC0901-D-02 is now CLOSED

The 2026-09-01 audit's headline HIGH finding (`useCourseBundle.ts`'s IndexedDB course-bundle cache, keyed by
course code alone with no learner scoping, survived sign-out and handed a paying learner's full paid course
verbatim to the next person on a shared device) is **fixed in this window**, and I re-derived the fix from
source rather than trusting the "closed" verdict:

- `useCourseBundle.ts` now records `ownerId` on every cached record and `cachedOwnerMatches()` refuses to
  serve a cached **full** (non-preview) bundle to anyone but the identity that fetched it — including a
  record from before this field existed (treated as unknown-owner, i.e. invalid). Checked **both** call
  sites: the network path (`getCourseBundle`) and, critically, the **offline fast path**
  (`getCachedCourseBundle`) — a fix that only covered the network path would leave the offline path as a
  live bypass, and it does not.
- `useAuth.ts`'s `signOut()` now `await`s `clearAllCachedBundles()` (awaited deliberately, since callers
  reload immediately after sign-out).
- The identity provider this all depends on is genuinely wired at boot: `App.vue` calls
  `setCourseBundleIdentityProvider()` with a real `getSession()`-backed resolver — I checked this because an
  unwired provider would make the whole `ownerId` scheme silently inert (comparing `null === null` forever).
- The **audio-byte** amplification of the same bug (audio cached by id alone, no learner) is separately
  closed by the new `cache/audioCacheOwner.ts` (`reconcileAudioCacheOwner`), wired into **both** the
  `onAuthStateChange` sign-in path and the restored-session boot path in `useAuth.ts` — the second call site
  matters because `onAuthStateChange` does not reliably fire for a session already on disk at boot, which is
  exactly the gap a partial fix would leave.

All five of these wiring points are pinned as regression guards in
`packages/player-vue/src/security/sec0905-d-clientDelta.security.test.ts`, alongside the two existing
behavioural suites (`useCourseBundle.crossIdentity.security.test.ts`, which the 09-01 audit itself wrote as
a characterization and which now asserts the fixed behaviour; `cache/audioCacheOwner.security.test.ts`).

No other cache/offline file in the delta (`AudioCache.ts`, `bulkAudioDownload.ts`, `platform/storage.ts`)
introduces a new identity-scoping question — `AudioCache.ts`'s changes are a pure platform-seam refactor
(routing the audio URL through `apiUrl()` and quota reads through `platform/storage.ts`, both already
reviewed above), and `bulkAudioDownload.ts`'s new opt-in gate is a data-usage/product control (Offline Mode
must be explicitly turned on before a bulk download runs), not an identity or entitlement boundary — the
entitlement gate on the audio urls it fetches is `SEC0901-D-01`, already filed and not re-litigated here.

---

## Verification

- `api/_security/sec0905-d-01-content-edit-identity-migrations.security.test.ts` — 13/13 passing
  (`npx vitest run -c vitest.api.config.ts api/_security/sec0905-d-01-content-edit-identity-migrations.security.test.ts`).
- `packages/player-vue/src/security/sec0905-d-clientDelta.security.test.ts` — 12/12 passing, run directly
  with `npx vitest run -c vitest.config.ts src/security/sec0905-d-clientDelta.security.test.ts` from
  `packages/player-vue/`.
- **Environment note (transparency, not a finding):** this worktree's `packages/player-vue/node_modules`
  does not exist and the root `node_modules` is a symlink into the *shared* checkout
  (`/home/tomcassidy/SSi/ssi-learning-app/node_modules`), which was itself in a transient, incomplete state
  during this session (17 top-level entries only, missing `@vitejs/plugin-vue` and `vue` — consistent with
  another live session's `pnpm install` running concurrently; per team memory this shared tree must never be
  written to from a worktree). To get a working Vue-aware vitest config for verification I added two
  symlinks **inside this worktree only** (`packages/player-vue/node_modules/@vitejs/plugin-vue` →
  the pnpm store entry) — no file outside this worktree was touched. Running the pre-existing
  `adminGateOpenRedirect.security.test.ts` alongside mine still failed on an unrelated `vue` resolution
  error from the same transient shared-tree state; this is an environment artifact, not a regression I
  introduced (confirmed by the entry count and by every file I actually changed passing cleanly in
  isolation).
- `pnpm run typecheck:api` could not be run as specified (`pnpm` binary unavailable in this shell; see
  above). `npx tsc --noEmit -p tsconfig.api.json` was run instead and reported one pre-existing error
  (`@ssi/core` unresolved from `packages/player-vue/src/types/courseBundle.ts`) — the same class of
  shared-node_modules environment issue, unrelated to the one file I added under `api/`
  (`api/_security/sec0905-d-01-...ts`, which imports only `vitest` and `node:fs`/`node:path`). Recorded as
  an explicit gap: I could not get a clean `tsc` run in this session's environment state, and did not
  attempt to fix the shared checkout to force one.
- No live database, email, payment, or deploy contact was made. No migration was applied. No production
  file was edited — the only files changed are the two test specs and this report.

---

## Landing line

Branch: `cs/555-sec-d-client-db`, committed and pushed to `origin/cs/555-sec-d-client-db`.
Merged: **not merged** — it is a plain feature branch off `origin/main`, untouched by anyone else.
Deployed: **nowhere** — no Vercel deploy, no promotion, this branch has not been built or served anywhere.

## Summary for the parent conversation

- **SEC0905-D-01** (MEDIUM, CONFIRMED) — `content_edit_events`'s `SELECT ... TO authenticated USING (true)`
  policy lets every signed-in learner in the shared DB read the internal editor-identity audit log (staff
  uids/names + edit payloads). New in this window; no own-row scoping.
- **SEC0905-D-02** (MEDIUM, CONFIRMED) — the DB-level "an edit must carry an identity" constraint is parked
  under a `.UNAPPLIED` filename and not enforced; a writer bypassing the (already-live, app-layer) editing
  gate can still write unattributed content changes indistinguishable from legacy rows. Calibrated down from
  the brief's "likely your best finding" framing after confirming the HTTP-facing editing surface is
  already gated at the application layer in the sibling repo.
- **SEC0905-D-03** (LOW, CONFIRMED) — same base migration never calls `NOTIFY pgrst, 'reload schema'`,
  against CLAUDE.md's own written rule; doctrine/process, not an access-control hole.
- **SEC0901-D-02 (09-01 HIGH) is now CLOSED** — re-derived from source, both the network and offline-cache
  paths fixed, wiring confirmed at every real call site, regression-guarded.
- Client review across all five brief categories (new XSS sinks, URL/postMessage-driven routing, token
  handling, client-only admin gates, cache identity-scoping) came back **clean** — one already-closed prior
  finding reconfirmed, no new vulnerability found.
- Explicit gaps: could not verify live-DB application state of any of the four migrations (dump is stale
  relative to them); could not get a fully clean `tsc`/vitest run for pre-existing, unrelated files due to a
  transient shared-checkout `node_modules` state during this session.
