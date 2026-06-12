# Teaching Insights — the tutor and teacher surfaces, on the Insight Engine

*A position paper on the next-generation insights dashboard for the people who **teach** — schools teachers and Anyone-Can-Teach tutors. Un-parks the schools revisit deferred in `admin-insights.md`, and answers `insight-engine.md` §8 Q2 ("how far does the engine reach beyond admin?") with: **this far, now.** Built to be argued with.*

**Status:** Think-piece for discussion — Tom + Claude, 2026-06-12.
**Companions:** `metrics-architecture.md` (the measurement model — §9 already sketches both audiences), `insight-engine.md` (the delivery system), `admin-insights.md` (the company lens this is the sibling of), `insight-engine-build-plan.md` (the substrate this proposes to reuse).
**Ground truth:** a full audit of the schools dashboard (16 composables, 12 views) and the telemetry pipeline (every emit site, every table), 2026-06-12.

---

## 1. The premise: two products got muddled, and we should stop extending the wrong one

The current `/schools` dashboard answers an **administration** question: *how many students, how many hours, which classes, who's enrolled.* Rosters, join codes, counts, hours-practised tiles. It does that adequately, and it should keep doing it.

A **teaching** dashboard answers a different question: *who needs me this week, what kind of help do they need, and is what I'm doing working?* That product barely exists — the closest things are a four-state health dot derived from seed counts and a benchmarks panel whose school and course comparisons are hardcoded to zero (`AnalyticsView.vue`).

The higgledy-piggledy feeling is not a styling problem; it is this category error compounding. Every time a teaching question came up, we answered it by adding aggregation to an administration page — another hand-rolled sparkline loop, another benchmark path, another magic number. The audit found the same 7-day sparkline computed independently in three views; **three separate benchmark aggregation paths** (`useAnalyticsData.getSchoolReport`, `useClassesData.getClassReport`, `DashboardView.benchFor`) constructing the same `{class, school, course}` object; two different health-bucketing implementations with drifting thresholds; `cycles / 30` estimating "LEGOs covered" in one view while another reads true `lego_progress.is_retired`; a journey bar scaled to `max(60, mastered)` because the course total was never fetched.

The fix is not to clean these up in place. The fix is the one we already committed to in `insight-engine.md` §6: **every board we build from here is an instance of the engine** — a metric defined and tested once in the registry, rendered by the widget library, never a one-off page. The teaching surfaces are the first real test of that commitment beyond admin.

---

## 2. Ground truth (what the 2026-06-12 audit established)

**The substrate is rich and mostly already flowing.** Tom's "telemetry-informed behaviours" — repeat-clicking, stopping, moving forward, pace — are largely captured today:

| Behaviour | Signal | State |
|---|---|---|
| Repeating / re-hearing | `phase_skip` with `direction: 'back'/'replay'` + `elapsed_in_phase_ms` | ✅ flowing since A1 |
| Confidence / skipping ahead | `phase_skip` `direction: 'forward'`, `tap_skip` | ✅ flowing |
| Stopping / stalling | `tap_pause` (with `during` context), session recency, drop-off position | ✅ flowing |
| Moving forward | `round_complete` (position), `course_enrollments.highest_completed_seed` | ✅ flowing |
| Pace | `playbackSpeed` inside `audio_play` payload | ⚠️ embedded, no explicit turbo-toggle event |
| Struggle | `spike_events` (latency vs rolling average), `learner_lego_metrics.mastery_state` | ✅ flowing |
| Speaking (VAD) | `VoiceActivityDetector` + `SpeechTimingAnalyzer` exist in `packages/core/src/audio/` | ⚠️ built, ~0% adoption, **key fields never persisted** |

**Orphaned signals worth knowing about:** `true_latency_ms` (VAD speech-onset latency), `started_during_prompt` / `still_speaking_at_voice1` (overlap flags), and the learner-vs-model `length_delta` are all computed in `MetricsTracker` and then dropped — never written to `response_metrics`. The execution axis has half its raw material already coded and thrown away.

**The class-play gap is the big one.** Class play — the dominant school mode — records only a thin `class_sessions` row (start/end LEGO, cycles, duration) keyed to `teacher_user_id`, a column the Lane B audit found dirty (mixed learner-ids / auth-uids / guest-ids). The rich per-cycle event stream *does* flow during class play, but attributed to whoever's logged in, indistinguishable from that person practising alone. The `device_class` field that `metrics-architecture.md` §7 calls **load-bearing** (`class_play | homework | tutor_session`) is specified but not implemented. Until events carry class context, every class-level insight is built on inference.

**No tutor entity exists.** Roles today are govt_admin / school_admin / teacher / student. The ACT tutor — an individual with a private roster of learners, no school — has no relationship in the schema.

---

## 3. The shape: two surfaces, one engine, no third product

