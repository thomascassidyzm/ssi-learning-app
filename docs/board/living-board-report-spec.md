# Living board report — design spec

*Design-only spec, 2026-07-15. No implementation in this commit. Owner intent: the board report is a LIVING, RUNNABLE thing at any time, computed from the actual state of the business in the app — not a hand-written monthly document. Companion artefacts: `docs/board/2026-07-board-report.md` (the current hand-written report, whose shape this spec inherits), `packages/player-vue/public/docs/metrics-vision.html` §5 (design authority for how comparisons display).*

---

## Executive summary (10 lines)

1. The board report becomes a page in the admin dashboard (`/admin/board`), sitting beside Stats and Insights — same Insight Engine surface, same admin gate.
2. Numbers are **live queries** against the one shared Supabase DB (learner app + Popty content tables — no integration needed); narrative stays **human-authored**.
3. Composition model: **authored prose wraps live tokens** — the writer owns the story, `{{metric:...}}` slots resolve to tonight's truth at render time.
4. The Progress/Problems/Plans skeleton stands; each slot is marked live / authored / hybrid in the inventory below. Problems and Plans stay 100% human — that's the taste.
5. A board member never touches the live DB: sharing mints a **frozen, dated snapshot** — all metrics resolved server-side, stored as a row, served by an unguessable revocable link (the proven try-link pattern).
6. One metric registry (`api/_utils/boardMetrics.ts`) is the single source of every number: value + as-of timestamp + one-line method, so every figure on the page can say how it was computed.
7. Comparisons, where shown, follow metrics-vision §5 verbatim: entity against the average of its level, two clocks, k-floor 5, honest "not enough data yet" — reusing `rateCompare.ts`, not re-deriving it.
8. First buildable slice is deliberately small: one page, **three live numbers** (active learners, practice minutes, schools on platform) wrapped in the existing 2026-07 narrative, plus the snapshot mechanism. Rough-but-honest ships first.
9. Marketing insights and course-QA surface through the same statistics/insights notion later — the metric registry is designed so those are just more named metrics, not new machinery.
10. Five work packages, sonnet-sized, dependency-ordered, with file touchpoints — WP-1 + WP-2 alone give Tom a runnable, sendable board report.

---

## 1. The composition model — narrative wraps numbers

The failure mode to avoid is the inverted one: a metrics dashboard with prose bolted on. A board report is a **story with evidence**, so the document is authored prose in which named slots resolve to live values:

```markdown
Teachers, school admins and group leaders now see real comparative progress data.
The schools tier is now {{metric:schools.total}} schools across {{metric:groups.total}}
groups, with {{metric:seats.teachers_active}} active teaching seats.
```

Three slot kinds:

| Kind | Resolves to | Example |
|---|---|---|
| `{{metric:slug}}` | a single number with as-of timestamp | `{{metric:learners.active_30d}}` |
| `{{series:slug}}` | a small inline chart (sparkline / band) | `{{series:minutes.weekly_12w}}` |
| `{{table:slug}}` | a short enumerable table | `{{table:courses.audio_coverage}}` |

Rules:

- **Every rendered value carries provenance on hover/tap**: the metric's one-line method and its as-of time. A board number you can't explain is worse than no number.
- **A metric that can't be computed renders as an honest gap** ("no data yet"), never a fabricated value — the standing rule from the analytics work ("real or absent, never fake") applies verbatim.
- **The authored text lives in the repo** (`docs/board/reports/<YYYY-MM>.md`), not in a DB table. Git is the provenance and edit history for prose; the DB holds only computed snapshots. Better (Tom writes in his own tools, full history), simpler (no authoring UI to build), cheaper (zero new write surface). PROPOSED — the alternative (a DB-stored draft with an in-app editor) is deferred until the repo workflow actually chafes.
- The renderer takes the markdown, resolves tokens via the metric registry, and produces the page. Unknown token = visible error in admin view, hard failure on snapshot creation (a snapshot must be complete or not exist — same principle as the Cycle refactor).

## 2. The live query layer — what computes vs what stays human

All queries run server-side (Vercel functions, service-role client) — never from the browser, per the settled `resolveVisibleScope` division of labour. Popty's content tables are in the **same Supabase DB**, so course/content metrics are plain queries too.

### Computable today (tables verified to exist)

| Metric (slug) | Source | Notes |
|---|---|---|
| `learners.total`, `learners.active_30d/7d` | `learners`, `sessions` / `daily_contributions` | activity = any contribution in window |
| `minutes.total_30d`, `minutes.weekly_12w` | `daily_contributions` | the practice-minutes spine already feeds analytics |
| `schools.total`, `schools.active`, `schools.awaiting_admin` | `schools` | "awaiting admin" is a real state the demo already shows |
| `groups.total` + growth series | `groups` (`created_at`) | region-tier growth curve |
| `classes.total`, `classes.active_30d` | `classes`, `class_sessions` | active = a class session in window |
| `seats.teachers_active` | `classes.teacher_user_id` / `class_teachers` distinct count | revenue-adjacent: the unit is the teacher |
| `seats.entitled` | `entitlement_grants` | paid/granted seats until Paddle lands; becomes the revenue proxy |
| `students.enrolled` | `course_enrollments` scoped to school classes | |
| `courses.live_beta_count` | `courses` (Popty side, same DB) | the "74 courses" number, live |
| `courses.audio_coverage` | `course_practice_phrases` × `course_audio` | the audio-census finding as a standing live table |
| `engagement.rate_compare` | `api/_utils/rateCompare.ts` | reuse as-is: entity ladder, K_FLOOR=5, two clocks |

