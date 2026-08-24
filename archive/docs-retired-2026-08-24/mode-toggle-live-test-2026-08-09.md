# Mode toggle (Easy ⇄ Fast) — live test on dev, 2026-08-09

**Status: NOT verified fixed.** Gates are green and the code is live on dev; the
claim that the toggle now genuinely changes playback is exactly what this test
decides. Nothing below asserts it works.

**Where to test:** https://ssi-learning-app-git-dev-zenjin.vercel.app
**Build that must be live:** `a0bb2b7` **or any hash committed after it** —
confirm at https://ssi-learning-app-git-dev-zenjin.vercel.app/version.json
before starting. `a0bb2b7` is the code under test; everything after it on dev
tonight is this document only, and each doc push rebuilds dev with a new hash,
so a later hash is expected and fine. An *earlier* hash means the deploy has
not caught up — wait and re-check rather than testing the wrong bundle.

---

## First: get a clean bundle

The service worker no longer force-updates in any environment (deliberate — a
force-update kills mid-flight cycle audio). So an already-open tab can still be
running last night's code.

- Close every open tab of the app, then open it fresh, **or**
- append `?reset=1` once for a full state wipe.

Then re-check `/version.json` reads `a0bb2b7`.

---

## Where the toggle lives

The **Easy / Fast** switch sits on the resting-state overlay, which is only
shown **when the player is paused**. So "mid-round switch" is this gesture:

> play into the middle of a round → **pause** → tap the other mode → **resume**

That is the real user gesture, and it is the one to test. There is no way to
change mode without pausing.

---

## Test 1 — Fast → Easy, mid-round

1. Start on **Fast**. Play until you are past the round's intro and the bare
   LEGO debut, i.e. well into the practice phrases — roughly 6–10 cycles in.
2. **Note the next two or three phrases you hear**, or better, note that you are
   hearing long ones.
3. Pause. Tap **Easy**. Resume.

**Pass looks like:** the phrases that play from here are noticeably **shorter**,
and the long ones you would have got are simply **not played at all**. Easy also
repeats more. The round does not restart, and you do not drop back to the intro.

**Fail looks like:** the same phrases still play, just slower / with longer
pauses. Timing changing while content stays identical is precisely the old bug —
timing was always read live; content was the broken lever.

**Also a fail:** the round jumps back to its intro, goes silent, or the text on
screen names a phrase you never hear.

---

## Test 2 — Easy → Fast, mid-round

Same shape, opposite direction. From within a round on **Easy**: pause, tap
**Fast**, resume.

**Pass looks like:** the longer phrases come back immediately — Fast plays
everything, so you should hear material Easy had been holding out, within the
same round, without a restart.

**Fail looks like:** you stay on the short Easy set. That would mean the toggle
only filters one way and cannot restore.

---

## Test 3 — the paused-display check (this is the subtle one)

While **paused** after a toggle, look at the phrase text on screen before you
resume. It must be a phrase the newly-selected mode will actually play. If the
screen shows one phrase and resuming plays a different one, that is a
text/audio mismatch and is a hard fail regardless of everything else — report it
immediately.

---

## What to report back

For each of the three tests: pass / fail, and if fail, **what you heard versus
what was on screen**. "The timing changed but the words didn't" is the single
most useful sentence you can send, because it separates the two levers cleanly.

---

## What is actually on dev (for the record)

Three commits, all merged and deployed:

- `e2c09131` — mode cycle-selection moved out of script generation and into
  live player logic (`playback/modeCycleSelection.ts`). One neutral cached
  script, two live selections over it; a toggle never touches any cache.
- `d696ee8a` — a round now opens on the first cycle the active mode actually
  plays. `advanceRound()` used to set position 0 literally and `jumpToRound()`
  merely clamped, so a round could open on a cycle the mode had said to skip.
  This is Tom's own hypothesis — a cached POSITION is not a live PLAY SEQUENCE —
  and a test written to his description failed against the old walker in four of
  five cases before the fix.
- `9c8353c5` — the selection memo was reading `cachedRounds`, a text/progress
  mirror whose cycle ids are minted in a different namespace from the ones the
  engine plays. It matched nothing, so the selection lever was inert from a few
  seconds into every session. It now reads the engine's own queue.

The third one is why the earlier commits alone did not fix the symptom: the
architecture was right and still nothing changed, because the lever was
answering about ids that were never played.

**Known gap, not fixed:** `SimplePlayer.progress` still counts array slots
rather than cycles the mode plays — display and telemetry only, no effect on
what you hear.

## Gates (run against `a0bb2b7`, all green)

| Gate | Result |
|---|---|
| `player-vue typecheck` | pass |
| `player-vue test` | 2045 passed, 3 skipped |
| `player-vue lint` | 0 errors (150 pre-existing warnings) |
| `typecheck:api` | pass |
| `test:api` | 1172 passed |
