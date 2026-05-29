# Metrics & Adaptation — Implementation Plan

*Project plan for building the architecture specified in [metrics-architecture.md](./metrics-architecture.md).*

**Status:** Draft v0.1 — for Tom/Aran/Colombo planning. Approved to proceed (Aran, 2026-05-29).
**Date:** 2026-05-29.
**Companion:** `metrics-architecture.md` (the what + why), `metrics-vision.html` (the interactive position paper).

---

## 0. How to read this plan

The spec is large, but it has a **natural shape** that makes most of it parallelisable:

1. **Behavioural-first.** ~26k telemetry events exist today; prosody/VAD is ~0%. So the first dashboards, the first adaptation, and the first competence band all run on data we already have. Prosody is a parallel track paced by *adoption*, not by build time.
2. **One data chain.** Layer 0 (events) → Layer 1 (per learner-LEGO) → Layer 2 (per learner) → Layer 3 (cohort) → Layer 4 (views + engine). This chain is the **critical path**; almost everything reads from it.
3. **Three priorities = three reference frames.** *Adapt* (relative to self) · *Surface* (relative to group) · *Certify* (relative to the world). They can be built in parallel once the data chain exists.

**Governing discipline (from the spec):** better × simpler × cheaper, and *don't build a signal before its consumer exists* (Principle 5). Several "obvious" pieces are deliberately deferred below for this reason.

---

## 1. Workstreams

Each workstream lists its tasks, what it **depends on**, and whether it can run **in parallel** as an independent sub-agent. Key existing files are named for the Colombo handoff.

### A — Telemetry & state foundation  ·  CRITICAL PATH  ·  do first
The chain everything reads from. Mostly serial within itself; gates B, C, D(real-data), G.

| # | Task | Notes |
|---|---|---|
| A1 | **Wire phase-pill events** — emit `phase_skip_forward` / `phase_skip_back` (with `elapsed_in_phase_ms`) to `player_events`. | Smallest unlock, biggest payoff. Handlers already exist; just add the emit. `payload` is JSONB, no migration. |
| A2 | Audit existing behavioural events for completeness (skip, pause, turbo, session_start/end, round_complete). | Most already flow. |
| A3 | **Layer 1 table** `learner_lego_state` + rollup job off the event stream. | Extend existing `learner_lego_metrics` rather than make a parallel table. Migration → folder, Tom applies. |
| A4 | **Layer 2 table** `learner_metrics` (difficulty coord, behavioural execution coord, baseline latency, streak, calibration, attention score) + 5-min refresh. | |

**Parallel?** A1 ships alone immediately. A3/A4 can be built in parallel once schemas are agreed. **A is the bottleneck — resource it first.**

### B — Metrics compute layer
Turns raw state into the signals the spec defines. Pure-ish compute — **can be prototyped on synthetic data in parallel with A**, then pointed at real Layer 1/2.

| # | Task | Depends |
|---|---|---|
| B1 | **Curvature engine** — level / velocity / acceleration over a smoothed, min-cycle-gated series, per metric (Savitzky-Golay-style local fit; stop at 2nd order). | synthetic → A |
| B2 | **Behavioural execution proxy** — the y-axis stand-in from skip-latency, skip-back, completion, turbo, streak (until prosody). | A |
| B3 | **Self-assessment calibration** — correlation of confidence-skips vs execution over a rolling window. | A1 |
| B4 | **Local difficulty sensing** — curvature per (learner, LEGO / word / boundary). | B1 + A3 |

**Parallel?** B1 is the strongest immediate parallel candidate (build + unit-test on the synthetic curves from Figure A). B2–B4 follow A.

### C — Adaptation engine  ·  the *Adapt* priority (self)
| # | Task | Depends |
|---|---|---|
| C1 | **Defer / drill / consolidate budget policy.** Criticality = *introduction order* (conversational impact, not frequency); return trigger = the existing **Fibonacci SR schedule**. No new tag/centrality yet (earn it). | B4 |
| C2 | **Acceleration-damping controller** — nudge pause multiplier (ratio to model length) + rep count to keep local curvature near zero. Extends `AdaptationEngine.ts` / `MetricsTracker.ts`; persist Layer 1 state. | B + A3 |
| C3 | **`surface_to_human` queue** — engine actions that need human sign-off (switch course, drop a track) written for the dashboard to read, not done silently. | A4 |

