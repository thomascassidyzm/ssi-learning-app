# Prod triage: can learners play after c1b613f?

**2026-08-20, 03:10 UTC.**

## Verdict

**Yes. Learners can play saysomethingin.app right now.** The 02:51 alarm was
false. Nothing was reverted, and nothing needed to be.

The alert named `c1b613f` as the culprit. That commit changes one file —
`apml/interfaces/insight-engine.apml`, +16/−5. It is documentation. There is
no shipped code in it, so reverting it would have produced a byte-identical
app and restored nothing. The sentinel named it only because it is the SHA
that opened the watch window; the sentinel watches the window, not the diff.

## The evidence

I drove production in a real headless browser, against the exact build that
is live (`version.json` → `c1b613f`), and clicked the actual play control:

| | |
|---|---|
| Session clock | **0:00 → 0:06 → 0:30 → 0:35** — playback genuinely running |
| Audio files fetched | **219**, every one a 200 |
| Telemetry to `/api/player-events` | **five 2xx posts** |
| JS errors | **zero** |
| On screen at 0:30 | `LISTEN CAREFULLY / to speak` — a live cycle, not the landing page |

A screenshot at 0:30 shows the player mid-cycle with the transport running and
the stop button lit. The five cheap HTTP probes are all green too: app shell
200, `/api/sw-config` 200, `/api/courses/available` 200, `OPTIONS
/api/player-events` 200.

## What actually went wrong: the probe has never worked

The failing report was `jsErrors: []`, `telemetryPosts: []`, screen still on
the landing state. That combination — no errors *and* no telemetry attempts —
pointed at "playback never started" rather than "the app is broken", and that
is exactly what it was.

I instrumented the sentinel's own probe. Of its five selectors:

- `button:has-text("Ready when you are")` → **0 matches**
- `.play-button` → **0 matches**
- `button[aria-label*="lay"]` → **0 matches**
- `.player-start` → **0 matches**
- `text=Ready when you are` → 1 match — and it resolves to
  **`<p class="hero-known">`**, the hero prompt *paragraph*. Not a control.

Clicking a paragraph times out, and the probe swallowed that with
`.catch(() => {})`. It then sat on the landing screen for its full 35-second
wait. The DOM never changed. **It has never started playback on any run it has
ever made.**

So how did it ever pass? The page itself posts a telemetry batch on load,
without any playback at all. If that flush landed inside the 35-second window,
the probe scored a pass. The verdict was a race, not a test. Last night, at
the quietest hour of the night, the race lost — and the probe paged you.

The giveaway is in the sentinel's own log: the `screen` text quoted in the
alarm as evidence of a stuck app is **character-for-character identical** to
the `screen` text in every passing run going back through the log. It was
never diagnostic.

## What I changed

The probe is now an honest test of the learner loop. It clicks `.center-btn`,
the real transport control; it records a refused click instead of discarding
it; it asserts playback **started** by requiring the session clock to advance,
rather than inferring health from a page-load artefact; and it sets
`--autoplay-policy=no-user-gesture-required` so headless audio policy cannot
manufacture a failure.

It now returns a three-way verdict, and the sentinel acts on the difference:

- **healthy** — playback ran, loop intact.
- **broken** — genuinely failing for learners. *The only verdict that alerts.*
- **inconclusive** — the probe could not drive the UI. That is a fact about
  the probe, not about learners, so it is logged and carried into the window
  summary rather than waking anyone. The crater-confirmation wording no longer
  claims a play-through "ALSO failed" when it merely could not start.

The fixed probe passes against live production: `verdict: healthy`, timer
0:00 → 0:35, 218 audio fetches, six 2xx telemetry posts, exit 0.

**The sentinel is left armed.** I corrected the false record in its state file
and logged why. I did not turn the watchman off.

## Two things worth knowing

**The sentinel is running stale code.** Its checkout (`~/ssi-learning-app`) is
on `main` and **74 commits behind `origin/main`**, and it never pulls. So it
has been watching production with an old copy of itself for some time. I
patched the fixed probe directly into that checkout so it is honest tonight,
but the real fix — have it pull, or point the cron at a current checkout — is
a separate small job, and I have not done it.

**Traffic really was near-zero.** Production telemetry shows 1 event in the
last 2 hours and 18 in the last 6 — it is 3am in the UK. That is why volume
alone could not settle this, and it is exactly the small-N condition the play
probe exists to adjudicate. The play-through is the evidence here, not the
volume.

## A judgement I made, overrule in one word

The brief allowed for a case where playback fails only in headless Chromium.
It did not arise — playback works headless, with and without the autoplay
flag, so there was no such call to make. The judgement I did make: I treated
the sentinel's stale checkout as a finding to report rather than something to
fix on the spot, because pulling 74 commits into the machine that watches
production, at 3am, unattended, is not a thing to do casually.
