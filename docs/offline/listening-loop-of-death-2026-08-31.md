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

## 5. The marker: "dijo" — and the root cause it exposed

Tom pinned the session himself: he came back online at the LEGO **"dijo"**
(he said). That is `S0084L01` — and **seed 84 is the Blue belt landing round**
(Blue = 80 seeds).

His telemetry resumes at 21:47:52 on exactly that LEGO, `S0084L01_debut`,
`cacheHit: false`. So the app had been **parked on "dijo" for the whole
thirteen-minute window, unable to sound it**, and played it the instant the
radio returned. The marker turns the hole in the timeline into a fact: the
loop was Blue belt's landing round, and *the belt skip put him there*.

Which is what Tom said it was: *"I skipped ahead to blue belt - perhaps belt
skip should NOT work when unexpected offline and no new LEGOS are available."*

### Why the belt was offered at all

The belt chips already drew themselves locked offline. The bug was one word in
the predicate behind them:

```ts
const hasPlayableCycle = cycles.some((c) => isCyclePlayableOffline(c, …))
```

`.some()` over the landing round — **one** cached cycle anywhere in it marked
the whole belt available. `S0084L01`'s spaced-repetition cycles draw on older
material that *was* on his phone, so Blue read green while "dijo" itself was
not there.

Now the question is asked of the cycles that **teach** the new LEGO
(`intro`/`debut`/`build`/`component_*`), and of **all** of them — a half-cached
debut is a LEGO you cannot be taught. No teaching cycles at all is also a no.
`roundTeachesOffline` in `playback/offlinePlayable.ts`, with his case as its
first test.

The **action** refuses too, not just the control: `handleSkipToBelt` is the one
funnel every belt move goes through, so a stale chip cannot start a jump into
content that isn't here. Backward jumps are never blocked — the ladder is
downloaded contiguously and retreating is how someone drowning gets relief.
Only the **wording** splits on how we came to be offline, as he asked:

> deliberate: *"Yellow belt isn't in your offline download — reconnect to add it."*
> unexpected: *"You're offline and yellow belt isn't on this device yet."*

## 6. Prefetch priority — one insertion, inside the existing sequence

Tom: *"we already had a sequence and a logic, but I do not think we included
the listening exercises early enough in the download ahead of time cache."*
Correct on both counts. There are two ordered lists; neither was replaced.

**(a) What the sequence was.** The rolling filler (`fillBuffer`) builds one
ordered missing-list and drains it front-to-back, so position *is* priority:

1. `collectSpanAudioIds(spanMs)` — every cycle clip in the whole rolling span ahead
2. `collectPodSpanAudioIds(spanMs)` — the next pod lap, **only if one falls inside the span**
3. `collectLayer1SpanAudioIds(spanMs)` — L1 cups due in that span

The deliberate download (`downloadForOffline`) had its own: all round clips to
the chosen depth, then `collectAuxiliaryAudioIds()` (commentary, pod pool, L1
pool, Core/All listening) — listening **last**.

**(b) Where listening sat, and where it sits now.** It was last in both, and in
the filler it was also *span-scoped* — so a learner who lost signal before
their first pod round had **no listening on the device at all**. It now sits
second, directly behind the first three rounds:

1. `collectHeadRoundsAudioIds(3)` — a few rounds, enough to start practising
2. **`collectPod1ListeningAudioIds()` — the entire pod 1**
3. the rest of the span's cycles
4. `collectPodSpanAudioIds` / `collectLayer1SpanAudioIds`, untouched

**(c) What got pushed later.** Only the **remainder of the rolling span's
cycles** — rounds 4..N ahead of the cursor. That is the right thing to yield:
the learner cannot reach them until the head rounds are played, and pod 1 is
bounded while the span tail grows with the course. Nothing was removed, and the
*set* of ids is unchanged in both paths, so totals, progress and "Ready ✓" mean
exactly what they meant.

### How big pod 1 actually is (measured 2026-09-01)

| | sentences | scenes | clips | audio | size (est. @32 kbps) |
|---|---|---|---|---|---|
| `spa_for_eng:pod-1` | 231 | 22 | **571** | **45.2 min** | **~10.3 MB** |
| `fra_for_eng:pod-1` | 231 | 22 | 573 | 44.7 min | ~10.2 MB |
| `pol_for_eng:pod-0` | 142 | 15 | 283 | 19.9 min | ~4.6 MB |
| scene 1 only (spa) | 4 | 1 | 12 | 1.0 min | ~0.2 MB |

**Pod 1 is the whole served pod, not its first scene.** `podSentences` is
already scoped to one `pod_id` by `resolveServedPod`. Scene 1 is four sentences
and one minute — nobody could "just loop through" that, which settles the
reading. Against a course of ~1,475 LEGOs, 571 clips is roughly 3% — genuinely
small, and it is 45 minutes of listening. Tom's judgement holds: cheap, and no
reason to be clever about it.

## 7. Verified offline after all three parts

Same rig, same genuinely-offline browser, dev deployment:

```
PASS — audio genuinely played online :: 693 clips        (was 144 — pod 1 arriving early)
PASS — navigator.onLine flipped false
[LearningPlayer] Belt skip to yellow refused — offline and its new LEGOs aren't on this device
PASS — no cycle got stuck repeating with genuine silence :: 30 genuine plays
PASS — no LISTENING-cycle stuck-loop-of-death
PASS — no sustained silent march :: max consecutive skips=0, failing cycleIds=0
PASS — audio kept genuinely sounding through the whole watch window
```

| | first measurement | after listening + engine + jump fixes | after the belt block |
|---|---|---|---|
| cycles selected that couldn't sound | 6 | 3 | **0** |
| longest silent march | 18 clips | 9 clips | **0** |
| genuine audio plays in 120s offline | 0 | 0 | **30** |
| clips warm after 90s online | 144 | 144 | **693** |

The residual silent march that survived the first three fixes is **gone** — and
it went for the reason Tom named rather than one I found: stop the belt skip
landing on content the device does not hold, and nothing downstream ever has to
cope with it. His diagnosis was the root cause.

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