Both teaching audiences are **lenses on the existing substrate**, exactly as `insight-engine.md` §5 promised ("a new audience is a different lens on one substrate, not a new product"). Concretely:

- **New frames** in the registry's vocabulary: `class` and `roster` (a tutor's student list) join self / group / world / content. The teacher's "my class vs the school" and the tutor's "my student vs all Spanish learners" are the same sovereign-comparison query at different `GROUP BY` levels — the unification we costed once and should now collect on.
- **A handful of new registry metrics**, each one tested definition replacing today's two-or-three duplicated client-side versions: `attentionScore`, `learnerProgress` (belt / seeds / hours — the Lens-A standing read), `calibration`, `classFriction` (= `contentFriction` scoped to a class/roster).
- **The widget library is already sufficient.** The triage list is `table` + `narrative-card`; the class picture is `scatter` (difficulty × execution plane, degrading gracefully to difficulty-only while VAD adoption is ~0%); standing is the already-built `SovereignComparison` widget; the debrief is `narrative-card` + `ranked-bar`. Zero new widgets for v1.
- **Lens discipline carries over.** A teacher looking at *their class vs the school* is Lens A (standing — celebratory, sovereign). A teacher looking at *which LEGOs hurt my class* is the content frame (actionable). They never share a screen, per the standing rule.

What this kills: the idea of "extending the schools analytics suite." `AnalyticsView.vue`'s hand-rolled aggregation, the three benchmark paths, the per-view sparkline loops — all replaced by engine instances, then deleted. Roster management, join codes, settings, setup stay exactly where they are: they're administration, and they're fine.

---

## 4. The tutor surface: one question, one screen

The tutor's entire dashboard is `metrics-architecture.md` §9, built as an engine board: **who needs my attention this week, and what *kind* of help do they need?**

