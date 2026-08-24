# The Insight Engine — Build Plan

*The concrete build for the architecture in [insight-engine.md](./insight-engine.md). That paper is the **why**; this is the **what, in what order, and against what ground truth**. Built to be argued with.*

**Status:** Build plan, 2026-06-02 — Tom + Aran. Decisions locked below; build initiated via multi-agent workflow.
**Companions:** `insight-engine.md` (the position paper), `admin-insights.md` (the catalogue / §6 first cut), `metrics-architecture.md` (the measurement model), `metrics-implementation-plan.md` (the broader metrics/adaptation programme this sits inside).

---

## 0. What this builds

Not a dashboard. The **engine** that drives the marginal cost of a new question toward zero: Claude is the **director** (emits a declarative JSON spec — `{ widget, data, annotate, story, actions, frame }`), the **app builds** (renders that spec from a fixed widget library). The real foundation is **the widget library + the semantic substrate**; Claude stays the thin spec-emitting layer between a question and a render.

This plan delivers the **substrate-first** half — registry + widget library + the first boards, on raw queries, **no LLM call yet**. The billed `explain`/`discover` interpreter (the CE-Alexander pattern, `insight-engine.md` §3.3) is Phase 4, added once there are boards worth interpreting.

---

## 1. Ground truth (from the deep-explore, 2026-06-02)

**The substrate is live and rich — no rollup tables needed yet.**

| Source | Shape | Notes |
|---|---|---|
| `player_events` | ~84k/30d; `user_id` UUID, JSONB `payload`, `event_type`, `course_code`, `device_type`, `client_version`, `ip_country`, `occurred_at` | `audio_play`, `audio_failed`, `round_complete`, `tap_skip/pause/play`, `phase_skip` (payload `direction` + `elapsed_in_phase_ms` + `legoId`/`seedId`), pod + commentary events. Admin-read. |
| `learner_speaking_opportunities` | per (learner, course, UTC-day): `opportunities`, `play_seconds` | days-active, minutes, retention |
| `course_enrollments` | `last/highest_completed_lego_id`, `highest_completed_seed`, `total_practice_minutes`, `last_practiced_at` | the difficulty-axis position |
| `learner_lego_metrics` | `mastery_state`, `n_samples` per (learner, lego) | per-LEGO mastery |
| `daily_contributions` | per (language, day) | community totals |
| `subscriptions` | `status`, `signup_course_code` | **0 rows today** — resolvers return zeros gracefully |

**Existing RPCs to reuse** (SECURITY DEFINER, `is_god_user()`-gated, anon-key callable): `analytics_overview`, `analytics_growth`, `analytics_engagement`, `analytics_retention_cohorts`, `analytics_friction_map`. Existing composables `useAnalytics{Overview,Growth,Engagement,Retention,Friction}.ts`.

**Join hazard:** `player_events.user_id` is UUID; `learners.user_id` is TEXT → join via `::text`.

**Rendering is half-proven.** The gallery `public/docs/insight-examples.html` proved **7 of 12 shapes in ECharts** (treemap, funnel, heatmap, sankey, scatter+effectScatter, donut, standing-bar). But the app renders in **D3** (4 hand-rolled components) — there is **no spec contract, no registry, no spec-driven library, no `/admin/insights`**. That is the build.

---

## 2. Decisions locked

- **ECharts** — admin-only, lazy-loaded. Gallery configs port nearly verbatim; the spec contract keeps the engine swappable. (The one cost D3 avoids — a dependency — is neutralised because nothing here ships to a learner.)
- **Desktop-first** — sized for desktop sessions; degrades gracefully on mobile, not optimised for it.
- **Frostwell Courtyard** — the *current* admin canon in this repo (not Popty/v7, a separate repo). Build native to Frostwell tokens; **no hardcoded hex**.
- **Substrate-first** — registry + widgets + boards on raw queries, no LLM. The billed `explain`/`discover` call is deferred to Phase 4.

**Open (for Aran):** Phase-4 interpreter timing (`insight-engine.md` §8 Q1) — defaulted to substrate-first; trivial to flip.

---

## 3. Architecture — the spine is the load-bearing contract

