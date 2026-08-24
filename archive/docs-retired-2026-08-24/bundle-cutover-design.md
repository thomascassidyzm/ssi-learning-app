# Bundle Cutover — the server-issued learning script artifact

> **Status: DESIGN (2026-07-09).** No code in this document has been written.
> Frame-level design for collapsing the app's three content-delivery paths onto
> the bundle endpoint and giving the deterministic learning script a first-class,
> versioned identity. Every claim below is grounded in the code at dev `ebf83eac`.

---

## 0. The move, in one paragraph

Today the learning script — the thing a learner actually experiences — has no
identity. It is *emergent* from: a 1,856-line client-side generator doing direct
anon-key table reads (`packages/player-vue/src/providers/generateLearningScript.ts`),
a client cache-invalidation constant (`SCRIPT_VERSION = 'v9'`,
`composables/useScriptCache.ts:22`), unversioned `algorithm_config` rows, a
materialised view refreshed by another repo (`course_round_index`), and a seeded
RNG whose key lives in a Vue component (`LearningPlayer.vue:484-487`). Meanwhile
`GET /api/courses/:code/bundle` — built, typed, tested, entitlement-gated, and
self-described as "the single source of truth" — is fetched by **no production
code**. The move: make the script a **server-issued artifact** with the identity
`course × content_version × script_shape_version × generator_version × learner_seed`,
issued through the bundle endpoint as the *one gated door*, computed by *one
shared pure function* that both the server and the client call — then delete the
other two paths and close the content tables to anonymous reads.

BSC: **Better** — text/audio/entitlement/offline/partner-API all become views of
one versioned artifact; scripts are replayable byte-for-byte for support and
telemetry. **Simpler** — three delivery paths → one; ~3,000 lines and a DB RPC
deleted; the SCRIPT_VERSION invalidation class of bugs disappears (you cache the
bundle, never the script). **Cheaper** — one cacheable fetch per course-version
replaces round-map + N×cycles + infplay-cycles + six course-wide client queries;
the Supabase read load moves behind an edge-cached endpoint.

---

## 1. Ground truth: the three paths as they exist today

### Path (a) — LIVE: client-side generator, direct anon table reads

`packages/player-vue/src/providers/generateLearningScript.ts` (1,856 lines).
Called from `LearningPlayer.vue:457` (`runGenerateScript`), `useEagerScriptPreload.ts:83`
(cold-start window), and `useFullCourseScript.ts:132` (CourseExplorer admin/QA).
Queries **six course-wide reads with the browser's anon-key Supabase client**
(`generateLearningScript.ts:391-447`): `course_legos`, `course_practice_phrases`
(paginated, 15-17k rows on big courses), `course_seeds`, `course_audio`
(bookends), `listening_pod_sentences`, plus a `course_legos` ordinal catalogue.
Its output is cached in IndexedDB by `useScriptCache.ts`, keyed on the client
constant `SCRIPT_VERSION = 'v9'` — bumping that constant is the *only*
invalidation. **There is no entitlement check anywhere on this path.**

### Path (b) — JIT: instant-playback endpoints

`api/courses/[code]/cycles.ts` (513 lines, backed by the
`get_course_cycles_window` Postgres RPC from dashboard-repo migration
`20260518_course_cycles_window_fn.sql`), `api/courses/[code]/infplay-cycles.ts`
(428 lines), and `api/courses/[code]/round-map.ts` (140 lines, reads the
`course_round_index` matview + `courses.version`). Consumed by
`composables/useInstantPlayback.ts` for the sub-second cold start, adapted by
`providers/backendCyclesToRounds.ts`. Both cycle endpoints call
`resolveServerCourseAccess` (`api/_utils/courseAccess.ts`) — **but the client
never sends an Authorization header** (`useInstantPlayback.ts:452`:
`fetch(url, { signal })`), so the gate only ever sees anonymous callers. A
premium learner past Yellow gets 403/preview from this path and playback
survives only because path (a) is ungated. `cycles.ts:289-294` enforces preview
by regex-parsing the `from` LEGO id (`parseLegoId`, `S\d{4}L\d{2}`) — string
parsing where a structured seed number should be.

### Path (c) — BUNDLE: built and orphaned

