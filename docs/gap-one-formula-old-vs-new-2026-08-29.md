# The speaking gap: old curve vs one formula

**What changed.** The gap between the prompt and the answer voices used to be a
five-knob curve (a boot floor, an assembly threshold, a linear slope, a
quadratic long-phrase lift, and two belt tapers) with belt position read off the
target playback speed. It is now one formula:

> **gap = k × (how long the answer takes to say, at 1.0×) + a fixed reaction beat**

with `k` and the reaction beat the only tunables, one pair per mode. Playback
speed is not an input by any path. `min` / `max` stay as safety clamps.

## Starting constants

| | k | reaction | floor | ceiling |
|---|---|---|---|---|
| **Fast** | 2.8 | 800ms | 1000ms | 15000ms |
| **Easy** | 3.6 | 800ms | 2000ms | 15000ms |

Chosen by fitting a straight line to what the **live** `fast_mode` / `easy_mode`
rows actually produce for answers between 1s and 3s — the range nearly every
phrase falls in — rather than inventing a curve. Easy fits almost exactly
(within 55ms across that range); Fast within ~0.9s at the edges of it.

## What a learner will hear

Gap in seconds, for an answer of the given native length.

| answer | Fast old (White) | Fast old (Green) | **Fast new** | Easy old (White) | Easy old (Green) | **Easy new** |
|---|---|---|---|---|---|---|
| 0.5s | 2.0 | 1.6 | **2.2** | 4.0 | 3.2 | **2.6** |
| 1.0s | 2.9 | 2.4 | **3.6** | 4.9 | 4.0 | **4.4** |
| 1.5s | 4.7 | 4.1 | **5.0** | 6.7 | 5.7 | **6.2** |
| 2.0s | 6.5 | 5.9 | **6.4** | 8.5 | 7.5 | **8.0** |
| 3.0s | 10.3 | 9.4 | **9.2** | 12.3 | 11.0 | **11.6** |
| 4.0s | 14.2 | 13.2 | **12.0** | 15.0 | 14.8 | **15.0** |

## Where it drifts, and which way

- **1s–3s answers — the bulk of the course — land within about half a second of
  today.** Most of the app will feel the same.
- **Very short answers (under ~1s)** get slightly *more* time on Fast and
  slightly *less* on Easy. Easy's 2s floor catches most of that.
- **Very long answers (4s+)** get *less* time than today on Fast — 12.0s against
  13.2–14.2s. That is the old quadratic lift going away. A straight line cannot
  reproduce a super-linear curve at both ends, and this is the end I let drift,
  because long answers already sat close to the 15s ceiling.
- **Belt variation disappears.** Today a White-belt learner gets a gap up to ~10%
  longer than a Green-belt one on the same phrase, purely because the belt taper
  read belt position off the slowed playback speed. Everyone now gets the same
  gap for the same sentence. If that turns out to be a loss, the cheap fix is a
  White→Green endpoint pair for those same two numbers, driven by actual belt
  rather than by speed — but that is a second knob, so I did not ship it.