**Parallel?** Independent of dashboards (D). Needs B. Invisible to the learner by design (Principle 1).

### D — Dashboards & the comparison model  ·  the *Surface* priority (group)
| # | Task | Depends |
|---|---|---|
| D1 | **The comparison primitive** — one curve-overlay chart: entity vs aggregate band, in-app/wall-clock clock toggle, efficiency/intensity readout. | **none** (synthetic) — prototype exists in `metrics-vision.html` Figure B |
| D2 | **Sovereign comparison engine** — entity→aggregate resolution; *like-with-like* aggregation; **k-anonymity** floor; visibility-vs-comparison separation. | A4 (Layer 2/3) |
| D3 | **Teacher dashboard** — "needs attention" list = group-relative position **+** who-just-changed (curvature) overlay; class scatter (execution axis arrives with F). Extends `DashboardView.vue` / `useAnalyticsData.ts`. | B + D2 |
| D4 | **Admin / gov views** — aggregations over the hierarchy drill-down (drill-down already shipped); add the metrics + comparison bands. | D2 + D3 |
| D5 | **Tutor dashboard (ACT private)** — attention-score-ranked student list + calibration indicator. | B + D2 |

**Parallel?** **D1 is a pure-frontend parallel task that can start now.** D2 follows A. D3/D4/D5 are parallelisable among themselves once B + D2 land.

### E — Methodology explainer pages  ·  trust + adoption + handoff
Each page is a self-contained interactive (like the position paper) — **the most parallelisable workstream: one sub-agent per page.**

| # | Task | Depends |
|---|---|---|
| E1 | Position paper — **done**, live at `/admin/methodology`. | — |
| E2 | `/methodology/*` pages: difficulty×execution plane · calibration · empirical 30/100h curves · LEGO mastery. One self-contained page each. | none |
| E3 | **Settings-as-discovery** — every Settings toggle links to its explainer (primary driver of VAD opt-in). | E2 |

**Parallel?** E2 is N independent pages — ideal sub-agent fan-out.

### F — Prosody / VAD (executional tier)  ·  paced by adoption
The most novel part; ~0% data today. Build can run ahead of adoption.

| # | Task | Depends |
|---|---|---|
| F1 | **Browser DSP module** — F0 contour, amplitude envelope, voiced segmentation, spectral centroid, tempo → `execution_score` (no ASR, no server round-trip). `packages/player-vue/src/lib/prosody/`. | none (self-contained) |
| F2 | **`cycle_prosody` capture** — hook into `CycleOrchestrator`; post events. | F1 + A |
| F3 | **Adoption** — explainer pages (E), default-on for tutored learners, VAD-lite tier. | E2 + F2 |

**Parallel?** F1 is a hard, self-contained eng task — strong independent parallel candidate. Adoption (F3) is UX/trust, paced by E.

### G — CEFR calibration & pilots  ·  the *Certify* priority (world)
| # | Task | When |
|---|---|---|
| G1 | **Flat hours-band** output ("~30h ≈ entry, ~100h ≈ B1"), admin/tutor-gated, heavy caveats. Uses `total_practice_minutes` — exists now. | now |
| G2 | **Pilot instrumentation** — ingest paired external CEFR-aligned assessment from Wales/Ireland schools. | 2026–27 pilots |
| G3 | Cluster discovery + calibration mapping (research, not eng). | needs corpus + pilot pairs |
| G4 | Confidence-weighted best-fit output (range + confidence; never a hard level). | 2027 → 2028 |

**Parallel?** G1 now. G2–G4 are **coupled to the pilots**, not to build capacity.

---

## 2. Dependency map & critical path