`api/courses/[code]/bundle.ts` (597 lines): one-shot payload of every LEGO,
phrase, seed, round-map entry and pod, each audio ref classified
ephemeral/persistent, entitlement-gated via `resolveServerCourseAccess` with
**structured slicing** (`row.seed_number <= previewMaxSeed`, bundle.ts:389-397),
`previewOnly` marking, matview-empty → 503. Typed by
`packages/player-vue/src/types/courseBundle.ts` (336 lines), tested by
`__tests__/api/bundle.test.ts` (including entitlement suites). Fetched by
nothing outside tests.

**Also already built and orphaned:** `packages/player-vue/src/script/generateScript.ts`
(566 lines) — a *pure* client-side generator over a `CourseBundle` (no I/O, no
Supabase, injectable `random` and `audioUrl`), explicitly written to replace the
JIT pipelines, with position types in `script/scriptGenerator.types.ts`. It is
the seed of the shared function in §3 — the cutover is mostly *wiring*, not
building.

### Where the script's identity is smeared today

| Fragment | Lives at | Problem |
|---|---|---|
| `SCRIPT_VERSION = 'v9'` | `useScriptCache.ts:22` (client constant) | invalidation only; says nothing about what the algorithm was |
| `DEFAULT_SCRIPT_SHAPE` | `generateLearningScript.ts:97-108` | fallback for an **unversioned** `algorithm_config.script_shape` row |
| Hardcoded shape copies | `script/generateScript.ts:52-62`, `infplay-cycles.ts:50-61` | three parallel definitions of the same offsets |
| `courses.version` | trigger `20260518_courses_version_stamp.sql`; read by round-map/cycles | **competes with** `courses.content_version` (read by bundle.ts:355, `checkContentVersion` in useScriptCache.ts:268) — two version stamps for one course |
| INF-PLAY seed | `LearningPlayer.vue:484-487`, `mulberry32(hash("${course}\|${learnerId}\|infplay-v1"))` | deterministic tail exists (coordinator decision 2026-05-29) but only for INF PLAY; main-loop spaced-rep draws are unseeded `Math.random()` |
| Round ordering | `course_round_index` matview (dashboard repo refreshes) | fine — stays; both bundle.ts and round-map.ts already 503 when empty |

---

## 2. Deliverable 1 — the artifact identity model

The script becomes a pure function of five named components:

```
scriptArtifactId = {courseCode} @ {contentVersion} / shape{scriptShapeVersion} / gen{generatorVersion} / seed{learnerSeed}
```

| Component | What it captures | Where it lives / is computed |
|---|---|---|
| `courseCode` | which course | URL path; `courses.course_code` |
| `contentVersion` | the content (LEGOs, phrases, audio ids, tiling, pods) | `courses.content_version` — already bumped by the dashboard on content change, already the invalidation key in `checkContentVersion` and `bundle.ts:355`. Treated as an **opaque string** (it is semver text on some courses, integer on others — courseBundle.ts:272-279). The parallel `courses.version` stamp **retires with round-map.ts**; one course, one version signal. |
| `scriptShapeVersion` | the *parameters* of the algorithm (spacedRepOffsets, maxBuildPhrases, useConsolidationCount, n1PhraseCount, turbo culling) | server-owned: `algorithm_config` gains a `version int` column (additive migration); the bundle endpoint resolves the `script_shape` + `turbo_boost` rows and **embeds both the values and the version** in the payload. The client stops reading `algorithm_config` for script shape — it reads the shape out of the bundle it was issued. |
| `generatorVersion` | the *code* of the algorithm (how the shape is interpreted) | exported const in the shared function's module (`packages/core/src/script/generateScript.ts`, §3): `export const GENERATOR_VERSION = 1`. Bumped when the assembly algorithm changes, not when parameters do. Replaces the client `SCRIPT_VERSION = 'v9'` constant. |
| `learnerSeed` | which deterministic stream of sampling draws | derived, never stored: `mulberry32(hash("${courseCode}\|${learnerId ?? 'guest'}\|script-v1"))` — the existing `makeInfPlayRng` key (`LearningPlayer.vue:485`) generalised from `infplay-v1` to the whole script. Client computes it for playback; the server can compute the identical value for partner/QA issuance because it is a pure function of (courseCode, learnerId). |

Two consequences worth naming:

