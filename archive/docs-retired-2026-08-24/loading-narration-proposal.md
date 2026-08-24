# Honest loading narration — proposal (2026-07-29)

**Status: PROPOSAL, not built.** Founder steer 2026-07-29 asked for the awakening/loading
copy to be reframed as a live progress update on the *actual* readiness of the course —
tied to real loading stages (fetching script / resolving audio / ready), rather than
decorative copy. The steer also said: if that rewrite is materially bigger than the stall
fix, land the stall fix + casing now and propose the narration instead of building it.

It is materially bigger, **and the measurements below change what the right design is** —
so this is a proposal. Two things already shipped to dev:

- `87c77e71` — the mid-word stall fix (`goLoadingStageReady()` / `finishLoadingTypewriterFast()`).
- `348b2f38` — sentence casing across `loading.*` / `resting.*`, and the three
  `resting.returnAfter*` keys that never existed in any locale (which is why the founder's
  screenshot rendered the lowercase inline fallback).

---

## 1. The measurement that reframes the problem

Measured on the deployed dev alias, real Chrome, returning-learner profile
(`ssi-has-played=true`), sampling the `.loading-text` node every 5ms:

| regime | awakening pane visible for | first visible at |
|---|---|---|
| warm ×4 | 832 / 987 / 988 / 989 ms | 550–790 ms |
| warm cache + throttled network ×3 | 514 / 524 / 517 ms | ~3.8 s |
| cold cache + throttled ×1 | 1555 ms | 12.4 s |

Two facts follow, and they matter more than the copy:

**(a) On every warm path the awakening pane lives ~0.5–1.0s, and that duration is not the
data load.** It is `MINIMUM_ANIMATION_MS` (a deliberate 300ms floor for returning users)
plus the stall fix's fast-finish + 220ms hold. The script, the resume position and the
round map are already in cache; the load has *effectively already happened* before the
pane can be read. There is no multi-stage wait to narrate — the honest narration on a warm
load is a single beat, "your course is ready".

**(b) The slow case is real but it is a different slow.** The cold+throttled run spent
**12.4 seconds before the awakening pane appeared at all** — that is JS bundle download,
during which the learner sees the app shell and *no* message. Only 1.5s of that run was
awakening. So the wait that actually hurts is upstream of the copy this steer is about.

### The consequence for the stated rationale

The steer's reasoning included: tying the messages to real stages means "the message
narration completes naturally, which also removes the race at its root." **The
measurements say it does not.** A four-stage narration in a 600ms window would flash four
lines faster than any of them can be read — strictly worse than one line. To let a
narration "complete naturally" on a warm load you would have to hold a course that is
already ready, i.e. deliberately slow the app down. The race is removed by the stall fix
(bounded, ~220ms, only on warm loads), not by the narration. Honest progress is still worth
doing — but for honesty, not as a race fix.

## 2. What real milestones exist

`loadAllData` (LearningPlayer.vue, ~11633–13080) already logs its own decision points, so
the signals exist and would not need inventing:

| milestone | existing marker |
|---|---|
| provider resolved | `courseDataProvider ready` |
| script source chosen | `coldScriptPath` = `cache` \| `swr` \| `progressive` \| `infplay_cache` \| `full` |
| cached script hydrated | `Found cached script with N rounds` |
| no cache → generating | `No cached script, generating new one...` |
| resume resolved | `Resumed at LEGO … → round N` |
| player armed | `SimplePlayer initialized successfully` |
| done | `Data loading complete in N ms` |

`isRegeneratingScript` already drives honest copy ("Updating your course…") for the
blocking-regeneration case — that is the existing precedent this proposal generalises.

## 3. Proposed design — conditional narration

One line by default; narrate only when the wait is genuinely long enough to deserve it.

1. **A `loadNarration` signal.** Milestones call `setLoadNarration(key)` at the seven points
   above. Cheap: one call per branch, no restructuring of `loadAllData`.
2. **A dwell floor.** A narration line is never replaced before it has been visible ~700ms.
   If the next milestone lands sooner, the line is simply skipped — the learner sees fewer,
   readable lines instead of a flicker.
3. **Fast path collapses to one line.** If everything resolves inside the splash floor
   (the common warm case), exactly one honest line shows — "Getting your {lang} course
   ready…" — and `goLoadingStageReady()` finishes it as it already does today. Zero change
   to warm-load feel or timing.
4. **Slow path narrates for real.** Cold cache, first-ever course open, or
   `isRegeneratingScript`: the learner sees the true sequence — finding your place →
   building your session → lining up the audio → ready. This is where decorative copy is
   currently dishonest, and it is the only place the narration earns its cost.
5. **Retire the decorative pools.** `AWAKENING_MESSAGES` / `PREPARING_MESSAGES` (23 random
   atmospheric lines) shrink to a small stage-keyed set. The unused `loading.stage*` keys
   already in the locales are close to the right shape — but note they are engineer-voiced
   and US-spelled (`initializing neural pathways`, `retrieving session data`); they would be
   rewritten warm and British before use.

**BSC narrative.** *Better:* the message tells the truth, and tells it exactly when the
learner is actually waiting. *Simpler:* deletes 23 random lines and the random-pick, and
replaces the timing-based cinematic with milestone-driven state. *Cheaper:* no new
composable, no new infra, ~7 one-line calls plus a dwell timer; and the warm path — the
common one — is unchanged, so the cold-start budget is untouched.

## 4. Cost, and the one thing needing Tom

Roughly: the narration mechanic + dwell policy, ~7 milestone calls, a rewritten copy set,
new i18n keys across 22 locales, and verification in warm/throttled/cold-throttled
regimes. Several times the stall fix. Not hard — but it is a copy-and-feel change to the
first thing every learner sees, which is a register call, not a plumbing call.

**The taste question for Tom:** on a warm load the honest answer is that there is nothing
to wait for. Is the right thing then (a) one honest line, as proposed, or (b) no message at
all — go straight to the player and let the ~1s splash floor go away too? Option (b) is
cheaper and arguably more honest still, but it deletes a deliberate brand beat, so it is
his call and not one to make unilaterally.

**Separately, and probably worth more than either:** the 12.4s cold-cache pre-pane gap is
a real learner-facing wait with *no* message on it at all. If honest-progress is the goal,
that gap is the bigger prize.
