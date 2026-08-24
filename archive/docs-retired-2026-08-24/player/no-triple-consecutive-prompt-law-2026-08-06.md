# A-64 follow-up: no prompt plays three times in a row

**2026-08-06 · branch `dev`**

This is the follow-up to the A-64 diagnosis ([published doc](https://watson-1.tail4968cb.ts.net/d/ea4c9c3c)). That job concluded the French repeat-line behaviour was working as designed. Tom accepted the diagnosis and then changed the design.

## The ruling

Tom, clearing A-64, verbatim:

> "yes - new rule: no mode should ever repeat the same prompt more than twice consecutively"

It is a design law. It binds every mode — the 4-phase learning player in Easy and Fast, Listening mode and the pods, infinite play, and every degraded or fallback playback path. Two identical prompts back to back is legal; three is not, under any configuration.

The law is about **consecutiveness only**. Spaced repetition is untouched: a phrase may still come back any number of times across a session. So the instruction was to keep the totals by **re-interleaving** — move the offending rep later — rather than by deleting reps and quietly shortening the round.

## What was actually found

The A-64 diagnosis was about four plays of one clip spread over **ten minutes**, which is not the same thing as four plays back to back. The first job here was to establish empirically where genuinely *consecutive* identical prompts occur. Two findings:

**1. The main learning script was already lawful.** `generateLearningScript.ts` ends with a consecutive-duplicate pass that has been there all along, and it is *stricter* than the new law: it collapses adjacent identical ordinary cycles down to one. Verified by removing the new cap and re-running the new regression tests — they still pass. So Easy mode's doubled `n1PhraseCount` of 6 against a one-phrase USE pool never actually reached the learner's ear as six in a row.

Worth noting for Tom: that pass **drops** the duplicate rather than re-interleaving it. Under the new law two in a row is legal and totals should be preserved, so those dropped reps are arguably owed back to the learner. That is a product-shape change beyond the ruling, so it has been left alone and flagged rather than done.

**2. Listening mode was the real breach.** A pod whose active cohorts hold a single sentence emits a stage playlist that ends on that clip — stage 8 is `['ps2x','ps2x']` — and the next lap restarts on the same clip. Three, then four, in immediate succession. Reproduced in a test that fails without the fix and passes with it. This matches the separate listening diagnosis of the same night: one sentence, played nineteen times across seven laps.

**3. The first fix was in the wrong place, and an audit caught it.** A read-only audit of every other emitter found that `INSTANT_PLAYBACK_ALL` is `true` in `LearningPlayer.vue` — so **every** course takes the instant-playback path: server cycles route → `useInstantPlayback` → `backendCyclesToRounds` → the player. That path never touches `generateLearningScript`. A cap living only in the generator would have protected nobody on the live default path.

Worse, the server route itself can construct the breach: `api/courses/[code]/cycles.ts` emits `intro` then `debut` with identical known and target text — legal at two — and then appends the first BUILD phrase with no adjacency check at all. If that phrase duplicates the bare LEGO text, that is three in a row.

So the floor moved to where both paths converge: the **round adapters**, immediately before the player receives the rounds. Three of the five new adapter tests fail without it. That placement is also strictly better than the generator, because the adapters drop cycles whose audio is missing — which can itself pull two previously separated prompts together.

**4. The offline degradation ladder**, whose documented last resort is literally "keep repeating last successfully played cycle" — an unbounded loop of one clip.

**5. The Layer-1 listening cups.** The shipped seed playlist is lawful, but it is admin-tunable from the Listening config page with no validation, so a saved `['known','t1','t1','t2']` would have emitted three.

## What changed

**One enforcement point, not four hand-rolled caps.** `packages/player-vue/src/playback/capConsecutiveRepeats.ts` is a pure, unit-tested helper: give it an ordered sequence and an identity function and it returns a sequence in which no identity appears more than twice consecutively, preferring to move a rep past a differing item rather than delete it.

It preserves totals wherever the arithmetic allows. A feasibility lookahead makes the greedy optimal — plain "first legal item wins" emits `A,B,B` out of `A,B,B,A,B,B,B` and then has to drop a B, whereas the true capacity (n differing items can separate at most 2·(n+1) copies of one identity) says all seven fit as `B,B,A,B,B,A,B`. A rep is dropped only when no ordering whatsoever could have kept it.

Applied at five points, all **downstream of configuration**, so no DB value and no future mode can breach the floor:

- **`backendCyclesToRounds.ts` and `toSimpleRounds.ts`** — the round adapters, the last word before the player. This is the one place both the instant-playback path (live default, every course) and the legacy generator path pass through, and it is what makes the law actually bind for real learners.
- **`generateLearningScript.ts`** — a final per-round pass. A floor, not a repair (see finding 1).
- **`usePodLapScheduler.ts`** — on the composed lap, downstream of the admin-editable stage playlists in `algorithm_config.pods`. The previous lap's tail carries into the next lap, except where bookend clips genuinely separate them.
- **`useLayer1Scheduler.ts`** — on the per-seed listening sandwich, so an admin-saved playlist cannot breach.
- **`useOfflinePlay.ts`** — a cycle that has already played twice is excluded from the scheduled pick and from the belt-only pool while any other cached cycle exists.

One deliberate exemption: a round's opening **intro and debut cycles are anchored** — never moved — because a round has to open with them. That means the opening is technically exempt from the law: a round whose intro *and* debut both match the two cycles ending the previous round would breach at the seam. That needs two adjacent LEGOs carrying identical text, which is a content defect rather than a scheduling one. The alternative — hoisting a practice phrase in front of the intro — breaks the round's structure to fix an unreachable case.

Re-interleaving is confined **within a round** everywhere it is applied. Rounds are the player's unit of position, so an item must never migrate across a round boundary; each round is seeded with the previous round's tail so the seam holds anyway.

## Audited and deliberately left alone

Two things the audit found that are **not** capped, on purpose:

- **`SimplePlayer.resume()`** deliberately restarts the current cycle from the top — "if the learner has stopped the app at all, we give them the full 4-phase cycle." If cycles N and N+1 carry the same text (legal, two in a row) and the learner pauses part-way through N+1, the prompt sounds a third time on resume. A queue-level cap cannot see this; only a resume-time check could. Changing resume semantics to chase an interaction-dependent edge risks a worse regression than the edge, so it is logged rather than fixed. **This one is yours if you want it closed.**
- **Stage 0 and atom fusion** can construct three in a row, but Stage 0 was retired from the runtime on 2026-07-14 and survives only behind `/admin/pod-auditioner`, and `usePodAtomFusion` has no caller outside its own test. Unreachable from learner-facing playback.

## Where a total had to shrink

Two places, both flagged deliberately rather than hidden:

1. **A pod lap holding a single clip, at the later stages.** Stage 7 is `['ps','ps2x']` and stage 8 is `['ps2x','ps2x']` — the same clip twice — and with one sentence there is nothing to interleave against. The lap is reduced to what the law allows and the shortfall is logged. A lap is never emptied: `minKeep: 1` guarantees at least one play, so the session cannot stall. **This visibly changes a brand-new learner's pod shape.** Tom may prefer a different answer here — growing the pod faster so there is always a second sentence to interleave with.

2. **The offline fallback with exactly one cached cycle.** Here the cap and "never stall the session" genuinely collide. Tom's steer is that the session wins, so the third play happens and is logged as a warning rather than passing silently.

## Taste-safe defaults taken

- **Prompt identity** = normalised known text paired with normalised target text, the existing `getPhraseId` notion. Pod plays are the exception: a pod sentence play carries no known text and a pod translation carries no target text, so pods are identified by **audio id** — which correctly makes `ps` and `ps2x`, the same clip at 1× and 2×, the same prompt.
- **Two in a row is allowed, three is not** — the plain reading of the ruling.
- **Re-interleave over drop**, always, wherever anything exists to interleave with.

## Verified live on dev

Not "verified" as a word — here is what was actually done.

A probe (`packages/player-vue/e2e/a64-consecutive-prompt-probe.mjs`) wraps `HTMLMediaElement.prototype.play` inside the page and records the src of every clip at the moment it starts, in order. That measures what the learner **hears**, not what the generator intended. Silent-gap WAVs are excluded as transport padding.

Run against `https://ssi-learning-app-git-dev-zenjin.vercel.app/?course=fra_for_eng&mode=easy`, a fresh guest session wiped with `?reset=1` so it starts at the very beginning of the course — the configuration Tom heard the four-in-a-row in. Ten minutes of continuous play:

| | |
|---|---|
| clips played | 193 |
| distinct clips | 114 |
| **longest run of one clip back to back** | **2** |
| breaches (runs of 3+) | 0 |
| JS errors | 0 |

The same probe run against the pre-fix build gave the same answer — longest run 2 — which is the live confirmation of finding 1 above: the main learning script was already lawful before this change.

## Tests

- `packages/player-vue/src/playback/capConsecutiveRepeats.test.ts` — unit behaviour plus a 400-case property sweep: the output never contains three consecutive equal identities, nothing is invented or duplicated, and totals survive whenever the arithmetic allows.
- `packages/player-vue/src/providers/a64ConsecutivePromptCap.test.ts` — the A-64 case directly, at the Easy-mode script shape (`n1PhraseCount: 6`, `useConsolidationCount: 4`, `maxBuildPhrases: 14`, `maxSpacedRepPhrases: 24`) against USE pools of one, two and three phrases, for the main loop and the infinite-play tail, plus the default Fast shape.
- `packages/player-vue/src/providers/a64RoundAdapters.test.ts` — the round adapters against the intro/debut/build triple the server route makes possible, within a round and across the seam. Three of its five tests fail without the cap.
- `packages/player-vue/src/composables/usePodLapScheduler.a64.test.ts` — pod laps with one, two and four sentences, with and without bookends, flattened across consecutive laps into the sequence the learner actually hears.

Spec: `apml/playback/consecutive-repeat-law.apml`, cross-referenced from `apml/interfaces/learning-player.apml` (v2.1.26) and `apml/interfaces/listening-mode.apml` (v1.4.0).