- **The whole script becomes seeded**, not just the INF-PLAY tail. Main-loop
  spaced-rep USE draws (`script/generateScript.ts:206`, currently
  `Math.random` via the default) take the learner seed too. This changes
  nothing a learner notices — a fresh draw today only ever happens on cache
  invalidation — and it buys full replayability: given an artifact id, anyone
  (support, telemetry, a partner) can rematerialise the *exact* cycle a learner
  heard at (round 620, slot 7). The INF-PLAY precedent (navigable back-nav,
  offline parity) already proved the model.
- **The bundle payload carries its own identity block.** New top-level fields
  on `CourseBundle`: `scriptShape`, `scriptShapeVersion`, and the server echoes
  `contentVersion` (today's `version` field, renamed-by-alias — keep `version`
  during transition). `previewOnly` already exists. The client's cache key for
  the bundle is `(courseCode, contentVersion, scriptShapeVersion, previewOnly)`.

---

## 3. Deliverable 2 — the ONE shared function, and the rewiring

### The function

`generateScript(opts: GenerateScriptOptions): GenerateScriptResult` — the
existing pure generator, **moved from `packages/player-vue/src/script/` to
`packages/core/src/script/`** together with the `CourseBundle` types
(`types/courseBundle.ts` → `packages/core/src/script/courseBundle.ts`) and
`computePauseDuration` (`player-vue/src/playback/computePauseDuration.ts` — it
takes a config object already; the `DEFAULT_NORMAL` import from
`useAlgorithmConfig` becomes an injected `pauseConfig` option so core imports
nothing framework-specific, honouring the engine rule). `player-vue` re-exports
from the old paths during transition so no import churn rides the move commit.

Signature grows two options, both additive:

```ts
generateScript({
  bundle,            // CourseBundle — now carries scriptShape + scriptShapeVersion
  position,          // { mode: 'main', fromLegoId } | { mode: 'infplay', fromInfRound }
  roundLimit?,       // default 15
  random?,           // the learnerSeed rng — REQUIRED for artifact-grade output
  audioUrl?,         // default /api/audio/{id}
  shape?,            // ScriptShape override; default = bundle.scriptShape
  pauseConfig?,      // replaces the DEFAULT_NORMAL import
})
```

### Parity work the shared function needs first (grounded gaps)

The pure generator is faithful to the JIT endpoints, but the JIT endpoints are
themselves a subset of the live path. Before it can replace path (a):

1. **Script-shape injection** — offsets/counts are hardcoded
   (`script/generateScript.ts:52-62`); must read from `opts.shape`.
2. **Seed-phase spaced-rep reviews** — offsets ≥ 144 play the *full parent seed
   sentence* (`SEED_PHASE_START_OFFSET`, `generateLearningScript.ts:122`,
   offsets list runs to 2584 at :103). The pure generator stops at 89. This
   requires the bundle's `seeds` to carry text + audio refs — today
   `BundleSeed` is id+number only (courseBundle.ts:190-193) and bundle.ts
   derives seeds from the round map without touching `course_seeds`. **Additive
   wire change:** bundle.ts adds a `course_seeds` query (same columns the live
   generator reads at :405-409) and `BundleSeed` gains
   `knownText/targetText/targetTextNative/audio`.
3. **Turbo culling tags** — `turboOmit` tagging per
   `generateLearningScript.ts:66-83` (cycle-level; runtime skips tagged cycles
   when Turbo is on). Port the tagging; the *runtime* Turbo behaviour is
   untouched.
4. **L1 listening and Layer-2 pods** — stay **runtime-scheduled**, not
   generator-emitted. L1 was pulled out of the main flow 2026-05-19
   (`generateLearningScript.ts:160-167`); pods fire via `usePodLapScheduler`
   consuming `bundle.pods`, which the bundle already ships fully-shaped
   (`bundle.ts:503-569`). The generator's only pod-adjacent duty (L1-outro
   merge cadence) moves to the scheduler with the same `podRoundInterval`
   input. This *shrinks* the generator's job versus path (a) — deliberate.

### The rewiring (client)

New composable `packages/player-vue/src/composables/useCourseBundle.ts`:

- `getBundle(courseCode): Promise<CourseBundle>` — IndexedDB-first
  (store `ssi-bundle-cache`, key = the §2 cache key), network on miss:
  `fetch('/api/courses/${code}/bundle', { headers: authHeaders() })` where
  `authHeaders()` attaches the Supabase session token (the same
  `Authorization: Bearer` pattern every entitled endpoint call already uses,
  e.g. `useSubscription.ts:191`) **or** the try-link token (§4).
