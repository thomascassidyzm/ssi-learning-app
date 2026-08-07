# Easy now hears the same speed on-ramp as Fast

**2026-08-07 · fixed, verified in a real browser on dev AND again on the release candidate's own deployed build · IN tonight's candidate.**

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

## Where it landed

Lifted onto the release candidate on its own — three commits by patch, not a wholesale
promote of dev — and **re-verified against the candidate's own deployed build** rather
than trusted from the dev run. Twelve checks, twelve passes, and the same numbers:
0.72x in both modes, Easy's pause still 3841 ms against Fast's 2401 ms.

The companion pin for the Easy listening hold was deliberately left behind: that ruling
is held on dev, so the option it tests does not exist on the candidate.

Full supplement: `docs/release-candidate-supplement-easy-speed-parity-2026-08-07.md`.
