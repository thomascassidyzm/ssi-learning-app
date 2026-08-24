# Staging promotion — Easy doubling + listening redesign (2026-08-08)

`dev` merged wholesale into `staging`, deployed, and verified live on
https://staging.saysomethingin.app. Nothing went to `main`. No database
migration was applied and no algorithm-config row was edited.

## What landed

32 commits that were genuinely not on staging (measured by patch-equivalence,
not raw ancestry — raw ancestry said 67 and was wrong). Among them the four
things worth listening for:

1. Easy-mode cycle doubling, fully parametrised, including the fix that made
   the **first** rounds double too — the instant-playback path had been
   mode-blind.
2. The 15-known-syllable pull filter on review and consolidate, replacing the
   old flat 20-target-syllable cap.
3. The belt speed table (0.8 white/yellow, 0.9 orange/green, 1.0 blue+).
4. The listening one-mode redesign — target · known · target · target at one
   belt-capped speed.

Riding along, as staging is the soak lane: a schools fix letting a school admin
who holds the admin tag read her own school, the leader-assigns-teacher feature,
the pods A-52 fix, the Turbo retirement, CI cost changes and a batch of docs.

## Conflicts, and how they were resolved

Seven files conflicted. Staging carried an **earlier generation** of the Easy
work (the flat 20-syllable cap, the phrase-count inflation) that dev had
deliberately superseded. dev's version was taken in every case; the only things
lost were the retired cap's own machinery. Two staging-only test files pinning
the retired feature were deleted, matching dev's own removal.

## Gates

Core build, player-vue typecheck, 1957 unit tests, API typecheck and 1139 API
tests all green. Lint reports 2 errors, both in **untracked local probe scripts
belonging to other workers** — CI never sees them; committed code is clean.

## Live verification

**Easy doubling — confirmed, three independent ways.** Same course, same
starting point, fresh session, 180 seconds each:

| | phrases covered | median seconds per phrase |
|---|---|---|
| Easy | 7 | 23.0 |
| Fast | 11 | 13.9 |

Like-for-like on the practice phrases:

| phrase | Fast | Easy | ratio |
|---|---|---|---|
| I want to speak | 11.1 s | 28.3 s | 2.55× |
| speak Chinese | 11.4 s | 28.5 s | 2.50× |
| I want to speak Chinese | 13.9 s | 33.9 s | 2.44× |

The debut/intro cycles — "I want", "to speak", "Chinese", "with you" — are
within a second of each other in both modes. That is exactly the ruling: the
intro LEGO and the LEGO alone are not doubled. The audio stream shows the same
three clips replayed back to back with nothing in between, and it starts from
the very first cycles of a fresh session, so the instant-playback fix is live.

**Speed.** The test course is recorded at 0.8 in the voice config, so it is a
slow-recorded course and the belt ramp deliberately does not apply to it —
speaking cycles at 1.0 are correct here, not a defect. The standalone Listening
surface played at a flat 0.8 throughout, one single speed, with no sign of the
exposure ramp being applied twice.

**Config.** The live algorithm_config rows already carry the new parameters
(Easy: repeat 2, 15 known syllables, BUILD unfiltered; Fast: repeat 1, no
filter). No stale row is overriding the code, and nothing was written.

## Explicit gap

**The target · known · target · target pattern was not verified live.** That
pattern is consumed by the listening laps that fire at round boundaries inside a
speaking session, not by the Listening scenes surface reached from the headphones
tray — those are two different things. A fresh reset learner has no accumulated
sentences for a lap to pour, so no lap fired in a five-minute forced-interjection
run. The pattern is backed by unit tests and by the shipped code default (the DB
listening row carries no override), but I did not hear it on staging. Anyone
picking this up needs a learner with session history, not a fresh one.

An earlier read that appeared to show the pattern was wrong and is withdrawn: a
doubled Easy cycle produces the same first-equals-fourth signature, and the
matches came in the runs that only doubling explains.
