# Did practising mode actually engage? What your session shows, and what it cannot

*2026-08-31, staging. Your session: `f7a42ff7-91f1-40e3-97a5-3cbb59cffb80`,
21:59:22 → 22:07:04 UTC, Spanish, iPhone, build `b781a76`.*

You said: *"basically we do not know if practising mode really worked - I am
still online of course."* You were right, and the reason you were right is the
finding.

## The one thing the record settles, flatly

**During all three belt skips, practising mode was NOT holding.**

Not inferred — the writes prove it. Every belt skip persists the cursor through
`setRemoteCursor`, which sits behind the practising gate and returns without
writing while the mode holds. All three wrote, and all three landed:

| time | belt | cursor written | landed |
|---|---|---|---|
| 22:01:56 | blue → purple | S0085L02 → S0150L02, round 360 | yes |
| 22:02:05 | purple → brown | S0150L02 → S0280L01, round 609 | yes |
| 22:02:14 | brown → **black** | S0280L01 → S0401L01, round 825 | yes |

`course_enrollments` still reads `last_completed_lego_id = S0401L01`,
`last_completed_round_index = 825`. That is the 22:02:14 write, on disk.

If the mode had been holding, none of those rows would exist.

## The thing the record cannot settle, and why that is the bug

**Whether the switch was on.** The mode has exactly one entry and one exit and,
until tonight, wrote **no row on either**. The test switch wrote none either.
Its entire observable surface was a banner and two console lines — on a phone,
with no console.

So the record can tell us where you were, what you tapped, and what the cursor
did. It cannot tell us the one thing you asked about. That is not a gap in the
reading; it is a gap in the app, and it is now closed.

## What was actually wrong with the switch

The switch raises a content blackout and returns. Whether the mode then moves is
decided two files away by the tier-3 probe, which has four outcomes — and **two
of them leave the mode alone by design**:

- `no-next` — the round map has no round after this one. **The end of the
  course's new content.** There is no next new LEGO for the blackout to take
  away, so it cannot engage. Correct, and silent.
- `skipped` — we never asked, or the failure was *ours* (401/403/429/5xx)
  rather than your reach. Correct, and silent.

A correct silent no-op and an unwired switch look **exactly the same** from the
outside. That is the whole of what you were sitting in.

And you were at round 825 of a course whose main loop ends at 831. You had
skipped to black belt, which is precisely the position where `no-next` is the
expected answer and the switch cannot engage at all.

## What changed tonight

1. **`practising_enter` / `practising_exit`** — one row per transition, carrying
   the probe outcome, the LEGO it asked about, the round, online, whether the
   course is bundle-backed, and **whether the test switch was on**. Never again
   unanswerable.
2. **`practising_probe_inert`** — the row for the case that cost you the
   evening: the switch is on and the mode did *not* move, with the reason.
3. **The switch answers back.** Settings now shows the verdict under the toggle:
   green when the mode genuinely engaged, amber with the reason when it did not
   — including *"there is no next new LEGO from here — this is the end of the
   course's new content. Skip back a belt and try again."*
4. **`no-next` stops covering for a cursor we cannot find.** The probe used to
   report the end of the course when it simply could not find your LEGO in the
   round map. Two different facts, one label. Now separated.

## For job #563

**Your belt-skip work was not validated by a real practising state.** The cursor
writes at 22:01:56, 22:02:05 and 22:02:14 all landed, which they could not have
done under the mode. Whatever the switch was set to, that run tested belt-skip
against a mode that was off.
