# SSi Methodology Documentation

> Central repository for SSi learning methodology specifications.
> As Aran noted: "You can just add this kind of data dump to Claude's files and it never gets lost or forgotten."

## Documents

| File | Status | Description |
|------|--------|-------------|
| [listening-layers.md](./listening-layers.md) | Design | Layer 1 (reactivation) and Layer 2 (acquisition) listening system |
| [conversational-flow-priming.md](./conversational-flow-priming.md) | Think-piece (2026-06-15, open — **not start-now**) | Aran's **day-45 Croatian** feedback: by ~day 45 the functional blocks are cold but the gap is *running a live conversation* — a **practice-flows** gap, not a missing-ingredients one. Central unresolved cut: where the fix lives — **speech-side priming** vs **escalating the listening pods** vs **growing the seeds**. Speech mechanisms floated: prompt-pairing / conversational connective tissue ("I'm not sure what to say" → "take your time, would you like to talk about fish?"), and TL-prompt→TL-response resolved as "you could've said one of these three" → which itself becomes a listening exercise. Seeds thin on **interlocutor turns** (the other person's lines). Ties to `adaptation-budget.md` §3 (meta-communication = early-criticality → is day-45-absence a *sequencing bug*?). **Decision: don't build now** — ship schools+freelancers → podcasts → methodology → next 7-day test forms the candidate solutions. Open questions in §8 |
| [metrics-implementation-plan.md](./metrics-implementation-plan.md) | Plan (approved) | Project plan for building the metrics architecture — workstreams A–G, dependency map + critical path (telemetry foundation is the bottleneck), parallelisation/sub-agent fan-out map, milestones M0–M5, guardrails |
| [metrics-architecture.md](./metrics-architecture.md) | Design | Two-axis (difficulty × execution) metrics layer; **rate-of-change (2nd-derivative) as the primary lens**; contextual *(learner × unit)* difficulty + consolidate/defer/drill adaptation budget; no-ASR prosody capture; self-assessment calibration from phase-pill clicks; CEFR-via-calibration with a pilot-coupled timeframe, anchored on SSi's 17-year empirical baseline |
| [tutor-insights.md](./tutor-insights.md) | Think-piece (rev. 2026-06-13, decisions settled) | Teaching insights as **two lanes on one engine**: **attention** (solo play — tutor/homework triage + calibration chip, per-student) and **coverage** (class play — **the class as a learner-equivalent**: full learner self-view/summaries/what-it's-done, read by its teacher and the leaders above; pace/dosage/efficiency the leadership distillation; no fabricated per-pupil data). Corrects the admin-vs-teacher split; coverage ships on existing `class_sessions` rows (clean `class_id`), no new instrumentation. §7 decisions settled |
| [class-first-class-citizen.md](./class-first-class-citizen.md) | Build map | The data-model + blast radius behind tutor-insights §5 — teacher↔class becomes a time-bounded `user_tags` relationship (handover / co-teaching / supply / teacher-leaves); class stays a **hard belonging to a school** (`school_id` FK; ACT = no-school); grouping above it is **flexible overlapping tags** (year/dept/faculty/chain), not a folder tree. Migration `20260613_class_first_class_citizen.sql` (additive, drafted, **not applied**); ownership sites across schools composables, the `api/` server layer, and the live RLS (owner→membership swap, god + school-admin branches kept); rollout order. Grouping layer = follow-on |
| [flexible-grouping.md](./flexible-grouping.md) | Think-piece (2026-06-14) | The open design area from tutor-insights §5/§7 — the layer **above** the class. **Belonging is singular+hard** (a class's `school_id` FK); **grouping is plural+soft** (year/department/faculty/key-stage/house/cohort/chain, overlapping) → expressed as time-bounded relationship tags (the same primitive as students/teachers, one level up), **not** the rigid `groups` path-tree. A leader's scope = a predicate over those tags (school-leader = the FK, needs zero grouping rows; dept/year scope added when a school asks). Roll-up = the coverage board at a higher `GROUP BY`; sovereignty k-floor carries up unchanged. Consumer-first / earn-it; doesn't block the teacher↔class migration |
| [adaptation-budget.md](./adaptation-budget.md) | Think-piece (2026-06-13) | The M2 controller design — how the curvature engine (B1, shipped) drives a finite-session **consolidate / defer / drill** budget. Control objective = damp local acceleration before a struggle crashes; criticality = **introduction order** (not frequency); return = the **Fibonacci SR** schedule; levers = pause multiplier + rep count (invisible per Principle 1); visible actions go to a `surface_to_human` queue, never silent. Honest dependency: **C is not start-now** — the next code step toward it is **B4** (curvature per unit) + persisted Layer 1, not the controller itself. §8 open questions for Tom/Aran |

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