### Stays human-authored

- **Problems** — entirely. A query can surface a symptom; deciding it's a board-level problem is taste.
- **Plans** — entirely. Priorities are Tom's.
- **Partnership narrative** (IME, Ireland, Wales) — relationship state lives in nobody's schema.
- **The month's story** (the opening paragraph) — the single highest-value sentence in the report is always authored.
- Commit-velocity numbers ("725 commits") — not in the DB. PROPOSED: drop rather than integrate GitHub's API; the practice-minutes and growth numbers are the honest heartbeat, commit counts are vanity-adjacent. If wanted later it's one more registry metric.

### Hybrid

Progress subsections: authored frame + live tokens, per §1. The writer asserts *what happened and why it matters*; the tokens prove *how much*.

## 3. Section inventory — the standing P/P/P skeleton

Derived from the 2026-07 report's actual shape. Each slot marked **L**ive / **A**uthored / **H**ybrid:

| # | Slot | Mode | Content |
|---|---|---|---|
| 0 | The month's story (one paragraph) | A | opening frame |
| 1 | Progress — Schools platform | H | narrative + `schools.*`, `groups.*`, `seats.*`, `classes.*` |
| 2 | Progress — Commercial | H | model narrative (A) + `seats.entitled`; post-Paddle: MRR-adjacent counts |
| 3 | Progress — Partnerships | A | IME / Ireland / Wales colour |
| 4 | Progress — Learner experience | H | narrative + `minutes.*`, `learners.*`, engagement compare widget |
| 5 | Progress — Content & production | H | narrative + `courses.live_beta_count`, `courses.audio_coverage` |
| 6 | Problems | A | bullets, human only |
| 7 | Plans | A | numbered, human only |
| 8 | The number that matters | L (choice is A) | one registry metric, hand-picked each report |
| 9 | Appendix: the dashboard block | L | auto: every registry metric with as-of + method, no narrative |

Slot 9 is new and is what makes the report *runnable at any time*: even with zero authoring this month, `/admin/board` always shows slot 9 with live truth. The authored slots layer on top when a report is being written. PROPOSED: slot 9 also renders standalone as the "instant board view" between authored reports.

## 4. Placement — inside the admin dashboard

- **Route:** `/admin/board` under the existing `/admin` guard, registered beside `stats` and `insights` in `packages/player-vue/src/router/index.ts` (meta title "Board", description "Living board report — live business state + authored reports").
- **Gate:** same `assertSsiAdmin` (`api/_utils/auth.ts`) on every board endpoint; the view sits behind the existing global admin route guard. No new role machinery.
- **Display conventions:** Insight Engine / metrics-vision §5 are design authority — growth curve against a comparison band, two clocks (in-app minutes vs wall-clock days), sovereignty (aggregate comparisons only), k-floor 5, honest empty states. Frostwell Courtyard canon for the chrome, like every management surface.
- **History note:** the static board page was just removed from the public learner app (`065014b6`) precisely because a board report doesn't belong on an unauthenticated learner surface. This spec is the replacement: admin-gated live page + deliberately-shared frozen snapshots.

## 5. Share / snapshot mechanism — frozen, dated, revocable

The board member's experience: a link that opens a **dated, frozen document**. Never live DB access, never an admin session.

### Model

1. Tom finishes (or simply wants to send) a report → clicks **Freeze & share** in `/admin/board`.
2. Server resolves **every** token against the DB *now*, renders the complete document to a self-contained JSON payload (prose + resolved values + series data + as-of timestamps), and inserts one row:

```
board_snapshots
  id            uuid pk
  created_at    timestamptz
  label         text          -- "July 2026 board report"
  report_month  text          -- "2026-07"
  payload       jsonb         -- the fully-resolved document
  share_code    text unique   -- 128-bit random, URL-safe
  revoked_at    timestamptz null
  created_by    text          -- auth uid of the admin who froze it
```

3. Share URL: `saysomethingin.app/board/<share_code>` → public route, no auth, renders **only** the stored payload. The page makes exactly one request (`GET /api/board/snapshot/[code]`), which reads the one row and nothing else.

### Gating design (the careful part)

