# Security audit 2026-08-29 — Area D: the client, second pass

**Slug:** `area-d-client` · **Branch:** `security/audit-2026-08-29` (this worktree) · **Date:** 2026-08-29

**Scope:** the parts of `packages/player-vue/src/**` (and the DB objects it calls into) that
`docs/security-audit-2026-08-25/area-b-client.md` did not cover: an exhaustive sink sweep, token/
secret storage, the browser-direct Supabase read surface, and the service worker/IndexedDB layer.
Read the 08-25 report first — it is not repeated here except where this pass found new evidence
against it.

**Method:** static reading of checked-out source and `supabase/schema.sql` /
`supabase/migrations/*.sql` as committed on this branch, plus running the real vitest toolchain
locally. No live HTTP traffic, no live DB queries, no production file modified — this branch adds a
findings doc and one test file.

**One read-only note on repo tooling (same as 08-25):** `packages/{player-vue,core}/node_modules`
did not exist in this worktree (`git worktree add` doesn't run `pnpm install`). Two symlinks were
created pointing at the main checkout's already-installed `node_modules` (same lockfile, read-only,
untracked) so the real vitest/eslint toolchain could run rather than asserting findings unverified.

---

## Headline

Two real findings this pass, both genuinely new (not in the 08-25 or 08-11 reports):

| ID | Severity | Finding |
|---|---|---|
| **SEC29-D-01** | **medium** | `admin_practice_minutes_by_course` is a `SECURITY DEFINER` RPC granted to `authenticated` (every signed-in learner, not just admins) with **no internal caller-role check** — unlike every sibling `analytics_*` RPC, which all gate on `is_god_user()`/`is_ssi_admin()`. Any signed-in account can call it directly from the browser and pull platform-wide, or any specific learner's, per-course aggregate practice minutes. |
| **SEC29-D-02** | **low** | `useAuth.signOut()` clears auth storage, the role cache, and the subscription/entitlement caches — but never touches the IndexedDB audio cache (`ssi-audio-cache-v2`). Cached playback (`resolveCachedPlaybackUrl` → `AudioCache.getWavBlobUrl`) serves bytes keyed only by content id, with no entitlement re-check. A paying learner's downloaded premium clips stay playable, from cache, to whoever uses that browser profile next. |

Everything else investigated — the exhaustive sink sweep, the two `v-html` sites, token storage, the
`VITE_*` surface, and the service worker config — is a control that **holds**. Full detail below.

---

## SEC29-D-01 — `admin_practice_minutes_by_course` has no internal role gate (medium)

**Where:** `supabase/migrations/20260619_admin_practice_minutes_by_course_rpc.sql`,
re-defined identically (re-granted, same absent gate) in `20260717a_practice_minutes_from_sessions.sql`
and `20260717c_position_derived_time_fallback.sql` (the live definition). Called from the browser in
`views/schools/StudentProgressView.vue`, `composables/schools/useAnalyticsData.ts`,
`composables/admin/useAdminUserDetail.ts`, `composables/admin/useAdminCourses.ts`.

**What it is.** A `language sql stable security definer` function:

```sql
create or replace function public.admin_practice_minutes_by_course(p_learner_ids uuid[] default null)
returns table(course_code text, practice_minutes integer, is_estimated boolean)
...
grant execute on function public.admin_practice_minutes_by_course(uuid[]) to service_role, authenticated;
```

`SECURITY DEFINER` means it runs as its owner, bypassing `player_events`'/`sessions`' own-row RLS by
construction — that's the whole point of the function (so an admin browser session, itself only
holding `authenticated`, can see other learners' aggregates at all). But **the grant is to
`authenticated`, not to a role reserved for admins, and the function body performs no caller check
at all** — no `is_god_user()`, no `is_ssi_admin()`, no `RAISE EXCEPTION`. Contrast with every sibling
in the same file (`supabase/schema.sql`):

```sql
CREATE FUNCTION public.analytics_health(...) ... SECURITY DEFINER AS $$
...
BEGIN
  IF NOT is_god_user() THEN
    RAISE EXCEPTION 'Forbidden: god mode required';
  END IF;
```

