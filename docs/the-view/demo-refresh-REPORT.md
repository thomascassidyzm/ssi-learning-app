# Demo-refresh engine + OPEN by the name — REPORT

Two founder rulings (2026-07-19), both landed on `dev`. Verification against the
deployed dev build with a real admin session; evidence in `docs/the-view/demo-refresh/`.

## 1. Refresh demo data — the verb on a DEMO node

**Shipped (`9cf178a6`):**
- **Engine** `api/_utils/demoNodeRefresh.ts` — regenerates a demo node's subtree
  telemetry up to the minute. ~8 weeks of practice sessions, weighted hard toward
  recent days and today (power-law day offsets); fast / steady / idle personas
  (20/50/30) per learner so needs-attention, belts, rates and cohort strips all
  read alive; positions anchored to each learner's existing cursor (a continuing
  cohort, never a teleported one); teacher-led class_sessions regenerated too.
- **Replace, not stack** — every run deletes the subtree's synthetic student
  telemetry first (sessions, seed_progress, lego_progress, class_sessions), then
  regenerates. Idempotent by construction.
- **Endpoint** `POST /api/groups/:id/demo-refresh` — verifyAdmin + service-role,
  same idiom as demo-mint.
- **Hard safety, server-side at every layer** (guard tests pin all three):
  1. node must be `is_demo=true` → otherwise **403 refused**;
  2. every school in the subtree must be `is_demo=true` → otherwise refused;
  3. only `is_demo=true` learners can enter the write set, and only STUDENT
     class-tags — demo staff are real logins (Tom demos as them), their own
     practice history is never rewritten.
- **Verb** — "Refresh demo activity" in the Structure node panel, demo nodes
  only, reports regenerated counts inline.

**Harvested from history:** the demo_orgs-keyed `demoSchoolRefresh.ts` (Nick's
"Refresh Activity" button — continuation-style top-up, left intact for legacy
orgs) and `scripts/demo-data/generate-ime-demo.cjs` (the dual progress model:
enrollment cursor + seed/lego count tables, which the dashboards read). The new
engine is keyed on the GROUP NODE (one-node world), replace-semantics, and
recent-weighted — the shape the ruling asked for.

## 2. OPEN by the name

**Shipped (`66b607f0`):**
- A labeled **Open** pill sits immediately next to every node name in the
  Structure tree — always visible (no hover gating), ≥36px tall at phone width,
  a word not an icon. Same treatment in the table lens.
- The less-used verbs (Rename / Add child group / Invite people / Mint a demo
  org / Delete) folded into one always-visible ⋯ overflow with labeled words.
- Name click still opens the quick-actions panel (THE-VIEW §2); Open goes to
  node home — one obvious verb per surface.
- Node-home children rows were already whole-row open buttons — unchanged.

## Verification on deployed dev

_(pending — walk script `packages/player-vue/e2e/the-view/demo-refresh-walk.mjs`
runs against the deployed build: before/after IME Demo Programme insights,
non-demo 403 guard, DB freshness lands today, phone-width OPEN walk.)_

*Last updated: 2026-07-19*
