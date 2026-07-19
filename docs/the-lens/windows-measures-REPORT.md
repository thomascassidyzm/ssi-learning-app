# THE LENS · time windows + richer measures + full compare sets — walk report

**Status: IN PROGRESS (contract frozen 2026-07-19; build fanning out).**

**Founder rulings (2026-07-19):**
1. **Time window chips** — everything is a rate, so today/7d/30d/all-time resolves
   as an explicit WINDOW selector: chips set the period the rate is computed over
   AND the chart's x-span; headline and chart obey the same window (honest-pace:
   idle time inside the window decays the rate). "Today" dropped (LEGOs/week over
   a day is noise). Default sensible, choice visible, URL-persisted.
2. **More measures** — the measure dropdown grows to what the telemetry genuinely
   carries, server-side; same grammar per measure (headline v comparison,
   over-time chart, cohort strip, entity voice). No invented metrics.
3. **Full compare sets at every level** — every node offers its full ancestor
   chain (parent … org, global) plus the sibling cohort; verify at region,
   school, class depths.

Standing rails respected: verbs-on-top (no jargon), k-floor anonymisation,
refresh protocol (no polling), one-round-trip cold load (windows + measures ride
`GET /api/groups/:id/rate-compare` as query params; options come back in the
same response).

## The contract (frozen — both workers build against this)

### Windows (`?window=` on the endpoint; chips in the engine; URL-persisted)

| value | chip label | period | trend series |
|---|---|---|---|
| `week` | This week | 7 days | daily · 7 points (`trendPeriodDays: 1`) |
| `4w` | Last 4 weeks | 28 days | weekly · 4 points (`trendPeriodDays: 7`) |
| `term` | This term | 84 days (12 weeks) | weekly · 12 points — **DEFAULT** |
| `all` | All time | unbounded (10y fetch) | monthly · last 12 months (`trendPeriodDays: 30`) |

- Default `term`: continuity with the old 90-day default and the natural
  school-shaped read. (Detail ruling, mine.)
- Headline rate denominator: first activity **in the window** → NOW (the
  honest-pace anchor), floored at 1 day. For `all`, first activity ever → now.
- The chart caption comes from the server (`trendLabel`) — the hardcoded
  "Rolling weekly · last 8 weeks" dies.

### Measures (`?measure=`; options server-sent per node kind)

All computed from `analytics_class_sessions_scoped` rows (class_id, start/end
ords, duration_seconds, started_at) — the telemetry this lens genuinely carries.
Learner-level measures (active-learner share, streaks, minutes/learner) need
learner telemetry this RPC does not return — deliberately NOT invented; noted
as future work gated on a consumer + a data ride-along.

| value | label | unit / per | definition (entity + each cohort member alike) |
|---|---|---|---|
| `rate` | Rate of progress | LEGOs / week | existing math — **DEFAULT** |
| `minutes_per_class` | Practice minutes per class | min / week | mean weekly practice minutes per active member class, NOW-anchored |
| `hours_total` | Practice hours | hours (no per) | total practice hours inside the window |
| `active_classes` | Active classes share | % | share of the entity's classes (on the course) with ≥1 session in the window; omitted at class level (degenerate 0/100) |

Every measure keeps the same grammar: headline v comparison, over-time chart
(same window), anonymised cohort strip, entity voice.

### Response additions (spec.ts `RateComparisonData` — committed with this doc)

- `windowLabel`, `trendLabel`, `trendPeriodDays` on the comparison payload.
- `options.windows: {value,label}[]`, `options.measures: {value,label,desc}[]`,
  `applied.window`, `applied.measure` alongside the existing courses/compares.

### Compare sets

Server already builds the ancestor chain from the groups forest; the founder
observes region/group nodes offering only the global options. Worker A
reproduces on deployed dev at region depth, diagnoses (root-node? path gaps?
demo-tree shape?), fixes, and proves the menu at region, school, class depths:
full ancestor chain + sibling cohort everywhere.

## Findings (incremental)

_(to be filled as workers land)_

## Screenshots

_(deployed-dev walk, real admin session)_

## Suites & shas

_(to be filled)_
