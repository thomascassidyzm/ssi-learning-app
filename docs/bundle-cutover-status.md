# Bundle cutover — live status

**Read this before touching the script-generation paths.** The design document
lives at `archive/docs-retired-2026-08-24/bundle-cutover-design.md` — it was
archived by the 2026-08-24 docs sweep, which is a large part of why this work
looked shelved for six weeks. Its own status line still says *"No code in this
document has been written"*; that has been false since 2026-08-16. **This file
is the current truth; the design doc is the map of intent.**

Last updated: 2026-08-29.

## Why it exists, in one paragraph

The app builds a learning session by hand in three places. They drift, and the
drift is the root cause of a recurring family of learner-facing bugs. One
unified, pure generator — `packages/core/src/script/generateScript.ts` —
replaces all three, fed by one entitlement-gated door, `GET /api/courses/:code/bundle`.

## The three paths

| Path | What | State |
|---|---|---|
| (a) LIVE walk | `packages/player-vue/src/providers/generateLearningScript.ts` (2,046 lines), six course-wide anon-key table reads, no entitlement check | still live; retired at step 6 |
| (b) JIT | `api/courses/[code]/{cycles,infplay-cycles,round-map}.ts` via `useInstantPlayback` | **being retired now (step 5)** |
| (c) BUNDLE | `api/courses/[code]/bundle.ts` | the destination |

## Phase table

| # | Step | State | Landed in |
|---|---|---|---|
| 1 | Promote the generator to `@ssi/core`; `GENERATOR_VERSION`; re-export shims | **DONE** | `eec98f09` |
| 2 | Enrich the bundle: `scriptShape` + `scriptShapeVersion`, `course_seeds` text+audio, `?head=1` version probe | **DONE** | `eec98f09` |
| 3 | Generator parity: shape injection, SEED-PHASE reviews (≥144), round shape, golden-master harness | **DONE** | `95bd4a1e` |
| 4 | Client bundle store `useCourseBundle` (auth header, IndexedDB, head probe, previewOnly-aware key) | **DONE** | this branch |
| 5 | Cut the bootstrap over (kills path b usage), per-course flag | **DONE — 15 courses flagged, main loop AND INF PLAY** | `53b4a00d`, `9d27521e` |
| 5b | `gloss_segments` in the bundle; parity widened to 16 courses; INF PLAY cut over | **DONE** | `e1dd52bb`, `eb82448f`, `464ba654`, `9d27521e` |
| 6 | Cut the full walk over (kills path a usage) | not started | |
| 7 | Repoint stragglers, delete, `REVOKE` on the content tables | not started | |

**Turbo tagging (design step 3, item 3) is MOOT** — Turbo was retired in
`d5548fdc` ("two learning modes — easy and fast, turbo retired"). Verified
2026-08-29: no `turboOmit` anywhere in the estate. Do not port it.

## What "parity" means here, and how it is proved

`tools/bundle-cutover/parity-cycles.mjs` diffs, cycle by cycle, against the
**live** `/cycles` endpoint on the deployed dev alias — real courses, real
data, no app boot, no DB credentials, read-only.

```bash
node tools/bundle-cutover/parity-cycles.mjs                       # generator level
node --experimental-strip-types tools/bundle-cutover/parity-cycles.mjs --wire   # wire level (what the cutover actually feeds the player)
```

Result on 2026-08-29, 4 courses × 3 positions, both modes:
**10/12 byte-identical, 2/12 supersets, 0 drift.**

The two supersets differ in exactly one way, and it is intentional: the
generator emits **SEED-PHASE reviews** (spaced-rep offsets ≥144 play the full
parent seed sentence), which `cycles.ts` documents under "KNOWN GAPS vs the
walk" as something it cannot do. The generator is *ahead* of the endpoint
there and matches the walk, which is the source of truth. Nothing the endpoint
emits is ever missing from the generator's output.

