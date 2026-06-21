# Layer-1 Listening — the 30-Cup Model

> Source: Tom, 2026-06-16 (worked out in conversation). Supersedes the Layer-1
> half of [`listening-layers.md`](./listening-layers.md) (block-windowed,
> drain-based) and replaces the current runtime implementation in
> `packages/player-vue/src/composables/useLayer1Scheduler.ts` (interval-50,
> 80/20 cap, normal+2× pass).
>
> **Status:** design agreed; build not started. Cluster templates (the authored
> linguistic groupings) are a **dependency — Aran is providing them.** Everything
> else can be built now behind a fallback grouping.

---

## The idea in one breath

Layer-1 listening is **fluency maintenance through pure input** — replaying seed
sentences you've already been *introduced* to, so the *listening* channel stays
warm on material you've stopped *producing*. Instead of one ~10-minute block every
50 rounds, it becomes **a little dose at the end of every round**: a 30-slot wheel
of "cups", one cup poured per round, each cup ≈ a minute of target audio, weighted
so freshly-added material gets more airtime and old material rests at a single
fast pass.

It stays a **pure function of (course catalogue, round, learner, cluster templates)**
— no persisted ratchet, resume-safe by construction, like the scheduler it replaces.

---

## The spine

### The wheel
- **30 cups, always.** One cup is poured at the end of each round; over 30
  consecutive rounds the wheel turns once, then loops. (`cupIndex = lapOrdinal mod 30`.)
- The "≈ 1 minute" per cup is an **approximate feel target, not a hard cap** — we
  never measure audio durations; the length falls out of the pattern (below) —
  two passes (1× then 2×) over the cup's seeds.

### Filling the cups
- **Unit = an *introduced* seed** (all of its LEGOs have debuted), **not** a
  spaced-rep-drained seed. A seed is "introduced" at the round of its last LEGO's
  catalogue ordinal.
- **Nothing fires until 30 seeds are introduced.** Then every further **batch of
  30 introduced seeds adds one seed to every cup**:

  | Introduced | Seeds/cup | Mode |
  |---|---|---|
  | 30 | 1 | filling |
  | 60 | 2 | filling |
  | 90 | 3 | filling |
  | 120 | 4 | filling |
  | **150** | **5** | **→ cluster (5-template)** |
  | 180–270 | 6–9 | cluster-5 + loose |
  | **300** | **10** | **→ re-cluster (10-template)** |
  | 450 | 15 | → re-cluster (15-template) |
  | **600** | **20** | **→ re-cluster (20-template) — CAP** |

  So `seedsPerCup = min(20, floor(introducedCount / 30))`.

- **Cap at 600 introduced → 20 seeds/cup.** Past 600 nothing new enters the wheel;
  on a longer course the listening layer deliberately maintains only the **first
  600** (newer material rides spaced-rep + Layer-2 pods). Shorter courses top out
  at their own count (a 300-seed course → 10/cup, a 450 → 15/cup). 600/20 is just
  the universal ceiling.

### Clusters (authored — Aran)
- At every **multiple-of-5 seeds/cup (5, 10, 15, 20)** the whole cup is re-formed
  into an **authored, ordered cluster** — a *linguistic* grouping of those seeds
  chosen to reinforce a pattern (type-(b): membership is authored, it **overrides**
  the arbitrary fill, and re-clustering regroups).
- Only **four templates are ever needed: 5, 10, 15, 20.**
- Between milestones, the cluster stays put and loose seeds accrete one per batch
  on top; the next milestone absorbs them into the bigger cluster.

### Playback: the per-seed comprehensible-input sandwich (Tom 2026-06-21)
Every seed in the poured cup plays a fixed **four-slot sandwich**, in cup order
(cluster then loose):

```
target @1× (voice 1)  →  known @1×  →  target @1× (voice 2)  →  target @2×
```

Hear the sentence → hear its **meaning** → hear the sentence again, now
understood → a stretch rep at 2×. The known clip is what makes the input
*comprehensible*. A seed with no known audio drops slot 2 (target, target,
target@2×) — the known slot is omitted, never silenced. No per-seed state, no
tiers; a cup is ≈ four plays over its `p` seeds — still comfortably ~a minute at
`p = 20`.

