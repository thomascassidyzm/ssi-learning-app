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
