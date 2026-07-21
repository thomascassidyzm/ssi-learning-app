# Plan 021 (SPIKE): Design the Paddle build for the settled per-teacher group model

> **Executor instructions**: This is a **spike/design** plan. Deliverable is a mapping
> of the settled commercial model to Paddle products/quantities + a build plan, plus
> the env-var wiring that is unambiguous. Do NOT ship billing changes without the
> characterization tests from plan 004 in place and without Tom's band numbers.
> Update `plans/README.md` when done.
>
> **Drift check (run first)**: `git diff --stat 5fb4a42f..HEAD -- api/teacher/paddle-webhook.ts docs/schools`

## Status

- **Priority**: P2 (the schools-tier revenue mechanism; £30k/mo target)
- **Effort**: M–L
- **Risk**: MED–HIGH (real money) — mitigated by requiring plan 004 first
- **Depends on**: 004 (webhook characterization tests) — REQUIRED before any webhook
  code change; 020 (all-languages-on-paid) simplifies what to grant
- **Category**: direction
- **Planned at**: commit `5fb4a42f`, 2026-07-17

## Why this matters

`WORKLIST.md`: "Group commercial model — SETTLED… Pending: `y` per band, band list,
annual/monthly discount, and the Paddle integration build" (`docs/schools/
group-commercial-model.md`). The webhook already has school-platform and tutor branches
(`api/teacher/paddle-webhook.ts`), and live Paddle price IDs are parked in WORKLIST —
including two annual student price IDs marked "NEW var — needs wiring." The revenue
mechanism for the schools tier is designed, priced, and half-plumbed; the remaining work
is the gap between demoing schools and charging them.

## Current state (verify)

- `api/teacher/paddle-webhook.ts` (1,398 lines) — existing tutor + school-platform +
  student branches; signature verified; idempotency + plan-precedence guards present.
- `docs/schools/group-commercial-model.md` — the settled model (read it fully).
- `WORKLIST.md` "📌 Paddle LIVE price IDs" section — parked price IDs, incl. two annual
  student IDs marked "NEW var — needs wiring."
- Per-teacher PAYG model: £15/mo per teacher seat unlocks all languages for that
  teacher's class play (per the 2026-07-14 direction) — so a paid seat grants
  everything, which is why plan 020 simplifies this.

## Commands you will need

| Purpose      | Command                                             | Expected |
|--------------|----------------------------------------------------|----------|
| API tests    | `pnpm test:api`                                     | all pass |
| API typecheck| `pnpm typecheck:api`                                | exit 0   |
| Find env use | `grep -rnE "PRICE_ID|PADDLE_" api packages`         | wiring sites |

## Scope

**In scope (spike deliverable)**:
- Read `docs/schools/group-commercial-model.md` + the webhook; map the settled model →
  Paddle products/prices/quantities and the exact webhook branches/writes needed.
- A build plan (staged) for extending the webhook's school/group branch.
- The **unambiguous** env-var wiring: wire the two parked annual student price IDs into
  the config that reads price IDs (a mechanical, low-risk change) — but only with
  plan 004's webhook tests as the guard.

**Out of scope**:
- Inventing band numbers / `y` per band / discount percentages — those are Tom's
  intention-level inputs (surface them as the blocking question).
- Shipping webhook logic changes without plan 004's characterization tests.
- The all-languages entitlement collapse (plan 020) — consumed here, not done here.

## Steps

### Step 1: Read the settled model and the webhook

Read `docs/schools/group-commercial-model.md` and `api/teacher/paddle-webhook.ts`
end-to-end. Note what the webhook already grants for school-platform vs tutor vs
student, and where a group/per-teacher-seat model would slot in.

**Verify**: a written summary of the current webhook behavior per branch.

### Step 2: Map model → Paddle + identify the blocking inputs

Produce the mapping: which Paddle product/price corresponds to which seat/band, how
quantity maps to teacher seats, monthly vs annual. Explicitly list what's **missing**
from Tom (band list, `y` per band, discount) as the blocking question.

**Verify**: mapping table + a short list of intention-level inputs needed from Tom.

### Step 3: Wire the parked annual student price IDs (guarded)

If plan 004 has landed, wire the two "needs wiring" annual student price IDs into the
price-ID config (mechanical). Add/extend a webhook test asserting the annual student
event grants correctly. If plan 004 has NOT landed, STOP — do not touch the webhook
without its safety net.

**Verify**: `pnpm test:api` all pass, including a test for the newly-wired annual price.

### Step 4: Write the staged build plan

Document the staged extension of the webhook for the group/per-teacher model (behind
tests), the entitlement grant it produces (a seat, not per-course — per plan 020), and
the rollout order. Commit to `docs/schools/` or `docs/methodology/`.

**Verify**: staged build plan committed.

## Done criteria

ALL must hold:

- [ ] Written mapping of the settled model → Paddle products/quantities/branches.
- [ ] Blocking intention-level inputs (bands, `y`, discount) listed for Tom.
- [ ] If plan 004 landed: annual student price IDs wired + tested; else Step 3 skipped
      and reported as blocked-on-004.
- [ ] Staged build plan committed to docs.
- [ ] `pnpm test:api` + `pnpm typecheck:api` pass.
- [ ] `plans/README.md` status row updated.

## STOP conditions

Stop and deliver design-only if:
- Plan 004's webhook tests are not in place — do not modify the money path unguarded.
- Band numbers / discount are unknown — that's Tom's call; surface it.
- The settled model doc contradicts the webhook's current behavior — report the conflict.

## Maintenance notes

- Depends hard on plan 004 (tests) and benefits from plan 020 (seat = all languages).
- Any webhook change must carry a characterization test in the same PR.
- Reviewer: real money — scrutinize idempotency and plan-precedence for every new branch.