The harness earned its keep immediately: it caught a cycle-id collision (a USE
row promoted into a build slot and replayed in the consolidation tail produced
two cycles with the same id, and the client de-dupes by cycle id — the
consolidation cycle would have been silently eaten). Fixed in `95bd4a1e`.

## Step 5 as shipped — how the flag works

`isBundleBootstrapEnabled(courseCode)` in `useInstantPlayback.ts`:

- `BUNDLE_BOOTSTRAP_ALL = false`
- `BUNDLE_BOOTSTRAP_COURSES = { hun_for_eng }` — a full 665-round free course,
  byte-identical parity at every tested position, ~19 player events a month.
- `?bundle=1` / `?bundle=0` overrides per session, for dev testing.

When enabled, `fetchRoundMap` and `fetchCycles` compute their payloads from
one cached `/bundle` fetch (`providers/bundleToBackendCycles.ts`) instead of
hitting `/round-map` and `/cycles`. **The wire shapes are identical**, so the
cycle buffer, partial-LEGO bookkeeping, pagination, `backendCyclesToRounds`,
and every scheduler in `LearningPlayer.vue` are untouched. Any failure on the
bundle path logs and falls through to the network path, so the worst case is
today's behaviour.

## Verified live on dev (2026-08-29)

A headless browser session on the dev alias, same course, flag on vs flag off:

| | `/bundle` | `/cycles` | `/round-map` | audio clips fetched |
|---|---|---|---|---|
| `?course=hun_for_eng` (flag on) | 1 | **0** | **0** | 71 |
| `?course=hun_for_eng&bundle=0` | 0 | 2 | 2 | 75 |

Both reach the same player screen and both stream audio. Zero calls on the two
retired endpoints is the cutover actually working, not just compiling. Getting
there needed one extra fix: `prewarmInstantCaches` is a module-level function
that hits those endpoints directly, bypassing the composable's branch, so a
flagged course was still paying one of each per session (`135ae9f4`).

**Try it:** https://ssi-learning-app-git-dev-zenjin.vercel.app/?course=hun_for_eng
— and the same URL with `&bundle=0` for the old path, side by side.

## Step 5b — what landed 2026-08-29 (second session)

### Courses now on the new path (15)

Free: `hun_for_eng`, `gle_for_eng`, `nld_for_eng`, `tur_for_eng`,
`eus_for_eng`, `pol_for_eng`, `heb_for_eng`, `tha_for_eng`, `hin_for_eng`.
Premium: `spa_for_eng`, `fra_for_eng`, `jpn_for_eng`, `zho_for_eng`,
`cym_s_for_eng`, `zho_for_gle`.

Each was walked by BOTH harnesses against the live endpoints before it was
added, and the raw results are committed under `docs/bundle-cutover-parity/`:

| Harness | Coverage | Result |
|---|---|---|
| `parity-cycles.mjs` (generator + wire) | 16 courses × 3 positions × 2 modes | 39 identical, 6 superset (seed-phase only), 3 no-audio, **0 drift** |
| `parity-cycles.mjs --wire`, anonymous | 6 premium courses × 3 positions, free-preview window | 18 identical, **0 drift** |
| `parity-infplay.mjs` | 16 courses × 3 entry rounds, both producers sampled | 3 identical, 42 superset (every extra attributed), 3 no-audio, **0 drift**, 0 lost reviews, 0 illegal draws |

Premium courses were walked twice: once with a real entitled session (a
throwaway auth user + entitlement, created for the run and deleted after) for
the full course, and once anonymously for the 19-seed preview an unsubscribed
visitor actually gets.

**NOT flagged, and why: `fin_for_eng`.** 1,394 rounds, no rendered audio at
all. Both paths emit nothing, so parity proves nothing about it. A vacuous
pass is not a pass — and until 2026-08-29 the harness reported that 0-vs-0 as
`IDENTICAL`.

### Verified live on dev, 2026-08-29 (headless, per-request counts)

