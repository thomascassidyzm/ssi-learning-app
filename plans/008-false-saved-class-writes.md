# Plan 008: Stop swallowing class-write errors (the "false Saved" class)

> **Executor instructions**: Follow step by step; run every verification command.
> Honor STOP conditions. Update `plans/README.md` when done.
>
> **Drift check (run first)**: `git diff --stat 5fb4a42f..HEAD -- packages/player-vue/src/composables/schools/useClassesData.ts`
> If it changed, re-read the three functions below before editing.

## Status

- **Priority**: P2
- **Effort**: S–M
- **Risk**: LOW (additive error propagation)
- **Depends on**: none
- **Category**: bug
- **Planned at**: commit `5fb4a42f`, 2026-07-17

## Why this matters

`CLAUDE.md`'s RLS doctrine rule 8 is explicit: "client code never swallows PostgREST
write errors (the false-'Saved' class)." Three functions in `useClassesData.ts`
violate it. `endClassSession` and `updateClassProgress` log the Supabase error and
return `void` — callers cannot tell saved from not-saved. `createClass` discards the
boolean result of `addClassTeacher` and then builds local state asserting the teacher
is lead regardless. When these writes fail (network, or future RLS tightening — the
exact scenario the doctrine warns about), the UI shows success while the class resumes
from a stale `last_lego_id` or the teacher↔class relationship row never exists, with
zero signal. This is the repo's documented past bug class recurring in the schools tier
it is actively selling ("teachers have zero tolerance for bugs").

## Current state

`packages/player-vue/src/composables/schools/useClassesData.ts`:

```ts
// :560-581  endClassSession returns void; error only logged
  async function endClassSession(sessionId, endLegoId, cyclesCompleted, durationSeconds): Promise<void> {
    try {
      const { error: err } = await client.from('class_sessions').update({...}).eq('id', sessionId)
      if (err) console.error('[ClassesData] Failed to end class session:', err)
    } catch (err) { console.error('[ClassesData] endClassSession error:', err) }
  }

// :762-773  updateClassProgress (writes classes.last_lego_id, the resume point) — same
  async function updateClassProgress(classId, lastLegoId): Promise<void> {
    try {
      const { error: err } = await client.from('classes').update({ last_lego_id: lastLegoId }).eq('id', classId)
      if (err) console.error('[ClassesData] Failed to update class progress:', err)
    } catch (err) { console.error('[ClassesData] updateClassProgress error:', err) }
  }

// :733-753  createClass discards addClassTeacher's boolean, then asserts teachers[] anyway
      await addClassTeacher(newClass.id, creatorUserId, { lead: true })   // returns boolean; ignored
      const classInfo: ClassInfo = {
        ...
        teachers: [{ user_id: newClass.teacher_user_id, is_lead: true }],  // assumes success
      }
```

`addClassTeacher` returns `boolean` (`false` on no-token / HTTP failure).
Test file (exists): `packages/player-vue/src/composables/schools/useClassesData.test.ts`.

## Commands you will need

| Purpose          | Command                                                       | Expected |
|------------------|--------------------------------------------------------------|----------|
| Install          | `pnpm install`                                                | exit 0   |
| Test this file   | `pnpm --filter player-vue test -- useClassesData`            | pass     |
| Player typecheck | `pnpm --filter player-vue typecheck`                         | exit 0   |
| Player tests     | `pnpm --filter player-vue test`                              | all pass |

## Scope

**In scope**:
- `packages/player-vue/src/composables/schools/useClassesData.ts` — the three
  functions above: return success signals; propagate `addClassTeacher`'s result.
- `packages/player-vue/src/composables/schools/useClassesData.test.ts` — add tests.
- The **call sites** of these three functions, only enough to consume the new return
  value (surface a toast/error or set `error.value`) — find them with the grep in
  Step 3. Keep call-site changes minimal.

**Out of scope**:
- Changing what the writes *do* (the SQL/columns). Only surface failures.
- Retry/queue mechanisms — surfacing the error honestly is the fix; retry is a
  possible follow-up, not required here.
- Other composables (their own findings).

## Git workflow

- Branch: `advisor/008-false-saved-class-writes` from `dev`.
- Commit style: `fix(schools): surface class-write failures instead of swallowing them`.

## Steps

### Step 1: Make the two write functions return a success boolean

Change `endClassSession` and `updateClassProgress` to return `Promise<boolean>` —
`false` when `err` is set or the catch fires (keep the `console.error`), `true`
otherwise. Do not change the write payloads.

**Verify**: `pnpm --filter player-vue typecheck` — expect errors at call sites that
ignore the return; that's expected and fixed in Step 3.

### Step 2: Propagate addClassTeacher's result in createClass

Capture `const teacherLinked = await addClassTeacher(...)`. If `false`, set
`error.value` to a clear message and either omit the optimistic `teachers` entry or
flag the class as degraded (do not silently assert `is_lead: true`). Return the class
so the UI still shows it, but the error surface is now truthful.

**Verify**: `pnpm --filter player-vue typecheck` progresses (call-site errors remain).

### Step 3: Update call sites to consume the signals

Find them:
`grep -rn "endClassSession\|updateClassProgress" packages/player-vue/src --include=*.vue --include=*.ts`
At each call site, check the boolean and surface a non-blocking failure affordance
(a toast, or set an error ref the template already renders — match how neighboring
composable errors are surfaced in that view). Do not block the learner/teacher flow;
just stop lying about success.

**Verify**: `pnpm --filter player-vue typecheck` exits 0.

### Step 4: Tests

In `useClassesData.test.ts`:
- `endClassSession` / `updateClassProgress` return `false` when the mocked client
  returns an error, `true` on success.
- `createClass` sets `error.value` (and does not assert an unconditional lead teacher)
  when `addClassTeacher` resolves `false`.

Model on the existing tests in that file.

**Verify**: `pnpm --filter player-vue test -- useClassesData` passes.

### Step 5: Full suite green

**Verify**: `pnpm --filter player-vue test` all pass.

## Test plan

- New tests as in Step 4.
- Pattern: existing `useClassesData.test.ts`.
- Verification: full player suite passes.

## Done criteria

ALL must hold:

- [ ] `endClassSession` and `updateClassProgress` return `Promise<boolean>`.
- [ ] `createClass` consumes `addClassTeacher`'s result and surfaces failure.
- [ ] All call sites consume the new return values (no ignored booleans).
- [ ] New tests exist and pass; full player suite + typecheck pass.
- [ ] `plans/README.md` status row updated.

## STOP conditions

Stop and report if:
- A call site is in a context where surfacing an error is non-trivial (e.g. a
  fire-and-forget teardown with no UI) — report it rather than inventing a toast system.
- The three functions don't match the excerpts (drift).

## Maintenance notes

- This is one instance of a repo-wide anti-pattern (`grep -rn "console.error.*Failed"
  packages/player-vue/src/composables/schools`); a follow-up could sweep the other
  composables, but this plan is scoped to the three confirmed class-write offenders.
- Reviewer: confirm no swallowed-write path remains in these three functions.
