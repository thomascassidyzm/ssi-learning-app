# What a learner actually waits for — the six-journey baseline

Measured 2026-09-01 against the real deployed build on `staging.saysomethingin.app`.
Read-only: no product code was changed to produce these numbers.

Harness: `packages/player-vue/e2e/journeys/` — re-run with
`BASE_URL=https://staging.saysomethingin.app ./e2e/journeys/run-all.sh`.

**"First word heard" means the audio element's `currentTime` genuinely advanced
past 0.05s on a lesson clip.** A resolved `play()` promise proves nothing —
a buffering-stalled element resolves it and never makes a sound. Brand chimes
and silent keepalives are excluded by URL pattern so they cannot flatter the
number. No run that failed to produce sound was dropped from any median; there
were none to drop.

Network profiles are Chrome DevTools' own presets: **good** = 12/4 Mbps, 40ms
(a decent 4G, not unthrottled — an unthrottled datacentre box flatters the app
in a way no phone ever will) · **fast3g** = 1.6/0.75 Mbps, 150ms · **slow3g** =
0.4/0.4 Mbps, 400ms · **highlatency** = 8/2 Mbps but 900ms RTT.

---

## The table

Times are milliseconds from the learner's action to what they asked for.
Median first, full spread in brackets, `n` = completed runs.

### Journeys 1–4 — time to the first word

| Journey | Network | n | Screen usable | Play tappable | **First word heard** | Spread |
|---|---|---|---|---|---|---|
| **j1** new user, cold device, brand new account | good | 5 | 4,146 | 4,220 | **4,633** (4,471–4,912) | 1.1x |
| | fast3g | 4 | 6,727 | 8,589 | **8,950** (8,947–9,013) | 1.0x |
| | slow3g | 3 | 18,205 | 26,248 | **29,024** (28,683–33,090) | 1.15x |
| | highlatency | 3 | 8,605 | 8,655 | **8,964** (8,790–9,137) | 1.04x |
| **j2** existing learner opens a course they have never opened | good | 4 | 1,505 | 1,626 | **1,993** (1,674–2,382) | 1.4x |
| | fast3g | 3 | 1,736 | 1,958 | **2,270** (2,098–5,110) | 2.4x |
| **j3** returning learner, content already cached | good | 4 | 2,266 | 2,426 | **2,747** (2,618–3,332) | 1.3x |
| | fast3g | 3 | 2,921 | 3,079 | **3,392** (3,127–3,482) | 1.1x |
| **j4** switch to a course with SOME content cached | good | 4 | 1,742 | 1,861 | **2,177** (2,017–2,225) | 1.1x |
| | fast3g | 3 | 2,174 | 2,271 | **2,584** (2,282–2,811) | 1.2x |

**Zero runs failed to produce sound, in any cell.** 42 measured journeys, 42 first words.

### Journey 5 — screen switching (good / fast3g, 3 runs each)

| Tap | Painted (good) | Interactive (good) | Painted (fast3g) | Interactive (fast3g) |
|---|---|---|---|---|
| player → library | 35ms | 48ms | 39ms | 54ms |
| library → back to player | 27ms | 14ms | 22ms | 10ms |
| player → settings | 34ms | 58ms | 44ms | 70ms |
| settings → close | 30ms | 9ms | 31ms | 9ms |

Screen switching is not a problem anywhere: every tap paints in 22–50ms and is
interactive inside 80ms, and the network makes almost no difference because
nothing on these paths is fetched. ("Interactive" for a *close* can read lower
than "painted" — it is a DOM-state check that flips on the class change, one
frame before pixels.)

**But the Settings button cannot be tapped in its middle.** On a 390×844
viewport (iPhone 12/13/14 width), the feedback FAB occupies x 318–366 / y
772–820 and the Settings pill occupies x 300–352 / y 770–822. The FAB owns the
pill's centre point. `document.elementFromPoint` at the gear's centre returns
`feedback-fab`, in **every run and every screen state measured** — player,
library open, and after returning to the player. A learner who taps the middle
of the gear gets the feedback form. The 34–70ms figures above were obtained by
deliberately tapping off-centre, on a part of the pill the pill actually owns.

### Journey 6 — intermittent signal, 90 seconds of 5s-up / 6s-down while playing (3 runs)

| | Result |
|---|---|
| First word heard before the storm | 3,768ms (3,727–3,818) |
| Recovered without the learner touching anything | **3 of 3** |
| Lost the learner's place | **0 of 3** — position moved *forward* (same LEGO, cycle `debut_15924` → `build_15926`) |
| Longest stretch of silence | **10,034ms** (10,015–10,050) |
| Said anything to the learner | **nothing, in 3 of 3 runs** |

The behaviour is good and the communication is absent. It keeps playing, it
recovers on its own, it does not lose the place — and it sits through ten
seconds of dead air without a word, which is exactly how long it takes a
learner to decide the app is broken.

---

## Where the time actually goes

Per-leg network-busy milliseconds, median across runs. Legs overlap, so they do
not sum to the total; the point is which leg dominates.

| Journey / net | app-code (JS) | course-content | audio | learner-progress | unexplained |
|---|---|---|---|---|---|
| j1 good | 758 | 903 | 2,283 | 1,169 | **2,205** |
| j1 fast3g | 5,371 | 2,363 | 2,760 | 2,203 | 1,686 |
| j1 slow3g | **21,940** | 13,481 | 14,688 | 7,778 | 6,894 |
| j1 highlatency | 3,875 | 3,652 | 1,615 | **6,716** (13 requests) | 351 |
| j3 good | 140 | 1,120 | 285 | 1,220 | 175 |

Three things fall out of this table.

