# Decisions — ssi-learning-app

Append-only decision journal per the search-first Better×Simpler×Cheaper doctrine
(`capture-pack/decision-doctrine.md`). Read the tail before deciding; append after each real
decision. Never edit old entries — union merge (`.gitattributes`) depends on append-only.

## 2026-07-09 — bundle-cutover Phase 1: generator + types promoted to @ssi/core
**Move:** Moved `generateScript`, `scriptGenerator.types.ts`, `courseBundle.ts`, and
`computePauseDuration.ts` from `player-vue/src/script|types|playback/` to
`packages/core/src/script/`, as a new `./script` subpath export (matching the existing
`./engine`/`./pods`/etc. pattern) plus a main-barrel re-export. `player-vue`'s old paths become
thin re-export shims so every existing import keeps working unchanged.
**Better:** the shared generator can now be called from a future server script-view (design §3)
without depending on `player-vue` — the whole point of "one shared function, client and server."
**Simpler:** deletes the eventual need for a second copy of the generator; `Cycle`/`Round` get one
canonical home (`core/script/playerTypes.ts`) instead of being declared inline in
`SimplePlayer.ts` and duplicated by hand wherever the shared generator needs them.
**Cheaper (total):** zero new runtime cost (shims are pure re-exports, erased for type-only
imports); one dist build step already existed (`tsup`) and needed only a new entry line.
**Searched & rejected:**
- Leave `generateScript` in `player-vue` and have a future server script-view import across the
  package boundary via a relative path into `player-vue/src` — rejected: inverts the intended
  dependency direction (server importing from the UI package) and breaks the moment `player-vue`
  gains a Vue-specific import upstream of the generator.
- Duplicate `Cycle`/`Round` into `core` and keep `SimplePlayer.ts`'s copy separate — rejected:
  the two shapes are used interchangeably (the generator's output is fed straight into
  `simplePlayer.initialize`), so two independently-editable copies is exactly the "SCRIPT_VERSION
  smeared across N places" problem the whole cutover exists to kill.
**Search width:** visible-options
**Decided by:** agent

## 2026-07-09 — pauseConfig injection replaces the useAlgorithmConfig import
**Move:** `generateScript`'s pause-duration calls now take an injected `pauseConfig` option
(default `DEFAULT_PAUSE_CONFIG`, a core-local literal numerically identical to
`useAlgorithmConfig.DEFAULT_NORMAL`) instead of importing `DEFAULT_NORMAL` from
`player-vue/composables/useAlgorithmConfig.ts` directly.
**Better:** nothing changes for any real caller today — the pure generator was already unused in
production (only its own test file called it), so this is free correctness-hardening, not a
behaviour change anyone notices.
**Simpler:** `@ssi/core` imports zero framework-specific modules (the engine rule) — a future
server script-view (design §3) can call `generateScript` without pulling in a Vue composable.
**Cheaper (total):** the two literal config objects must be kept in sync by hand until
script-shape wiring (design §3 parity item 1, explicitly out of Phase 1 scope — see below) lets
the bundle carry pause config too. Accepted as a small, documented, temporary duplication rather
than building the full shape-injection plumbing now for a caller that doesn't exist yet.
**Searched & rejected:**
- Pass a lazy `() => import('player-vue/...')` — rejected: still a framework dependency, just
  deferred; doesn't achieve the actual goal (a server process has no `player-vue` to import).
- Wire full `opts.shape`/pauseConfig-from-bundle now (design §3 item 1) — rejected as Phase 1
  scope: nothing consumes it yet (bundle stays unfetched in production), and the design doc lists
  script-shape injection as separate parity work from the seed-phase gap Phase 1 was scoped to fix.
**Search width:** visible-options
**Decided by:** agent

## 2026-07-09 — PhraseRole renamed to BundlePhraseRole (collision at the @ssi/core barrel)
**Move:** `courseBundle.ts`'s `PhraseRole` ('build'|'use') renamed to `BundlePhraseRole` inside
`@ssi/core`; the `player-vue` shim re-exports it under the original name (`BundlePhraseRole as
PhraseRole`) so the one real consumer (`api/courses/[code]/bundle.ts`) needs zero changes.
**Better:** `tsup`'s DTS build failed outright on the barrel collision with `@ssi/core/data`'s
pre-existing `PhraseRole` ('component'|'build'|'use', a different and unrelated concept) — this
isn't optional, the build doesn't succeed without it.
**Simpler:** matches the existing `Bundle*` naming convention every other type in this file
already follows (`BundleLego`, `BundlePhrase`, `BundleSeed`...) — `PhraseRole` was the one
outlier, not a deliberate departure.
**Cheaper (total):** zero-cost rename at the source; the aliasing shim absorbs the whole blast
radius so the one external consumer's code is untouched.
**Searched & rejected:**
- Rename `@ssi/core/data`'s `PhraseRole` instead — rejected: that type is `data/types.ts`'s
  general LEGO-hierarchy concept (`'component'|'build'|'use'`), predates this work, and has its
  own consumers outside the bundle-cutover scope; touching it is a bigger, unrelated blast radius
  for the same fix.
- Alias only at the `export *` barrel (`export { PhraseRole as BundlePhraseRole } from './script'`
  in `core/src/index.ts`) instead of renaming the source — rejected: leaves two names for the same
  type depending which import path you use (`@ssi/core` vs `@ssi/core/script`), a worse footgun
  than the collision it fixes.
**Search width:** visible-options
**Decided by:** agent

## 2026-07-09 — algorithm_config.version column applied directly, not via a migrations/ file
**Move:** Ran the additive `ALTER TABLE algorithm_config ADD COLUMN version integer NOT NULL
DEFAULT 1` directly against the live shared DB via psql (transaction + `NOTIFY pgrst`), then
refreshed `supabase/schema.sql` — no new file added to `supabase/migrations/`.
**Better:** `supabase/migrations/README.md` (landed same-week, commit `bb6fc303`) states the
migrations pile is archived and "No new files go in this directory" — following the doc that's
already there beats reintroducing the pattern it just retired.
**Simpler:** one canonical source of DB truth (`schema.sql`) instead of a schema-plus-pending-
migrations split that has to be reconciled by a human running `psql` anyway.
**Cheaper (total):** no unapplied-migration file to track, forget, or double-apply later.
**Searched & rejected:**
- Add a timestamped file to `supabase/migrations/` per the general engineering-manual convention
  — rejected: that convention is superseded in *this* repo by the more recent archival commit;
  the manual's guidance is the general case, the repo's own README is the specific, current
  instruction and wins.
**Search width:** visible-options
**Decided by:** agent

## 2026-07-09 — SEED-PHASE review cycles: stricter audio gate than path (a)'s asymmetry
**Move:** The shared generator's new `buildSeedReviewCycle` requires known + target1 + target2 all
present before emitting a seed review (falls back to a use-phrase review otherwise), for BOTH
main-loop and INF PLAY. `providers/generateLearningScript.ts` (path a) only requires known +
target1 for the main-loop seed-phase branch but all three for the INF PLAY branch — an existing,
undocumented asymmetry, not a deliberate design choice recorded anywhere.
**Better:** one consistent audio-completeness rule across every cycle builder in the shared
generator (matches `buildDebutCycle`/`buildPhraseCycle`'s existing "known+target1+target2 or skip"
convention) instead of silently porting an inconsistency nobody could explain.
**Simpler:** one gate to reason about, not two call-sites with different rules for the same
concept.
**Cheaper (total):** no behaviour change for any real learner today (bundle path is dark); avoids
carrying forward a footgun into the eventual cutover.
**Searched & rejected:**
- Faithfully port path (a)'s asymmetric gate (known+target1-only for main-loop) — rejected: no
  commit message, comment, or design-doc note explains why main-loop is looser than INF PLAY for
  the identical seed-review concept; reads as an accidental drift between two hand-written
  implementations of "the same idea," not an intentional rule worth preserving.