- Version probe: on session start, one tiny
  `GET /api/courses/:code/bundle?head=1` returns
  `{ contentVersion, scriptShapeVersion }` — replaces both `round-map`'s
  version role and `checkContentVersion`'s direct `courses` read. Mismatch →
  refetch bundle, drop stale audio cache (same cascade `checkContentVersion`
  does today at useScriptCache.ts:278-294).

Then the two consumers collapse onto it:

- **Bootstrap (path b consumer):** `useInstantPlayback` keeps its public API
  (`bootstrap()`, `getOrFetchRoundMap()`, prefetch tiers — `LearningPlayer.vue`
  touches it at 565, 1003, 1285-1329, 10863-10983) but its internals become:
  round map = `bundle.roundMap`; first cycle and every subsequent batch =
  `generateScript(bundle, { mode:'main', fromLegoId }, …)` — synchronous,
  in-memory, zero network after the bundle fetch. The partial-LEGO machinery,
  the cycles response cache, and the `infplay-cycles` fetch all evaporate:
  there is no partial data when the whole course is in memory.
- **Full walk (path a consumer):** `LearningPlayer.vue`'s `runGenerateScript`
  (:435-477) calls `generateScript` over the bundle instead of
  `generateSimpleScript(supabase, …)`. `useScriptCache` stops persisting
  *scripts* — the bundle is the cached object and scripts regenerate in
  milliseconds (path (a) was slow because of six network queries, not CPU).
  The `mainLoopRoundCount` single-sourcing (`useScriptCache.ts:113-119`)
  becomes trivial: it is derivable from the bundle + generator, same code both
  sides. `CourseExplorer` (`useFullCourseScript`) repoints to the same call so
  the admin view shows exactly what the player plays — its stated goal
  (`useFullCourseScript.ts:6-11`).

### The rewiring (server)

The bundle endpoint stays the issuer of the *data* artifact. The shared
function gives the server the ability to materialise the *script* view of it:

- `GET /api/courses/:code/script?from=S0042L01&limit=15&learner=…` — a thin
  handler: `generateScript(await assembleBundle(code, access), position,
  seedFor(code, learner))`. Not needed for the app itself; it exists as (a)
  the QA/diff surface during cutover (assert server-materialised script ≡
  client-materialised script for the same artifact id — the cutover's
  regression harness), and (b) the seed of the IME partner API (§6). The
  bundle-assembly body of `bundle.ts` extracts into
  `api/_utils/assembleBundle.ts` so the bundle handler and the script view
  share one assembly.

---

## 4. Deliverable 3 — entitlement becomes real, as a side effect

What today's code actually enforces:

- Path (a): **nothing**. Anonymous browsers read every premium course's full
  text via the anon key. `checkCourseAccess` client-side is decoration
  (bundle.ts:373-374 says exactly this).
- Path (b): a real gate (`resolveServerCourseAccess`) that **no entitled caller
  ever reaches** — the client sends no token (`useInstantPlayback.ts:452`), so
  premium learners work only because path (a) exists. Preview enforcement
  parses `S####` strings (`cycles.ts:289`).
- Audio bytes: `api/audio/[audioId].ts:91-107` +
  `api/_utils/audioAccess.ts` (`resolveAudioEntitlement`) — real, including
  the stateless HMAC try-token, currently fail-open (tag-and-observe) pending
  `ENTITLEMENT_ENFORCE=strict`.
- Try links: `api/try-link/validate.ts` mints `entitlementToken`;
  `TryLinkGateway.vue:43` stores it as `ssi-try-token`. It unlocks UI
  (`useEntitlement.ts:36-47` — "drives UI only") and the audio proxy honours
  it — but **course structure never consults it**, because structure comes
  from ungated tables. The round-trip dangles.

After the cutover the enforcement story is two doors, both real, both already
written:

1. **Structure door: `/bundle`.** The client attaches the Supabase token or the
   try token; `resolveServerCourseAccess` grows one clause — accept the
   try-link HMAC (verified exactly as `audioAccess.ts` verifies it for audio)
   as an access grant scoped to the try link's course/expiry. Slicing is
   structured end-to-end (`seed_number <= previewMaxSeed`,
   bundle.ts:389-397) — the `parseLegoId` preview check dies with cycles.ts.
   A preview caller gets a `previewOnly` bundle; the generator over a preview
   bundle *cannot* emit past-preview cycles because the data was never
   shipped — enforcement by construction, not by check.