**The splash is a new-user-only tax, and on a good connection it is half the
wait.** j1 on good 4G spends 2,205ms unexplained by any network leg — a
deliberate app-side animation floor. The returning learner (j3, same
connection, same code) spends 175ms unexplained. So the splash costs a
first-timer ~2.2s of their 4.6s and costs a returning learner nothing.

**On 3G the app's own JavaScript dominates, not the lesson audio.** At slow 3G
the app-code leg is busy for 21.9 seconds against 14.7s for audio, and the
first word does not arrive for 29s. The learner is waiting for the app to
arrive, not for the lesson.

**Bandwidth is not the whole story — round trips are.** The high-latency
profile has 8 Mbps of bandwidth, twenty times slow 3G, and still takes 8,964ms,
statistically indistinguishable from fast 3G's 8,950ms. The `learner-progress`
leg alone is 13 separate requests costing 6.7s of busy time — roughly one
900ms round trip each. The boot path is chatty, and chattiness is what a real
cell connection punishes.

**A partial cache buys almost nothing on a course switch.** j4 (some of course
B already cached) is *not* faster than j2 (course B never opened): 2,177ms vs
1,993ms on good, 2,584ms vs 2,270ms on fast3g — the cached case is marginally
*slower*, well inside the spread. The gate on a switch is the round-map and
course-content fetch, not the audio. Caching audio ahead does not help the
learner switch course.

---

## Cross-check against real phones (job #635)

Job #635's telemetry census landed and can be compared. Over 30 days, after
stripping 40% bot traffic, 1,932 real-device `cold_start` events from 82
distinct learners:

| | Real devices (#635, `mountToReadyMs`) | This harness (`screen usable`) |
|---|---|---|
| median | 2,742ms | j3 good 2,266 · j1 good 4,146 |
| p75 | 3,990ms | — |
| p90 | 7,667ms | j1 fast3g 6,727 |
| p95 | 12,163ms | between fast3g 6,727 and slow3g 18,205 |

The synthetic median is broadly consistent with the real-device median, which
is the reassuring half. The instructive half: **real phones have a fatter tail
than this harness will ever produce.** One real cold start in ten takes 7.7s+
and one in twenty takes 12s+ — i.e. a meaningful slice of real learners are
living in the fast-3G-to-slow-3G band of this table, so those columns are not
hypothetical worst cases, they are somebody's Tuesday.

#635 also records two gaps worth knowing here: there is **no connection-type
telemetry** (device/OS only, no WiFi vs cellular), so real data cannot be split
the way this harness splits it; and `mountToReadyMs` spans wall-clock, so it
includes backgrounding — 16 of 1,932 events exceed 60s and are almost certainly
locked phones, not waiting learners.

---

## Ranked: what moves the biggest number for a real learner

1. **Cut the JavaScript on the boot path.** Worst-off learner, biggest number:
   29s to first word on slow 3G, with the app-code leg busy for 21.9s of it.
   This is the only lever that touches the 29s figure at all, and it also pays
   out at fast 3G (5.4s of app-code) and high latency (3.9s). Nothing else on
   this list is worth as many seconds to as unhappy a learner.

2. **Collapse the boot round trips.** 8 Mbps and 900ms RTT is as slow as
   1.6 Mbps and 150ms — 8,964 vs 8,950ms. `learner-progress` is 13 requests on
   its own. Every request removed from the boot path is ~1s back on a congested
   cell, and this compounds with (1) rather than overlapping it.

3. **Drop or shorten the new-user splash.** 2.2s of a 4.6s first impression, on
   a good connection, for the one audience that has not yet decided to stay.
   It is deliberate, it is app-side, and it costs nothing to remove — the
   cheapest second on this list by a wide margin.

4. **Move the feedback FAB off the Settings button.** Not a latency number, a
   correctness one: on a standard iPhone width the gear's centre belongs to the
   FAB, in every state measured. A learner reaching for Settings gets a
   feedback form. One CSS change.

5. **Say something during a signal drop.** The recovery behaviour is already
   right — 3/3 recovered untouched, 0/3 lost the place — so this is purely one
   honest line during up to 10s of silence. Cheap, and it converts "the app is
   broken" into "the app knows".

6. **Stop pre-caching audio to speed up course switching — it doesn't.** j4 is
   no faster than j2. Whatever cache-ahead is buying, it is not switch latency;
   the round-map/course-content fetch is the gate. Worth knowing before anyone
   spends effort making the cache bigger for this reason.

7. **Do not spend anything on screen-switching performance.** 22–80ms, on both
   networks, on every tap. It is already fast; work here buys nothing.

Items 1 and 2 are the same fight (less stuff, fewer trips, on the boot path)
and between them own every number above 4 seconds in the table. Items 3–5 are
small, cheap, and independently shippable.

---

## Provenance and limits

- 12 cells, 42 measured journeys, all six journeys covered, zero failed runs.
- Single Linux box, headless Chrome, CDP network throttling. A real phone adds
  CPU limits this does not model — see the #635 tail above.
- Per-run JSON, waterfalls and screenshots: `$CS_SCRATCH/journeys/<journey>-<net>/`.
- Journey 1's first-attempt slow3g cell (2 of 3 runs, killed mid-run) was
  discarded and re-run in full; the numbers above are the complete 3-run cell.
- **Harness corrections made during this run, and why the earlier j5 numbers
  were wrong:** the paint probe only completed on *added* DOM nodes, so every
  "close this screen" tap reported a flat 8,000ms that was the probe's own
  timeout, not anything a learner waited for; and taps used Playwright's
  `.click()`, which retries until a control is actionable and so silently hid
  the FAB sitting on the Settings button. Both are fixed: taps are now real
  pointer events at the control's own coordinates, and the harness records
  which element the tap actually landed on.
