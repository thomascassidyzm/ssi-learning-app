# Founder pass A — windows relabel · insights keeps the map · scroll bug

**Status: IN FLIGHT — code landed on dev; deployed verification pending (this
line flips when the walk is green).**

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

## Deployed verification

_(pending — filled in after the dev deploy of the three commits)_