This mirrors what **Layer-2 pods** already do (`target → known → target →
target`); the runtime gap matrix in `LearningPlayer` is already built for these
role transitions (`ps`/`ps2x` = target, `trans` = known).

**Why known audio came back.** The cup went through several target-only shapes —
a per-seed decay ladder (`1×2× → 2×2× → 2×`, 2026-06-18), a flat once-slow-once-fast
pour, then 1×,1× slow-only (06-20) on the theory that 2× without dialogue scaffold
is just fast noise. Road-tests then showed the deeper problem was **no
comprehensible input at all**: a seed pulled out of its dialogue has no flow to
infer meaning from, so pure target replays — at any speed — teach nothing. The
fix isn't a speed; it's restoring the meaning, via the known clip, exactly as the
pods do.

### The forever loop
When a course stops introducing seeds (hits the 600 cap, or its own end), cup
membership stops changing — so each cup just keeps pouring its fixed set (1× pass
then 2× pass) forever: steady background maintenance.

---

## Layer-2 pods: segue, don't double-bracket

Layer-2 listening pods still fire on their own cadence (every ~5 rounds, owned by
`usePodLapScheduler`). On a pod round the cup wheel is *also* turning, and we don't
want two separately-bracketed listening blocks (`intro/seeds/outro` then
`intro/pod/outro`). Instead, **this round's L1 cup seeds are prepended onto the
front of the pod lap and played as one lap**:

```
intro bookend → L1 cup seeds → pod plays → outro bookend   (single bookend pair)
```

