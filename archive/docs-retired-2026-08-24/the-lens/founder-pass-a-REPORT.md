# Founder pass A — windows relabel · insights keeps the map · scroll bug

**Status: VERIFIED GREEN on deployed staging (`staging.saysomethingin.app`,
build `104d906`), 2026-07-19 — full walk below.**

Founder rulings from playing the deployed staging build, 2026-07-19. Three
items, three commits, each scoped and revertable.

## 1. Window chips → rolling day units (`a1178126`)

**Ruling:** replace "This week / Last 4 weeks / This term / All time" with
**Today / Last 7 days / Last 30 days / All time** — ROLLING windows anchored
to now, no calendar definitions ("this week" and "this term" were ambiguous;
day units are standard).

What shipped (server `api/groups/[id]/rate-compare.ts` + demo parity
`insight/data/demoRates.ts`):

| chip | value | period | trend | caption |
|---|---|---|---|---|
| Today | `today` | 1 day | hourly · 24 pts | "Hourly · last 24 hours" |
| Last 7 days | `7d` | 7 days | daily · 7 pts | "Daily · last 7 days" |
| **Last 30 days** (default) | `30d` | 30 days | daily · 30 pts | "Daily · last 30 days" |
| All time | `all` | unbounded (10y fetch) | monthly · 12 pts | "Monthly · last 12 months" |

- **Honest Today:** a per-week rate over one day is a 7× extrapolation, so
  under `today` every per-week measure (rate of progress, practice minutes)
  presents in its natural per-day form — headline AND cohort values scale
  together (delta/percentile are scale-invariant), `per` comes back as
  `day`, and the chart caption owns the bucket granularity (same precedent
  as daily buckets under the 7-day window). Windowed totals (practice hours,
  active-classes share) are already window-native and unchanged.
- **Old URLs keep working:** `week`→`7d`, `4w`→`30d`, `term`→`30d` alias
  forward server-side; legacy `?days=` untouched (byte-identical trend
  shape); `?window=` still wins over `?days=`.
- RateTrend renders hourly `HH:MM` x-labels for sub-day spacing.
- Tests repinned: 33 endpoint + 19 demoRates green, incl. new pins for the
  alias map and the Today per-day scaling (entity 5 LEGOs/day vs cohort mean
  3/day from the fixture).
- `docs/the-lens/windows-measures-REPORT.md` carries the amendment note (its
  "'Today' dropped" line is superseded by this ruling's honest-framing
  version).

## 2. Insights keeps the where-you-are nav (`00b366ce`)

**Ruling:** "we can't go to a different nav style — persist the
where-you-are style nav throughout the whole dashboard."

`NodeInsightsView` (the one component behind all three insight mounts —
`/admin/schools/:id/analytics`, `/admin/groups/:id/analytics`,
`/admin/classes/:id/insights`) now renders the node-home chrome:

- The **WHERE-YOU-ARE map rail** (`NodeMapRail`, you-are-here lit), fed by
  one `GET /api/groups/:id/home` fetch — the same endpoint node home reads.
- The **same identity header grammar**: kicker `<Label> · Insights`, node
  name in the display face, same layout skeleton (sticky rail-col +
  main-col).
- **`← Back to group home` is dead.** The rail is the way around; the verbs
  corner offers **Overview** (node home) and **All boards** in node home's
  own verb grammar — the mirror of node home's "See insights".

APML updated (`apml/interfaces/insight-engine.apml` admin_mounts).

## 3. Scroll bug — containers own their scroll (`25c3cd5e`)

**Ruling:** "Quite a few of the pages don't scroll by default, so we can't
see the bottom of the page."

**Root cause (reproduced on deployed dev before fixing):** `body` carries
`overflow: hidden` app-wide (the Android bounce fix in `style.css`), so the
document never scrolls — every full-page shell must own its scroll.
`AdminContainer` does (`height: 100vh; overflow-y: auto`); the node-surface
shells didn't — they set only `min-height: 100vh`, so anything below the
fold was stranded with no scroll owner.