```
        ┌───────────────────────────── CRITICAL PATH ─────────────────────────────┐
A1 events → A2 audit → A3 Layer1 → A4 Layer2 → (B2,B3,B4 metrics) → C engine
                                              └→ D2 sovereign engine → D3/D4/D5 dashboards
START-NOW IN PARALLEL (little/no dependency):
  • A1 (phase-pill events)        • B1 (curvature lib, synthetic)
  • D1 (comparison chart, synthetic)  • E2 (explainer pages — N parallel)
  • F1 (DSP module)               • G1 (flat hours band)
PILOT-COUPLED (2026–27, not build-gated):  G2 → G3 → G4
```

**The one bottleneck is A (telemetry/state foundation).** Everything that needs *real* data waits on it, so it is the first thing to resource. Six things can run the moment we start, before A finishes.

---

## 3. Parallelisation map (sub-agent fan-out)

Tasks that are genuinely independent and safe to run as parallel sub-agents **today**:

- **Curvature engine (B1)** — spec'd maths, synthetic test data, no app coupling.
- **Comparison chart component (D1)** — pure frontend, prototype already exists in Figure B.
- **Explainer pages (E2)** — one sub-agent per page; zero shared state.
- **DSP / prosody module (F1)** — isolated `lib/prosody/`, testable on audio fixtures.
- **Flat hours-band (G1)** — small, reads existing data.
- **Phase-pill events (A1)** — small, self-contained emit.

Tasks that should **not** be parallelised blindly (shared schema / production data / sequencing):
- A3/A4 schema (agree the schema once, then build) — DB migrations go to the folder for Tom to apply; **never ad-hoc mutate production data**.
- C2 controller (touches live `AdaptationEngine`; must not be felt by learners; **never auto-interrupt a session**).
- D2 sovereign engine (the k-anonymity floor is a correctness/privacy gate — single careful owner).

---

## 4. Milestones (outcomes, not tasks)

| # | Outcome | Rough horizon |
|---|---|---|
| **M0** | Right data flowing (phase-pill wired); crude competence band visible to admin; position paper live. | days |
| **M1** | Behavioural metrics persisted; curvature signal live; teacher "needs attention" list (group-relative + who-changed) + comparison chart on **real** data. | weeks |
| **M2** | Adaptation engine running defer/drill/consolidate + acceleration damping; explainer pages driving VAD opt-in. | weeks–months |
| **M3** | Prosody/execution axis live for opt-in users; dashboards gain the second dimension. | months (adoption-paced) |
| **M4** | Pilot calibration underway; Welsh lower-to-mid CEFR best-fit. | 2026–27 pilots → 2027 |
| **M5** | Population clusters; multi-band, multi-language sharpening. | 2028+ |

Parallel sub-agents compress wall-clock between milestones, but **M1 onward is gated on M0's foundation (A)** — that gate is real.

---

## 5. Guardrails (non-negotiable)

- **Production data:** migrations into `supabase/migrations/` for Tom to run; no ad-hoc write scripts; read-only queries/dumps only (`scripts/check-tele.cjs`).
- **Never auto-interrupt a learner session** — updates/SW/reloads are explicit user taps.
- **No Anthropic API** in service code — Claude CLI only (subscription).
- **BSC + earn-it:** no richer signal (explicit layer tag, graph centrality, prosody adoption machinery, CEFR output) before its consumer exists.
- **APML:** functional changes update the relevant `apml/` spec in the same commit.
- **Branch flow:** all work to `dev` → soak on `staging` → `main`.

---

## 6. Open resourcing questions (for Tom / Aran / Colombo)

1. Who owns **A (foundation)** — the bottleneck? It wants a single careful owner, fast.
2. How many parallel sub-agents do we want to run at once, and on which of the six start-now tasks first?
3. Colombo handoff point — do they take A (production schema/rollups) from the start, or do we prototype B1/D1/E2/F1 ourselves and hand them the foundation?
4. Pilot data contract (G2) — what exactly will Wales/Ireland schools hand us as external CEFR truth (teacher judgement / formal exam / both), and when?
