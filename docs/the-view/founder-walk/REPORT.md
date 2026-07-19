# FOUNDER WALK 2 — staging verification report

- **Date:** 2026-07-19
- **Staging build:** `a23c989` (lens-perf promotion — confirmed via `/version.json?cb=<epoch>`)
- **Verifier:** Claude (resuming a died session; fw-1..fw-5 + e2e script inherited, eyeballed, and re-verified below)
- **Method:** real admin session (`thomas.cassidy+admin001@gmail.com`) against deployed staging, fresh Playwright contexts for cold loads. Script: `packages/player-vue/e2e/the-view/founder-walk-staging.mjs`.

## Checklist

| # | Item | Verdict |
|---|------|---------|
| 1 | Continuity drill — one surface, rail element identity | _pending re-run_ (prior evidence fw-1/fw-2 looks right) |
| 2 | Class node home carries the teaching data | **PASS** (fw-3, eyeballed — see F) |
| 3 | Student expands in place; learner page redirects | _expand PASS from fw-4; redirect pending (item D)_ |
| 6 | See-insights verb; node-scoped lens; ancestor compare | **PASS** (fw-5, eyeballed — see F) |
| A | Cold-load reliability ×5 each (school insights / programme insights / class home) | _pending_ |
| B | No-chatter soak 3+ min; manual refresh; honest Updated stamp | _pending_ |
| C | Magic link straight-in, fresh context, zero interstitials | _pending_ |
| D | Dead routes: /admin/users/:id/progress redirects; old analytics gone/alive-as-insights | _pending_ |
| E | Copy sweep: no node/entitlement/subtree user-facing; identity chrome; play-as-class | _pending_ |
| F | Review fw-1..fw-5 against rulings | **PASS with observations** (below) |

## F — screenshot review (fw-1..fw-5)

All five inherited screenshots were opened and read against the rulings. Verdicts:

- **fw-1-org.png (org/region node home): PASS.** Continuous map rail present ("Where you are" with you're-here marker, siblings count, child school). Identity chrome names the most specific active context (Gaelscoileanna Píolótach, VIEWING GROUP banner). Stat cards (learners/teachers/classes/practice hours), Below-this browser with lens chips (Directly below / All groups / All schools / All teachers / All classes), Invite someone + See insights + Quick actions verbs. No jargon visible.
- **fw-2-school.png (school node home): PASS**, one wording observation. Same surface grammar, rail shows region → school with you're-here. **Observation (taste, not a fail):** "Directly below" shows *"Nothing below this yet — use Quick actions to add a school or group"* while the stat cards say 3 classes — the classes are reachable via the "All classes" chip, but the empty-state copy suggests the school has nothing in it. Candidate copy fix: mention classes, or default a class-bearing school's browser to the All-classes lens.
- **fw-3-class.jpg (class node home): PASS.** Teaching density in THE VIEW grammar: per-student rows with belt dot + name, needs-attention + last-practised, LEGOs count, practised hours; Course journey card (52/943, "20 more to Green belt"), Belt distribution card, Practice min/student/week benchmark (class vs school vs global). Taught-by line with (lead). Rail continuity intact (region → school → class).
- **fw-4-student-expanded.jpg: PASS.** Same URL/surface, student row expanded in place with Course journey (94/943), Streak, Last 7 days. No navigation, list intact around the expansion.
- **fw-5-class-insights.jpg: PASS**, two observations. Node-scoped ("INSIGHTS · CLASS · Rang a Cúig"), compare-to control (Gaelscoil na Mara average), honest explanatory copy ("Rate leads; position is just context"), Back to class home + All boards. Observations (logged, no action): (1) footer shows **"Furthest LEGO · S21 · L1"** — raw position IDs on an admin surface; the position-is-LEGO ruling displays the last LEGO's own content, worth a taste call on whether admin surfaces should too. (2) The rolling-weekly chart reads as flat ~0 for both series while the headline says 1.70 v 0.90 — likely windowing (demo data's last practice early June), but the chart and headline visually disagree; worth one look.

## A — cold-load reliability

_pending_

## B — no-chatter soak

_pending_

## C — magic link straight-in

_pending_

## D — dead routes

_pending_

## E — copy sweep

_pending_

## How it feels

_pending — written after the walk completes_
