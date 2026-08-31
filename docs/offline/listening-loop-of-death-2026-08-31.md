# The listening loop of death — diagnosis and fix

**2026-08-31.** Tom, iPhone Safari, staging, `spa_for_eng`, airplane mode, skipping
belts until the new LEGOs ran out.

> "Aha - display comes up as TEXT for the next LEGO, but then when it realises it
> hasnt got it, it goes to the play what you have"
> "it should probably NOT try and play the listening exercises - its doing that now
> and its got stuck in a loop"
> "play what you have means play whatever cycles you have COMPLETELY and not keep
> fucking well trying to play listening exercises you havent got"
> "its stuck in a listening exercise loop of death now"

---

## 1. What the telemetry says — and what it cannot say

**The session.** `player_events`, learner `81987d60-…` (display_name "Tom"),
session `5a4b7ac1-6770-48d4-b7a4-d3cf07dc4856`, `course_code` `spa_for_eng`,
`env` staging, `client_version` `2f9f849`, `device_type` mobile, iPhone OS 18.7 /
Safari 26.6.

| Time (UTC) | Event |
|---|---|
| 21:19:45 | `cold_start`, `totalMs` 9799, `returnUser` false; 3 × `bundle_boot_path`, all `outcome: bundle` |
| 21:34:14 | `tap_pause`, `legoId` S0004L01, `roundNumber` 11 |
| **21:34:14 → 21:47:52** | **nothing at all — 13m38s inside a live session** |
| 21:47:52 | `audio_play` resumes at **S0084L01**, `cacheHit: false` |
| 21:47:52 → | normal play continues; builds, then spaced-rep back through S0083/S0082/S0079/S0078 |

The jump from S0004 to S0084 is the belt-skipping run. The hole either side of it
is the airplane-mode window.

**What the hole proves, honestly.** It pins the window and the session. It does
**not** prove the silence, and I will not claim it does:

```ts
// packages/player-vue/src/composables/usePlayerLog.ts
if (isOfflineish()) {
  buffer.length = 0
  return
}
```

