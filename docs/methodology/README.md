# SSi Methodology Documentation

> Central repository for SSi learning methodology specifications.
> As Aran noted: "You can just add this kind of data dump to Claude's files and it never gets lost or forgotten."

## Documents

| File | Status | Description |
|------|--------|-------------|
| [listening-layers.md](./listening-layers.md) | Design | Layer 1 (reactivation) and Layer 2 (acquisition) listening system |
| [metrics-implementation-plan.md](./metrics-implementation-plan.md) | Plan (approved) | Project plan for building the metrics architecture — workstreams A–G, dependency map + critical path (telemetry foundation is the bottleneck), parallelisation/sub-agent fan-out map, milestones M0–M5, guardrails |
| [metrics-architecture.md](./metrics-architecture.md) | Design | Two-axis (difficulty × execution) metrics layer; **rate-of-change (2nd-derivative) as the primary lens**; contextual *(learner × unit)* difficulty + consolidate/defer/drill adaptation budget; no-ASR prosody capture; self-assessment calibration from phase-pill clicks; CEFR-via-calibration with a pilot-coupled timeframe, anchored on SSi's 17-year empirical baseline |
| [tutor-insights.md](./tutor-insights.md) | Think-piece (rev. 2026-06-13) | Teaching insights as **two lanes on one engine**: **attention** (solo play — tutor/homework triage + calibration chip, per-student) and **coverage** (class play — a *leadership* product of pace/dosage/efficiency over wall-clock, performance-free, teacher is producer not consumer). Corrects the admin-vs-teacher split; coverage ships on existing `class_sessions` rows (clean `class_id`), no new instrumentation |
| [class-first-class-citizen.md](./class-first-class-citizen.md) | Build map | The data-model + blast radius behind tutor-insights §6 — teacher↔class becomes a time-bounded `user_tags` relationship (handover / co-teaching / supply / teacher-leaves), class becomes durable; migration `20260613_class_first_class_citizen.sql` (additive, drafted, **not applied**); ownership sites across the schools composables, the `api/` server layer (incl. a **financial commission decision**), and the live RLS policies (owner→membership swap, god + school-admin branches kept); rollout order |

## Adding New Methodology

When capturing methodology insights:

1. Create a new markdown file in this directory
2. Include source attribution and date
3. Structure with clear sections: Purpose, Behavior, Parameters
4. Note implementation considerations
5. List open questions/TBDs

## Related APML Specs

The methodology docs inform the APML specifications in `/apml/`:
- `learning/spaced-repetition.apml` - Fibonacci decay system
- `learning/triple-helix.apml` - Thread interleaving
- `learning/listening-layers.apml` - Layer 1/Layer 2 listening system
- `learning/adaptation-engine.apml` - Real-time difficulty adjustment
- `learning/phrase-selection.apml` - Phrase selection algorithm

---

*This directory serves as the "methodology file" Aran mentioned - a persistent record of learning design decisions that informs implementation.*
