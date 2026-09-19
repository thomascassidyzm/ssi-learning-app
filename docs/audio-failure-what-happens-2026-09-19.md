# What happens to a clip that fails to play

*Written 19 September 2026 from the running code and the live `player_events`
rows, for Tom's question on the Working-now chart: "Relating to audio files not
playing — what happens to them? Are they retried later?" Nothing here comes
from a doc; every claim names the file and line that decides it.*

---

## The short answer

**One silent retry of the same URL, immediately. If that fails, the clip is
SKIPPED and the session carries on as though it had played. It is never queued
for another go.** The learner usually meets the same clip again later anyway,
because spaced repetition brings the cycle round — and on this build, when it
did come round, it failed again more often than not.

The learner is not told, except by a banner that says the wrong thing (below).

---

## 1. What the engine does, step by step

All of this is `packages/player-vue/src/playback/SimplePlayer.ts`.

1. **First failure** — `handleAudioFailure()` (line 828). If a retry URL
   exists and the device is not offline, it emits `audio_failed` with
   `attempt: 1` and calls `retryCurrentAudio()`. Nothing is shown, nothing
   pauses.
2. **The retry** — `retryCurrentAudio()` (line 873) re-assigns **the same
   URL** to the same `<audio>` element, calls `load()` and `play()`. There is
   no back-off: it is the very next tick. There is no second URL — no fall
   back from a dead IndexedDB blob to the `/api/audio/<id>` proxy, and no
   presigned-S3 attempt. Whatever `resolveCachedPlaybackUrl` chose for the
   first attempt is what the retry gets
   (`cache/resolvePlaybackUrl.ts`: cached WAV blob if the bytes are in
   IndexedDB, else the proxy URL).
   - If the retry **sounds**, it emits `audio_started` with `attempt: 2` — the
     learner did hear it, one attempt late.
   - If the retry **rejects**, or makes no progress for **10 seconds**
     (`safetyTimer`, line 912), the clip is skipped.
3. **The skip** — `skipFailedClip()` (line 928) emits `audio_failed` with
   `attempt: 2`, logs loudly to the console, and calls
   `advancePastUnheardClip()`, which is just `onAudioEnded()`. The phase
   machine moves on **exactly as if the clip had finished**. `isPlaying` is
   deliberately untouched: the standing ruling is that the player plays what
   it has, and a permanently-unplayable clip must not become a reproducible
   hard stop on the same item every replay.
4. **The retry budget is per play attempt, not per clip** (`playAudio()`,
   line ~1965: `this.retryAttempted = false` on every fresh play). So the next
   time that cycle comes round — spaced repetition, a resume, a replay — it
   gets a fresh two attempts.

**Two failure modes do NOT skip.**

- `needs-gesture` (`tripGestureRequired()`, line 774) — the browser's autoplay
  policy refused, typically iOS after a backgrounded tab lost its unlock. The
  session **pauses in place**; skipping would burn the whole session in
  silence, because nothing will play until the learner taps.
- `silent-run` (`haltSilentRun()`, line ~975) — **4 clips skipped in a row**
  (`CONSECUTIVE_SKIP_ALARM = 3`, `SILENT_RUN_STOP = 4`) and the player stops
  in place rather than advancing through silence. Three in a row logs a loud
  console error and keeps going.

There is also a **stall watchdog** on ordinary plays (`armSafetyTimer()`, line
2036): no `timeupdate` progress for 10 seconds and the clip is skipped with
`audio_failed`, `lastError: 'stall-watchdog-no-progress'`. It reschedules on
real progress, so a long clip is never truncated.

And **offline**: if the device is offline and the URL is not local,
`unavailableOffline()` short-circuits — no doomed retry, no ten-second timer,
straight to the skip (line 835 and `playAudio()`).

## 2. Does the learner ever hear that clip?

**Not in that moment — the engine never comes back to it.** There is no
deferred queue, no end-of-round sweep, no "play the ones we missed".

**But the cycle itself returns**, through ordinary spaced repetition, and the
retry budget is fresh when it does. On build `b12047e`, of the 32 distinct
(learner, cycle) pairs that failed, **28 had a later `audio_play` for the same
cycle** — so the material did come round. **22 of those 28 failed again.** So
for most of them the clip is not transiently unlucky, it is broken for that
learner on that device, and it fails every time it returns.

