# Plan 005: Guard stale awaited plays in SimplePlayer — the audio/text desync race

> **Executor instructions**: Follow step by step; run every verification command.
> Honor STOP conditions. Update `plans/README.md` when done.
>
> **Drift check (run first)**: `git diff --stat 5fb4a42f..HEAD -- packages/player-vue/src/playback/SimplePlayer.ts`
> If it changed, compare the "Current state" excerpts against the live code first.

## Status

- **Priority**: P1
- **Effort**: S
- **Risk**: LOW (the guard only suppresses plays that are already wrong)
- **Depends on**: none
- **Category**: bug
- **Planned at**: commit `5fb4a42f`, 2026-07-17

## Why this matters

`CLAUDE.md` declares audio/text desync unacceptable: "teaching the wrong thing is
worse than teaching nothing." In `SimplePlayer.startPhase`, three phase branches
`await this.resolveUrl(...)` and then call `playAudio(...)` with **no staleness
check** after the await. `resolveUrl` (offline/cache path) does an IndexedDB read +
mp3→WAV re-encode — tens to hundreds of ms, not sub-ms. If the learner taps
skip/stepCycle/jumpToRound (or a round boundary fires) while that await is pending,
the superseded continuation still plays the **old** cycle's clip while the UI already
shows the **new** cycle's text — the exact desync the app must never produce. The
neighboring buffering branch already guards this class of race; these three don't.

## Current state

`packages/player-vue/src/playback/SimplePlayer.ts` — `startPhase`, the `prompt`,
`voice1`, and `voice2` branches. The buffering path (lines 869-873) shows the authors
already know to re-check after an await:

```ts
// :869-875  (prompt branch)
            // Bail if we were stopped, skipped, or moved on during the
            // wait. Anything that changes phase away from 'buffering'
            // or pauses playback supersedes this branch.
            if (this.state.phase !== 'buffering' || !this.state.isPlaying) return
            this.updateState({ phase: 'prompt' })
          }
          this.playAudio(await this.resolveUrl(currentCycle.known.audioUrl))   // <-- no guard after THIS await
```

```ts
// :887-888  (voice1 branch)
        if (currentCycle?.target?.voice1Url) {
          this.playAudio(await this.resolveUrl(currentCycle.target.voice1Url), true)  // <-- no guard
```

```ts
// :901-902  (voice2 branch)
        if (currentCycle?.target?.voice2Url) {
          this.playAudio(await this.resolveUrl(currentCycle.target.voice2Url), true)  // <-- no guard
```

Relevant existing mechanism: `playAudio` already reads/bumps `this.playGeneration`
(a monotonic counter used elsewhere — e.g. the safety timer at `:1041-1046` checks
`gen !== this.playGeneration`). This is the staleness signal to snapshot.

Test file to extend: `packages/player-vue/src/playback/SimplePlayer.test.ts` (exists).

## Commands you will need

| Purpose          | Command                                                        | Expected |
|------------------|---------------------------------------------------------------|----------|
| Install          | `pnpm install`                                                 | exit 0   |
| Player typecheck | `pnpm --filter player-vue typecheck`                          | exit 0   |
| This test file   | `pnpm --filter player-vue test -- SimplePlayer`               | pass     |
| Player tests     | `pnpm --filter player-vue test`                               | all pass |

## Scope

**In scope**:
- `packages/player-vue/src/playback/SimplePlayer.ts` — add a staleness guard after
  each of the three `await this.resolveUrl(...)` calls in `startPhase`.
- `packages/player-vue/src/playback/SimplePlayer.test.ts` — add a regression test.

**Out of scope**:
- `playAudio`, `resolveUrl`, the safety timer, or any other method — do not change
  their signatures or behavior.
- `LearningPlayer.vue` — no change needed; this is contained in SimplePlayer.
- Plans 006 (`addRounds`) and 013 (safety timer) also touch this file; coordinate
  drift but do not do their work here.

## Git workflow

- Branch: `advisor/005-simpleplayer-resolveurl-race` from `dev`.
- Commit style: `fix(player): guard stale awaited plays in startPhase (audio/text desync)`.

## Steps

### Step 1: Snapshot the generation before each resolveUrl await

Immediately before each of the three `this.playAudio(await this.resolveUrl(...))`
calls, capture the current generation and cycle identity, await the resolve into a
local, then bail if anything moved. Target shape (apply to all three branches):

```ts
// prompt branch, replacing the bare line at :875
const gen = this.playGeneration
const url = await this.resolveUrl(currentCycle.known.audioUrl)
if (gen !== this.playGeneration || this.currentCycle !== currentCycle || !this.state.isPlaying) return
this.playAudio(url)
```

Use whatever the field is actually called (confirm `playGeneration` exists and is what
`playAudio`/the safety timer read — it is, per `:1043`). Use the same three-part check
in the `voice1` and `voice2` branches (preserving the `true` second arg to `playAudio`
there). Do **not** advance the phase machine on the bail — a superseded continuation
must simply stop; the newer play has already taken over.

**Verify**: `pnpm --filter player-vue typecheck` exits 0.

### Step 2: Add a regression test

In `SimplePlayer.test.ts`, add a test that:
1. Constructs a player with a **slow** `resolveUrl` (a resolver that returns a promise
   you resolve manually after triggering a jump).
2. Starts a phase (so `resolveUrl` is pending), then triggers a skip/jump that bumps
   the generation / changes `currentCycle`.
3. Resolves the slow `resolveUrl`.
4. Asserts `playAudio` was **not** called with the stale URL (spy on `playAudio` or on
   the audio element `src`).

Model setup on the existing tests in the same file.

**Verify**: `pnpm --filter player-vue test -- SimplePlayer` — new test passes, and it
**fails** if you revert the Step 1 guard (sanity-check by temporarily reverting).

### Step 3: Full player suite green

**Verify**: `pnpm --filter player-vue test` — all pass (562 prior + new).

## Test plan

- New test in `SimplePlayer.test.ts`: "does not play a stale cycle's audio when a
  jump occurs during resolveUrl". Optionally one per branch (prompt/voice1/voice2) if
  cheap; one covering the prompt path is the minimum.
- Structural pattern: existing SimplePlayer tests.
- Verification: `pnpm --filter player-vue test` all pass including the new test.

## Done criteria

ALL must hold:

- [ ] All three `await this.resolveUrl(...)` sites in `startPhase` have a
      generation+cycle+isPlaying guard before `playAudio`.
- [ ] `grep -n "await this.resolveUrl" packages/player-vue/src/playback/SimplePlayer.ts`
      shows each match preceded (within a few lines) by a `playGeneration` check.
- [ ] New regression test exists and passes; it fails when the guard is reverted.
- [ ] `pnpm --filter player-vue typecheck` and `pnpm --filter player-vue test` pass.
- [ ] Only the two in-scope files changed (`git status`).
- [ ] `plans/README.md` status row updated.

## STOP conditions

Stop and report if:
- There is no `playGeneration` (or equivalent monotonic play counter) field — the
  excerpt at `:1043` says there is; if the code has drifted and it's gone, report
  rather than inventing a new mechanism.
- Adding the guard makes existing SimplePlayer tests fail in a way that suggests some
  code path *relies* on the stale play firing (unexpected — report it).
- The three call sites don't match the excerpts (drift).

## Maintenance notes

- Any new `await` added inside `startPhase` (or any method that resolves a URL then
  plays) must carry the same generation guard — note this in the method's comment.
- Reviewer: confirm the bail does NOT advance the phase state machine (a superseded
  continuation should be inert, not trigger `onAudioEnded`).
