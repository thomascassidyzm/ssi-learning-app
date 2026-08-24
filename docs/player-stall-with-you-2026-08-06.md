# The "with you" stall — diagnosis and fix

**2026-08-06 · ssi-learning-app · branch `claude/player-never-stalls`**

## What Aran hit

German, at the item **"with you"**: playback hard-stopped and would not restart.
Skipping **back** reproduced it every time. Only skipping **forward past it**
recovered. All practice for that item was lost.

The server was ruled out before I started: all three "with you" clips resolve
fast and correctly, and all 978 revised German clips carry correct versioned
refs. So this was a **client** stall.

## The code path that stops the session

`packages/player-vue/src/playback/SimplePlayer.ts:968` (and the matching lines
for voice1 at `:986` and voice2 at `:1005`, line numbers as on `origin/dev`
before the fix):

```ts
const gen = this.playGeneration
const url = await this.resolveUrl(currentCycle.known.audioUrl)   // <- unbounded
if (gen !== this.playGeneration || ...) return
this.playAudio(url)
```

`resolveUrl` calls the `resolveAudioUrl` runtime override. There is **no
timeout on that await, and no timer armed anywhere while it runs.** The engine's
stall watchdog (`armSafetyTimer`, 10s) is armed *inside* `playAudio` — i.e.
only *after* this await returns. So during the await the player has:

- `phase` set to `prompt` (or `voice1` / `voice2`)
- `isPlaying` true
- no `src` assigned, no audio element activity
- **not one timer running**

If that promise never settles, the session is dead where it stands. No error
fires, so nothing retries. No `ended` fires, so nothing advances. From
`PlayerConductor`'s seat this reads as a perfectly healthy `playing` state,
which is why the conductor's own bounded-exit discipline did not catch it —
the hole is one layer below it.

### Why it is that ONE item, forever

The override is live for **every learner** — `cachePlayOnline`
(`LearningPlayer.vue:3888`) is on unless the URL carries `?stream`. It resolves
through `resolveCachedPlaybackUrl` → `AudioCache.getWavBlobUrl`, which
**memoises its in-flight promise per audio id**:

```ts
// AudioCache.ts
const existing = this.wavUrlInflight.get(id)
if (existing) return existing            // <- the same promise, forever
```

The innermost await in that promise is `ctx.decodeAudioData` (`cache/wav.ts:97`),
the mp3→WAV re-encode. That is an unbounded WebKit primitive — it does not
reliably settle either way when the audio session is interrupted or the payload
upsets it.

Put those together and one non-settling decode **poisons exactly one audio id
permanently**:

| Action | What happens | Matches the report |
|---|---|---|
| Item plays | awaits the dead promise, nothing armed | hard stop |
| Press play / pause-resume | `resume()` → `startPhase('prompt')` → same id → same dead promise | "would not restart" |
| Skip **back** | `isPlaying` is still true, so `jumpToRound` replays; playing forward re-reaches the item → same dead promise | "reproduced it every time" |
| Skip **forward** past it | different audio id → fresh, healthy decode | "only skipping forward recovered" |
| Everything else in the course | untouched ids | one item, not a broken session |

That asymmetry is the fingerprint. A per-*session* failure would not skip-forward
away; a per-*network* failure would not be reproducible on one item. Only a
per-id memoised promise behaves like this.

This is the same disease the team already fixed one layer up: the hard fetch
timeout in `doFetchAndStore` was added for the "silent bulk-download freeze"
(founder stall, 2026-07-31), with the comment *"since it lives in the in-flight
de-dupe map every retry of the id gets the same dead promise"*. The fetch got
bounded. **The decode did not.**

## The second hard stop: retry-then-HALT

Independently, `tripPlayError` (old `SimplePlayer.ts:428`) **halted the whole
session** whenever a clip's silent retry also failed — pause, `isPlaying` false,
tap-to-retry chip. For a permanently-unplayable clip (a revoked blob URL, a
decode the device refuses) that is a reproducible hard stop on the same item on
every single replay. It directly contradicts both the standing ruling and the
suite's own existing test, which already asserts *"Learner experience must never
stall on a broken UUID / 404 / stall… now we log and advance."*