2. **Bytes door: `/api/audio/:id`** — unchanged, already consistent with door 1
   (same preview window, same try-token). With structure closed, flipping
   `ENTITLEMENT_ENFORCE=strict` stops being a leap: no legitimate path still
   depends on fail-open.

3. **Close the tables.** Once no production client code reads content tables
   directly (§5 step 7 inventories the stragglers), `REVOKE SELECT` from
   `anon`/`authenticated` on `course_legos`, `course_practice_phrases`,
   `course_seeds`, `listening_pods`, `listening_pod_sentences` (and the
   client-facing `course_audio` metadata reads). Per the standing RLS doctrine:
   explicit posture, REVOKE + GRANTs in the same migration, canary transaction
   replaying real app queries as real roles, `NOTIFY pgrst, 'reload schema'`.
   Content tables stop being "permissive by design" because the design reason
   (the client generator needed them) is gone.

The ssi-try-token round-trip therefore *resolves*: one token, minted once,
honoured at both doors, and the UI flag stays what it already is — decoration.

---

## 5. Deliverable 4 — migration order (expand-contract; every step ships alone and reverts alone)

Shared-DB rule respected throughout: steps 1-6 make **zero** destructive DB
changes (one additive column, one additive payload). The single REVOKE lands
last, canaried. dev → staging → main promotion is Tom-driven at every step;
per-course flag-gating reuses the `INSTANT_PLAYBACK_ALL` /
`INSTANT_PLAYBACK_COURSES` scaffolding kept for exactly this
(`LearningPlayer.vue:106-110`).

| # | Step | Ships | Reverts by |
|---|---|---|---|
| 1 | **Promote the generator to core.** Move `script/generateScript.ts`, `scriptGenerator.types.ts`, `types/courseBundle.ts`, `computePauseDuration.ts` → `packages/core/src/script/`; inject `pauseConfig`/`shape`; add `GENERATOR_VERSION`; old paths re-export. Tests move. | No behaviour change anywhere. | revert commit |
| 2 | **Enrich the bundle (additive).** `algorithm_config.version` column (idempotent SQL, `NOTIFY pgrst`); bundle.ts embeds `scriptShape` + `scriptShapeVersion`; `BundleSeed` gains text+audio (new `course_seeds` query in the parallel block); `?head=1` version probe. Bundle tests extend. | Endpoint still fetched by nothing — dark. | revert commit (column is additive, harmless to leave) |
| 3 | **Generator parity.** Shape injection, seed-phase reviews (≥144), turbo tagging, L1-outro cadence handoff to the scheduler (§3). Golden-master test: for N courses, artifact-id-pinned output diffed against path (a)'s emission for the same inputs. | Pure-function work, all dark. | revert commit |
| 4 | **Client bundle store.** `useCourseBundle` (auth header, IndexedDB, head-probe, previewOnly-aware cache key); offline downloader + `AudioCache` enumeration repointed to bundle audio refs (replaces regex-scraping URLs out of generated rounds, `LearningPlayer.vue:8980-8986`). | Store ships dark or on one dev-flagged course. | flag off |
| 5 | **Cut bootstrap over** (kills path b usage). `useInstantPlayback` internals → bundle + `generateScript`. Flag per course: dev course first, then staging soak ≥1 week with every entry mode exercised (fresh, resume, belt-skip, INF-PLAY entry, preview/anonymous, try-link), then ALL. | JIT endpoints still live for un-flagged courses. | flag off |
| 6 | **Cut the full walk over** (kills path a usage). `runGenerateScript` → shared generator; learner seed generalised to `script-v1`; `useScriptCache` caches bundles, not scripts; CourseExplorer repoints. Resume unchanged: `resolveResumeAnchor` (`utils/resolveResumeAnchor.ts`) anchors against `bundle.roundMap`. | Same flag + soak discipline. | flag off |
| 7 | **Repoint stragglers, then DELETE + REVOKE.** Remaining direct content readers repoint to the bundle: `utils/infinitePlay.ts` (derives INF-PLAY from `course_legos` — becomes a pure check against `bundle.roundMap` tail), `listeningMetaCache.ts`, `useLayer1Scheduler.ts`, `useListeningProgress.ts`, `PronunciationOverlay.vue`, `ListeningOverlay.vue`, `CourseDataProvider.ts`, `useScriptCache`'s `lookupAudioLazy`/`loadIntroAudio` (text-based audio lookup — already doctrine-banned: "No audio lookup by text string"). Then the §5b deletion list lands, then the REVOKE migration (canary method, staging week, zero `[RLS_VIOLATION]`-class logs for 48h before main). | | REVOKE migration carries its GRANTs; canary txn rolls back on any red |