Player telemetry **drops its whole buffer while offline, by design** ("better than
retrying forever and risking memory bloat"). So an offline fault is *structurally
invisible* to `player_events` — an absence of events is exactly what you get
whether the app played nothing or played everything. **The silence in the loop is
Tom's own report, not a telemetry finding.** That is the honest division.

> **Gap, stated plainly:** the loop's iteration count could not be measured from
> the live DB, because no telemetry surface can witness an offline session. This
> is itself a finding — see §5.

---

## 2. The loop, established in code

Three facts compose into it.

**(a) Listening laps never met the offline availability gate.** The main cycle
walker has run through `isCyclePlayableOffline` since 2026-08-15
(`playback/offlinePlayable.ts`, fails closed on blank/uncached URLs). Pod laps and
Layer-1 listening cups do not go through the walker. A lap was assembled from
**position alone** — which cup the 30-slot wheel is on, which pod the ratchet is
at — with no cache check anywhere in the path.

**(b) A failed play was indistinguishable from a completed one.** `playPodSegment`
built `/api/audio/<id>` and played it. Offline that request fails. The audio
element's `error` handler in `RealAudioController` called `_notifyEnded()` — there
was no error channel at all — so the lap's ended handler resolved
`{ ok: true, reason: 'natural' }`. The old comment says so outright: *"we can't
tell them apart from here."* Every dead play therefore counted as a real play,
instantly. The lap "completed". `markLapCompleted()` ratcheted forward.

**(c) Layer-1 fires at every clean non-pod boundary.** So the sequence is: round
ends → pour a cup → every play fails instantly and silently → lap reports
complete → `simplePlayer.resume()` → round ends → pour the next cup → … The
retried condition (the clip arriving over a switched-off radio) can never become
satisfiable, and nothing in the path ever asks whether it could.

Tom's "display comes up as TEXT … then when it realises it hasnt got it" is the
same fault seen from the front: `currentPodPlay.value = play` is set *before* the
audio call, deliberately, so the visual and the sound agree — which is right when
there is a sound, and is exactly how a phrase that can never sound gets its text
on screen anyway.

---

## 3. The fix — selection is where availability is decided

Branch `fix/offline-listening-loop-of-death-2026-08-31`, commit `916bc875`, off `dev`.

1. **`filterLapToDeviceAudio`** (`playback/offlinePlayable.ts`) reduces a lap to
   the sentences this device can sound **completely**, or returns `null`. The unit
   is the **sentence**, not the play: a pod sentence sounds as a four-slot
   sandwich (target · known · target · target), and a half-cached sandwich is a
   broken exercise, not a degraded one. Blank and absent ids fail closed, like
   everything else in that file.
2. **`lapPlayableNow`** gates **both** listening surfaces before anything else
   happens — before the pause, before the display, before a single request. `null`
   means the exercise is not fired at all: no text on screen for a phrase that can
   never sound. The course simply carries on with what *is* cached.
3. **`playPodSegment` refuses outright** to request a clip that isn't on the
   device while offline. This makes *"there is no path that retries an unavailable
   asset"* true of the playback primitive itself, not merely of its callers. It
   also removes the 30-second safety timeout per dead play.
4. **`RealAudioController` gains an error channel** (`onError` / `offError` /
   `_notifyError`), announced immediately **before** the ended notification.
   Cycles are unaffected — an error still ends the play, the cycle still moves —
   but a lap can now tell a sound from a silence, so a lap of dead clips can no
   longer report itself complete and ratchet forward.
5. **When offline playback genuinely has nothing left, the learner is told**, in
   plain words, on every path that previously went quiet or showed a paused
   summary: *"We can't reach anything to play right now, and there's nothing saved
   on this device for this course yet. As soon as we can reach the internet again,
   this will pick up right where you left off."* Dismissible, once per session,
   gates nothing.
6. **`listening_skipped_offline`** is emitted on every skip — with its own limited
   reach documented at the call site, per §1.

**Gates:** 267 test files / 2754 tests green · `vue-tsc` clean · 0 lint errors ·
production build succeeds (512 SW precache entries). 8 new unit cases pin the
selection rule, including "bookends cached but no sentences ⇒ null" and
"half-cached sandwich is dropped whole".

---

## 4. Verified offline, on the deployed build

Not a mock. Playwright drives Chromium and `context.setOffline(true)` is CDP
`Network.emulateNetworkConditions(offline: true)` — real network-layer
disconnection, with the app's own service worker and IndexedDB still serving
exactly as they would on a phone in airplane mode. Probe:
`packages/player-vue/e2e/offline-listening-loop-repro.mjs` (written by worker
#564, which first caught the silent march on the unfixed build).

Scenario each run: boot online, warm ~90s of real audio, go genuinely offline,
belt-skip 25 taps forward past the cached edge, then watch 120s.

**On staging, after the fix:**

```
PASS — audio genuinely played online (real warm cache) :: 144 clips
PASS — navigator.onLine flipped false
PASS — forward belt-skip taps landed :: 25 taps
[LearningPlayer] Listening lap has no audio on this device — skipping the exercise entirely (offline)
[LearningPlayer] L1 cup 22 skipped — its audio isn't on this device
[LearningPlayer] Listening lap trimmed to what's on this device: 8/36 plays
[SimplePlayer] Offline and this clip is not on the device — skipping it without touching the network.
PASS — no LISTENING-cycle stuck-loop-of-death
```

| | before | after |
|---|---|---|
| listening laps selected without their audio | yes — every clean boundary, forever | **none; excluded at selection** |
| `Retrying audio (attempt 2/2)` over a dead network | on every failed clip | **none** |
| cycles selected that could not sound | 6 | 3 |
| longest silent march (app's own alarm) | 18 clips | 9 clips |

The loop Tom hit is closed: no listening exercise is ever selected without its
audio, and no path retries an unavailable asset.

## 5. What is NOT fixed — stated plainly

**The session can still go silent offline, for a different reason.** Three
cycles still get selected whose audio is not on the device:
`S0299L02_infsr_R6_1`, `S0299L02_infsr_R11_1`, `S0298L01_infsr_R16_1`. They are
`infsr` cycles — INF PLAY revival rounds, built locally from course data after
the belt-skip ran past the cached edge. In the 120s watch the pane sits on one
phrase with nothing audible.

They are now skipped without touching the network, so the retry storm and the
30s timeouts are gone, and the count fell from six cycles to three and from
eighteen consecutive silent clips to nine. But they should never have been
*selected*, and that is still Tom's rule unmet.

What the measurement says so far: the audio cache holds **103 real clips, all
`lifecycle: persistent`, none zero-byte, ~3.1 MB** (read straight out of
IndexedDB in the offline browser). Those three cycles are at seeds 298-299, far
outside the warmed range — so `audioCache.persistent.has(id)` should answer
FALSE and the cull should drop them. It does not, and the engine's
"all cycles skipped by the runtime cull" log never appears. I have not isolated
why. Worker **#592** is measuring it directly; I will not guess at it here.

---

## 6. Better × Simpler × Cheaper

- **Better** — the failure mode it removes is the worst class in the app: a
  learner who cannot escape. It also deletes the silent-lap-counts-as-completed
  bug, which was quietly ratcheting listening progress the learner never heard.
- **Simpler** — one rule, applied at one place, matching the rule the cycle walker
  already obeys. No new state, no mode branch, no retry policy. The 30s-timeout
  path is deleted rather than tuned.
- **Cheaper** — strictly fewer network requests (it refuses doomed ones), strictly
  less wall-clock spent in timeouts, no new storage, no new signal without a
  consumer.

---

## 7. Open, for Tom

**Offline telemetry is dropped, so offline faults are invisible.** This one had to
be reconstructed from a hole in a timeline plus Tom's testimony. A durable offline
event queue (persist to IndexedDB, replay on reconnect, keep `occurred_at`) would
have handed us the iteration count directly. It is its own piece of work with its
own design questions — replay trust, storage bounds, and what a backfilled
`occurred_at` means for every dashboard that reads the table. Not done here.
