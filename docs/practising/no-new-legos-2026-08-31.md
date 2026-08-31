# Practising mode withholds new LEGOs

**2026-08-31 · learner-facing · on `staging` · not on `main`**

Tom, on being shown that the mode changed nothing about what was served:

> "practice mode is designed as a no/low wifi test though ffs, so it should not
> serve any new LEGOS, else, what is the point???"

That is the whole specification, and it is now what the code does.

## What was wrong

The hold looked **backwards for a ROUND that introduced nothing** — no intro, no
debut, no build, over a 40-round window. Every main-loop round carries all
three. So on any ordinary learner the candidate list was always empty, the hold
never engaged, and the mode only ever stopped progress being *written down*.
Nothing in the serving path changed at all.

Measured against Tom's own state — learner `81987d60`, `spa_for_eng`, cursor
`S0403L03`, round 828 — the next twenty items with the mode ON were identical,
item for item, to the twenty with it OFF. The trace said it plainly:

```
[PRACTISING] wanted to refuse round 829 (S0403L04) but NOTHING review-shaped
in the 40 rounds behind → the new LEGO plays anyway
```

**The unit was wrong, not its range.** A wider window still finds no
review-shaped round, because this course does not produce one.

## What it does now

The hold lands on a **cycle**, not a round.

Every round the learner has already completed ends in a block of spaced
repetition and USE phrases over LEGOs introduced long ago. That material is
already in the queue, and its audio is already on the device because the round
was played. So the mode walks back over the completed history, newest first,
and puts the playhead on the first cycle of a round whose remaining tail
introduces nothing.

No new content source. No fetch. No urn, no cache measurement, no network.

- **It cannot serve something new.** The component cycles count as introducing
  too — wider than the old intro/debut/build test, which they slipped past.
- **It cannot run dry.** The rotation covers the whole played history and wraps,
  so there is no window constant left to tune. If nothing has a practised-only
  tail at all (one round into a brand-new course) it replays the last completed
  round, whose LEGO the learner has already met.

## The demonstration

Same harness, same learner, same live state. Round 828, cursor `S0403L03`.

**Practising OFF — unchanged, byte for byte, from before the fix:**

```
 1 POD DIALOGUE lap — podRound 3, 16 plays
 2 INTRO        S0404L01
 3 DEBUT        S0404L01
 4 BUILD        S0404L01
 5 BUILD        S0404L01
 6 BUILD        S0404L01
 7 BUILD        S0404L01
 8 BUILD        S0404L01
 9 BUILD        S0404L01
10 BUILD        S0404L01
11 SPACED_REP   S0404L01
12 SPACED_REP   S0404L01
13 SPACED_REP   S0404L01
14 SPACED_REP   S0404L01
15 SPACED_REP   S0404L01
16 SPACED_REP   S0404L01
17 SPACED_REP   S0404L01
18 SPACED_REP   S0404L01
19 SPACED_REP   S0404L01
20 SPACED_REP   S0404L01
```

**Practising ON — no intro, no debut, no build:**

```
 1 POD DIALOGUE lap — podRound 3, 16 plays
 2 [PRACTISING HOLD] refused round 830 (S0404L01) → held on practised material, round 829 from cycle 8
 3 SPACED_REP   S0403L04
 4 SPACED_REP   S0403L04
 5 SPACED_REP   S0403L04
 6 SPACED_REP   S0403L04
 7 SPACED_REP   S0403L04
 8 SPACED_REP   S0403L04
 9 SPACED_REP   S0403L04
10 SPACED_REP   S0403L04
11 SPACED_REP   S0403L04
12 SPACED_REP   S0403L04
13 SPACED_REP   S0403L04
14 SPACED_REP   S0403L04
15 USE          S0403L04
16 USE          S0403L04
17 POD DIALOGUE lap — podRound 3, 16 plays
18 [PRACTISING HOLD] refused round 830 (S0404L01) → held on practised material, round 828 from cycle 9
19 SPACED_REP   S0403L03
20 SPACED_REP   S0403L03
```

Run out to **120 items** with the mode ON, it stays clean and never runs dry:

| what plays | count |
|---|---|
| spaced repetition | 90 |
| USE phrases | 14 |
| seed-listening laps | 4 |
| pod dialogues | 4 |
| **intro / debut / build / component** | **0** |

## Belt skip

Same principle, the control Tom named: **belt skip must be unavailable whenever
the app cannot serve the target belt.**

The picker already greyed out belts whose audio is not on the device — but only
when the app was *offline*. Practising is the other way to be in that state and
the more exact one: the mode's whole trigger is the next new LEGO coming back
unfetchable. It can also be switched on deliberately, on a full signal, from the
settings door — and there every belt pill was tappable. Tapping one walked the
learner out of the downloaded plan into content the mode had just refused to
fetch, straight past the hold that exists to stop exactly that.

One predicate now, named for what it means — `cannotFetchNewContent()` — feeding
both the pill greying and the modal. The availability test underneath is
untouched and stays exact: a belt greys out only when its landing round has no
cycle whose audio is actually in the persistent cache. A practising learner
keeps every belt they have already downloaded and loses only the ones that would
hand them silence.

## Honest gaps

- **The demonstration is the selector, not a phone.** It runs the real
  generator, the real pod and Layer-1 schedulers and the real choosing function
  against Tom's live state, read-only. It does not prove the audio plays, and
  the pod lap repeats in the trace because a read-only probe never advances the
  persisted pod counter — a probe artefact, not a behaviour.
- **Belt skip is guarded against "the audio is not on this device."** Any other
  kind of "cannot serve" — online, but the content has never been generated —
  is not covered by this check and was not in scope.

## Where it is

- Branch `fix/practising-serves-only-practised`, merged to `dev` (`c1efefe0`),
  promoted to `staging` (`790380ff`). **Not on `main`.**
- The choosing is pure and pinned in
  `packages/player-vue/src/playback/practisingMode.test.ts`; the belt guard in
  `packages/player-vue/src/components/ProgressModal.offlineNotice.test.ts`.