**Search width:** visible-options
**Decided by:** agent

## 2026-07-09 — bundle ?head=1 probe skips entitlement resolution entirely
**Move:** The new `?head=1` version-probe branch in `api/courses/[code]/bundle.ts` returns
`{contentVersion, scriptShapeVersion}` from two small queries (`courses`, `algorithm_config`) and
never calls `resolveServerCourseAccess`.
**Better:** stays genuinely cheap (the design's stated point of the probe — "one tiny GET") instead
of paying the auth-token-verification + subscription-lookup cost the full bundle fetch pays.
**Simpler:** version numbers aren't content — there's nothing for an entitlement check to gate.
**Cheaper (total):** two queries instead of up to ~8 plus an auth round-trip.
**Searched & rejected:**
- Gate the probe behind the same entitlement resolution as the full bundle, for symmetry —
  rejected: manufactures work with no security benefit (a course's content_version and
  script_shape version are not secrets — knowing them reveals nothing about the course's actual
  content) purely to look consistent with a sibling endpoint that has an actual reason to gate.
**Search width:** visible-options
**Decided by:** agent

## 2026-07-09 — PWA lifecycle design: watchdog outside the SW, freshness-ruled position authority
**Move:** Authored `docs/pwa-lifecycle-design.md` (design only): (1) a boot watchdog + self-heal
ladder living INLINE in `index.html` — armed only when a SW controls the page, wiping SW caches
(never IndexedDB/localStorage) with a 2-attempt guard and a static floor screen; (2) the
authority ruling — server enrollment row authoritative for signed-in learners, local position a
device cache trusted only when `local.lastUpdated > server.last_practiced_at`; guests' local IS
truth and stops being wiped by deploys and the 7-day expiry; (3) install detection via a
`start_url: '/?source=pwa'` launch marker + `appinstalled` flag in one `installState` module,
with per-browser guidance replacing the Chrome-only copy.
**Better:** each of Jonathan's three reproducible failure classes (unrecoverable spin after a
Firefox update; reset resurrection / progress loss; Chrome instructions inside installed
Firefox) is dissolved at its mechanism, not patched at its symptom.
**Simpler:** deletes 4 duplicate isStandalone checks, the 7-day expiry, the deploy-time position
wipe, and a future migration step (the ruling is the bundle-cutover position spine applied now).
**Cheaper (total):** ~60 inline lines + one pure tested util + a copy matrix; no SW architecture
change, no new signal without a consumer (wedge telemetry explicitly deferred).
**Searched & rejected:**
- No SW at all — kills offline learning (core requirement); near-zero Better.
- injectManifest custom SW self-healing — a hung SW can't lifeboat itself; bespoke SW to maintain.
- TWA/store install (frame-breaker) — dissolves Android install detection but is the separate
  native-migration track and doesn't help Firefox-browser users.
- Server-only position — breaks guests + offline; CRDT merge — ceremony around what LWW-by-
  practice-time already is for a scalar cursor.
- Patch-only (clear local on reset) — fixes the repro, leaves the family (cross-device
  staleness, deploy/7-day guest wipes).
**Search width:** re-levelled (symptom-patches → boot-line defence + authority ruling); one
genuine floor surfaced (guest data has one copy — warned, not coded around).
**Decided by:** agent (design pass; implementation staged Sonnet-executable, Tom gates promotion)