Ordering rationale: entitlement (the REVOKE) *cannot* precede the repoints — it
would black out live learners (path a is the live path). Determinism (steps
1-3) *must* precede the cutovers so the golden-master diff exists before any
learner-facing switch. Nothing in 1-4 can regress anyone: it is all dark until
a flag flips, and flags flip per course on dev first.

---

## 6. Deliverable 5 — what gets DELETED at the end

Code (≈3,400 lines of product code plus a DB function):

- `packages/player-vue/src/providers/generateLearningScript.ts` (1,856) and its
  adapter `providers/toSimpleRounds.ts`; `providers/validateLearningScript.ts`
  if nothing else imports it.
- `api/courses/[code]/cycles.ts` (513) **and** the `get_course_cycles_window`
  RPC — dropped via a dashboard-repo migration (it was created there,
  `20260518_course_cycles_window_fn.sql`), plus its follow-up
  `20260607_course_cycles_window_display_tiling.sql` becomes dead.
- `api/courses/[code]/infplay-cycles.ts` (428).
- `api/courses/[code]/round-map.ts` (140) — superseded by `bundle.roundMap` +
  `?head=1`; with it dies the last reader of `courses.version`, resolving the
  two-version-stamps split in favour of `content_version`.
- `providers/backendCyclesToRounds.ts` (the path-b adapter).
- `composables/useEagerScriptPreload.ts` (the cold-start window belongs to the
  bundle store now).
- `composables/useFullCourseScript.ts` (CourseExplorer consumes the shared
  generator directly).
- Inside `composables/useInstantPlayback.ts`: the cycles fetch/cache, the
  round-map fetch, `prefetchNextInfPlayBatch`, the partial-LEGO tracking —
  i.e. most of its 800+ lines; what survives is the position/orchestration
  shell `LearningPlayer.vue` talks to.
- Inside `composables/useScriptCache.ts`: the script-blob store +
  `SCRIPT_VERSION`, `checkContentVersion` (→ head probe), `lookupAudioLazy`,
  `loadIntroAudio`, `buildAudioUrl`'s S3-direct path. The offline-lease
  helpers move to the bundle store (the lease attaches to the downloaded
  bundle — same "Spotify handshake", new home).
- `LearningPlayer.vue`: `makeInfPlayRng`'s `infplay-v1` key (subsumed by
  `script-v1`), the legacy eager/deferred dual-walk plumbing around
  `runGenerateScript`, the URL-scraping audio collectors (:8975-8993).
- The client's direct anon reads of content tables (inventory in §5 step 7).

Database posture (not deletion, closure): anon/authenticated `SELECT` revoked
on the five content tables + client-facing `course_audio` reads, per §4.3.

