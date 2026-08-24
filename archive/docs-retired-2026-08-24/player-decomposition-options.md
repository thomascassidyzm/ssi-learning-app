# Player decomposition — options paper

*2026-07-21. Decision doc for the owner. Context: seven user-reported bugs on 2026-07-21,
all one class — the player is a de-facto distributed state machine coordinated by ad-hoc
async code. Sources read: `plans/019-decompose-learningplayer.md`, fix commits `ed738a0f`
(stranded-paused), `73c1507a` (dead round-skip / desync), `e2fe33e0` + `44701a38`
(stale-cache fallbacks), `LearningPlayer.vue` (17,261 lines, 39 watchers, 87 computeds),
`SimplePlayer.ts`, `docs/DECISIONS.md`.*

## The actual disease

The seven bugs were not size bugs — they were **ownership bugs**. Four recurring failure
modes, and what each really is:

| Failure mode | Example | Root cause |
|---|---|---|
| Fire-and-forget promises | interlude handler stranded player paused (`ed738a0f`) | resume() is a *hope*, not an invariant — any throw between pause and resume strands the engine |
| Async racing the engine | skip started loads before stopping playback (`73c1507a`) | no serialised transition path; anyone can touch the engine any time |
| State mirrors drifting | `cachedRounds` vs engine's internal queue → dead round-skip | two writers, two truths, no single owner of "what rounds exist" |
| Silent stale-cache fallbacks | `e2fe33e0`, `44701a38` | error paths decide policy locally, invisibly |

Plan 019 (extract regions into composables) attacks **reviewability and watcher
cross-talk** — real, but a different disease. Behaviour-preserving extraction moves the
same ad-hoc coordination into more files; none of the four bug classes above becomes
*impossible*. Plan 019's own STOP condition says it: regions sharing mutable state "need
a state-ownership decision first." That decision is this paper.

## Option 1 — Invariant hardening in place (minimal)

Lint + runtime discipline, no structural change:
`no-floating-promises` scoped to the player; every pause/resume pair wrapped in a
try/finally helper (generalising the `ed738a0f` fix); **delete the `cachedRounds` mirror**
and read round state from SimplePlayer getters; a watchdog that detects
"engine paused, no user pause intent, N seconds" and recovers; loud (logged) cache
fallbacks.

- **Retires structurally:** the mirror-drift class only (deleting `cachedRounds` removes
  one of the two truths). Everything else it makes *less likely*, not impossible — the
  next fire-and-forget path someone adds recreates `ed738a0f`.
- **Size/risk:** days, low risk, ships on dev incrementally alongside daily fixes.
- **Review burden:** near zero; each piece is a small mechanical PR.
- **Honest read:** this is the "keep patching per-bug, but systematically" option. It
  papers over the missing owner.

## Option 2 — PlayerConductor: one owner of all transitions (partial extraction)

A small explicit state machine (`playback/PlayerConductor.ts`, ~300–500 lines) that is
the **only** code allowed to call SimplePlayer's `pause/resume/stop/skip/jump/addRounds`.
States: `playing / interlude(kind) / seeking(intent) / loading / ended / user-paused`.
Transitions are serialised (one at a time, queued); every transition that leaves
`playing` carries its return path *in the state*, not in a promise chain. The component
keeps its template and its 39 watchers initially, but every handler that today touches
the engine calls `conductor.request(...)` instead. The already-established skip rule —
pause first, capture intent, resume after landing — becomes the conductor's literal
transition shape rather than a convention.

- **Retires structurally:**
  - *Stranded-paused* — impossible by construction: `interlude` is a state, and the
    machine cannot remain in it after its exit event; error = forced transition back to
    `playing` (the `ed738a0f` fix, but as an invariant, not a per-callsite try/catch).
  - *Skip races* — transitions serialise; a load cannot start while a stop is mid-flight.
  - *Mirror drift* — the conductor exposes the single reactive view of engine truth;
    `cachedRounds` dies here too (Option 1's best item is subsumed).
  - Stale-cache fallbacks: **not** retired (that's the offline layer) — but fallback
    events surface through conductor state, so they stop being silent.
- **Size/risk:** ~1–2 weeks of focused work; incremental — conductor lands first doing
  pass-through, then handlers migrate one per PR (`handleRoundBoundary` first, skips
  second). Dev never breaks; unmigrated handlers keep working until migrated.
- **Review burden:** the conductor itself is the one carefully-reviewed artifact; each
  migration PR is small and mechanical ("this handler now requests instead of touching").
  Future player PRs get *cheaper* to review: "does it go through the conductor?" is the
  whole question.

## Option 3 — Full decomposition per plan 019 (maximal)

Extract paywall, offline picker, rolling buffer, phase/timing into composables, many PRs,
until LearningPlayer.vue is a thin shell.

- **Retires structurally:** watcher cross-talk between regions; near-zero reviewability;
  gives each region a testable seam. But the four bug classes are *coordination* bugs —
  extraction alone redistributes them. The phase/timing extraction (the risky one plan
  019 defers to last) is exactly the conductor's territory, reached the slow way.
- **Size/risk:** L-effort, many PRs over weeks, in the product's hottest file
  (~2 commits/day churn — every extraction races the daily fixes; plan 019 itself
  budgets for drift).
- **Review burden:** high and sustained — every extraction is a large "prove it's a pure
  move" diff in the regression-dominant file.

## Recommendation

**Option 2, with Option 1's cheap invariants folded into week one, and plan 019 resumed
afterwards as the follow-on.** BSC: *Better* — it makes the two worst live bug classes
(stranded player, racing skips) structurally impossible rather than less likely, and it
is the state-ownership decision plan 019 says it needs before touching the core.
*Simpler* — one small owned artifact replaces N ad-hoc pause/resume conventions; it
deletes the `cachedRounds` mirror and the per-callsite try/catch pattern. *Cheaper* —
1–2 weeks vs plan 019's open-ended L-effort, migrates handler-by-handler so it never
blocks daily fixes, and it makes every subsequent 019 extraction smaller and safer
(regions no longer carry engine-coordination code, so they extract clean). Option 1
alone fails Better (papers over); Option 3 first fails Cheaper (weeks of high-review
churn before the live bug class is closed).

## The one decision

**Does all engine coordination move behind a single PlayerConductor — yes or no?**
Everything else (which handler migrates first, extraction order, lint rules) is detail
downstream of that. If yes, the sequence is: week 1 conductor + `handleRoundBoundary`
migration + mirror deletion; then skips; then plan 019 extractions resume against a
player whose transitions are already owned.
