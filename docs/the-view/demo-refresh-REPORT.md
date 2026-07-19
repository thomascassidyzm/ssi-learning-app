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

## Verification on deployed dev (walk script: `packages/player-vue/e2e/the-view/demo-refresh-walk.mjs`)

**Run 1 (build 9cf178a, 2026-07-19): 13/13 PASS.** Live refresh on IME Demo
Programme: 3 schools · 6 classes · **80 learners touched, 989 sessions,
2,276 seed rows, 7,973 lego rows, 56 class sessions written in 10s**. Latest
demo session moved from 2026-07-17 (stale) to TODAY. Guard proven live: the
same call against a real org (Welsh Gov Lang Office) → **403 "Refresh
refused: this is not a demo node"**, zero writes.

**Run 2 (same build): 15/15 PASS — idempotency proven live.** Session count
989 → 944 (replaced, not stacked). School insights (Sunrise Pune) compares
within the programme — "IME Demo Programme average", rank 1st of 2 — no
"not enough data".

**One honest finding:** the PROGRAMME-level insights view says "Not enough
data to compare fairly yet" — correctly. A top-level demo group's only
compare-to is the global course average, and global cohorts exclude demo
data by design (feat_17). The demo comes alive at school/class level, where
the cohort is its own programme peers. Not a bug; the honesty is the point.

**One real bug found by looking at the chart, fixed (`edafe274`):** the
school rate-trend still fell to zero at "now" — school/class rate-of-progress
reads class_sessions start→end LEGO ordinals, and the regenerated teacher
sessions all covered a fixed range. They now form an advancing arc (~6–10
seeds over ~5 weeks, newest session today, ending at the class's current
seed), so the rolling weekly rate reads alive at the right edge.

**OPEN walk (390px phone viewport):** Open pill on all 35 visible tree rows,
visible without hover, labeled "Open", 36px tall; tapping it lands on the
node's dashboard. Evidence: `open-by-name-phone.png`,
`open-tapped-node-home-phone.png`.

## Promotion

dev → staging held at time of writing: the api suite at dev HEAD carries 6
failing tests in `api/groups/[id]/rate-compare.test.ts` — THE LENS agent's
in-flight windows+measures work, not this scope (my suites: player-vue
957/957, api demo-refresh 6/6, full api green before the lens commits
landed). Promote once the lens suite is green.

*Last updated: 2026-07-19*
