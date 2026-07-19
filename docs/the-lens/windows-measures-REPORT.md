# THE LENS · time windows + richer measures + full compare sets — walk report

**Status: SHIPPED to dev + verified on deployed dev (`60b8faf`); promoted dev→staging.**

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

## What shipped

### Windows (`?window=`, chips, URL-persisted)

| chip | period | trend | caption |
|---|---|---|---|
| This week | 7 days | daily · 7 pts | "Daily · last 7 days" |
| Last 4 weeks | 28 days | weekly · 4 pts | "Weekly · last 4 weeks" |
| **This term** (default) | 84 days | weekly · 12 pts | "Weekly · last 12 weeks" |
| All time | unbounded (10y fetch) | monthly · 12 pts | "Monthly · last 12 months" |

- Headline denominator = first activity in the window → NOW, floored 1 day
  (honest-pace: idle time decays the rate). Chart caption comes from the server
  (`trendLabel`); the hardcoded "Rolling weekly · last 8 weeks" is dead. The
  trend chart draws real daily/weekly/monthly calendar x-labels (`trendPeriodDays`).
- Legacy `?days=` still works byte-identically ("Last N days" custom window);
  `?window=` wins when both present. Teacher lane (`api/school/rate-compare.ts`)
  untouched — its 21 tests pass unmodified.
- Fixed en route: a half-open bucket boundary dropped a session landing exactly
  on "now" from the last trend bucket (`9643d71f`).

### Measures (`?measure=`, server-sent options per node kind)

All computed from the SAME `analytics_class_sessions_scoped` rows already
fetched — one round trip, no new RPC. Learner-level measures (active-learner
share, streaks, minutes/learner) need learner telemetry this RPC does not carry
— deliberately NOT invented; future work gated on a consumer + data ride-along.

| measure | unit | live value in walk (Sunrise Pune, term) |
|---|---|---|
| Rate of progress (default) | LEGOs / week | 4.8 v 6.6 |
| Practice minutes per class | min / week | 62.7 v 64.5 |
| Practice hours | hours (window total) | 18.3 |
| Active classes share | % | 100% |

Same grammar everywhere: headline v comparison, over-time chart in the same
window, anonymised cohort strip, entity voice. `active_classes` is omitted at
class level (degenerate 0/100) and a forced request falls back to `rate`.
`contextLine` (furthest LEGO content) rides only on the rate measure.

### Compare sets — the diagnosis is DATA, not code

The ancestor-walk in the endpoint has no depth cap and already emits the full
chain. Queried the live forest: **the entire tree (real + demo) is exactly 2
tiers deep** — every region/programme/organisation node is a ROOT
(`parent_id = NULL`), and 7 of 13 real schools are standalone roots. So a
region node showing only the two Global options is the code being honest about
the data. Proven live at every existing depth:

- **class** (Rang a Trí): school avg → root region avg → 2 globals (4 options) ✓
- **school** (Sunrise Pune): programme avg → 2 globals (3 options) ✓
- **region/root** (IME Demo Programme): 2 globals — nothing above it exists ✓

Pinned in tests with a 3-level fixture (class → school → programme → nation →
globals = 5 options), so a deeper real tree lights up the full chain the moment
one exists. **No code fix was applied; one would have been wrong.**
*Option for the founder:* mint one 3-tier demo org (region → schools) if the
demo should SHOW a grandparent chain before a real 3-tier customer arrives.

## Deployed-dev walk — ALL GREEN, 47/47

`packages/player-vue/e2e/the-lens/windowscheck.mjs` (magiclink admin session;
API contract assertions at class/school/root depth + Playwright UI walk)
against dev build `60b8faf`:

- Chips render with **This term** active by default; This week → "Daily · last
  7 days", All time → "Monthly · last 12 months" — caption and chart span flip
  with the chip, URL carries `?window=` + `?measure=` (deep-linkable).
- Measure picker: 4 measures at school, 3 at class (no Active classes share);
  units honest per the table above; descriptions in plain words.
- Voice guards on every surface: zero "YOU v" / "Where you sit" / raw S/L ids.

Screenshots (committed alongside): `windows-school-term/week/all.jpg`,
`measure-school-minutes/hours/active.jpg`, `windows-class.jpg`,
`windows-root-programme.jpg`.

## Suites

- player-vue: typecheck ✅ · vitest **957/957** ✅ (demoRates 13→18, pinning
  windows×measures demo parity)
- api: vitest **633/633** ✅ (rateCompare 23→51; node rate-compare 14→31)

## Commits

Contract `77883629` · client `6976ca64`, `8eb4e7c0`, `f1d9f12e`, `e5a57a24` ·
server `48a16508`, `9643d71f`, `60b8faf8` · walk + evidence + this report (see
git log for shas).