| Case | `/bundle` | `/cycles` | `/round-map` | audio |
|---|---|---|---|---|
| `hun_for_eng` (free, flagged) | 1 | **0** | **0** | 71 |
| `hun_for_eng&bundle=0` (control) | 0 | 2 | 1 | 75 |
| `spa_for_eng` (premium, flagged, anonymous preview) | 1 | **0** | **0** | 101 |
| `ita_for_eng` (not flagged, control) | 0 | 2 | 1 | 94 |

**Try it:** https://ssi-learning-app-git-dev-zenjin.vercel.app/?course=spa_for_eng
— and the same URL with `&bundle=0` for the old path, side by side.

### `gloss_segments` — closed

`BundleLego.glossSegments` now carries the authored word mapping, validated by
the same rule `/cycles` uses (the validator moved to
`api/_utils/glossSegments.ts`; both endpoints import it rather than keeping two
copies of a rule about stale mappings). Nothing in the estate carries the
column, so no live row can prove it — unit tests do, at both the generator and
the wire.

### INF PLAY — cut over

`bootstrapInfPlay` now generates from the bundle on a flagged course. A
PREVIEW bundle is deliberately excluded: `/infplay-cycles` is the one content
endpoint with no preview slice — it hard-403s a non-entitled caller — so
generating locally from a 19-seed preview bundle would hand that caller a
session the server just refused.

**Parity here cannot mean byte-identical, and a harness claiming it would be
lying.** The endpoint documents itself as non-deterministic and disagrees with
ITSELF run to run (measured: 21–22 cycles per round on the same request).
`parity-infplay.mjs` samples BOTH producers and checks what is actually
contractual: the review schedule, that nothing is ever lost, that every drawn
phrase is legally in its LEGO's pool, that both agree where the main loop ends,
and that round length is not short. Every extra cycle must be attributed to one
of three named reasons or the case fails:

- `seedPhase` — offsets ≥144, which the endpoint documents itself as not
  walking and the walk does;
- `endpointPhraseCap` — the endpoint's phrase query is capped at 10,000 rows,
  so the tail of a big course is invisible to it (`spa_for_eng` has 10,072);
- `endpointLostToAudioDraw` — the endpoint samples one USE phrase at random and
  then skips it if a clip is missing, losing the whole review.

### Five defects found and fixed in this session

Three were in the harness — each would have let a course onto the flag list on
false evidence:

1. A 0-vs-0 case reported `IDENTICAL` (`fin_for_eng`).
2. Raw wire cycles were compared rather than what the player keeps. `/cycles`
   emits cycles for LEGOs with no audio; `toPlayerCycle` bins them on BOTH
   paths. `eus_for_eng` read as 44 missing cycles the learner could never have
   heard. Both sides now pass through the client's own audio gate, and what the
   old side lost is reported per case.
3. The seed-phase tier was matched by cycle id. When a parent seed has no
   target audio — 205 of `cym_s_for_eng`'s 332 seeds — both the walk and the
   generator fall back to a use-phrase review, so a legitimate extra arrives
   without a `_seedrep` id. The tier is now judged by scheduling offset.

Two were in the generator, and both were learner-facing:

4. **Phrase pools carried unplayable rows.** The walk and `/cycles` both drop a
   phrase missing any of its three clips at load time; the generator did not. A
   pool is not a list — it is what the schedulers count and index into — so an
   unplayable row consumed a BUILD slot, shifted the review cursor, and in INF
   PLAY, where the draw is random, silently deleted a whole scheduled review.
   `zho_for_eng` `S0668L01` has 21 USE phrases with audio on 5: its review
   appeared or vanished per run.
5. **INF PLAY sized its random-USE bucket from PROJECTED spaced rep, not
   emitted.** On a patchy-audio course the projection is fantasy:
   `eus_for_eng` projected 16 review cycles, emitted 6, then allowed itself
   only the 6-cycle floor — a 10-cycle round against a 22-cycle target that
   exists to leave room for interjections. Spaced rep is now emitted first and
   the bucket sized from the real count; `eus_for_eng` round length went from
   9–20 to 15–21.

