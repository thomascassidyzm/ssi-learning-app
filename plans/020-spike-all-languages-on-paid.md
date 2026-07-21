# Plan 020 (SPIKE): Collapse per-course entitlement gating for paid seats

> **Executor instructions**: This is a **spike/design** plan, not a build-everything
> plan. Its deliverable is an inventory + a staged deletion design written to
> `docs/methodology/` (or appended to the build plan), plus — only if the design is
> unambiguous and low-risk — the first deletion step behind the existing paywall e2e.
> Do NOT rip out entitlement code speculatively. Update `plans/README.md` when done.
>
> **Drift check (run first)**: `git diff --stat 5fb4a42f..HEAD -- packages/core/src/pricing api/entitlement packages/player-vue/src/composables`
> Re-read the entitlement surface before designing against it.

## Status

- **Priority**: P2 (stated owner bet, un-started; removes code)
- **Effort**: M
- **Risk**: MED (touches the live paywall/revenue path — stage carefully)
- **Depends on**: none, but coordinate with 021 (Paddle build consumes the simplified model)
- **Category**: direction
- **Planned at**: commit `5fb4a42f`, 2026-07-17

## Why this matters

`WORKLIST.md` records Tom's 2026-07-14 ruling: "the cross-offer is dissolved — if a
school pays, it gets access to all languages… NO per-course entitlement state needed
for paid seats — delete per-course blocking for paid, don't extend it." This is a
stated top-level bet that is BSC-positive on all three axes (it *removes* code) and
verified un-started. Every week it's deferred, new features keep building on the model
slated for deletion. The predicate collapses to: **active paid seat → all premium
courses**; free tier keeps free/community languages + the Welsh year.

## Current state (leads to verify — open each before designing)

- `packages/core/src/pricing/access.ts` — `canAccessSeed` (~:143) and
  `packages/core/src/pricing/constants.ts` still encode the per-course preview/tier
  model.
- `api/entitlement/*` — per-course entitlement machinery (`grant.ts`, `grants.ts`,
  `list.ts`, `user.ts`, `offline-lease.ts`, `create.ts`).
- Client: `useEntitlement`/`useCourseAccess` composables in
  `packages/player-vue/src/composables/` consume per-course entitlement state.
- The audio paywall server-side (`api/_utils/audioAccess.ts`) has its own premium
  gate — coordinate the predicate so client and server agree.
- Guard: the paywall e2e (find it under `packages/player-vue/e2e/`) is the behavioral
  safety net for any change here.

## Commands you will need

| Purpose        | Command                                                        | Expected |
|----------------|---------------------------------------------------------------|----------|
| Find per-course reads | `grep -rnE "canAccessSeed|per.?course|granted_courses|course_id" packages/core/src/pricing api/entitlement packages/player-vue/src/composables` | the surface |
| API tests      | `pnpm test:api`                                                | all pass |
| Player tests   | `pnpm --filter player-vue test`                              | all pass |
| Paywall e2e    | `pnpm --filter player-vue e2e -- <paywall spec>`             | pass     |

## Scope

**In scope (spike deliverable)**:
- A written inventory of **every** per-course entitlement read/write (client + server).
- A defined seat-check predicate ("active paid seat → all premium courses") and where
  it should live (one shared function, ideally in `@ssi/core/pricing`).
- A **staged deletion plan** (which reads collapse first, what state becomes dead, what
  the free-tier predicate keeps) written to `docs/methodology/`.
- OPTIONALLY the first, safest deletion step if it's unambiguous — gated by the paywall
  e2e.

**Out of scope**:
- Deleting the whole entitlement machinery in one pass.
- The Paddle billing build (plan 021) — this simplifies what that build must grant.
- Free-tier/community/Welsh-year logic — that stays; only paid gating collapses.

## Steps

### Step 1: Inventory the per-course entitlement surface

Grep + read every site. Produce a table: file:symbol → what per-course decision it
makes → does it apply to paid seats (collapses) or free tier (stays)?

**Verify**: inventory table complete; each entry classified paid-collapses vs
free-keeps.

### Step 2: Define the seat predicate and its home

Specify the single predicate for paid access (all premium courses if an active paid
seat exists) and the free-tier predicate (free/community + Welsh year). Decide the one
place it lives so client and server share it.

**Verify**: predicate written; both `access.ts` and `audioAccess.ts` can express it.

### Step 3: Write the staged deletion plan

Order the deletions so the app is never broken between stages (collapse reads first,
then retire now-dead state). Identify what `entitlement_grants`/`user_entitlements`
state becomes vestigial for paid seats. Reference the paywall e2e as the guard for each
stage.

**Verify**: staged plan committed to `docs/methodology/`.

### Step 4 (optional): Execute only the first, unambiguous stage

If stage 1 is clearly safe (e.g. making `canAccessSeed` return true for any active paid
seat regardless of course), implement it and prove it with the paywall e2e + suites. If
there's any ambiguity, STOP and hand the staged plan back for review before touching
code.

**Verify**: if executed — paywall e2e + both suites green; if not — the plan is the
deliverable.

## Done criteria

ALL must hold:

- [ ] Complete inventory of per-course entitlement reads/writes (client + server).
- [ ] Seat predicate + free-tier predicate defined, with a single home identified.
- [ ] Staged deletion plan written to `docs/methodology/`.
- [ ] If any code changed: paywall e2e + `pnpm test:api` + `pnpm --filter player-vue test`
      all pass.
- [ ] `plans/README.md` status row updated.

## STOP conditions

Stop and report (deliver the design only) if:
- The free-tier vs paid boundary is ambiguous anywhere in the inventory — that's an
  intention-level question for Tom.
- Collapsing a read would change behavior for FREE users (out of scope — only paid
  gating collapses).
- The paywall e2e can't be run to guard a code change.

## Maintenance notes

- This unblocks/​simplifies plan 021 (paid seat = all languages → the webhook grants a
  seat, not per-course entitlements).
- Interacts with `offline-lease.ts` (which currently carries per-course `courses[]`) —
  the staged plan should note that lease scoping simplifies too.