Seeds first, then the pod, segued. Implemented in `LearningPlayer.handleRoundBoundary`:
the pod block prepends the cup's plays to `lap.plays`; the standalone L1 block is
already gated on `!podFiresThisBoundary`, so nothing double-fires. The pod's ratchet
still advances on the combined lap's completion (L1 has no ratchet). Skipped in INF
PLAY (L1 doesn't run there — the pod plays alone with its own bookends, as before).

## Cup composition, fully specified

For `seedsPerCup = p` (1…20), let `C = largest multiple of 5 ≤ p` (the current
cluster size; 0 while `p < 5`) and `L = p − C` (loose count, 0…4):

- **Cluster part** (`C ≥ 5`): the `C` seeds of `clusterTemplate[C][cupIndex]`, in
  template order.
- **Loose part**: the `L` most-recently-added seeds for this cup (one per batch
  since the last cluster milestone), assigned by a seeded permutation.

**Playback:** no tiering — every seed plays the same four-slot sandwich
(`target1× → known1× → target1×(v2) → target2×`), regardless of how new it is or
whether introductions are frozen. Seeds run in cup order: cluster (template
order) then loose (oldest → newest).

### Worked trace — cup #7

Each seed below expands to its sandwich (`t@1× · k@1× · t@1× · t@2×`):

| Introduced | Cup #7 holds | Pour (per seed in order) |
|---|---|---|
| 30 | {s7} | s7 sandwich |
| 60 | {s7, s43} | s7 sandwich, then s43 sandwich |
| 90 | +s77 | s7, s43, s77 — each its sandwich |
| **150** | authored 5-cluster | the five, each its sandwich |
| **300** | authored 10-cluster | the ten, each its sandwich |
| … 600 | authored 20-cluster | the twenty, each its sandwich, looping |

---

## Open build questions

1. **Cluster templates (Aran).** Per-course, ordered groupings for sizes 5/10/15/20
   (30 cups × size seed-numbers). Confirm the delivery format → maps to the data
   contract below. *Blocking the "real" clustering only — not the rest.*
2. **"Introduced" mapping.** Proposed: a seed is introduced at its **last LEGO's
   catalogue ordinal** (≈ the round, one new LEGO/round), so
   `introducedCount(round) = #{seeds : lastOrdinal ≤ round}`. Confirm this is the
   right "fully introduced" definition.
3. **Loose-seed playback position** within a cup — appended after the cluster
   (default), and in what order among themselves. Minor.
4. **Bookend every round.** Today the "now just listen…" bookend plays 1–2×/session;
   at every-round cadence it would repeat ~12×/hour. Options: full bookend only on
   the **first lap of a session** (+ a 1s tone otherwise), or a sonic cue only.
   *Feel decision — defaulting to keep-the-bookend for v1, fast-follow if it grates.*
5. **Encouragement adjacency.** With L1 on every clean round, the rule that
   suppresses encouragements next to listening would starve them — relax it so the
   ~10-min encouragement still fires (a 1-min listen beside it is fine now).
6. **Wheel advance vs pod pre-emption.** Pods (Layer-2) still win their rounds and
   L1 skips. Decide whether a pod-preempted round still advances `cupIndex` (default:
   derive `cupIndex` from the round, so a preempted cup just sits out that turn).

---

## Build plan

**BSC.** *Better:* little-and-often listening tuned to maturity, with coherent
authored clusters reinforcing patterns — closer to how acquisition actually works
than one rare 10-min block. *Simpler:* one 30-cup wheel that's a pure function of
(catalogue, round, learner, templates); deletes the drain math, the 80/20 cap, the
duration/packing idea, and the separate 2× pass. *Cheaper:* no new runtime cost —
reuses the proven pod playback path and already-cached seed audio; the only new
data is one small per-course cluster table.

### Phase 0 — engine + wiring, with a fallback grouping (buildable now)
- Rewrite the **pure core** of `useLayer1Scheduler.ts` to the cup model. New pure,
  unit-tested functions (mirroring the existing `*.test.ts` discipline):
  - `introducedCountAt(seedLastOrdinal, round)` and `seedsPerCup(count)`
  - `clusterSizeFor(p)` / `looseCountFor(p)`
  - `cupIndexFor(round, activationRound)`
  - `tierForSeed(...)` → `'debut' | 'mid' | 'floor'` per the table above
  - `composeCup(round, …, clusterProvider)` → ordered `L1Play[]` (seed + speed
    sequence), reusing the existing `L1Play`/`L1Lap` shapes
  - `isFrozen(round, totalSeeds)` → forces all-floor
- `clusterProvider` is **injected**. Ship a deterministic **fallback** (seeded
  contiguous grouping of the first `C` introduced seeds into 30 ordered cups) so the
  whole thing runs end-to-end before Aran's templates land.
- Reuse the existing **LearningPlayer seam** (`handleRoundBoundary`, lap→`PodLap`
  shaping, resume/skip/offline handling). Changes there:
  - fire **every round** once `seedsPerCup ≥ 1` (not interval-50)
  - `nextLap(round)` → `composeCup(round)`; bookend per Q4 (keep for v1)
  - relax the encouragement-adjacency gate (Q5)
  - prefetch the next cup (mirror the current look-ahead)
- Update the `?l1test` dev cheat to exercise the wheel early (low introduced
  thresholds) so it's testable by hand.
- Tests + typecheck + lint green; ship to **dev**.

### Phase 1 — real clusters (when Aran delivers)
- Add storage: `course_listening_clusters(course_code, cluster_size, cup_index,
  seed_order int[])` (DB-first, hot-swappable, queryable) + a loader in
  `initialize()`.
- Swap the fallback provider for the table-backed one; ingest Aran's templates
  per course. No engine change — just the data source.

### Phase 2 — polish (fast-follow)
- Bookend treatment (Q4: first-of-session / sonic cue), the eternal-loop feel,
  `algorithm_config.layer1` tuner keys for the thresholds, APML update
  (`apml/learning/listening-layers.apml`).

### Testing focus
Determinism (same round → same cup), the milestone transitions, the per-seed
sandwich (`buildSeedPlays`: 4 slots, known-text only on the trans slot, trans
dropped when no known audio), freeze-to-floor at the cap/end, and the cup-#7
trace as a fixture.

---

*Last updated: 2026-06-21 · Status: built + live on dev; per-seed comprehensible-input sandwich (target → known → target → target@2×); cluster templates still pending Aran*