One honest caveat: `audio_play` is logged on phase ENTRY, not on sound coming
out, so a later `audio_play` proves the cycle was reached, not that it was
heard. That is the same limitation the stall watchdog's own comment names.

## 3. Is the failure visible to the learner?

**Yes, and the banner is wrong.** `useSimplePlayer.ts:200` sets
`audioFailed.value` on EVERY `audio_failed` event — including the `attempt: 1`
blip that is about to be silently retried and usually recovers.
`LearningPlayer.vue:18485` renders it as a button reading
**"Audio didn't load — tap to retry"**.

Two problems, both from reading the code rather than a report:

- It is **only cleared** by `play`, `resume`, `stop`, `stepCycle` and `jump`
  (`clearAudioFailed`, line 256) — never by a clip that subsequently played.
  So after a blip that recovered, or after a skip the session carried on
  through, the banner **stays on screen** while everything works.
- Tapping it calls `togglePlayback`, which while playing **pauses**. The
  banner offers a retry and delivers a pause.

`silent-run` shows `t('player.audioSilentRun')` and `needs-gesture` shows
"Paused — tap play to continue" — both of those are accurate, because in both
cases the player really has stopped.

*I have not changed this. It is a judgement about what the banner should say,
and part 3 of this job was read-only.*

## 4. What the 58 on `b12047e` actually are

The chart's number comes from `api/intel/working.ts`, which counts
`player_events` rows of type `audio_play` and `audio_failed` for **real
learners only**, machine countries dropped, over the window — so the 58 is a
subset of the raw rows.

`audio_failed` in that table is the **genuine post-retry failure only**.
`LearningPlayer.vue:3124` sends the `attempt: 1` blip to a different event,
`audio_retry`, precisely so transient blips do not inflate the rate. So every
one of the 58 is a clip a learner did not hear.

Raw, on `b12047e`: **76 `audio_failed`, 48 `audio_retry`, 22,659 `audio_play`.**

**It is several kinds, not one:**

| kind (`lastError`) | count | reading |
|---|---:|---|
| `The operation is not supported.` | 33 | the media element refused the source outright — a decode/codec refusal, all on mobile |
| *(no lastError)* | 20 | the `errorCode` path — a MediaError with no message |
| `stall-watchdog-no-progress` | 15 | 10 seconds with no playback progress, all on mobile |
| `Failed to load because no supported source was found.` | 8 | the fetch produced nothing playable — an empty or 404 body |

By device: **68 of the 76 are mobile**, and every "operation is not supported"
and every stall is. Desktop contributes 5 unlabelled and 3 no-supported-source.

Roles are spread across all three slots — 38 `known`, 27 `target1`,
11 `target2` — so it is not one voice or one phase.

## 4a. And ONE clip is half of it

Grouping the failures by `cycleId` makes the shape obvious. There are 19
distinct cycles in the 76 failures, and **exactly one of them hit more than
one person**:

**`S0006L01_intro` in `cym_s_for_eng` — "I can't" / "alla i ddim".**

- **35 of the 76 failures on `b12047e`**, across **14 different people**.
- Across every build in the window: **92 failures, 22 different people**,
  continuously from 12 Sep 06:30 to 18 Sep 19:14.
- It fails on the `known` slot and the `target1` slot of the intro cycle, with
  `Failed to load because no supported source was found.` and
  `The operation is not supported.`

Twenty-two different people on many different devices do not share a device
fault. **This is a bad clip in the course, on seed 6 of the south Welsh
course** — near the start, where new learners are. It is not on the fix list
for this job and nobody has raised it; it is the single biggest thing on this
chart and I would chase it next.

The other 18 cycles are one person each, which is consistent with device-level
decode failures.

## 5. What I could not determine

- Whether the 4 (learner, cycle) pairs that never returned simply stopped
  practising, or were dropped some other way.
- Why "the operation is not supported" is so concentrated on mobile. The
  payload carries no URL, so I cannot tell from telemetry alone whether those
  are dead IndexedDB blob URLs or proxy responses. Naming the URL kind
  (`blob:` vs `/api/audio`) in the `audio_failed` payload would answer it on
  the next occurrence, and is a one-line change.
- Whether any of these clips are bad in the course itself rather than on the
  device. Twenty-two repeat failures on the same cycle is the thread to pull:
  if they concentrate on particular `cycleId`s across DIFFERENT learners, the
  audio is bad; if each is one learner's own device, it is a device problem.
