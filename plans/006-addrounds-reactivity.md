# Plan 006: Fix `addRounds` silent roundIndex mutation (port the appendRounds fix)

> **Executor instructions**: Follow step by step; run every verification command.
> Honor STOP conditions. Update `plans/README.md` when done.
>
> **Drift check (run first)**: `git diff --stat 5fb4a42f..HEAD -- packages/player-vue/src/playback/SimplePlayer.ts`
> If it changed, compare the excerpts below against the live code first.

## Status

- **Priority**: P2
- **Effort**: S
- **Risk**: LOW (makes `addRounds` behave like the already-shipped `appendRounds`)
- **Depends on**: none
- **Category**: bug
- **Planned at**: commit `5fb4a42f`, 2026-07-17

## Why this matters

`SimplePlayer.addRounds` increments `this.state.roundIndex` **directly**, bypassing
`updateState()` and therefore the `state_changed` event. The sibling method
`appendRounds` carries an explicit comment that this exact direct-`++` "bypasses Vue
reactivity and the expansion-watcher chain never re-fires" and was fixed there —
`addRounds` was left with the bug. When a background-loaded batch inserts rounds
*before* the currently-playing round, the cursor shifts silently: persisted position,
progress UI, and the expansion-watcher chain read a stale `roundIndex` until some
unrelated state change. Resumed learners far from the loaded edge can stall or
mis-persist position.

## Current state

`packages/player-vue/src/playback/SimplePlayer.ts`.

The buggy method (`addRounds`, :476-493):

```ts
    for (const round of newRounds) {
      if (existingLegoIds.has(round.legoId)) continue
      const insertIndex = this.rounds.findIndex(r => r.legoId > round.legoId)
      if (insertIndex === -1) {
        this.rounds.push(round)
      } else {
        this.rounds.splice(insertIndex, 0, round)
        if (insertIndex <= this.state.roundIndex) {
          this.state.roundIndex++          // <-- direct mutation, no updateState
        }
      }
      existingLegoIds.add(round.legoId)
    }
```

The already-fixed sibling (`appendRounds`, :508-533) shows the correct pattern:

```ts
    let indexShift = 0
    for (const round of newRounds) {
      if (existingRoundNumbers.has(round.roundNumber)) continue
      const insertIndex = this.rounds.findIndex(r => r.roundNumber > round.roundNumber)
      if (insertIndex === -1) {
        this.rounds.push(round)
      } else {
        this.rounds.splice(insertIndex, 0, round)
        // Accumulate the shift; emit once at the end via updateState so
        // the state_changed event fires (otherwise direct ++ bypasses
        // Vue reactivity and the expansion-watcher chain never re-fires ...).
        if (insertIndex <= this.state.roundIndex + indexShift) {
          indexShift++
        }
      }
      existingRoundNumbers.add(round.roundNumber)
    }
    if (indexShift > 0) {
      this.updateState({ roundIndex: this.state.roundIndex + indexShift })
    }
```

`addRounds` is called from `LearningPlayer.vue:7999` and `:8059`.
Test file: `packages/player-vue/src/playback/SimplePlayer.test.ts`.

## Commands you will need

| Purpose          | Command                                          | Expected |
|------------------|--------------------------------------------------|----------|
| Install          | `pnpm install`                                    | exit 0   |
| This test file   | `pnpm --filter player-vue test -- SimplePlayer`   | pass     |
| Player typecheck | `pnpm --filter player-vue typecheck`              | exit 0   |
| Player tests     | `pnpm --filter player-vue test`                   | all pass |

## Scope

**In scope**:
- `packages/player-vue/src/playback/SimplePlayer.ts` — `addRounds` only.
- `packages/player-vue/src/playback/SimplePlayer.test.ts` — add a regression test.

**Out of scope**:
- `appendRounds` (already correct — do not touch).
- `LearningPlayer.vue` call sites — no change needed.
- Plan 005 and 013 also touch this file; do only the `addRounds` change here.

## Git workflow

- Branch: `advisor/006-addrounds-reactivity` from `dev`.
- Commit style: `fix(player): emit state_changed on addRounds cursor shift (port appendRounds fix)`.

## Steps

### Step 1: Port the indexShift pattern into addRounds

Replace the direct `this.state.roundIndex++` with the accumulate-then-`updateState`
pattern from `appendRounds`: track `let indexShift = 0`, compare against
`this.state.roundIndex + indexShift` inside the loop, increment `indexShift`, and after
the loop `if (indexShift > 0) this.updateState({ roundIndex: this.state.roundIndex + indexShift })`.
Keep `addRounds`'s legoId-based dedupe and insertion (do not switch it to roundNumber —
that difference is intentional per the `appendRounds` comment).

**Verify**: `pnpm --filter player-vue typecheck` exits 0;
`grep -n "this.state.roundIndex++" packages/player-vue/src/playback/SimplePlayer.ts`
returns **no** matches inside `addRounds`.

### Step 2: Add a regression test

In `SimplePlayer.test.ts`, add a test that:
1. Sets up a player positioned at some `roundIndex > 0`.
2. Registers a `state_changed` listener (or spies on it).
3. Calls `addRounds` with a batch whose legoIds sort **before** the current round.
4. Asserts `roundIndex` advanced by the number of rounds inserted before the cursor
   **and** that a `state_changed` event fired with the new index.

Model on existing SimplePlayer tests.

**Verify**: `pnpm --filter player-vue test -- SimplePlayer` — new test passes and
fails if Step 1 is reverted.

### Step 3: Full player suite green

**Verify**: `pnpm --filter player-vue test` — all pass.

## Test plan

- New test in `SimplePlayer.test.ts`: "addRounds inserting before the cursor emits
  state_changed with the shifted roundIndex".
- Verification: full player suite passes with the new test.

## Done criteria

ALL must hold:

- [ ] `addRounds` uses `indexShift` + a single `updateState` (no direct `roundIndex++`).
- [ ] New regression test exists, passes, and fails on revert.
- [ ] `pnpm --filter player-vue typecheck` and `pnpm --filter player-vue test` pass.
- [ ] Only the two in-scope files changed.
- [ ] `plans/README.md` status row updated.

## STOP conditions

Stop and report if:
- `addRounds` no longer matches the excerpt (drift), or `updateState`'s signature
  differs from `updateState({ roundIndex })`.
- Fixing this breaks a test that asserted the old (buggy) silent behavior — report it;
  such a test would itself be wrong.

## Maintenance notes

- Both `addRounds` and `appendRounds` now share the same invariant: never mutate
  `roundIndex` outside `updateState`. A reviewer of any future insertion method should
  enforce it.