- **Capability-by-unguessability, mint-gated, revocable** — the exact trust model of try-links (`api/try-link/*`), already proven in production. Minting requires `assertSsiAdmin`; the code is 128-bit random (not sequential, not derived from the label); `revoked_at` kills a leaked link instantly; a list view shows every live snapshot link and who minted it.
- **The snapshot endpoint has no query parameters that touch live tables.** It is a lookup of one jsonb row. There is structurally nothing to escalate: a leaked link leaks one frozen document, not a data surface.
- **Table posture at creation** (RLS doctrine rule 7): `board_snapshots` is service-role-only — RLS enabled, zero policies, all access through the two endpoints. No client ever queries it directly.
- **k-floor still applies inside the payload**: any comparative widget frozen into a snapshot was computed through `rateCompare.ts`, so pools under 5 were already "not enough data" at freeze time. Board-level aggregates (whole-platform counts) have no sovereignty exposure.
- PROPOSED: no expiry by default (a board report is meant to persist as the record), with optional expiry on mint for pre-release drafts. Revocation covers the leak case; auto-expiry of the official record would be a nuisance.
- PROPOSED: snapshot creation is the **only** outward-facing act in this design, and it's still just minting a capability — the send itself (email/message with the link) stays a human act. No auto-send.

### Why snapshot beats "read-only board login"

Better: the board reads a document, which is what a board wants; nothing goes stale mid-meeting. Simpler: no new role, no RLS work, no session lifecycle for outsiders — one table, two endpoints. Cheaper: reuses the try-link pattern and the admin gate wholesale; a board login would drag the org-table RLS timetable forward for six people who don't want a dashboard anyway.

## 6. Work packages — sonnet-sized, dependency-ordered

Feedback loops before every commit: `pnpm --filter player-vue typecheck && test && lint`. APML update rides each WP that changes surfaces.

### WP-1 — First slice: the page with three live numbers *(no dependencies)*

One page, three metrics, current narrative. Deliberately small.

- `api/_utils/boardMetrics.ts` — metric registry: `{ slug, label, method, resolve(svc) → { value, asOf } }`. Three metrics: `learners.active_30d`, `minutes.total_30d`, `schools.total`.
- `api/_utils/boardMetrics.test.ts` — resolver tests against mocked rows.
- `api/admin/board-metrics.ts` — `GET`, `assertSsiAdmin`, returns all registry metrics.
- `packages/player-vue/src/views/admin/BoardReportView.vue` — renders `docs/board/reports/2026-07.md` content (seeded from the existing report, three tokens substituted) with resolved values + as-of + method-on-hover; slot-9 dashboard block listing the three metrics.
- `packages/player-vue/src/router/index.ts` — register `/admin/board`.
- Token resolution util + test: `packages/player-vue/src/utils/boardTokens.ts` (parse `{{metric:...}}`, unknown token = visible error).

### WP-2 — Snapshot mechanism *(depends: WP-1)*

- `supabase/migrations/<ts>_board_snapshots.sql` — table per §5, RLS on, no policies, `NOTIFY pgrst, 'reload schema'`. **Migration authored in this WP, applied manually per current practice.**
- `api/admin/board-snapshot.ts` — `POST` freeze (resolve all tokens, hard-fail on any unresolvable, insert), `GET` list, `POST revoke`. Admin-gated.
- `api/board/snapshot/[code].ts` — public, single-row lookup, 404 on missing/revoked.
- `packages/player-vue/src/views/BoardSnapshotView.vue` + public route `/board/:code` — renders payload only; explicitly outside the admin guard.
- Freeze & share + link-list UI in `BoardReportView.vue`.

### WP-3 — Full metric inventory *(depends: WP-1; parallel with WP-2)*

- Extend `boardMetrics.ts` with the remaining §2 metrics, including the Popty-side queries (`courses.live_beta_count`, `courses.audio_coverage`) and growth series (`series:` kind).
- Sparkline/series rendering in the view (dataviz conventions; band + honest empty state).
- Slot-9 appendix grows to the full registry automatically.

### WP-4 — Comparison widget *(depends: WP-3)*

- Board-level rate-compare block reusing `api/_utils/rateCompare.ts` and the §5/metrics-vision display: global cohort curve, two-clock toggle, k-floor honoured. No new comparison math — wiring only.

### WP-5 — Monthly authoring loop *(depends: WP-2)*

- `docs/board/reports/` convention doc + template with the §3 skeleton and token palette.
- Report-month picker in `BoardReportView.vue` (render any month's authored file; default latest).
- PROPOSED, build only when chafing is real: draft/preview diffing ("what changed since last freeze").

## 7. Open forks (all marked, none blocking WP-1/2)

- **Prose in repo vs DB** (§1) — PROPOSED repo; revisit only if Tom wants to author in-app.
- **Commit-count metrics** (§2) — PROPOSED drop.
- **Snapshot expiry default** (§5) — PROPOSED none, optional on mint.
- **Slot-9 standalone "instant board view"** (§3) — PROPOSED yes; it's free once WP-1 lands.
- **Marketing-insight metrics** (Windsor/ad-spend etc.) — same registry shape, deliberately out of scope until a consumer exists (Principle 5: no signal before its consumer).
