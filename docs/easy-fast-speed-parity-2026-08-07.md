# Easy now hears the same speed on-ramp as Fast

**2026-08-07 · fixed, verified in a real browser, on dev · NOT yet in tonight's production candidate — see the last section.**

## What was wrong

Easy mode cancelled the belt speed on-ramp and played the target language at full
speed. Fast kept the on-ramp. So a beginner who picked **Easy** heard the new
language **faster** than the same beginner on **Fast** — backwards from what the
two names promise, and worst exactly where it matters most, at white belt.

Tom's ruling: *"Easy should follow the exact speed pattern on-ramps for the target
language as Fast — but just with bigger pauses, more repetitions and so on as they
currently are."*

## What changed

One deletion. Easy owned a private speed override; it is gone, along with the two
places that applied it. Both modes now read the single speed the round-builder
bakes onto every cycle — one on-ramp, no second copy to drift.

Nothing else about Easy moved: its longer pauses, its beat of silence after the
second voice, its extra repetitions and its shorter phrases are all untouched.

## Proof — by driving the real player, not by reading the code

A probe drives the deployed app in a real browser, in each mode, and records the
speed the browser was actually asked to play every clip at. French, white belt:

| | target voice | pause before the learner speaks | listening laps |
|---|---|---|---|
| **Fast** | 0.72× | 2401 ms | 0.72× |
| **Easy** | 0.72× | 3841 ms | 0.72× |

Same speed. Easy's pause is still 60% longer. Listening and pods still ramp.

The control makes it airtight: the **same probe run against staging**, which still
has the old code, catches Easy playing a clip at 0.9999999999999999× — the ramp
being cancelled back to full speed, a speed Fast never uses. And staging's pauses
come back **identical** to the fixed build's (2401 / 3841), which is the evidence
that this fix left Easy's timing alone.

A unit test pins both halves: no second speed path can exist, and the modes still
differ where they are supposed to.

## One thing to know

Another ruling landed tonight in parallel — Easy holds **listening** at the
beginner's 0.8× rung instead of climbing with the belt. That is the same on-ramp
held, not a second one, and it can only ever make Easy slower, never faster. At
white belt the two are identical, so it agrees with the ruling above rather than
fighting it. Both are now pinned by the same test so they cannot drift apart.

## What still needs a decision

The fix is **on dev and verified live there**. Tonight's production candidate was
cut from **staging**, which does not have it. So as things stand it would ship in
the *next* release, not tonight's.

Getting it into tonight's ship needs one of: promote dev → staging before the
staging → main step, or lift these three commits onto staging on their own. That
is a call about what reaches real learners tonight, so it is yours.