`analytics_overview`, `analytics_entitlement_funnel`, `analytics_trial_conversion` (and by pattern,
every other `analytics_*` `SECURITY DEFINER` RPC read for this pass) all open with the same shape of
check. `admin_practice_minutes_by_course` is the one written and re-shipped three times (2026-06-19,
2026-07-17 ×2) without ever picking one up.

**What an attacker gets.** Any authenticated Supabase session — a free learner account, no admin
role of any kind — can open the browser console on the live app (which already holds a valid
Supabase client and a valid access token by virtue of being signed in) and call:

```js
await supabase.rpc('admin_practice_minutes_by_course')          // p_learner_ids = null
// → every learner's aggregate practice minutes, per course, platform-wide

await supabase.rpc('admin_practice_minutes_by_course', { p_learner_ids: ['<some-uuid>'] })
// → that specific learner's per-course minutes, if the uuid is known/guessed
```

**Cost to the attacker:** one free account, one RPC call, zero elevated privilege, zero social
engineering. **What it costs the platform:** aggregate usage telemetry (practice minutes by course,
platform-wide or per-learner-id) is not a credential and carries no email/name/PII directly — but it
is precisely the class of internal metric the `analytics_*` family goes out of its way to gate behind
admin, and this one function was missed. Rated **medium**, not high: no PII/credential exposure, no
write path, but it is an unambiguous, verified authz bypass reachable by any signed-in account with
zero friction.

