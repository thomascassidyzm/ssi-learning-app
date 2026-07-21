# Plan 013: Fix three latent playback/cache defects (clearCourse, WAV-URL dedupe, safety timer)

> **Executor instructions**: Follow step by step; run every verification command.
> Honor STOP conditions. Update `plans/README.md` when done. These three fixes are
> independent — you may commit each separately.
>
> **Drift check (run first)**:
> `git diff --stat 5fb4a42f..HEAD -- packages/player-vue/src/cache/AudioCache.ts packages/player-vue/src/playback/SimplePlayer.ts`
> If either changed, re-read the excerpts before editing.

## Status

- **Priority**: P3
- **Effort**: S (each)
- **Risk**: LOW
- **Depends on**: none (coordinate SimplePlayer.ts drift with plans 005/006)
- **Category**: bug
- **Planned at**: commit `5fb4a42f`, 2026-07-17

## Why this matters

Three cheap correctness/hygiene defects in the offline playback stack:
- **A. `clearCourse` can never delete anything.** Every cached row is written with
  `courseCode: null`, but `clearCourse` walks the `by-course` index with
  `IDBKeyRange.only(courseCode)` — it matches zero rows by construction. The moment any
  "remove this course's downloads" UI calls the documented API, it silently no-ops and
  tells the user storage was cleared.
- **B. `getWavBlobUrl` has no in-flight dedupe.** Two concurrent calls for the same id
  (prefetch racing playback) both decode mp3→WAV and the second `set` overwrites the
  first object URL without `revokeObjectURL` — duplicate decodes on the playback
  critical path and a slow blob-URL leak.
- **C. The 10s safety timer force-advances long clips.** A fixed `10_000`ms timer,
  never rescheduled from the clip's real duration, fires `onAudioEnded()` on any clip
  that legitimately plays longer than 10s (listening intros/outros, slow-rate
  playback) — cutting audio mid-play and advancing the phase machine, the "silently
  advancing lies to the learner" failure the surrounding code exists to prevent.

## Current state

**A — `packages/player-vue/src/cache/AudioCache.ts`**:
```ts
// :229-241  every row stored with courseCode: null
    const row: AudioRow = { id, blob, mimeType: ..., size: blob.size,
      lifecycle: opts.lifecycle, courseCode: null, cachedAt: now, lastAccessedAt: now,
      ephemeralOwnerLegoId: opts.ephemeralOwnerLegoId }
// :491-507  clearCourse walks by-course index → matches nothing
  async clearCourse(courseCode: string): Promise<void> {
    ...
    let cursor = await idx.openCursor(IDBKeyRange.only(courseCode))
    while (cursor) { ...; await cursor.delete(); cursor = await cursor.continue() }
  }
```
The contract promising per-course clearing is in `cache/AudioCache.types.ts` (~:193).

**B — same file**:
```ts
// :407-419  no in-flight map (contrast the fetch path which uses `inflight`)
  async getWavBlobUrl(id: AudioId): Promise<string | null> {
    const cached = this.wavUrlCache.get(id)
    if (cached) return cached
    await this.init(); if (!this.db) return null
    const row = await this.db.get(STORE, id); if (!row) return null
    const wav = await bytesToWavBlob(await row.blob.arrayBuffer()); if (!wav) return null
    const url = URL.createObjectURL(wav)
    this.wavUrlCache.set(id, url)   // <-- concurrent call overwrites without revoke
    return url
  }
```

**C — `packages/player-vue/src/playback/SimplePlayer.ts:1041-1046`**:
```ts
    this.safetyTimer = setTimeout(() => {
      if (gen !== this.playGeneration) return
      console.warn('[SimplePlayer] Safety timeout — audio ended event never fired, advancing')
      this.onAudioEnded()
    }, 10_000)   // <-- absolute, not derived from clip duration/playbackRate
```
`timeupdate`/`loadedmetadata` handlers are already attached elsewhere in the class
(the audio element is set up in the same file).

Test files: `packages/player-vue/src/cache/AudioCache.test.ts` (verify it exists;
create if not) and `packages/player-vue/src/playback/SimplePlayer.test.ts` (exists).

## Commands you will need

| Purpose          | Command                                             | Expected |
|------------------|----------------------------------------------------|----------|
| Install          | `pnpm install`                                       | exit 0   |
| Player typecheck | `pnpm --filter player-vue typecheck`               | exit 0   |
| Cache tests      | `pnpm --filter player-vue test -- AudioCache`      | pass     |
| Player tests     | `pnpm --filter player-vue test`                    | all pass |

