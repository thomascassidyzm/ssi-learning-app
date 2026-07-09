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