## The fix

The ruling — **the player plays what it has** — is now structural, not
aspirational. Four bounds:

1. **`resolveUrl()` is bounded** (`RESOLVE_URL_TIMEOUT_MS`, 4s). Past the
   ceiling we play the original network URL, which is always a valid resource.
   The override is documented as "must resolve cheaply (sub-ms)", so 4s is
   orders of magnitude of headroom.

2. **A phase watchdog** (`PHASE_START_TIMEOUT_MS`, 8s) covers the whole window
   from phase entry to the moment `playAudio` assigns a `src`. Nothing on that
   path — this await, the `ensureKnownReady` gate, or anything a future change
   adds — can outlive its bound. On fire it logs loudly, emits
   `audio_failed(attempt=2, lastError='phase-watchdog-resolve-hang')`, and
   advances through the normal `onAudioEnded` path. Cleared through the existing
   `clearSafetyTimer` chokepoint, so no teardown path can miss it.

3. **`skipFailedClip()` replaces the halt.** After the silent retry is burned,
   the clip is **skipped** and the session continues, logged loudly with the
   full cycle context. `audio_failed` telemetry keeps its exact shape so admin
   diagnostics carry on grouping on it. The one halt kept is `needs-gesture`:
   there the browser will play *nothing* until the learner taps, so skipping
   would burn the whole session in silence rather than lose one clip.

4. **`AudioCache.getWavBlobUrl` bounds its memoised read** (5s), so that promise
   *always* settles. On timeout it resolves `null` and the caller falls back to
   the network URL, exactly as for a plain cache miss. This closes the
   poisoned-memo class at source; the engine bounds above survive it regardless.

Also fixed alongside: `playAudio` reset its retry budget only when the URL
changed, so a clip replayed by spaced repetition or by `resume()` got **no
second chance** after an earlier failure. The budget is now per play attempt.

## Regression tests

`packages/player-vue/src/playback/SimplePlayer.test.ts`, describe
**"never stalls on one item (the ruling)"** — verified failing on `origin/dev`,
passing with the fix:

- a `resolveAudioUrl` promise that **never settles** cannot strand the phase —
  the network URL plays instead, and the session moves on to the next round;
- when **every** await on the path hangs, the phase watchdog fires, says so
  loudly, and skips the clip;
- a clip whose audio element **errors on every attempt** is skipped, not halted,
  with the attempt=1 / attempt=2 telemetry intact;
- `needs-gesture` still halts — skipping cannot help when the browser will play
  nothing.

One pre-existing test was corrected rather than weakened: it drove fake timers
with the *synchronous* `advanceTimersByTime`, so the microtask queue never
drained, `playAudio` never ran, and it was measuring a scenario the browser
cannot produce. Switched to `advanceTimersByTimeAsync`.

## Gates

`@ssi/core` build · `player-vue` typecheck · `player-vue` test (1561 passed,
3 skipped) · `player-vue` lint (**0 errors, 148 warnings — exactly the
`origin/dev` baseline**) · `typecheck:api` · `test:api` (978 passed).

## Explicit gaps

- **The exact reason WebKit's `decodeAudioData` failed to settle for that one
  clip is not proven from here** — it needs a device-side capture, and the
  browser gives no signal when it happens. What *is* proven is that the path had
  no bound, that a non-settling promise there produces precisely the reported
  symptoms including the skip-back/skip-forward asymmetry, and that it is the
  only path in the player that can. The fix does not depend on identifying the
  trigger: it bounds the wait regardless of cause.
- **Not verified live on a device.** The branch is pushed and the regression
  tests demonstrate the behaviour change; confirming on Aran's German session
  needs a deploy and a real replay.
- The `resolveAudioUrl` id regex (`/\/api\/audio\/([^?]+)/`) strips query
  strings, so a versioned ref carried as `?v=N` rather than the `.vN` path
  suffix would read stale bytes from IndexedDB. Production uses the `.vN` path
  form, so this is not the live bug — flagged as adjacent, not fixed here.