## Scope

**In scope**:
- `packages/player-vue/src/cache/AudioCache.ts` — A and B.
- `packages/player-vue/src/cache/AudioCache.types.ts` — only if you thread `courseCode`
  through the store options for fix A.
- `packages/player-vue/src/playback/SimplePlayer.ts` — C (safety timer only).
- Callers of the cache store method that know the active course — only enough to pass
  `courseCode` through for fix A.
- Test files above.

**Out of scope**:
- Any other SimplePlayer behavior (plans 005/006 own their parts).
- Rewriting the offline eviction system — these are targeted fixes.

## Git workflow

- Branch: `advisor/013-audiocache-timer-hygiene` from `dev`.
- Commit style (one per fix is fine):
  `fix(cache): populate courseCode so clearCourse works`,
  `fix(cache): dedupe in-flight getWavBlobUrl decodes`,
  `fix(player): safety timer detects stalls, not long clips`.

## Steps

### Step 1 (Fix A): Populate courseCode, or remove the dead API

Preferred: add `courseCode` to the store options (`ensure`/`acquire`/`doFetchAndStore`
opts and the `AudioRow` write at `:236`), populated by callers that know the active
course. Then `clearCourse` works as documented. If threading the course code through
every caller is out of scope-sized, the acceptable fallback is to **delete
`clearCourse` and its contract entry** so no future caller trusts a silent no-op —
choose this only if the threading is genuinely large; prefer making it work.

**Verify**: an `AudioCache` test stores two rows under different course codes and
`clearCourse('X')` deletes only X's rows (add the test).

### Step 2 (Fix B): In-flight dedupe for getWavBlobUrl

Reuse the existing `inflight`-map pattern from the fetch path: store a
`Promise<string|null>` keyed by id; concurrent callers await the same promise; on
resolution cache the URL. Ensure a losing concurrent decode does not leak — with a
shared promise there is only one decode and one URL, which fixes the leak by
construction.

**Verify**: a test calling `getWavBlobUrl(id)` twice concurrently triggers
`bytesToWavBlob` once (spy) and returns the same URL both times.

### Step 3 (Fix C): Make the safety timer a stall detector

Change the timer from an absolute 10s play-deadline to a **stall** detector: reset the
deadline whenever `timeupdate` shows `currentTime` advancing (or compute the deadline
from `duration / playbackRate + margin` once `loadedmetadata` fires). A genuinely
stalled element (no progress for N seconds) still times out and advances; a healthy
long clip is no longer truncated. Keep the `gen !== this.playGeneration` guard.

**Verify**: a SimplePlayer test with a mock audio element whose `currentTime` keeps
advancing past 10s does NOT trigger `onAudioEnded` via the safety timer; one that
stalls (no `timeupdate`) still does.

### Step 4: Full suite green

**Verify**: `pnpm --filter player-vue typecheck` and `pnpm --filter player-vue test`
pass.

## Test plan

- Fix A: per-course store + `clearCourse` deletes only the target course's rows.
- Fix B: concurrent `getWavBlobUrl` → single decode, same URL, no leak.
- Fix C: advancing long clip not truncated; stalled clip still times out.
- Patterns: `AudioCache.test.ts` (create if absent, model on other cache tests),
  `SimplePlayer.test.ts`.

## Done criteria

ALL must hold:

- [ ] `clearCourse` deletes the target course's rows in a test (or the dead API +
      contract entry are removed).
- [ ] `getWavBlobUrl` decodes once under concurrency (spy-proven) and leaks no URL.
- [ ] The safety timer no longer truncates a clip that is actively progressing past
      10s (test-proven); stalled clips still advance.
- [ ] `pnpm --filter player-vue typecheck` and `test` pass.
- [ ] Only in-scope files changed.
- [ ] `plans/README.md` status row updated.

## STOP conditions

Stop and report if:
- Fix A's course-code threading touches more than ~6 call sites — report and take the
  "remove the dead API" fallback instead.
- Fix C reveals that listening/pod clips play on a **different** audio element than the
  one this timer guards (then those clips aren't affected and Fix C's risk is lower —
  note it, still convert the timer to a stall detector).
- The excerpts don't match (drift).

## Maintenance notes

- Fix C interacts with any future variable-playback-rate feature — a stall detector
  based on `timeupdate` progress is rate-agnostic, which is why it's preferred over a
  duration-derived deadline.
- Coordinate SimplePlayer.ts edits with plans 005 and 006 to avoid merge churn (all
  three touch this file in different methods).