**Why this wasn't caught by the 2026-08-25 pass.** That report's remediation section noted the
*client call-site pattern* ("`useAdminCourses.ts`, `useAdminUserDetail.ts`, `useAnalyticsData.ts` and
`StudentProgressView.vue` call the RPC directly from the browser") as something to watch, but did not
pull the function's own SQL definition to check its internal gate — this pass did, and that is the
new evidence.

**Recommended fix (not applied — DML-only worktree, and DDL needs a proper migration/rollout):**
add `IF NOT is_god_user() THEN RAISE EXCEPTION ...` to `admin_practice_minutes_by_course`, matching
its siblings, **or** revoke the `authenticated` grant entirely and route the four call sites through
a server-mediated endpoint (the `resolveVisibleScope` pattern CLAUDE.md's RLS doctrine already
prescribes for exactly this class of cross-tenant read).

**Tests:** `sec29-d-client.security.test.ts`, `describe('SEC29-D-01...')` — 4 characterization tests
(grant text, absent gate in the live definition, the sibling-gate control holding, the 4 real browser
call sites) + `it.todo` naming the fix.

---

## SEC29-D-02 — signOut() leaves paid audio in IndexedDB, served without re-checking entitlement (low)

**Where:** `composables/useAuth.ts` (`signOut()`), `cache/resolvePlaybackUrl.ts`, `cache/AudioCache.ts`.

`signOut()` is deliberate and thorough about everything it *does* clear:

```ts
purgeSupabaseAuthStorage()
forgetIdentity()
...
useUserRole().clear()
useSharedSubscription().clearCache()
useSharedUserEntitlements().clearCache()
```

It never calls into `getAudioCache()`, never deletes the `ssi-audio-cache-v2` IndexedDB database, and
never runs `deleteIndexedDbs(...)` (the helper `SettingsScreen.vue`'s "clear cache" tool already
uses for exactly this database, for a different reason — see below).

Playback resolution (`resolveCachedPlaybackUrl` → `AudioCache.getWavBlobUrl(id)`) is keyed **only by
content id** — there is no learner id, session, or entitlement token anywhere in that lookup path
(verified directly against both files' source; neither mentions `learnerId`, `userId`, or
`auth.uid`). The entitlement check happens once, when a clip is first fetched through the proxy or a
presigned URL and written into the cache — never again on replay.

**Consequence.** On a shared device (a family tablet, a school computer, any browser profile more
than one person signs into), once learner A — a paying subscriber — has played or offline-downloaded
a premium clip, that clip's bytes sit in IndexedDB indefinitely. If A signs out and a different,
unpaid or guest learner B signs in on the same browser, B's player will still serve A's cached
premium audio for any id B also happens to need, with no re-check that B is entitled to it.
`SettingsScreen.vue`'s "Fix things" flow (`confirmClearCache`) *does* wipe every IndexedDB — but that
is a user-invoked troubleshooting tool, not something sign-out ever triggers.

**Severity: low.** This is a paywall-bypass / content-leak on a shared device, not an account or
personal-data compromise — B gets audio bytes, not A's identity, session, or any other data. It also
requires actual physical/browser-profile device sharing, which is a real but narrow population (the
CLAUDE.md schools context — shared classroom devices — makes it more plausible than for an average
consumer app). Cost to an attacker: sharing a device with a subscriber and knowing/guessing which
audio ids to request (in practice: just using the app normally on the round map, since caching is
transparent).

**Recommended fix (not applied):** have `signOut()` clear the persistent `AudioCache` namespace (or
at minimum stop serving from it for content ids not covered by the new session's entitlement), the
same way `confirmClearCache`'s "Clearing downloaded audio" step already does — just triggered on
sign-out instead of only on manual troubleshooting.

**Tests:** `sec29-d-client.security.test.ts`, `describe('SEC29-D-02...')` — 3 characterization tests
(signOut's clear-list vs. its absence for AudioCache; the id-only cache lookup; the unnamespaced
database) + `it.todo` naming the fix.

---

## D1 — sink sweep (exhaustive, not sampled)

Full-repo grep across `packages/player-vue/src/**` for every sink category in the brief.

| Sink | Occurrences | Attacker-controllable? |
|---|---|---|
| `v-html` | 2 (`HowThisWorks.vue`, `WalkCard.vue`) | **No.** Both sourced from repo-authored, compiled `pack.json` files (`explainer/pack.json`, `walkthrough/pack.json`), both escape `& < >` before a bounded `**bold**→<strong>` rewrite, and both are traced end-to-end to their only real callers (`WalkOverlay.vue`, `ManagerOnboardingGate.vue`) — never a DB row, never a route/query param. See the 08-25 report's identical finding for the *other* two v-html-adjacent surfaces (published-copy markdown, which uses `{{ }}` not `v-html`); these two were not in that pass's diff and so not previously checked, but hold for the same reason (escape-before-render, no user input path). |
| `innerHTML`/`outerHTML`/`insertAdjacentHTML` | 0 | n/a |
| `document.write` | 0 (one comment mentioning it in prose) | n/a |
| `eval` / `new Function` | 0 | n/a |
| `setTimeout`/`setInterval` with a string arg | 0 (all call sites pass function references) | n/a |
| `window.location.href =` / `window.open(` | 12 call sites total | All either (a) fixed literal paths, (b) `data.portalUrl`/`data.redirect` — a value from this app's own `/api/*` JSON response, a server-controlled trust boundary out of client scope, or (c) `new URL(window.location.href)` mutated same-origin (query-param add/remove) and written back to itself — never an attacker-supplied absolute URL. `window.open` calls (`useSubscription.ts`, `useInAppBrowser.ts`) both pass `'noopener,noreferrer'`/`'_blank'` correctly. |
| `router.push`/`router.replace` with a route-object `{path, query}` | 13 call sites | Not an open-redirect vector by construction — vue-router route objects resolve against the app's own route table, never navigate off-origin. The one call site carrying a `query` value from `route.fullPath` (`useAdminGate.ts`'s `deniedDestination`) was already locked by the 08-25 report's `adminGateOpenRedirect.security.test.ts`; re-confirmed unchanged this pass. |
| `postMessage` (send) | 1 (`generateLearningScript.ts:367`, `ch.port2.postMessage(null)`) | A `MessageChannel` yield point between same-thread code, not cross-origin — same conclusion as 08-25. |
| `postMessage`/`message` listener (receive) | 0 | No `window`/`document` `'message'` listener anywhere — no origin-check bug is possible because there is nothing to check. |
| Dynamic `<script>`/`<link>` injection | 0 | n/a |

**Data-from-the-database rendered somewhere:** org/class/display names and invite labels render via
`{{ }}` interpolation throughout the schools views (spot-checked `ClassDetail.vue`,
`TeacherDashboard.vue`, invite components) — no `v-html` anywhere in that surface. Consistent with
the 08-25 report's "zero `v-html`/`innerHTML` in the new diff" finding, now confirmed against the
*whole* two-site `v-html` population, not just the diff.

---

## D2 — token and secret handling

**`localStorage`/`sessionStorage` key inventory (grepped exhaustively):** ~50 distinct keys across
the app. Classified by content:
- **Real bearer tokens:** Supabase's own `sb-<project-ref>-auth-token` family (supabase-js's default
  `localStorage` persistence — `App.vue`'s `createClient(..., { auth: { persistSession: true,
  autoRefreshToken: true } })` sets no custom `storage`, so this is the library default, not custom
  code). Confirmed present indirectly: `SettingsScreen.vue`'s `confirmClearCache()` explicitly
  snapshots every `sb-`-prefixed localStorage key before a wipe and restores them immediately after,
  specifically so a signed-in user survives the "fix things" cache-clear tool.
- **A time-boxed, server-minted, low-value grant:** `ssi-try-token`/`ssi-try-exp` in `sessionStorage`
  (`TryLinkGateway.vue`) — a server-verified entitlement token for the try-link demo flow, sent only
  via `Authorization` header (`bulkAudioDownload.ts`'s `batchUrlsBearer()`), never in a URL/query
  string, tab-lifetime only. No Referer-leak or analytics-log path found for it.
- **Everything else** (~45 keys): UI/feature-flag state (theme, locale, listening mode, settings
  toggles), position/progress caches, a guest id, dismissed-banner flags, a per-course script-cache
  version stamp. None hold a credential.
- **The `sb-*` auth tokens' 30-day CacheStorage twin** (`authHandoff.ts`, the iOS Safari→installed-PWA
  bridge) is unchanged and was already assessed as info/acceptable in the 08-11 report
  (CLIENT-CONFIG-08) — same-origin exposure as the localStorage token Supabase already persists, no
  new blast radius. Re-read this pass; still holds, still not a new finding.

**Secret-pattern grep of client source** (`service_role`, `sk_live`/`sk_test`, `AWS_SECRET`,
`AWS_ACCESS_KEY`, `PADDLE_API`/`PADDLE_SECRET`, `RESEND_API`, `CRON_SECRET`): two hits, both **comments
naming a server-side env var to explain why a code path must not run client-side**
(`composables/servedPod.ts:50` referencing `SUPABASE_SERVICE_ROLE_KEY`;
`components/admin/NodeActionBar.vue:168` referencing `RESEND_API_KEY`) — no value, no leak. Locked in
the test file with a filter that would still catch an actual assignment/literal.

**`VITE_*` inventory (22 distinct vars), classified:**

| Var(s) | Classification |
|---|---|
| `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY` | Legitimately public — anon key is designed to be shipped to browsers; RLS is the real boundary (see D3). |
| `VITE_PADDLE_CLIENT_TOKEN`, `VITE_PADDLE_ENV`, and 10 `VITE_PADDLE_*_PRICE_*` vars | Legitimately public — Paddle's client-side checkout token and public price ids, by Paddle's own design. |
| `VITE_S3_AUDIO_BASE_URL`, `VITE_S3_AUDIO_BUCKET`, `VITE_S3_REGION` | Legitimately public — a public-read CDN bucket's own coordinates, not a credential. |
| `VITE_POPTY_BASE_URL` | Legitimately public — a public CMS base URL (already assessed in 08-25, SEC25-B-01, for a different reason — a CSP gap, not a secrecy issue). |
| `VITE_USE_DATABASE`, `VITE_USE_DEMO_MODE` | Feature flags, not secrets. |

No `VITE_*` var carries a value that should not be public. Unchanged from the 08-11/08-25 assessment,
now independently re-derived rather than carried forward.

---

## D3 — the browser-direct Supabase read surface

Exhaustive grep of `packages/player-vue/src/**` for `.from('<table>')` against the seven org tables
CLAUDE.md's RLS-tightening precondition names, excluding `.test.ts` files:

| Table | Direct browser read call sites |
|---|---|
| `schools` | 12 |
| `classes` | 13 |
| `groups` | 5 |
| `govt_admins` | 1 |
| `invite_codes` | 0 |
| `entitlement_grants` | 2 |
| `user_tags` | 6 |
| **Total** | **39** |
| `learners` (named separately in the brief; not in CLAUDE.md's six-table list, but read directly 15×) | 15 |

**This is the number CLAUDE.md's precondition #2 ("client org-table reads repointed to server
endpoints") is measured against, and it has not moved toward zero** — 39 direct reads is a
substantial, live surface, spread across `composables/schools/{useSchoolContext,useSchoolData,
useClassesData,useAnalyticsData,useStudentsData,useTeachersData,useCourseAccess,classTeacherScope,
rlsGuard}.ts`, `insight/data/vadUptake.ts`, `components/admin/invites/OrgInviteForm.vue`,
`views/schools/ClassDetail.vue`, `views/teach/WithTeacher.vue`, `components/LearningPlayer.vue`.

**Two of the `entitlement_grants` reads (`useCourseAccess.ts`) are dead code** — grepping for a real
call site (`useCourseAccess()` invoked, not just mentioned in a comment) finds none;
`useSchoolCourseCatalogue.ts`'s own header comment calls it "the SUPERSEDED per-course-grant model."
The live count that matters going forward is effectively 37, not 39, once this file is deleted — a
small, free win that also shrinks the RLS-tightening precondition's measure at zero risk.

**What these reads depend on.** By CLAUDE.md's own design, the client's role/scope state
(`useUserRole.ts`) is an explicit, self-declared cache: *"DB is source of truth, localStorage is a
fast cache"* — meaning `isGovtAdmin`/`isSchoolAdmin`/`selectedUser.value.group_path` etc. are
**spoofable client-side by construction** (anyone can edit their own localStorage). The composables
above compute `allowedSchoolIds`/`allowedClassIds` from that client state and then issue **filtered
but not further-authorized** queries — e.g. `useClassesData.ts` does
`client.from('groups').select('id').like('path', selectedUser.value.group_path + '%')` with no
additional server-side check that the caller is actually entitled to that `group_path`. This is the
architecture working as designed **only if** the RLS policies on `groups`/`schools`/`classes`/
`user_tags`/`govt_admins`/`entitlement_grants` genuinely enforce "is this caller's hierarchy," not
merely "is this my own row" — CLAUDE.md records these six tables as RLS-`ON` with real policies
(verified live 2026-08-06), but **this pass cannot independently verify the policies' predicates are
correct** without a live DB connection, which is out of scope (see Gaps).

**SECURITY DEFINER RPCs called directly from the browser** (the brief's specific follow-up on
whether anything beyond `admin_practice_minutes_by_course` does this): yes, extensively — a full
`analytics_*` family (`analytics_entitlement_funnel`, `analytics_class_coverage`,
`analytics_difficulty_turns`, `analytics_trial_conversion`, `analytics_friction_map`,
`analytics_friction_extended`, `analytics_health`, `analytics_course_value`, `analytics_growth`,
`analytics_overview`, `analytics_retention_cohorts`, `analytics_engagement`) called from
`insight/data/*.ts` and `composables/admin/useAnalytics*.ts`. **All of these were checked against
`supabase/schema.sql` and every one gates internally on `is_god_user()`/`is_ssi_admin()`** — this
family is architected correctly; `admin_practice_minutes_by_course` (SEC29-D-01) is the one outlier
that was never given the same gate.

---

## D4 — service worker and cache

**Service worker (`vite.config.js`'s `runtimeCaching`):** covers exactly navigations (NetworkFirst,
4-entry shell cache) and `/fonts/*` (CacheFirst, static assets). **No `/api/*` pattern anywhere** —
confirmed by parsing the actual `runtimeCaching` array (not just grepping comments, which do mention
`/api/audio` in prose explaining why audio is deliberately *not* SW-cached). So no per-user or
entitlement-gated API response can be served cross-user via the SW's shared CacheStorage — this
control holds, matching the 08-25 report's identical finding for the (then three, now unchanged)
`/api/*` endpoints.

**`?reset=1` recovery path (`App.vue`):** wipes localStorage/sessionStorage/IndexedDB/SW/caches on
the *current* browser, triggered only by the user's own navigation to their own origin with that
query param — not a cross-origin-triggerable action (no iframe/redirect path found that could add the
param to someone else's tab without them already being on the app's own origin).

**IndexedDB `AudioCache` ('ssi-audio-cache-v2'):** see SEC29-D-02 above — this is the one place a
cross-user boundary is genuinely crossed, via sign-out not clearing it rather than via the SW.

---

## Gaps — what this pass could not check

1. **The actual RLS policy predicates on the six org tables** (D3) — CLAUDE.md records them as
   `relrowsecurity=true` with real policy counts (verified live 2026-08-06), but this pass had no
   live DB access and could not re-derive whether each policy's predicate genuinely scopes to the
   caller's hierarchy (vs. a looser predicate that would let the 39 browser reads above return
   cross-tenant rows). This is the single biggest open question this report raises and cannot close.
2. **Whether any other `SECURITY DEFINER` function beyond the `analytics_*` family and
   `admin_practice_minutes_by_course` is reachable from the browser with a missing gate** — this
   pass checked every RPC actually called from `packages/player-vue/src/**` (a closed, greppable
   set) but did not enumerate every `SECURITY DEFINER` function in `schema.sql` that is *not* called
   from this client — those could still be reachable from a hand-written `fetch`/`supabase-js` call
   outside this codebase (e.g. a third-party script, or a future client), which is a broader
   DB-hygiene question outside this area's brief.
3. **Popty's own storage/rendering of `pack.json`'s source content** (the two `v-html` sinks'
   ultimate origin) — both files are compiled and checked into this repo, not fetched at runtime, so
   this pass treats them as repo-authored per the file headers' own claims; it did not independently
   verify the build step that produces `pack.json` from whatever authoring tool feeds it (out of this
   repo, same boundary the 08-25 report drew around Popty's `htw` doc).
4. **No live HTTP access, matching every prior pass's own limitation** — the `?et=` entitlement-token
   question, VITE_* values, and CSP were all read from source/config as committed, not from a
   deployed response.

---

## Tests added

`packages/player-vue/src/__security__/sec29-d-client.security.test.ts` — 26 passing, 2 `it.todo`.

| Group | Tests | Covers |
|---|---|---|
| `SEC29-D-01` | 4 + 1 todo | Grant text across all 3 migrations, absent gate in the live definition, sibling-gate control holding, the 4 real browser call sites |
| `SEC29-D-02` | 3 + 1 todo | signOut's clear-list vs. absent AudioCache teardown, content-id-only cache lookup, unnamespaced database |
| D1 | 5 | Both `v-html` sinks' escape-then-bound-markdown source, their callers' repo-authored-only data path, zero innerHTML/outerHTML/eval/new Function, zero `message`-event listeners |
| D2 | 3 | Zero real secret-value patterns in client source, try-token sent only via header not URL, try-token scoped to sessionStorage not localStorage |
| D3 | 9 | Exact-count regression lock per org table (39 total across the seven), the spoofable-client-role-cache doctrine text, `useCourseAccess.ts` dead-code confirmation |
| D4 | 1 | No `/api/*` pattern in the real `runtimeCaching` array |

**Verify:**

```bash
npx vitest run --root packages/player-vue src/__security__/sec29-d-client.security.test.ts
# 26 passed, 2 todo
npx eslint packages/player-vue/src/__security__/sec29-d-client.security.test.ts
# clean
```