## 2026-07-09 — PWA lifecycle Stage 1 shipped: never-wedge boot watchdog, Tom's one-button ruling
**Move:** Implemented Stage 1 of the design above on `sonnet-impl/pwa-lifecycle-stage1`: (1)
`window.__SSI_BOOTED` handshake in `main.js` + a plain, import-free inline watchdog in
`index.html` armed only when `navigator.serviceWorker.controller` exists, with a fast path
(capture-phase `error` listener for failed script/module loads) and a slow path (15s timeout);
(2) a 2-attempt heal ladder (unregister SW + clear every Cache Storage entry except
`ssi-auth-handoff`, then reload) guarded by a sessionStorage attempt counter; (3) the floor
screen, rewritten per Tom's verbatim ruling (now the accepted fitness function, recorded at the
top of `docs/pwa-lifecycle-design.md`) as ONE button, "Fix the app", with zero instructions —
no mention of caching, service workers, browser menus, or `/reset` — wired directly to the same
full-heal routine; (4) `vite:preloadError` reload-once in `main.js` for mid-deploy chunk skew;
(5) a hidden `/reset` route (hard `window.location.replace`, not a SPA redirect) as the
power-user/support alias to the existing `?reset=1` nuclear recovery mode — never surfaced by
any UI copy; (6) the `?wedge=1` dev cheat (`utils/wedgeCheat.ts` + wiring in `main.js`, gated by
a new `__ENABLE_WEDGE_CHEAT__` vite define that reuses `swSelfUpdate`'s exact env carve-out) so
testers can deliberately corrupt two precached JS chunks — preferring ones actually referenced
by the current page's entry graph, so the corruption reproduces a real wedge rather than a
lazy-chunk no-op — and rehearse the watchdog's recovery on demand.
**Better:** Jonathan's T5/T6 regression class (Firefox-update wedge, `?wedge=1` drill) now heals
without any user action beyond, at the absolute floor, one unambiguous tap — matching Tom's
ruling that a PWA update "has to be relatively straightforward," not a caching lesson.
**Simpler:** the decision logic (attempt counting, cache-preserve list, arming condition, the
wedge-poison chunk selection) lives in two pure, unit-tested modules
(`utils/bootHeal.ts`, `utils/wedgeCheat.ts`) that the inline script hand-mirrors — one place to
reason about the ladder's numbers instead of re-deriving them from the inline script by eye.
**Cheaper (total):** ~90 lines of dependency-free inline script + two small pure utils + one
router entry; zero SW architecture change; reuses the existing `clearAllCaches`/reset machinery
for the `/reset` alias instead of writing a second recovery path; the wedge cheat reuses
`swSelfUpdate`'s env logic rather than inventing a second dev/prod check.
**Searched & rejected:**
- Point the floor screen at `/reset` with instructions (the design's original text) — rejected
  outright by Tom's ruling: any step requiring the user to read and follow an instruction, or
  understand what `/reset` does, fails "all they need to do is click update app."
- Have `/reset` run the SAME scoped SW-only heal as the floor button, instead of the existing
  nuclear `?reset=1` wipe — considered for consistency, but the design doc (§2.1) already
  specifies `/reset` as "a tiny route alias for `?reset=1`," and that existing nuclear path is
  already documented (CLAUDE.md Recovery Mode) and used elsewhere (Settings troubleshoot) as the
  deliberate full-wipe escape hatch for a human on the phone with support — reusing it outright
  is cheaper than authoring a second, narrower recovery flow with its own test surface. Flagging
  this interpretation explicitly in case Tom intended the narrower scope.
- SPA `redirect:` for the `/reset` route — rejected: a client-side route change wouldn't re-run
  App.vue's top-level `?reset=1` check (that code runs once, at initial module evaluation), so
  the alias needs a hard `window.location.replace`, not router-level `redirect`.
**Search width:** visible-options (implementation of an already-designed, Tom-ruled spec).
**Decided by:** agent (Stage 1 execution per the design's staging table + Tom's verbatim ruling)

## 2026-07-09 — PWA lifecycle Stage 2 shipped: position authority ruling wired in, plus a race the design didn't name
**Move:** Implemented Stage 2 on `sonnet-impl/pwa-lifecycle-stage2` (branched from `origin/dev`,
not stage 1 — stage 1 hasn't merged yet): (1) `utils/resolveAuthoritativePosition.ts` — pure
freshness comparison between a device-cached position and the server enrollment row, wired into
`resolveStartLegoId` (the sole resume-anchor site — `INSTANT_PLAYBACK_ALL = true` means every
course runs this path today, the legacy per-call-site local-first logic elsewhere is the
error-fallback safety net, out of scope); the enrollment fetch races a 2s timeout so
offline/slow-network fails to local exactly as before. (2) `SettingsScreen.vue` `confirmReset`:
clears the local position key (mirroring `confirmRecover`'s existing pattern) and STAMPS
`last_practiced_at` to now instead of nulling it, so a reset carries a real, comparable freshness
signal. (3) `App.vue` `invalidateStaleCaches`: deploys no longer clear `ssi_learning_position_*`/
`ssi_explorer_position_*`. (4) The 7-day local-position expiry in `loadPositionFromLocalStorage`
is deleted (superseded by the freshness comparison for signed-in learners; was actively harmful
for guests). (5) **Not in the design doc, found during implementation and fixed in the same
stroke:** opening Settings only pauses playback, it doesn't unmount `LearningPlayer` — so
`window.location.reload()` in `confirmReset`/`confirmRecover` fires a `pagehide` event first,
which `saveResumeAudio` was still listening for, and would flush the STALE pre-reset round back
into both localStorage and the DB (with a fresh timestamp) a moment after the reset cleared them —
re-ratcheting the exact position reset was meant to erase, at the DB level, inside the same user
action. Closed with a `sessionStorage` suspend flag (`ssi-position-writes-suspended`): set by
`confirmReset`/`confirmRecover` immediately before clearing the local key and reloading, checked by
`saveResumeAudio`'s position-write branch, cleared once at the top of `App.vue`'s boot script (it
must survive the reload itself — same tab, same session — but not linger past it).
**Better:** T10 ("reset stays reset") now holds in the realistic case the design's own test matrix
describes — mid-session, Settings opened over a still-mounted, paused player — not just in a cold
scenario where no dormancy flush could fire. Without the suspend-flag fix, the reset+localStorage-
clear change would have shipped looking correct (matches the design's literal instruction, passes
a superficial test) while silently failing its own flagship regression test in the most common
real path — exactly the "verify the real path, not the ledger" failure class the audio saga burned
five separate incidents establishing.
**Simpler:** one pure, exhaustively-unit-tested function (16 cases: both-null, null-cursor-plus-
fresh-local, fresh-cursor-plus-stale-local, exact-tie, null-timestamp-with-real-cursor treated as
maximally-fresh, guest/no-row fail-to-local, T10 reset variants, cross-device both directions, and
— found while writing the enumeration, not in the design — a brand-new enrollment row (signup,
never practiced) must NOT beat carried-over guest local progress, since `migrateGuestProgress`
deliberately leaves the local position key untouched and a null-cursor/null-timestamp row is
indistinguishable from "just signed up" unless the null-timestamp special case is scoped to rows
that have a real cursor). The suspend-flag reuses the existing local/session-storage
cross-component signalling idiom the reset/recover flows already use (no new architecture).
**Cheaper (total):** the util adds one bounded (2s) round-trip only on the signed-in resume path,
same call already made when local was empty; the suspend flag is a single sessionStorage read on
one hot path, false the overwhelming majority of the time.
**Searched & rejected:**
- Treat any null `last_practiced_at` as "server maximally fresh, always wins" (a literal reading
  of the design doc's own parenthetical) — rejected after writing the guest-signup test: it
  regresses "a guest who played locally then signs up resumes where they left off," which the
  PRE-ruling code got right (local-first unconditional) and nothing in the design intended to
  break. Scoped the null-timestamp-wins rule to rows that also carry a real cursor (protects an
  unstamped-but-real position) or a real timestamp (a reset, which stamps one) — a row with
  neither has simply never been touched under this account and has no standing to override local.
- Guard the pagehide race by re-registering a second `pagehide` listener in SettingsScreen that
  re-clears the key after `saveResumeAudio`'s (relying on DOM listener registration order) —
  rejected: doesn't stop `persistLivePositionToDb`'s fire-and-forget Supabase write from firing in
  the first listener, which could still land the stale position in the DB with a fresh timestamp
  before the tab navigates away; a race on *who overwrites localStorage last* doesn't touch the
  DB-write vector at all. The suspend flag prevents the write from being attempted, closing both.
- Fetch the enrollment row via `App.vue`'s already-loaded `learnerEnrollments` map instead of a
  fresh `progressStore.getEnrollment` call (the design's own suggestion, "the row is already
  fetched at boot") — rejected for Stage 2: that map is missing `highest_completed_lego_id` (the
  ceiling fallback still needs it) and isn't guaranteed populated by the time `resolveStartLegoId`
  runs on mount; reusing the existing `getEnrollment` call this function already made when local
  was empty is one code path instead of two, and `useInstantPlayback`'s round-map fetch is already
  cache-backed so the added latency is bounded and usually near-zero. Flagged as a legitimate
  follow-up if resume latency ever needs shaving.
**Search width:** re-levelled once (the pagehide race is a genuine gap the design didn't name,
not a visible-options choice among things the design already listed).
**Decided by:** agent (Stage 2 execution per the design + Tom's ruling; the pagehide-race fix and
the null-timestamp scoping correction are judgment calls made against the ruling's stated intent,
flagged here rather than silently shipped)

## 2026-07-17 — Organisation = root of the existing groups tree, no new table
**Move:** Built the founder "Organisations + full group hierarchy" model (ORGANISATION →
arbitrary-depth GROUP containers → leaf ENTITY = school) entirely on the existing `groups`
table (`parent_id`/`path`, already arbitrary-depth via `trg_compute_group_path`) plus the
existing `groups.is_demo`/`is_test` flags — no new `organisations` table, and `demo_orgs`
(20260716e) is left untouched as the orthogonal expiry-tracking ledger for the sales-demo tool,
not folded in. Added one migration (groups-inherit-from-parent-group trigger, mirroring the
existing schools-inherit-from-group trigger) so `is_demo`/`is_test` cascade correctly at any
depth, plus `is_demo` passthrough on `POST /api/groups` and a recursive `GroupTreeNode.vue`
admin tree UI (replacing the old hardcoded 3-level template) wired to `ConfirmDeleteModal.vue`.
**Better:** Nick (and any admin) gets the described flow — create an org, build nested
groups/entities of any depth, get shareable join links — on infrastructure that was already
95% built by this week's region-tier and self-serve-delete work; the group-delete endpoint
(`api/groups/[id].ts`) had no UI to hang off (explicitly noted in `73cbca76`'s commit message)
and now has one.
**Simpler:** zero new tables for the org concept itself — an "organisation" is just `parent_id
IS NULL` on a row in a tree that already exists, `is_demo` is a column that already exists and
already cascades to schools. The leaf-only-join invariant ("learners join ONLY an end entity")
needed no new enforcement code: `api/code/redeem.ts`'s `student` branch only ever writes
`CLASS:` tags from `grants_class_id` — there is no code path today that creates a group- or
school-level learner membership, so this was already true by construction, not something this
feature had to build.
**Cheaper (total):** one small trigger migration (mirrors an existing one exactly, same
maintenance shape) + one recursive Vue component reusing existing CSS tokens and the existing
`ConfirmDeleteModal`; no new DB surface to keep in sync, no new RLS policies (the six org tables
stay in their documented RLS-off holding pattern per CLAUDE.md's gated TODO — this feature adds
rows to that pattern, it doesn't change the pattern).
**Searched & rejected:**
- Evolve `demo_orgs` into the general organisation model (the brief's second option) —
  rejected: `demo_orgs` is a narrow, purpose-built expiry ledger (`expires_at`/`status`/a
  creation-time metadata snapshot) for one sales-tool flow; a real paying organisation has no
  expiry and needs none of that shape. Its `group_id`/`school_id` FKs already point INTO the
  groups tree, so a demo org today already *is* one instance of the general model — nothing to
  fold, they already compose correctly as two independent, orthogonal concerns (the tree vs. an
  ephemeral tracking row over one tree instance).
- A dedicated `organisations` table as the root, with `groups` re-pointed to hang off it —
  rejected: `groups.parent_id IS NULL` already means exactly "top of a tree"; a second table
  for the same fact is a duplicate source of truth for zero new capability, and every existing
  subtree-scoping/RLS-adjacent code (`schoolScope.ts`, `isStrictDescendantGroup`) already treats
  the groups tree as the one hierarchy — a parallel root concept would need its own scoping code
  to stay in sync with it.
**Search width:** visible-options (both alternatives were named in the brief itself).
**Decided by:** agent (>90% confidence per CLAUDE.md's BSC-autonomy rule — schema/DB decision,
inside the "code and database changes, decide and go" bucket, not an outward-facing action).

## 2026-07-18 — login lands in your own player; view-as dies with the session
**Move:** Removed the '/' cached-role staff redirect (beforeEnter + the role-driven corrective
watch) from `router/index.ts`; the only thing that now moves a freshly-resolved session off '/'
is the new opt-in "Start me at" preference (`learners.preferences.start_surface`, surfaced in
SettingsScreen's Dashboards section, options limited to surfaces the current role can access,
default Player), read via a new `useStartSurface` module singleton. `useAuth.signOut` now tears
down all session-scoped surface/view-as state: `useSchoolContext` (admin-view/persona scope),
the start-surface singleton, and the persisted `ssi-active-class` / `ssi-demo-active-class` /
`ssi-last-dashboard` keys. Course-progress persistence untouched.
**Better:** kills the trap class where a stale localStorage role/class context from a prior
session (tutor test account, view-as detour) hijacked a fresh login onto /schools — founder
ruling: remember progress, not position. A stale/demoted preference degrades silently to the
player, never a bounce-wall.
**Simpler:** deletes a role-inference redirect (two code paths: fast cached + slow resolved) and
replaces it with one explicit, DB-persisted setting read by one watch; landing behaviour is now
identical for every role.
**Cheaper (total):** one optional JSONB key in an existing preferences column — no new table, no
new endpoint, no localStorage mirror to invalidate.
**Searched & rejected:**
- Keep the staff→/schools redirect but validate the cache against the DB before redirecting —
  rejected: still a position-memory, still needs the async fetch anyway, and re-creates the
  race the resolved-session gate exists to kill.
- Persist "last surface" server-side and restore it — rejected: exactly the behaviour the
  ruling forbids (position memory), just moved somewhere harder to clear.
- localStorage-cached preference for a synchronous fast-path redirect — rejected: reintroduces
  the stale-cache-hijack this change removes; a one-tick post-resolution redirect is imperceptible.
**Search width:** visible-options
**Decided by:** agent (ruling from Tom)

## 2026-07-18 — operator-capture guard: self-service flows never mutate an ssi_admin's roles
**Move:** New `api/_utils/operatorGuard.ts`; invite redemption (`api/code/redeem.ts`, before the
use-claim) and onboarding provisioning (`api/onboarding/provision.ts`, before any write) refuse a
caller whose learner row carries `platform_role='ssi_admin'`, with one shared message pointing at
test accounts. Schools shells gain a "My player" menu item (SchoolsTopBar + TopNav) — leaving the
dashboard is navigation, never identity sign-out. DB remediation for the live capture applied
directly (audited in role_change_audit, source='admin-cleanup').
**Better:** closes the incident class where the founder's real admin account was captured as a
teacher/tutor by testing real signup/invite flows while signed in; also stops a test burning a
capped code use or a one-per-email trial burn.
**Simpler:** one 15-line util + two early returns; no new state, no client changes to the flows.
**Cheaper (total):** one extra indexed select per role-granting redemption/provision call — paths
that already do several round-trips.
**Searched & rejected:**
- Confirmation dialog ("really take this role onto your admin account?") — rejected: the operator
  is testing the REAL flow; a dialog either blocks the test anyway or gets clicked through and
  captures again. Refusal + test accounts is the honest shape.
- Client-side guard in RedeemCode.vue/Onboarding.vue — rejected: the mutation is server-side;
  a client guard is bypassable and misses future callers.
- Auto-revert after redemption — rejected: leaves a mutation window and cleanup complexity for
  zero benefit over refusing up front.
**Search width:** visible-options
**Decided by:** agent (incident + ruling from Tom: testing must never mutate operator roles)

## 2026-07-19 — THE LENS: one node-scoped rate endpoint, not a second engine
**Move:** `GET /api/groups/:id/rate-compare` — resolves group/school/class ids exactly like the
node-home endpoint, returns picker options (courses below the node; the ancestor chain nearest-
first) AND the resolved comparison in one round trip. `NodeRateEngine.vue` is the ONE engine
component both admin node pages (mounted at the old analytics URLs; `AnalyticsView.vue` deleted)
and the teacher surface consume; `plainWords` prop carries design law §1.12. Additive
`p_include_demo` on the sessions RPC so a demo node reads its own sessions (canary-applied).
**Better:** the compare-to chain IS the org tree (parent avg default) — same story as the map
rail; teacher/leader/admin read the same numbers via the same math (api/_utils/rateCompare.ts);
the engine tells the same story as the node-home stats row on demo orgs.
**Simpler:** deletes the old-school AnalyticsView and the teacher view's demo-fixture fork;
reuses home.ts id-resolution, resolveVisibleScope authz, and the existing RPC — no new tables,
no new RPC, one new endpoint + one component.
**Cheaper (total):** one round trip per view; no polling (refresh protocol); fewer surfaces to
maintain; K_FLOOR privacy held for non-admin callers (admin floor 1 — they already hold row
access, so the floor would blank the tool while protecting nothing).
**Searched & rejected:**
- Extending `/api/school/rate-compare` with node ids — rejected: its entity/compare vocabulary is
  the fixed 3-level ladder; the node model needs the arbitrary-depth ancestor chain, and mixing
  both grammars in one endpoint doubles every authz branch.
- Client-side compare-chain derivation from the home payload — rejected: teacher surface has no
  home payload, and cohort resolution must stay server-side (sovereignty).
- Sibling-group cohort members above class level — rejected: structurally too sparse to ever
  clear K_FLOOR; schools are the peers-like-me unit that yields a meaningful, k-clearable spread.
**Search width:** visible-options
**Decided by:** agent (founder frame: "insight engine at every node", compare chain = map rail)

## 2026-07-19 — teacher/admin/leader invite links go STRAIGHT IN again (regression fix)
**Move:** Restored the founder's "magic link with a built-in token" for possession-eligible invite
types (teacher / school_admin / school_admin_join / govt_admin-leader / student). Clicking a
`/redeem/CODE` (or `/group/CODE`) link now auto-establishes a session from possession of the code
alone — NO email/name form, NO OTP — and lands on the role dashboard. Implemented as a `linkAuth`
mode on `api/auth/possession-redeem.ts`: a brand-new user has no email at click-time, so the
account is minted against a unique placeholder address (`link-<uuid>@invite.saysomethingin.app`,
never emailed) and flagged `needs_verification` so first-run prompts for a real email (existing
`SettingsScreen` + `api/email/verify.ts` machinery). `RedeemCode.vue` auto-runs it on mount; the
email form / OTP remains the fallback for anyone without a link and whenever the mint can't proceed.
**Diagnosis:** teacher/admin invite links were NEVER minted as Supabase `generateLink` magic links
in git history (pickaxed all of `api/`); the "straight in" experience drifted off through
`cecee5eb` (inline auth rewrite) → `afb2ea6e` (possession email+name form, never formless) → the
the-model unified-invites redesign (`7826e513`/`386a3450`, invites became anonymous `/redeem`
codes). So the invite code in the URL is the only token the link carried, and the recipient still
had to authenticate — the "completely different type of magic link" the founder flagged.
**Better:** clicking a teacher/admin/leader link authenticates you straight onto your dashboard —
the experience the founder remembers, zero ceremony.
**Simpler:** reuses the proven possession `generateLink→verifyOtp` mint and the existing
needs-verification/add-real-email loop; no invite-creation change, no new table, one endpoint mode
+ the RedeemCode entry flow. `onboarded_via` stays `'possession'` for both paths so the whole
downstream apparatus is untouched.
**Cheaper (total):** no new infra; links stay revocable (unified invite list), single-use/expiring,
and redemption still records through `invite_codes`.
**Known trade-off (flagged to founder, dev-only until tasted):** formless straight-in mints against
a placeholder email, so on a MULTI-use shared link the same person clicking on two devices makes two
accounts. Clean resolution = per-person single-use straight-in links; deferred to founder's taste
call on the dev artifact.
**Searched & rejected:**
- Email-bound magic link minted at invite-creation (true token-in-URL, real email, dedupe-safe) —
  rejected for now: requires the inviter to supply the recipient's email at mint time, changing the
  anonymous-shareable-link invite model the task spec said to keep ("links remain revocable…records
  through invite_codes"). It's the cleaner long-term shape if the founder wants per-person links.
- Supabase anonymous sign-in (no placeholder email, email=null) — rejected: hard dependency on a
  project-level auth setting that can't be verified/toggled from here; the placeholder path reuses a
  mint already proven in production.
**Search width:** visible-options
**Decided by:** agent (task spec: "token embedded, session established on click… email-OTP stays as
the fallback for people without a link"); placeholder-vs-per-person shape held for founder taste-pass.

## 2026-07-19 — straight-in is the DESIGN: the link is the credential (founder sharpening, elevated to standing principle)
**Move:** Founder sharpened the fix above into a standing principle, now written as `THE-MODEL.md`
§1.13 + invariant **I12**. Verbatim: *"given that the email is not even verified before they get
access, [the OTP step] is just an unnecessary friction point."* THE LINK IS THE CREDENTIAL —
possession of the invite/access link already grants the account, so an OTP/email screen after the
click re-proves possession of what the click just proved: **ceremony, not security**. Straight-in on
click is the DESIGN, not a convenience; no future "standardisation"/"sign-in hardening" pass may
reintroduce an interstitial on a valid link (that's a regression, pinned by I12 + the
`RedeemCode.test.ts` "goes STRAIGHT IN" assertions: zero interstitial steps, no OTP input, no form).
**Better:** the invariant is now load-bearing doc + executable pin, so the teacher/admin/leader
experience can't silently regress back to a form.
**Simpler:** one principle ("the link is the credential") replaces case-by-case arguments about which
flows may skip OTP.
**Cheaper (total):** the security budget is explicitly redirected to where it does real work — link
revocability, expiry/single-use where configured, and the unified audit trail
(`invite_codes` + `possession_mint_attempts`) — never on re-proving the click.
**Searched & rejected:** keep OTP "for safety" — rejected on the founder's own ground: access is
granted before any email is verified and nothing matches the typed email to the invitee, so the step
protects nothing while taxing every teacher.
**Search width:** founder-ruled
**Decided by:** founder (verbatim ruling); agent recorded + pinned.

## 2026-07-20 — role-shaped invite links: ONE identity-capture screen replaces the ghost mint (founder reconciliation)
**Move:** Founder-ruled reconciliation of §1.13 after the staging shambles (every node's link felt
generic; redeem minted anonymous `link-<uuid>@invite.saysomethingin.app` accounts and dumped every
role wherever). The link stays the credential — NO OTP, NO email round-trip — but **named roles
(teacher / school leader / group leader) get ONE identity-capture screen on first redeem** ("You've
been invited as a teacher at <School>. Your name / your email") and the account is born REAL: their
name, their recorded (unverified-is-fine) email. Pupil links (student→class, learner→group) keep
lighter capture: name only — young learners have no email; the placeholder address survives for
code_type `student` ONLY, server-enforced (`identity_required` refusal otherwise). Re-clicking a
link under a session that already redeemed it goes straight to the person's surface — no confirm
screen, no second code spend. `validate.ts` now resolves node context (group/school name) for
node-scoped codes so no capture screen is ever anonymous. THE-MODEL §1.13 + I12 rewritten; pins
updated in `RedeemCode.test.ts` / `possession-redeem.test.ts` / `invites.test.ts`.
**Better:** teachers/leaders arrive as real named people on the right surface; the founder can send
IME links that say who and where they're for.
**Simpler:** one capture screen IS the account creation — no ghost-account + later-repair loop
(SettingsScreen add-email nudge stops being the only source of identity for staff).
**Cheaper (total):** deletes the support cost of nameless accounts on teacher rosters and dead
"who is link-3f2a…?" dashboards; no new tables, no new endpoints — same possession mint, one new
refusal branch.
**Generic-link ruling (my read, journalled):** the node's "Get join link" learner path (role
`student`, `grants_group_id` = the node) is NOT the generic-link bug and is kept — it is node-scoped
and learner-only, the low-friction path the model wants for pupils. What died is the ghost mint for
named roles and the anonymous screens. Per-person single-use links remain OPEN (held for founder
taste, `project_straight_in_invite_links` memory).
**Searched & rejected:**
- Full email verification (OTP) for named roles — rejected: re-proves possession the click just
  proved (§1.13 verbatim); school gateways still quarantine the mail (the original Option A driver).
- Capture email lazily after landing (keep zero screens, prompt on the dashboard) — rejected: the
  ghost exists in that window, appears on rosters/audits, and the founder ruled the capture screen
  is the account being born, not ceremony.
**Search width:** founder-ruled shape; agent owned the enforcement layers.
**Decided by:** founder (reconciled design, project brief 2026-07-20); agent implementation.

## 2026-07-20 — TWO link species: PERSONAL (pre-provisioned, zero screens) vs OPEN (capture) — founder clarification
**Move:** Founder-ruled (screenshot evidence): the capture screen shipped earlier today is the flow
for **OPEN shareable links only** (person unknown at mint). **PERSONAL links** — the thing he emails
known partners — are pre-provisioned accounts (role + node + display name, optional email) whose
link IS the login: click → authenticated as THAT account → role dashboard, ZERO screens, repeatable,
revocable. Implemented: `provisionPersona` (api/_utils) + `personal:{name,email?,class_id?}` on the
node mint endpoint (binding stored as `invite_codes.metadata.personal_auth_user_id`, server-derived
only) + a personal branch in `possession-redeem.ts` (mints the session for the bound account) +
client zero-screen path + "Invite a person" vs "Get a shareable link" verbs on the node.
**Better:** partners get the real straight-in (what §1.13 always meant); open links keep honest
identity capture; both species carry names — no ghosts anywhere.
**Simpler:** same invite_codes table, same possession mint, same rails (revocation = is_active,
expiry, rate limits, audit); one metadata key instead of a new table/column.
**Cheaper (total):** no migration (metadata jsonb), no OTP infra, and pre-provisioning removes the
"who is this account?" support loop entirely for known partners.
**Security note (deliberate):** the personal branch skips the already-registered takeover rail —
signing into the bound account IS the link's purpose; binding is admin-gated at mint and never
client-supplied. Rate limits + audit unchanged. Session-replacement on click is by design (the link
is the login), unlike open links which still confirm under a foreign session before spending a code.
**Searched & rejected:**
- Supabase generateLink magic links as the personal mechanism — rejected: single-use and
  short-lived; founder needs repeatable, revocable links.
- A `grants_auth_user_id` column — rejected for tonight: needs a live migration for zero functional
  gain over metadata; revisit in the contract phase if personal links become hot-path.
**Search width:** founder-ruled shape; agent owned mechanism.
**Decided by:** founder (species clarification, 2026-07-20 late); agent implementation.

## 2026-07-22 — structural cache freshness: trigger-maintained courses.content_stamp (agent, BSC)
**Move:** Closed the "content fixed in DB, devices stale for months" bug class (ita 'come'='how'
gloss: fixed 2026-03-12, still served 2026-07-22). New `courses.content_stamp` (timestamptz),
maintained by exception-safe AFTER triggers on all six learner-facing content tables
(course_seeds, course_legos, course_practice_phrases, course_audio, listening_pod_sentences,
lego_introductions), debounced to one bump per transaction. The app reads it in the ONE tiny
courses query it already makes on boot (checkContentVersion — no new request); every cache entry
records the stamp it was built from; mismatch while online → script cache entry dropped
(regenerates on the next walk, offline lease rescued and re-attached) and the listening metadata
bundle refetches in the background. Stamp-less entries (every pre-mechanism device) count as
stale-once — retroactively healing the whole stale fleet. Offline: no stamp obtainable → nothing
invalidates (a stale cache offline is correct; staleness only matters once online).
Migration applied live 2026-07-22 (verified: no-op pod update moved ita's stamp, other courses
untouched, anon PostgREST read OK).
**Better:** no human ever bumps a version for a content fix again — the DB write IS the
invalidation; devices self-heal on next online boot; play is never blocked (background refresh).
**Simpler:** one concept (per-course content vintage) covers listening meta + script cache + the
offline snapshot fallback (same cache); piggybacks on the existing boot query and the existing
checkContentVersion call sites (zero call-site changes); META_VERSION/SCRIPT_VERSION shrink to
their honest job (schema-shape escape hatch).
**Cheaper (total):** one column + one trigger function; deletes the recurring manual-bump toil and
the months-stale support burden; refresh cost is bounded by actual content-change frequency.
**Searched & rejected:**
- Reuse `courses.version` (int, trigger-bumped) — rejected: it's the dashboard's
  decomposition-staleness key and deliberately excludes audio; extending it entangles two repos'
  semantics.
- Reuse `courses.content_version` (semver) — rejected as the sole mechanism: hand-bumped, which IS
  the disease; kept for its heavier role (audio regeneration → full clear incl. SW audio cache).
- Client-side max(updated_at) probes — rejected: course_audio has no updated_at, N extra queries
  per boot, and updated_at hygiene varies by table; the trigger stamps writes at the source.
- Delta audio re-download on refresh — deferred: metadata (text/gloss/structure) is the stale
  class observed; re-recorded clips stream+cache on first online play and wholesale regeneration
  rides the content_version lane. Revisit if re-recording churn shows up offline.
**Search width:** 4 options, one frame-breaker (DB triggers instead of any client-side freshness
accounting).
**Decided by:** agent under the project brief "cache freshness: structural self-invalidation";
verified by unit tests + live e2e (doctored stale-vintage IndexedDB entries self-refreshed on
online boot against the real DB).
## 2026-07-10 — family_members table: revoked the grant-open default despite RLS already blocking it
**Move:** Applied `family_members` (FAMILY-PLAN-SPEC.md §1) directly to the live DB — RLS ON, zero
policies — then found Supabase's table-creation default had granted `ALL` to `anon` and
`authenticated` alongside `service_role`. Ran a second REVOKE ALL FROM anon, authenticated pass
before snapshotting, leaving only `postgres` (owner) and `service_role` with any privilege.
**Better:** matches the explicit posture CLAUDE.md rule 7 requires ("never Supabase's grant-open
default") and the pattern already established on `govt_admins`/`invite_codes` during the 2026-07-04
grant-hygiene pass — this table now reads the same way on inspection as every other
service-role-only table, not as an outlier that happens to be safe for a different reason.
**Simpler:** one posture, enforced at both layers (RLS row-level + GRANT table-level) — a future
reader checking "can anon touch this?" gets the same answer from either layer, instead of RLS being
silently the only thing standing between the default grants and a leak.
**Cheaper (total):** zero runtime cost; the REVOKE is one extra statement in a migration that's
already being applied by hand.
**Searched & rejected:**
- Leave the default ALL grants in place since RLS-with-no-policies already denies every operation
  for anon/authenticated regardless of table grants — rejected: correct today, but it's exactly the
  "RLS already covers it" reasoning the rule exists to rule out; a future policy added carelessly
  (or a `bypassrls` role) would then be riding on the loose grants with nobody having checked them.
**Search width:** visible-options (the fix is the documented rule 7 pattern, not a novel design).
**Decided by:** agent

## 2026-07-10 — family plan resolver: two point-lookups instead of one PostgREST join
**Move:** `resolveEffectiveSubscription` (FAMILY-PLAN-SPEC.md §3) implements the "own row OR
family join" resolution as two sequential queries (family_members, then subscriptions) rather
than the one-query embedded join the spec pseudocode sketches.
**Better:** identical behaviour for every caller — the spec's predicate list (removed_at,
status='active', plan_name='SSi Family', status='active', period-end freshness) is applied
exactly, just as two round trips instead of one.
**Simpler:** there is no direct FK from `family_members` to `subscriptions` (both reference
`learners.id` independently), so PostgREST can't auto-embed one across the other without a
manual join hint — the two-query version is the straight-line read anyone maintaining this file
can follow without knowing PostgREST's embed-hint syntax.
**Cheaper (total):** both queries hit an index already on the table (`family_members_one_family`
on member_learner_id; subscriptions' own learner_id uniqueness) — two indexed point-lookups cost
about the same as one join for a table this small, and the resolver only runs on the
"no own row" branch (the common case — most learners aren't family members — never pays the
second query at all).
**Searched & rejected:**
- A PostgREST embedded join via a manual FK hint / view — rejected: adds a schema object (a
  view, or a synthetic FK) purely to satisfy a query-shape preference; the two-query version
  needs neither and is exactly as correct.
**Search width:** visible-options.
**Decided by:** agent (spec pseudocode is a sketch of the LOGIC, not a mandated query shape —
implementation detail per CLAUDE.md's altitude rule).

## 2026-07-10 — family plan QR: added `qrcode` (client-side, lazy-loaded) rather than a hosted QR API
**Move:** The create-child sign-in link (FAMILY-PLAN-SPEC.md §4.1(b)) renders as a QR code via
the `qrcode` npm package, dynamically imported inside FamilyManagementModal.vue so it lazy-loads
into its own chunk (verified in the production build — separate from the SettingsScreen bundle).
**Better:** the alternative — a third-party "QR image" HTTP API (`data=<url>` query param) —
would leak the bearer sign-in link (a credential granting full access to a child's account) to
an external service's request logs. Client-side generation never sends the link anywhere.
**Simpler:** one well-established, dependency-free-at-runtime library call
(`QRCode.toDataURL(link)`) vs. building/hosting a QR endpoint ourselves.
**Cheaper (total):** ~26KB gzipped, lazy-loaded only when a parent actually adds a child — zero
cost for every other user of the app; no new server surface, no third-party runtime dependency.
**Searched & rejected:**
- A hosted third-party QR image API — rejected outright on the security leg, not a trade-off:
  the payload here is a live magic-link credential, not public data.
- No QR at all, link-only — rejected: spec explicitly calls for "one-time sign-in link, rendered
  as link + QR" as the age-verification-sidestep UX; a parent scanning with a phone camera is the
  whole point of the flow (no manual URL retyping onto a kid's device).
**Search width:** visible-options.
**Decided by:** agent

## 2026-07-29 — deploy sentinel: local cron watcher, version.json + GitHub deployments as deploy truth
**Move:** Stage-1 post-deploy fallout watcher (`tools/deploy-sentinel/sentinel.mjs`) runs on
watson-1 via user cron every 3 min. New main SHA (via `git ls-remote`) opens a 2h window: deploy
confirmation = prod `/version.json` buildNumber reaching the pushed short SHA, cross-checked
against the GitHub deployments API (`gh api …?environment=Production`) so a Vercel usage-cap
block/build failure is reported DISTINCTLY ("deploy never went live") from app breakage.
Telemetry = `player_events env=production` window volume vs same-clock-window median of the 4
prior weeks (crater < 35% of median, judged only after ≥60 min and median ≥50 events). Probes =
5 cheap GETs (shell, sw-config, courses, audio proxy, player-events OPTIONS), alert after 2
consecutive failing ticks. Clean window → one done-board card; fallout → one needs-you card per
failure class (needs-you pushes to devices).
**Better:** Tom KNOWS a deploy is clean within 2h instead of waiting for user complaints; the
Vercel-block failure mode (recently real) is a named, distinct alert.
**Simpler:** zero app changes — `/version.json` already existed (vite stamps it for the update
banner), `gh` is already authed, the boards already exist. One dependency-free Node file + a
crontab line; no webhooks, no Vercel API token needed.
**Cheaper (total):** a few HTTP GETs every 3 min; no new server surface, no new tables.
**Searched & rejected:**
- Vercel API polling with a token — rejected: no token exists on this VM, and the GitHub
  deployments API (already authed via gh) carries the same production deploy state for free.
- GitHub webhook → local listener — rejected: standing infra + exposure for what a 3-min poll
  of `ls-remote` does adequately; deploy windows are 2h, 3-min latency is noise.
- Writing a tagged synthetic event to prove player-events ingest — rejected: an OPTIONS probe
  proves reachability without polluting production telemetry.
**Search width:** visible-options.
**Decided by:** agent (per brief's taste-safe defaults; thresholds flagged in report).
**Open:** telemetry leg is INACTIVE until a Supabase service-role key lands on this VM
(`~/.ssi-sentinel.env`) — the only keys present are anon-role, which RLS correctly blocks from
player_events; worked around nothing, reported plainly.

## 2026-07-30 — course-switch READY: switches never replay the cinematic; whole-course walk waits for READY
**Move:** Two scoped changes in `LearningPlayer.vue` under the founder ruling "READINESS = first
LEGO identified, ≤2–3s on a course switch". (1) The 2800ms first-visit cinematic floor now keys
on `skipCinematic = isReturnUser || !isFreshLoad` — an in-app remount (course switch, detected
via `__ssiBoot.mountedMs`, the same test the cold_start telemetry already used) always takes the
300ms floor, even when `ssi-has-played` has been wiped. (2) A `playerReadySignal` promise
(resolved right after the loading stage flips to 'ready') now gates the whole-course
`generateScript` walk (main-loop handoff AND INF-PLAY idle warm) plus the contribution fetch, so
their ~45 course-wide queries can never compete with the switch's two critical fetches
(round-map + first-round cycles).
**Evidence:** the founder's own staging telemetry (iPhone, 01:32–01:45 UTC): every warm switch
pinned at exactly ~2805ms (= the 2800 floor re-applied after a storage wipe); cold switches
4.3–9.4s while the walk's flood shared the phone pipe with the bootstrap. Deployed-staging
waterfalls (guest + minted signed-in tester session) confirmed the flood fires inside the READY
window; on datacenter broadband it costs little (1.1–1.7s switches) — the phone numbers are the
same waterfall paying real RTTs.
**Better:** switch READY on-device drops from 2.8s-pinned / 4–9s-cold toward the bootstrap's own
~1s; a stale mount's walk (rapid re-switch) is now skipped entirely instead of running for a
course no longer shown.
**Simpler:** no new state machine — one promise + an existing detection reused; floor and
telemetry now share ONE isFreshLoad computation instead of two copies.
**Cheaper (total):** strictly less network in the critical window; the walk still runs once,
just after play is available.
**Searched & rejected:** deferring every boot-time composable fetch (pods, journey, explorer
legos) — invasive across an 18k-line file for ~8 small requests; revisit only if on-device
numbers still miss the target. Priority hints/HTTP2 tuning — doesn't remove the contention,
just reorders it.
**Search width:** visible-options.
**Decided by:** agent (BSC >90%; founder ruling supplied the target and the readiness definition).

## 2026-07-30 — production ships weekly, Friday mornings, on an explicit GO
**Ruling (founder, verbatim):** *"wait on this - I want to ship to production on a weekly basis -
Friday mornings."* Said in answer to an offer to promote the open 130-commit `staging → main`
backlog immediately. The answer was not "ship now" but "institute a cadence."
**Move:** Built the mechanism, not the one-off ship. (1) `tools/release-train/candidate-report.mjs`
— a Thursday 17:00 UTC cron on watson-1 that computes `origin/main..origin/staging`, condenses it
to human headlines (process commits split out, substantive ones clustered by area), reads per-SHA
CI verdicts from the Verify workflow history plus the staging head's combined status, flags open
regressions and MAIN-gated items out of `WORKLIST.md`, commits the report to
`tools/release-train/reports/<date>.md` from a throwaway worktree, and posts the needs-you card
**"Friday ship: N commits ready — GO / HOLD"**. (2) `tools/release-train/promote.sh` — the Friday
merge, run by a human on Tom's word, refusing without `--go` and refusing if `main` is not an
ancestor of `staging`. (3) `docs/RELEASE-TRAIN.md`. (4) `verify.yml` now also runs on `staging` and
`main` pushes, so the report reads a real verdict on the tree being promoted rather than inferring
one; those runs gate nothing.
**Explicitly NOT built:** anything that promotes on a timer. The trigger is Tom's sentence, every
week, forever. Post-ship fallout watching is not duplicated either — `tools/deploy-sentinel/`
already opens a 2h watch window on every `main` push.
**Better:** production stops drifting a month behind staging; each ship carries a written
candidate readable on a phone in a minute instead of 130 raw subject lines, with the items the
promote *unblocks* (two parked migrations gated on code reaching `main`) named up front.
**Simpler:** one cron writing a question, one script a human runs on the answer. No release
manager, no new environment, no new watching layer.
**Cheaper (total):** a `git log` and a handful of `gh` calls once a week; the promote is one merge.
Nothing on the money path moves without a human sentence in front of it.
**Searched & rejected:** promoting the backlog immediately (the founder's actual instruction was
the opposite); a cron that promotes automatically with a veto window (inverts the ruling — GO must
be affirmative); posting the full detail in the card body (the needs-you board takes text ≤300
chars and a url, with no detail field — hence a committed report file the card links to);
a second post-ship watcher (the sentinel already exists).
**Search width:** visible-options.
**Decided by:** founder (the cadence); agent for the mechanism's shape (BSC >90%).

## 2026-07-31 — two lanes: fixes ship immediately without notes, features ride the Friday train
**Ruling (founder, verbatim):** *"fixes go live immediately - at any point in the week - without
release notes; whereas features, and/or minor fixes that are just better affordances stick to the
weekly release train."* An amendment to the 2026-07-30 weekly-cadence ruling, not a reversal of it.
**The classification test, as documented:** *was something broken, or lying to the user?* → fix:
ships now, any day, no notes. *Is something newly possible, or nicer?* → feature or affordance:
rides the train, gets notes. "Lying to the user" is load-bearing — dishonest behaviour (a control
out of step with reality, a false "Saved", a stale number presented as live) is breakage even when
nothing crashed. Regressions are fixes by definition. The test is the **state of the thing before
the change**, not the size of the diff: a small change to something that was merely *less good* is
an affordance and waits for Friday.
**Move:** amended `docs/RELEASE-TRAIN.md` — retitled the cadence to govern features/affordances,
added the classification test up front and an "Any day — the fix lane" section, and stated
explicitly that the deploy sentinel watches ALL `main` pushes, so a Tuesday fix gets the same
2-hour fallout watch as a Friday promote.
**Explicitly NOT built:** a second promotion mechanism. The fix lane **IS** `CLAUDE.md`'s existing
`hotfix/<desc>`-off-`main` lane, back-merged into `staging` AND `dev` — the ruling widens *what
qualifies*, it does not add machinery. No notes file, no card, no cron for the fix lane.
**Better:** nobody lives with a broken or dishonest surface until Friday; the weekly cadence keeps
its whole point (features arrive announced, in one readable batch) without holding fixes hostage.
**Simpler:** one written test decides the lane, and the fix lane reuses a mechanism that already
existed and was already documented; the sentinel needed zero change to cover it.
**Cheaper (total):** zero new infrastructure. The only new ongoing cost is one judgement call per
change, and the default when it's genuinely in doubt is the train — a week's wait costs less than
an unannounced surprise.
**Search width:** founder ruling (the policy); agent for the documentation shape only.
**Decided by:** founder.

## 2026-07-31 — release notes are regenerated from the promoted diff, not stamped from the draft
**Ruling (founder, verbatim):** *"accuracy over elegance"* — said on finding the 2026-07-30 notes
did not describe what actually shipped.
**What was actually wrong (the reconciliation finding):** not machinery drift. Re-running the
generator over the real promoted range (`becac1cc^1..becac1cc^2`, 150 commits) reproduced the
shipped file byte-for-byte. Two things were wrong instead: (1) two genuinely user-visible fixes —
the stuck "Updating the app" overlay and WHERE-YOU-ARE rail stability — were dropped by the
generic path as *"names nothing a user can see"*, because their commit subjects read as machinery;
(2) the course-switch bullet said "near-instant" for a change that lands READY in 2-3s, which is
over-claiming, the one failure mode these notes may not have. Both fixed at the durable layer —
two new phrasebook entries (surfaces, not one-offs) and a corrected phrasebook line — so the
reconciled file is machine output, not a hand-patched one.
**Move:** `candidate()` takes a range (default `origin/main..origin/staging`); `--finalize`
REGENERATES the notes from the promoted range instead of stamping the draft; `promote.sh` passes
`--base $MAIN --head $STAGING` (the only place that knows main's sha before the merge) and a
hand-run finalize reads `main^1..main^2` off the promote merge commit.
**Hand-edit preservation, made exact:** every machine commit to a notes file is prefixed
`release-train:`, so "was this file touched by a human" is answerable from `git log` rather than
guessed from text. Machine-only file → regenerate wholesale (which is how a reworded phrasebook
line replaces its predecessor instead of doubling it). Human-touched file → keep any bullet we
cannot prove the machine wrote.
**Better:** the notes describe what shipped. A Thursday draft could previously miss everything
merged to staging on Thursday night and Friday morning — which is exactly what happened: the ship
was 150 commits against a draft written for 130.
**Simpler:** deletes the concept of "the draft is the content, the promote is a rubber stamp" —
one source of truth (the promoted diff) instead of two that drift. The immediate-fix lane needs no
exclusion filter either: a hotfix already on `main` is not in `main..staging`, so the range IS the
policy.
**Cheaper (total):** one extra `git log` at promote time. No new inputs, no new files.
**Searched & rejected:** marking machine bullets inline in the draft so finalize can tell them
apart (plumbing in a file Tom reads and edits, and it would have to be stripped again for
learners); reconstructing the draft's own range at finalize time to subtract it (needs a sha the
draft does not record, for a case `git log` answers exactly); leaving the stamp-only flow and
correcting notes by hand each week (the founder's complaint was precisely that).
**Search width:** visible-options.
**Decided by:** founder (accuracy over elegance); agent for the mechanism (BSC >90%).
