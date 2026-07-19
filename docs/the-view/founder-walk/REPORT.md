# FOUNDER WALK 2 — staging verification report

- **Date:** 2026-07-19
- **Staging build walked:** `a23c989` (lens-perf promotion — confirmed via `/version.json?cb=<epoch>`); 5b re-walked on the promoted fix build (sha noted below).
- **Verifier:** Claude (resuming a died session; fw-1..fw-5 + e2e script inherited, eyeballed, and re-verified live)
- **Method:** real admin session (`thomas.cassidy+admin001@gmail.com`) against deployed staging; fresh Playwright contexts per cold load. Scripts: `packages/player-vue/e2e/the-view/founder-walk-staging.mjs` (full walk, 24/26 first pass), `founder-walk-coldloads.mjs` (cold-to-DATA timing), `founder-walk-magiclink.mjs` (item C re-walk).

## Checklist

| # | Item | Verdict |
|---|------|---------|
| 1 | Continuity drill — one surface, rail element identity | **PASS** (live re-run: 1a/1b/1c same `.map-rail` element org→school→class; fw-1, fw-2) |
| 2 | Class node home carries the teaching data | **PASS** (live: belts, LEGOs column, Course journey, Belt distribution, practice benchmark; fw-3-class.jpg) |
| 3 | Student expands in place; learner page redirects | **PASS** (live: expansion in place with journey+streak+last-7-days, URL unchanged; `/admin/users/:id/progress` → `/admin/users/:id`, no 404; fw-4-student-expanded.jpg) |
| 6 | See-insights verb; node-scoped lens; ancestor compare; old analytics URLs alive | **PASS** (live: verb present, insight view names the class, compare present, group+school `/analytics` URLs render the insight view; fw-5-class-insights.jpg) |
| A | Cold-load reliability ×5 each | **PASS** — 15/15 first-time, no refresh ritual. Cold-to-DATA seconds: school insights 1.7/0.8/0.7/1.0/1.2 · programme insights 0.8/0.7/0.8/0.8/0.8 · class home 0.7/0.6/0.5/0.6/0.7 |
| B | No-chatter soak 3+ min; manual refresh; honest Updated stamp | **FAIL → FIXED** — soak PASS (zero background API calls in 3 min idle, 0 even exempt); manual refresh affordance present and refetches (1 request on click). Updated stamp was BLANK on node home until a manual refresh → fixed (see below), re-walked green on the promoted build |
| C | Magic link straight-in | **PASS** — teacher link visible on the school node's Ways in (`/redeem/DEMO-IR-T`); fresh incognito context landed IN at `/schools` in 9.6s, authenticated, zero interstitials, no OTP, no email form (fw-9-ways-in.png, fw-10-straight-in.png) |
| D | Dead routes | **PASS** — learner progress URL redirects (3c above); old analytics page gone, its URLs remounted to the insight view (6d above); repo grep: every in-app Analytics link points at the live route |
| E | Copy sweep | **PASS with one fix** — no node/entitlement/subtree on any walked surface (org home, school home, class home, class insights, school insights, structure, node panel); identity chrome = most specific context (VIEWING GROUP/SCHOOL banner + rail you're-here). Wart found on the straight-in landing: "Welcome back, link-c3b38942-…" (link-auth placeholder name in the greeting) → fixed |
| F | Review fw-1..fw-5 against rulings | **PASS with observations** (below) |

## Fixes shipped during the walk (dev → staging)

1. **Updated stamp blank until manual refresh (item B).** `NodeHomeView` registers `immediate:false` and loads via a route watch (deliberate — `refresh()`'s in-flight guard would drop rapid drill navigations), so `lastUpdated` was never stamped on load. `useDashboardRefresh` now exports `markUpdated()`; `fetchHome` stamps on success. APML updated with the watch-driven-page exception. Other dashboard surfaces already route their initial load through `refresh()` and were stamping correctly (Structure showed "Updated 06:01" in fw-8).
2. **Greeting shows the link-auth machine placeholder (item E/C).** The straight-in teacher landing greeted "Welcome back, link-c3b38942-…". `DashboardView.firstName` now treats `link-<uuid>` display names as absent ("there").
3. **Walk-tooling honesty.** The inherited script's cold-load ready-selector (`.niv`) fired on the *Loading shell* — its 0.4s "cold loads" were not data-rendered. `founder-walk-coldloads.mjs` waits for Loading-gone + real content. Its structure-page selectors also missed the tree row's `.structure-name` click target (the 7a "FAIL" was the check's fault, not the product's).

## F — screenshot review (fw-1..fw-5)

- **fw-1-org.png (org/region node home): PASS.** Continuous map rail ("Where you are" with you're-here marker, siblings count, child school). Identity chrome names the most specific active context. Stat cards, Below-this browser with lens chips, Invite someone + See insights + Quick actions verbs. No jargon.
- **fw-2-school.png (school node home): PASS**, one wording observation (below). Same surface grammar, rail shows region → school with you're-here.
- **fw-3-class.jpg (class node home): PASS.** Teaching density in THE VIEW grammar: per-student rows with belt dot, needs-attention + last-practised, LEGOs count, practised hours; Course journey (52/943, "20 more to Green belt"), Belt distribution, Practice min/student/week vs school vs global. Taught-by line with (lead). Rail continuity intact.
- **fw-4-student-expanded.jpg: PASS.** Same URL, student row expanded in place with Course journey (94/943), Streak, Last 7 days; list intact around the expansion.
- **fw-5-class-insights.jpg: PASS**, two observations (below). Node-scoped ("INSIGHTS · CLASS · Rang a Cúig"), compare-to control (Gaelscoil na Mara average), honest copy ("Rate leads; position is just context"), Back to class home + All boards.

## Observations logged (no action — founder taste / one-look items)

- **School home empty-state wording** (fw-2): "Directly below" shows *"Nothing below this yet — use Quick actions to add a school or group"* while the stat cards say 3 classes (classes live behind the "All classes" chip). Candidate: mention classes in the empty state, or default class-bearing schools to the All-classes lens.
- **Insights footer shows raw position IDs** (fw-5): "Furthest LEGO · S21 · L1" on an admin surface. The position-is-LEGO ruling displays the last LEGO's own content learner-facing; whether admin surfaces should too is a taste call.
- **Rate chart vs headline** (fw-5): rolling-weekly chart reads flat ~0 for both series while the headline says 1.70 v 0.90 (+88.9%). Likely windowing (demo data's last practice was early June), but the two visually disagree on one card — worth one look.
- **Identity chip on link-auth accounts** shows "link-c3b38942-b190-4…" (top-right chrome). The greeting is fixed; the chip still shows the placeholder until the person names themselves — the per-person link/naming flow is already an open founder-taste item.

## Evidence

| File | What |
|------|------|
| fw-1-org.png | Org node home: rail, identity, stats, lens chips |
| fw-2-school.png | School node home, continuity from org |
| fw-3-class.jpg | Class home: full teaching density |
| fw-4-student-expanded.jpg | Student expanded in place |
| fw-5-class-insights.jpg | Node-scoped insight view with ancestor compare |
| fw-6-school-insights.png · fw-7-idle-refresh.png · fw-8-structure.png | School insights · idle-soak page state · Structure page |
| fw-9-ways-in.png · fw-10-straight-in.png | Node panel Ways-in with teacher link · fresh-context landing, authenticated |
| fw-cold-*.png · fw-cold2-*.png | Per-load cold screenshots (first batch shell-timed; cold2 = data-timed) |

## How it feels

Honest verdict: the staging build walks like a finished thing. You drop into a region, drill region → school → class → student and it is one continuous surface — the map rail never repaints, the identity banner always names where you are, and every level answers the teaching question at that level (the class page in particular now reads like a register: belts, LEGOs, hours, who needs attention, when they last practised). Cold loads are genuinely fast — under a second to real data on almost every load, 1.7s worst case — and nothing needed the old refresh ritual, fifteen times out of fifteen. The dashboard then holds still: three minutes open, not one background request, and refresh is a deliberate, honest act. The invite link is the standout for the founder demo: click it in a clean browser and you are simply IN, on the school's teacher dashboard, nine seconds, no OTP, no interstitial — though the "Welcome back, link-c3b38…" greeting it landed on (now fixed) shows the naming flow for link-auth people still wants its taste pass. The two soft spots worth an eyeball rather than a fix: the school home's "nothing below this yet" wording when its classes sit behind a chip, and the insight card whose flat chart disagrees with its headline rate on demo data. Nothing on the walk felt broken; what remains is polish-grade.

---
*First full-walk result: 24/26 (5b stamp — fixed; 7a — walk-tooling selector fault, re-walked PASS). Staging sha for the fix re-walk recorded below.*