Everything fans out *against* a single typed contract. Get it right and 18 agents build in parallel safely; skip it and they build against guesses.

```
packages/player-vue/src/insight/
  spec.ts              # InsightSpec + per-widget data types (the contract)
  registry.ts          # metric id → { def, resolver }  (the semantic substrate)
  theme.ts             # Frostwell ECharts theme (tokens, not literals)
  InsightWidget.vue    # dispatcher + the FOUR BEHAVIOURS wrapper
  widgets/<Name>.vue   # one file per widget — resolves by naming convention
  data/<metric>.ts     # one resolver per metric (read-only)
  boards/<Board>.vue   # saved compositions = arrangements of specs
  InsightsView.vue     # /admin/insights host (board switcher)
```

**The four behaviours live on the wrapper, not each widget** (defined once): *annotatable* (mark the point that IS the story), *interrogable* (a quiet "why?" → an `interrogate` event), *sovereign* (entity-vs-aggregate + k-anonymity floor, never a named peer), *action-terminated & drillable* (graded actions footer: try / investigate / together + owner). Widgets render only the chart from resolved data + annotations.

**Conflict-free parallelism:** every agent creates its own file; the dispatcher resolves widgets by naming convention so adding a widget needs no shared edit. Only integration touches shared files (`router/index.ts`, `AdminTopBar.vue`).

---

## 4. The build (phased, parallel where it can be)

**Spine (sequential) → 13 widgets + 5 queries (concurrent) → 3 boards (parallel) → integration (sequential).**

### Widget library (13 — Stat is the reference, built with the spine)
`stat` (+ donut variant) · `time-series` · `ranked-bar` · `sovereign-comparison`/standing · `distribution` · `scatter` · `funnel` · `flow`/Sankey · `cohort-grid`/heatmap · `map` · `table` · `narrative-card` · `treemap`. Seven port from the gallery; the rest are new.

### Registry — five metrics (the §6 first cut)
1. **courseValue** — LTV-proxy = reach × stickiness × retention, per course (world/content).
2. **contentFriction** — per-unit (lego/seed) skip-back + stall + drop-off + audio_failed (content; reuses `analytics_friction_map`).
3. **retention** — days-active + return-rate 7/30/90d (group/world; reuses `analytics_retention_cohorts`).
4. **health** — `audio_failed` rate, `cacheHit`, `client_version` spread, device spread (world/ops).
5. **trialConversion** — trial→paid funnel (**stub** — 0 rows; returns zeros).

### Boards — three, all Lens B (company "what should we do?")
1. **Course Scoreboard** — treemap + ranked-bar + KPIs (courseValue, retention).
2. **Content-Friction** — cohort-grid heatmap + ranked-bar of top friction units, each → a Popty action (contentFriction).
3. **Health strip** — stat + donut (build-sha spread) + time-series failure trend (health).

The **sovereign-comparison/standing** widget (Lens A) is built into the library but *not* placed on these Lens-B boards — A and B never share a screen.

---

## 5. The quality harness (ultracode grade)

1. **Spine design panel** — 3 independent contract designs → judged → synthesised. The data-type model is inherited by every downstream agent; it is not one-shot.
2. **Adversarial widget verify** — a skeptic per widget: renders the right shape? four behaviours? Frostwell tokens only? typechecks?
3. **Completeness critic + build gate** — final pass on what's missing (a widget that won't typecheck, a metric with no consumer, a board referencing a missing widget) + a real `pnpm --filter player-vue typecheck`.
4. **Human verifies by git diff**, not just agent reports.

---

## 6. Guardrails (non-negotiable)

- **Read-only queries.** New SQL → a migration *file* in `supabase/migrations/` for Tom to apply. Never an ad-hoc write.
- **Nothing committed or pushed** — work lands in the `ssi-buffer-model` working tree on `dev` for review.
- **No Anthropic API in service code** — Phase 4's call is the deliberate, billed exception (CE-Alexander pattern), aggregates-only, admin-gated, cached.
- **No auto-interrupt; subscription tier stays a stub** until it has rows.
- **APML:** the engine gets a spec under `apml/`.
- **BSC + earn-it:** no richer signal before its consumer exists.