Explicitly **kept**: `course_round_index` matview and its dashboard-driven
refresh (the bundle 503s when it's empty — same operator model, bundle.ts:360);
the audio proxy and its cache stack; `SimplePlayer` and everything below the
`Round[]` boundary; the pods/L1 runtime schedulers; `resolveServerCourseAccess`
(it becomes load-bearing instead of bypassed).

---

## 7. Deliverable 6 — position, offline, and the IME partner API as views

### Position / cursor

Unchanged storage, upgraded meaning. The cursor
(`course_enrollments.last_completed_lego_id`, cursor-only model locked
2026-07-04, `docs/position-and-ownership-model.md`) resolves against
`bundle.roundMap` via the same `resolveResumeAnchor`. What the artifact adds:
a *position* is now fully addressable as `(scriptArtifactId, roundIndex, slot)`
— and because the script is seeded end-to-end, that triple rematerialises the
exact cycle. Telemetry (`player_events`) starts stamping the artifact id
alongside the build sha it already stamps (`LearningPlayer.vue:1121`), which
turns "what did this learner actually hear when they reported the bug" from
archaeology into a lookup. INF-PLAY membership stops being a DB query
(`utils/infinitePlay.ts` today reads `course_legos`) and becomes arithmetic on
the artifact: cursor beyond the last `roundMap` entry.

### Offline

The bundle **is** the offline unit — this was its design intent
(courseBundle.ts:5-7). Download = walk the bundle's audio refs in priority
order (roundMap order for ephemeral, `use`-phrase persistent refs, pods),
deduped by id — replacing today's regex extraction of `/api/audio/` URLs out
of generated round objects. The 30-day lease rides the cached bundle row.
Offline playback = `generateScript` over the cached bundle with the same
learner seed — *identical* to online output by construction, which is the
determinism guarantee the seeded INF-PLAY tail was originally built to give
offline (`generateLearningScript.ts:343-350`). A `previewOnly` bundle is never
leased (premium downloads already require entitlement in the download UI; the
server now enforces it).

### IME partner API

Per `IME_code_answers.md` Q6, no partner-facing API exists today. The artifact
gives it a shape that costs almost nothing: a partner endpoint is
`assembleBundle` + `generateScript` under partner auth —
`GET /api/partner/v1/courses/:code/script?seed=…&from=…` returning versioned,
deterministic, auditable script JSON (the §3 server script view with a partner
credential in front). Because the artifact id pins content, shape, generator
and seed, a partner integration can cache, replay, and *cite* exactly what was
issued — and entitlement slicing comes through the same one door as everything
else. No parallel content pipeline, no second source of truth.

---

## 8. Risks and open forks (with positions)

1. **Bundle weight on big courses.** Path (a) deliberately *excludes*
   `decomposition`/`display_tiling` course-wide because those two JSON columns
   dominate 15-17k-row phrase sets (`generateLearningScript.ts:258-269`),
   leaning on /cycles to serve tiling for rendered rounds. The bundle
   *includes* them — correct once /cycles dies, but unmeasured at
   Irish/Estonian scale. **Position:** measure gzipped size on the three
   biggest courses at step 2; if > ~2 MB gz, split tiling into a lazily-fetched
   sidecar (`/bundle?part=tiling`) keyed to the same artifact id. Decision
   point, not a blocker.
2. **previewOnly cache transitions.** A preview bundle cached, then the user
   subscribes → must not keep playing the sliced bundle. Handled by putting
   `previewOnly` in the cache key + refetch on entitlement-state change
   (`useUserEntitlements` already tracks it). Cheap, but must be in step 4's
   tests.
3. **Guest determinism.** All guests share `learnerId = 'guest'` → identical
   sampling stream. Same as today's INF-PLAY behaviour (`LearningPlayer.vue:485`);
   acceptable — variety across a *session* comes from position, and guests
   converting to accounts get their own seed.
4. **Main-loop draw freshness.** Seeding main-loop spaced-rep draws means a
   regenerated script repeats the same USE picks for the same artifact id.
   That is the point (replayability); the counter-consideration ("variety >
   determinism", Tom 2026-05-20, `infplay-cycles.ts:20-24`) was already
   superseded for INF PLAY by the seeded model (2026-05-29). If freshness per
   *visit* is ever wanted, it is one knob: fold a date/window into the seed —
   an intention-level call to surface only if learners notice.
5. **Cold-start budget.** One ~300 KB-1 MB gz fetch replaces round-map +
   cycles(limit=1) + cycles(limit=15). Edge-cached (`s-maxage=86400` already on
   bundle.ts:586-589) and IndexedDB-warm thereafter (zero-network resume beats
   today's path b, which still probes). Worst case first-visit-on-3G is the
   regression to watch in step 5's staging soak; the `?head=1` probe plus
   background bundle fetch with a "downloading course" state is the fallback
   posture — "Downloading… is acceptable; mismatched audio is not" (CLAUDE.md).
6. **Matview freshness** stays an operator dependency (dashboard refreshes
   `course_round_index` on lego mutations). Unchanged by this design; the
   bundle's 503 already converts silent to loud.

---

## 9. What this deletes conceptually

Not just lines: it deletes the *question* "which of the three scripts is the
learner actually on?" — the question behind the SCRIPT_VERSION bumps, the
`mainLoopRoundCount` single-sourcing note, the cycles-response cache
staleness rules, and the client/server preview drift. One artifact, one door,
one function; everything else is a view.