And one regression the flag list itself exposed: `getCourseBundle` gives its
own fetch 20 seconds, right for a one-time multi-megabyte download and wrong
for a cold start that promises a first play in about two. A flagged course on
a stalled connection would have waited 20s and only then fallen through to
`/round-map` for another 2.5. The boot path now waits only the critical-path
budget; the download is not cancelled and `getCourseBundle` de-dupes in flight,
so the next page joins it and the session cuts over the moment it lands.

## The boot budget, and why the cutover was largely cosmetic (2026-08-29)

Tom hit this in the console on a real first play on staging, with all fifteen
courses flagged:

```
[InstantPlayback] bundle round-map failed, falling back to /round-map:
  Error: [InstantPlayback] bundle not ready inside the boot budget
```

The fallback is the right safety behaviour — the learner still plays, on the
old endpoints — but it meant the cutover had not happened for that session, and
it said so only in the console. Two hypotheses were separated by measurement:
the budget was too tight, or the fetch started too late and the budget was a
red herring.

**It was the budget, and not marginally.** Measured against the staging
deployment, entitled session, brotli on the wire, two runs each:

| course | wire | JSON | TTFB | total |
|---|---|---|---|---|
| `spa_for_eng` | 2.19 MB | 13.9 MB | 1.42–1.55s | 1.91–1.94s |
| `fra_for_eng` | 1.91 MB | | 1.30–1.31s | 1.68–2.20s |
| `jpn_for_eng` | 1.46 MB | | 1.08–1.12s | 1.46–1.66s |
| `zho_for_eng` | 1.46 MB | | 0.91–0.94s | 1.33–1.37s |
| `cym_s_for_eng` | 0.80 MB | | 0.63–0.68s | 0.90–0.96s |
| `hun_for_eng` | 0.67 MB | | 0.44–0.46s | 0.69–0.84s |

Those are from a fast wired link with a warm serverless function. The worst
course spent ~78% of the 2500ms budget under the best conditions any learner
will ever have, and `fra_for_eng` crossed 2.2s on one of two runs. On a 4G-ish
link the same download is roughly 1.4s of server generation plus ~2.0s of
transfer plus mobile JSON parse — about 4s. The budget was
`CRITICAL_PATH_TIMEOUT_MS`, which exists to bound a ~20 KB round-map fetch; it
was never sized for a whole-course download.

A separate anonymous sweep of all fifteen courses (same day, first-hit vs
second-hit) shows the **cold serverless** case is worse again — server time
alone, before a byte of payload moves:

| course | cold TTFB | warm TTFB | wire | JSON | legos / phrases |
|---|---|---|---|---|---|
| `fra_for_eng` (preview) | 3379ms | 1086ms | 74 KB | 0.53 MB | 62 / 641 |
| `eus_for_eng` | 2843ms | 564ms | 662 KB | 4.0 MB | 713 / 6,011 |
| `hin_for_eng` | 1725ms | 650ms | 912 KB | 5.8 MB | 716 / 5,760 |
| `heb_for_eng` | 1706ms | 536ms | 758 KB | 4.6 MB | 602 / 4,701 |
| `pol_for_eng` | 1500ms | 679ms | 751 KB | 4.5 MB | 666 / 5,049 |
| `tur_for_eng` | 1313ms | 780ms | 1.18 MB | 7.5 MB | 840 / 9,046 |
| `gle_for_eng` | 1043ms | 668ms | 916 KB | 6.2 MB | 786 / 5,431 |

`fra_for_eng`'s 3379ms is a 74 KB preview — that is cold-start latency, not
payload. So the realistic worst cold case for a learner is roughly 3.4s of
server time plus a multi-megabyte download on whatever connection they have.
8000ms leaves about 1.5x headroom over that, not 2x; it is a budget that wins
on any workable connection rather than one that can never lose. The
`bundle_boot_path` fallback share is what tells us whether it was set right.