- **A triage list**, default-sorted by the rule-based attention score already specified (no-activity, execution drop, skip-back burst, zero sessions, subscription state). Three students bubble to the top; the tutor acts on them; done. For five students it's a glance; for fifty the score does the triage. No charts on this screen.
- **Each row carries a calibration chip** — overconfident / underconfident / well-calibrated / not-yet-established — from the `phase_skip` confidence stream correlated with execution. This is the *kind-of-help* signal: overconfident wants gentle reality-checking and harder material; underconfident wants reassurance and a deliberate stretch. Same score, opposite interventions — the chip is what makes the list a teaching tool instead of a league table.
- **Each row terminates in graded actions** (the engine's try / investigate / together grammar): *"message Megan — 9 days quiet"* · *"look at S0042 with Huw — 6 back-skips this week"* · *"celebrate Eleri — top decile pace."* A curated recommender, never a taskmaster.
- **Drill-down is a re-scope, not a new page**: tapping a student re-runs the same lenses at entity level — their trajectory (curvature headline, per Principle 3: the *turn* is the alarm, not the level), their per-LEGO friction, their standing vs an aggregate they belong to (sovereign, k-floored).

What the tutor surface deliberately does **not** have: twelve views, hours-practised vanity tiles, or anything the tutor must interpret unaided. Where a number needs reading, the interpreter reads it (§7).

---

## 5. The teacher surface: the class is the learner

Class play means the teacher stands at the front and **joins in** — their attention belongs to the room, not a screen. So the design point that falls out of the classroom reality is:

> **The classroom needs a briefing and a debrief, not a HUD.** The teaching surface lives *before* the lesson (where we are, what's coming, who to keep an eye on) and *after* it (what happened). Never during.

- **The debrief card (post-class-session summary)** is the highest-value cheap build: when a class session ends, one narrative card — *"32 minutes, 41 cycles, S0051→S0058. You paused twice on S0055 — the third class this week to stall there."* The teacher's own taps during class play (pause, repeat, skip-back) are themselves class-level friction telemetry: a teacher pausing to explain *is* a friction marker on that LEGO for that class. Nobody is logging into a dashboard for this; it can land where the teacher already is (end-of-session screen, optionally email).
- **The class snapshot** is the teacher's standing read: class position and pace vs school and vs all classes on this course — the benchmark feature that today renders zeros, finally implemented once, in the registry, instead of three broken ways.
- **Individuals, honestly bounded.** Per-student signals come **only from homework** (`device_class = 'homework'`); class play is collective by nature and we don't pretend otherwise. The roster view is the same triage list as the tutor's, scoped to the class, with the explicit honest state: *"Maria keeps up in class but has no homework data — we can't tell how she's actually speaking."* That sentence is a feature, not a gap: it's also the teacher's lever for driving homework (and, later, VAD opt-in).
- **Friction law applies within the class:** a stall that concentrates on one student → triage list (adaptation/coaching). A stall that concentrates on one LEGO across the class → content signal, and if it shows across *many* classes it escalates to the company's content-friction board → Popty. Same pivot, same data, opposite owner — the teacher's debrief and the company quality queue are the same query at different scopes.

Admin and govt-admin views stay what they already are structurally — aggregations of the teacher view over the hierarchy — but rendered from the same registry metrics instead of parallel composable code.

---

## 6. The telemetry patch — the only instrumentation this needs

Per *earn-it*, each addition below has a named consumer in §4–5. Everything else already flows.

1. **Class/context tagging (the load-bearing one).** Every `player_events` row gains `device_class` (`class_play | homework | tutor_session | solo`) and, in class mode, `class_id` — carried explicitly, **not** inferred from the dirty `teacher_user_id` (Lane B fixes that column on its own track; new telemetry shouldn't depend on it). The player already knows it's in class mode (`ssi-active-class` context). Consumer: every class-level read in §5, and the protection of individual execution scores from collective-audio pollution.
2. **Explicit pace events.** `turbo_toggle` (specified in `metrics-architecture.md` §8, never wired) and a distinct `tap_repeat` if any user-initiated repeat control isn't already expressed as `phase_skip direction:'replay'` — check first; don't double-instrument. Consumer: the pace/rushing signal in the triage score.
3. **Persist the orphaned VAD fields.** Add `true_latency_ms`, `learner_duration_ms`, `duration_delta_ms`, `started_during_prompt`, `still_speaking_at_voice1` columns to `response_metrics` (they're already computed client-side; this is plumbing, not capture). Consumer: the execution axis the moment any learner opts in — instead of recomputing-and-discarding forever.
4. **Tutor roster relationship.** The one schema decision (see §9): most likely the existing `user_tags` pattern (`tag_type: 'tutor'`, `role_in_context: 'student'`) rather than a new table — it's exactly how class membership already works.

Explicitly **not** building: rollup tables (`learner_lego_state` / `learner_metrics`) until a live query strains — rosters are ≤50 students and the admin RPCs prove the SECURITY-DEFINER-RPC-over-raw-events pattern works; prosody capture push (adoption-paced, Phase 2 of the metrics plan, unchanged); any live in-class display.

---

## 7. The interpreter is what makes it world-class — and teaching is its best use case

The honest assessment of competitor dashboards (and our own current one) is that they hand a busy non-analyst a wall of numbers. The teacher with 28 students and five free minutes is the *least* served by charts and the *best* served by `insight-engine.md` §3.3's analyst-in-the-box:

> *"Three things this week: Megan's gone quiet (9 days — was daily); the class collectively stalls on S0055, third week running — that's the content, not them, and it's been flagged to SSi; and Huw's confidence taps now match his execution — the overconfidence you saw last month has resolved itself."*

Same engine, same cost discipline (aggregates only, on-demand, cached, admin/teacher-gated) — the teaching boards simply become the second consumer of the `explain`/`discover` call, after the admin DiscoveryFeed. For tutors and teachers the `together` action tier gets its natural meaning: *bring this to your next session with the student.*

Sovereignty notes specific to these audiences: a teacher/tutor has **visibility** over their own students (named, real numbers — that's their job), but every **comparison** shown remains entity-vs-aggregate; students never see each other; the k-floor applies to any cohort a learner is compared against; and minors' data stays inside the school scope. All enforced at the substrate, inherited by every board, per `insight-engine.md` §7.

---

## 8. Better × simpler × cheaper — the accounting

- **Better:** teaching questions answered directly (triage + kind-of-help + debrief) instead of administration counts; curvature and calibration signals surfaced to the people who can act on them; class play finally measured as what it is.
- **Simpler:** one metric definition each, in the registry, where today there are two or three drifting client-side versions; the tutor product is *one screen*; `AnalyticsView`'s bespoke aggregation and the three benchmark paths get **deleted**, not maintained.
- **Cheaper:** ~2 new RPCs + ~4 registry entries + boards assembled from existing widgets, versus the counterfactual of growing the 16-composable suite; server-side scoped RPCs also pre-position us for the RLS tightening (one place to police per metric, instead of sixteen composables to audit).

---

## 9. Decisions (for Tom)

1. **Tutor roster schema** — `user_tags` pattern (lean, consistent with classes) or a first-class `tutors`/`tutor_students` table? Lean says tags until ACT has paying volume.
2. **Where the teacher boards live** — inside `/schools` (teachers already log in there) with the engine imported, or on the `/admin/insights` host generalised? Lean: render inside `/schools`, engine as a library — the audience shouldn't move, the code should.
3. **Attention-score thresholds** — adopt the §9 rule-sum as-is and tune against real rosters, or pilot-tune first? Lean: ship as-is behind the teacher view; it's a sort order, not a verdict.
4. **Deletion timing** — remove `AnalyticsView`'s hand-rolled aggregation when the class snapshot board lands, or run both for a soak? Lean: one staging soak, then delete; two parallel answers to one question is how we got here.
5. **Debrief delivery** — end-of-session screen only, or also a weekly email digest? (The email is the retention hook for tutors who won't open a dashboard.)
