# Plan 019: Begin decomposing LearningPlayer.vue (17k lines) into composables

> **Executor instructions**: This is an L-effort, multi-PR effort. Do ONE extraction
> per pass, keeping the app green and behavior identical between passes. Run every
> verification command. Honor STOP conditions. Update `plans/README.md` when done with
> the first extraction (and note remaining extractions as follow-ups).
>
> **Drift check (run first)**: `git diff --stat 5fb4a42f..HEAD -- packages/player-vue/src/components/LearningPlayer.vue`
> This file changes ~2×/day — expect drift. Re-locate the target region by its content,
> not by line number, before extracting.

## Status

- **Priority**: P2 (chronic, not acute) — highest long-term leverage, highest risk
- **Effort**: L (incremental, many PRs)
- **Risk**: HIGH if done big-bang; LOW–MED per isolated extraction
- **Depends on**: 001 (a CI gate makes each extraction safe), 005/006/013 (finish the
  SimplePlayer bug fixes first so extractions don't collide with them)
- **Category**: tech-debt / architecture
- **Planned at**: commit `5fb4a42f`, 2026-07-17

## Why this matters

`packages/player-vue/src/components/LearningPlayer.vue` is **17,086 lines** — ~5× the
next-largest file — with 36 top-level `watch`/`watchEffect` and 84 `computed` in one
setup scope, and ~2 commits/day of churn. Multiple watchers consume the same reactive
state (e.g. `isPlaying` watched at three places thousands of lines apart) so a change in
one region can silently perturb another. It is the product's hottest file and its
dominant regression source by construction. Reviewability is near zero. This plan does
**not** rewrite it — it extracts self-contained regions into composables with explicit
inputs/outputs, one at a time, shrinking the orchestration surface without changing
behavior.

## Current state

- `packages/player-vue/src/components/LearningPlayer.vue` — 17,086 lines (verified).
- Visually separable regions the audit identified as extraction candidates (locate by
  content — line numbers WILL have drifted):
  - **Paywall + entitlements** watchers/handlers (audit cited ~1476-1525).
  - **Offline download picker** UI + logic (audit cited ~10184).
  - **Phase/timing cluster** (audit cited ~4851-4949) — but this is close to the
    playback core; treat as a LATER extraction, not the first.
  - **Rolling buffer** logic (audit cited ~9523-9527).
- The playback engine itself already lives outside this file in
  `packages/player-vue/src/playback/SimplePlayer.ts` — extractions should pull UI/glue
  into composables, not duplicate engine logic.
- Existing composables under `packages/player-vue/src/composables/` show the house
  pattern (a `useX()` returning refs + methods) — model extractions on them.

## Commands you will need

| Purpose          | Command                                          | Expected |
|------------------|--------------------------------------------------|----------|
| Install          | `pnpm install`                                    | exit 0   |
| Player typecheck | `pnpm --filter player-vue typecheck`             | exit 0   |
| Player tests     | `pnpm --filter player-vue test`                  | all pass |
| Line count       | `wc -l packages/player-vue/src/components/LearningPlayer.vue` | shrinks per pass |
| E2E smoke        | `pnpm --filter player-vue e2e:chromium` (if feasible) | pass |

## Scope

**In scope (per pass — pick ONE region)**:
- A new composable file `packages/player-vue/src/composables/use<Region>.ts`.
- `LearningPlayer.vue` — remove the extracted region, call the composable instead.
- A unit test for the new composable.

**Out of scope**:
- Changing behavior. This is a pure refactor — the app must behave identically.
- Extracting the phase/timing/playback core in the FIRST pass (highest risk; do the
  peripheral regions first — paywall, offline picker).
- Touching `SimplePlayer.ts` (plans 005/006/013 own it).
- Splitting more than one region per PR.

## Git workflow

- Branch: `advisor/019-decompose-learningplayer-<region>` from `dev` (one branch per
  extraction).
- Commit style: `refactor(player): extract <region> from LearningPlayer into use<Region>`.

## Steps (repeat per region; start with the paywall region)

### Step 1: Characterize the region before touching it

Identify the region's **inputs** (props, refs, other composables it reads) and
**outputs** (what the template binds, what it emits/mutates). Write these down. If the
region reads/writes shared refs that other regions also use, note every such ref — those
are the seams that must be passed in/out explicitly, not recreated.

**Verify**: an inputs/outputs contract for the region.

### Step 2: Extract into a composable

Create `use<Region>.ts` exposing exactly that contract: it receives its inputs as
arguments (refs/props) and returns refs + methods. Move the region's `ref`/`computed`/
`watch`/handlers into it verbatim (adjust references to use the passed-in inputs). Do
not "improve" logic while moving it — a behavior-preserving move only.

**Verify**: `pnpm --filter player-vue typecheck` exits 0.

### Step 3: Wire it back into LearningPlayer.vue

Replace the removed region with a `const { ... } = use<Region>(...)` call and keep the
template bindings pointing at the returned refs/methods.

**Verify**: `wc -l LearningPlayer.vue` dropped by roughly the extracted size;
`pnpm --filter player-vue typecheck` exits 0.

### Step 4: Test the composable + prove no behavior change

Add a unit test for `use<Region>` (model on existing composable tests). Run the full
player suite and, if feasible, an e2e smoke of the player flow to confirm the extracted
region still works end-to-end (the whole point of extracting is testability).

**Verify**: `pnpm --filter player-vue test` all pass (562 + new); e2e smoke green.

### Step 5: Stop after ONE region; report and hand off the next

After the first successful extraction, STOP, update the index, and list the remaining
candidate regions as follow-up passes. Do not batch multiple extractions.

## Test plan

- New unit test per extracted composable.
- Regression gate: full player suite unchanged (same count + new tests), plus an e2e
  smoke of the player. Because this is behavior-preserving, ANY test assertion change is
  a red flag.

## Done criteria (for one extraction pass)

ALL must hold:

- [ ] One region extracted into a `use<Region>.ts` composable with an explicit
      inputs/outputs contract.
- [ ] `LearningPlayer.vue` line count dropped by ~the region's size; it now calls the
      composable.
- [ ] New composable unit test exists and passes.
- [ ] `pnpm --filter player-vue typecheck` and full `test` pass with no assertion
      changes; e2e smoke green if run.
- [ ] `plans/README.md` status row updated with which region was extracted and what
      remains.

## STOP conditions

Stop and report if:
- The chosen region shares mutable state with 3+ other regions such that extraction
  would require passing a large tangle of refs — pick a more isolated region, or report
  that this region needs a state-ownership decision first.
- Any player test assertion would need to change to pass — that means behavior drifted;
  revert and report.
- You're tempted to fix a bug spotted mid-extraction — don't; log it as a separate
  finding and keep the refactor behavior-preserving.

## Maintenance notes

- Recommended extraction order (peripheral → core): paywall/entitlements → offline
  download picker → rolling buffer → (last, most carefully) phase/timing cluster.
- Each extraction is independently valuable; there is no need to finish all of them.
- The success metric is not "small file" but "each region independently testable and no
  longer able to silently perturb its neighbors."
- Reviewer: diff should be a move, not a rewrite — scrutinize any logic change smuggled
  into an extraction.