Note the anonymous numbers are not the real ones for premium courses:
anonymous `spa_for_eng` is 64 KB, the 19-seed preview slice — 34x smaller than
what an entitled learner downloads. Any measurement of a premium bundle taken
without a session understates it by that factor.

**What changed**

- `BUNDLE_BOOT_BUDGET_MS = 8000` in `config/networkGate.ts`, used by every
  bundle consumer on the boot path instead of the round-map budget. Sized off
  the table above with ~2x headroom over the 4G worst case, and still bounded
  so a genuinely bad link falls through to the small `/round-map` rather than
  staring at a blank player.
- The IndexedDB persist left the budget. `getCourseBundle` returned only after
  `await writeCached(...)`, so structured-cloning a 13.9 MB object graph with
  ~15,000 phrase objects was time the boot path paid for a write it does not
  need this session. It now returns the bundle and persists in the background.
- The download starts at the earliest moment a course can be named — the URL
  param, else the last-played course — from `App.vue`'s synchronous Supabase
  block, rather than after course-list and enrollment resolution. It overlaps
  the download with app boot; `getCourseBundle` de-dupes in flight, so
  `prewarmInstantCaches` and the player's own bootstrap join that one fetch.
- A cached PREVIEW bundle is re-fetched once a token exists. The IndexedDB
  store is keyed by course alone while cache identity includes `previewOnly`,
  and the head probe compares versions only — so a guest who cached the 19-seed
  preview kept being served it after signing in.

**How anyone can now tell**

`bundle_boot_path` on `player_events`, one row per stage per session, carrying
`stage` (`round_map` | `cycles` | `infplay`), `outcome` (`bundle` |
`fallback`), `reason` (`budget` | `error` | `preview`), `waitedMs` and
`budgetMs`. The fallback share per course is the health number: if it climbs,
the cutover is drifting back to cosmetic, and that is now a query rather than
a console line somebody happened to have open. Wired through a module-level
sink (`playback/bundlePathTelemetry.ts`) exactly like `introAudioTelemetry`,
because `useInstantPlayback` is a plain module with no access to the Vue
telemetry composable.

## Still open

1. **Bundle weight is not a gate** (Tom, 2026-08-29): "it is a one-time
   per-course cost after which everything runs off cache. Single fetch is the
   design." No head-bundle, streaming or lazy-load scheme is to be built, and
   no performance probe run. The earlier prerequisite here is withdrawn.
2. **Round length on patchy-audio courses.** `gle_for_eng` and `cym_s_for_eng`
   produce INF PLAY rounds of 6–18 and 6–15 cycles against a target of 22 —
   better than the endpoint's 3–14 and 1–13, but still short, because the fill
   samples a fixed number of LEGOs and many have no playable USE phrase. This
   is a content-audio gap showing through, on all three producers. Filling by
   re-sampling would change INF PLAY variety semantics and no existing producer
   does it, so it is logged rather than changed.
3. **`/infplay-cycles` has a 10,000-row phrase cap** that makes the tail of
   `spa_for_eng` (10,072 USE rows) invisible to it. Not worth fixing in an
   endpoint being retired; recorded because it explains real parity extras.
4. **Soak.** Design §5 step 5 asks for a week with every entry mode exercised
   (fresh, resume, belt-skip, INF-PLAY entry, preview/anonymous, try-link)
   before `ALL`. Nothing here has gone past `dev` (Tom, 2026-08-29: dev only).

## The next phase, concretely

`BUNDLE_BOOTSTRAP_ALL = true` is now a one-line change gated on the soak, not
on missing work — the remaining ~130 courses have not been walked, and the list
is deliberately evidence-only. Steps 6 (retire the full walk) and 7 (delete the
JIT endpoints, `REVOKE` on the content tables) become reachable after it.