**Probe** (`packages/player-vue/e2e/the-view/scroll-probe.mjs`, committed as
the pin — real admin session against deployed dev, laptop 1280×800 + phone
390×700): 6 failures before the fix — group node home, group insights, class
node home, class insights at phone height; methodology at both heights. The
failing pages all reported `owner=null` (no scrollable element anywhere)
with `bodyOverflow=hidden`.

**Fix:** the AdminContainer pattern (`height: 100vh; overflow-y: auto`)
applied to `AdminGroupContainer`, `AdminSchoolsContainer`,
`MethodologyContainer`, and the `AdminClassInsights` shell. Sticky children
(entity context bar, node-home rail) stick against the container scroll as
designed.

## Deployed verification — staging walk, 2026-07-19

Walked **deployed staging** (`/version.json` → `104d906`, the merge of dev tip
`a829959d`; all three pass A commits confirmed ancestors of `origin/staging`)
with a real admin session (magic-link auth, same pattern as the scroll probe).
Scripted walk committed as `packages/player-vue/e2e/the-lens/pass-a-staging-verify.mjs`
— 36 automated checks + the committed scroll probe re-run against staging.

### 1. Window chips — PASS
- Chips read **Today / Last 7 days / Last 30 days / All time** on group
  insights, class insights, AND the Stats board Rate-compare lens; default
  **Last 30 days** everywhere. (`pass-a-verify-group-insights.jpg`,
  `pass-a-verify-class-insights.jpg`, `pass-a-verify-stats-rates.jpg`)
- **Today honest framing live:** class insights under Today shows the
  headline in **LEGOs / day** (2 v 3, cohort scaled with it) with the
  **"Hourly · last 24 hours"** trend caption and hourly x-labels.
  (`pass-a-verify-today-hourly.jpg`)
- **Old deep-links alias forward without error:** `?window=term` → Last 30
  days, `?window=4w` → Last 30 days, `?window=week` → Last 7 days — checked
  on both group and class mounts, no error state, chip lands correctly.
- *Caveat, not a defect:* the demo **region** node shows "Not enough data to
  compare fairly yet" in every window (`pass-a-verify-group-today-empty.jpg`)
  — it's the only region in the demo programme, so the fair-compare floor has
  no comparator cohort. School tier (`pass-a-verify-school-insights.jpg`) and
  class tier both render full data, proving the code path; the region empty
  state is the K_FLOOR guard being honest and predates this pass.

### 2. Insights carries the where-you-are nav — PASS
On group, school, and class insight mounts: **NodeMapRail present with
you're-here lit**, identity kicker `<Label> · Insights` (Region/Class ·
Insights observed), **zero "← Back to group home"** text anywhere, and the
verbs corner offers **Overview + All boards**.

### 3. Scroll — PASS
- Committed probe (`scroll-probe.mjs`) against staging: **18/18 PASS, 0
  failures** (9 surfaces × laptop 1280×800 + phone 390×700). Every surface
  reports a scroll owner (`admin-container` / `schools-container` /
  `methodology-container`) or content that fits the viewport.
- Manual scroll-to-true-bottom (drive the owner to `scrollHeight`, assert
  bottom reached): Structure, node home, insights, Users, Stats — **10/10
  at both viewport heights**. (`pass-a-verify-insights-bottom-phone.jpg`)

### 4. Regression — PASS
- Cold load: `/admin/structure` content rendered in **211 ms** on a fresh
  context.
- Idle polling: **zero network requests** over a 65 s idle sit on an
  insights view (images/fonts excluded; nothing at all fired).

**Result: 34/36 scripted checks PASS; the 2 "fails" are the region
fair-compare empty state documented above — honest by design, feature proven
live at school and class tiers. Nothing to fix; no dev changes needed.**
