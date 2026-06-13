# Teaching Insights — two lanes, one engine: attention and coverage

*The insight surfaces for the people around the learning — schools teachers, the leaders above them, and Anyone-Can-Teach tutors. Built to be argued with. (Supersedes the 2026-06-12 draft; what changed is in the appendix.)*

**Status:** Think-piece, revised — Tom + Claude, 2026-06-13.
**Companions:** `metrics-architecture.md` (the measurement model), `insight-engine.md` (the delivery system), `admin-insights.md` (the company-lens sibling), `class-first-class-citizen.md` (the data-model + blast-radius behind §5).
**Ground truth:** the 2026-06-12 audit and live introspection on 2026-06-13 — 78 `class_sessions` on a clean `class_id` (100% with end-LEGO + duration), and the tell: 168 `class/student` tags, **0** `class/teacher`. (Pilot/test entities — what's real is the *shape* of the pipe.)

---

## 1. The cut: attention vs coverage

> **Solo play produces a question — "how is this learner doing? someone go look." Class play produces a rate — "how fast is this cohort moving, and how much is it doing?"** The first is the tutor's and the teacher's. The second is the leadership stack's. They are different products with different audiences, and conflating them is the category error that made the schools dashboard feel like a junk drawer.

The old framing split the world into *administration vs teaching* and aimed a teaching dashboard at the teacher. The right line is **attention vs coverage**, and it falls out of one fact the canonical doc already states. `metrics-architecture.md` §7 says of class play: *"there is no way to attribute the captured audio to individual students… the metrics extracted here belong to the **class**, not to any student in it."* Exactly right. But §9 then hands those class-belonging metrics back to **the teacher** — "is my class on track?", a scatter plane, a calibration summary.

The teacher is the one person who doesn't need them. In class play the teacher drives every cycle: they chose to replay S0055, they chose to skip ahead, they watched the room do it. A dashboard reporting *what they just did* answers a question they don't have — it reads back their own afternoon. The metrics belong to the class, yes — and **the audience for a class-belonging metric is whoever is above the class**, because the person inside it already knows.

There is exactly one genuinely new fact a post-class readout could carry — *"the third class this week to stall on S0055."* That's real, but it's **content quality**, not teacher feedback (per Tom's friction law, `admin-insights.md` §1: friction that stays with a *unit across classes* is a curriculum problem). It routes to Popty and the curriculum owner; if it ever reaches a teacher it's a *forward briefing* ("S0055 tends to be sticky"), never a backward debrief. The old draft filed the right signal under the wrong reader.

---

## 2. The coverage lane — a leadership product

Class play's signal is for the people accountable for *many* classes over time: a school leader, a head of department, a multi-academy-trust or local-authority lead, a government or inspectorate view. Each tier up is the same query rolled up a level — the `insight-engine.md` §5 promise ("a new audience is a different lens on one substrate"). **The teacher is the producer of this signal, not its consumer.**

A deliberately small, deliberately performance-free metric set:

- **Coverage** — where each class has reached in the program (its furthest LEGO; seed is the rollup).
- **Coverage over wall-clock time** — the *rate of advance through the program* in calendar terms, per week or month. This is the headline. A teacher who says "you've got this — straight to the next new item", often, with the class keeping up, shows up as a fast, healthy curve. (A performance lens misreads that skip as missing data; the coverage lens reads it as the mastery signal it is. Skipping ahead is a feature, and only this framing makes it legible.)
- **Active minutes per class, per day / week / month** — dosage. The *flow rate* of use, not a cumulative "hours practised" vanity tile.
- **Coverage per active-minute** — efficiency. Two classes at the same coverage but very different minutes are telling a leader two different stories; that contrast is the leadership question.

No execution scores, no calibration, no per-pupil breakdown, no behaviour debrief — a class performance is collective and teacher-driven, so performance metrics on it are noise. The leader's questions are **pace, dosage, and efficiency**, and nothing else.

Because coverage belongs to the durable class and accrues across every session whoever drove each one, **teacher churn is invisible to the curve** — a class changing teacher, sharing two, taking a supply, or losing one to another school never breaks it. That property is the whole point of §5, and it is what a leadership product needs to mean anything over a year.

The widgets already exist (`insight-engine.md` §3.4): coverage-over-time and dosage are `time-series`; the per-class league of pace/efficiency is `ranked-bar`/`table`; a leader comparing their own classes is `sovereign-comparison`. Zero new widgets. (Sovereignty: a leader has *visibility* over their own classes, so named within-school comparison is fine; anything shown across schools, or to a teacher about peers, stays entity-vs-aggregate with the k-floor — `insight-engine.md` §7.)

---

## 3. The coverage lane is cheaper than it looks — and already instrumented

The old draft, and the pessimism in `metrics-architecture.md` §7–§9 about class-level data, treated class signals as built on inference until every `player_event` carries `device_class` and `class_id`. That's true for **per-pupil** signals inside a class — and false for **coverage**.

`class_sessions` already carries everything coverage needs, on a **clean `class_id` foreign key** (not the dirty `teacher_user_id`): `start_lego_id` (NOT NULL) → `end_lego_id`, `duration_seconds`, and `started_at`/`ended_at`. Verified live 2026-06-13: 78 rows across 7 classes, 100% with a populated end-LEGO and duration; a sample class ran `S0012L01 → S0014L01` in 2,094 seconds across 190 cycles in one evening.

So the lane is a group-by over rows that already flow: coverage = furthest `end_lego_id` per class; rate = that bucketed by `started_at`; dosage = `SUM(duration_seconds)` per period; efficiency = LEGOs ÷ minutes. Two consequences. **It needs zero new event instrumentation** — a single new aggregate over `class_sessions` (note: the existing `class_activity_stats` view is *not* it — that aggregates the per-learner `sessions` table, i.e. homework, so it gives dosage-of-individuals, not class-play coverage). **And it is independent of the Lane B identity cleanup** — coverage groups by `class_id`, so the dirty `teacher_user_id` never enters it. The expensive `device_class` + `class_id`-on-every-event patch is still needed, but only for the attention lane's homework attribution (§4), never for coverage.

---

## 4. The attention lane — keep it; it's right

Where a learner practised **alone** — homework, or an ACT tutor's roster — nobody watched, so a per-student read is legitimate and valuable. This is `metrics-architecture.md` §9 (Tutor) as an engine board:

- **A triage list**, default-sorted by the rule-based attention score already specified (no-activity, execution drop, skip-back burst, zero sessions, subscription state). Three names bubble up; the tutor acts; done. No charts.
- **A calibration chip per row** — overconfident / underconfident / well-calibrated / not-yet-established — the *kind-of-help* signal that makes the list a teaching tool, not a league table. Same score, opposite intervention.
- **Graded actions** in the engine's *try / investigate / together* grammar — *"message Megan — 9 days quiet"*, *"look at S0042 with Huw"*, *"celebrate Eleri — top-decile pace."* A curated recommender, never a taskmaster.
- **Drill-down is a re-scope, not a new page** — the same lenses at entity level (trajectory by curvature, per-LEGO friction, sovereign standing).

For schools, this lane is the **homework roster**: the same triage scoped to a class, sourced **only** from `device_class = 'homework'`, with the honest state where it's missing — *"Maria keeps up in class but has no homework data — we can't tell how she's actually speaking."* That sentence is the feature (and the teacher's lever to drive homework, and later VAD opt-in). It is the **only** per-pupil teaching surface, homework-sourced by construction, never inferred from collective class play — exactly as `metrics-architecture.md` §7 demands.

The one instrumentation this lane needs is the part coverage doesn't: **`device_class` (`class_play | homework | tutor_session`) + `class_id` on `player_events`**, carried explicitly (not inferred from the dirty `teacher_user_id`), plus the orphaned VAD fields persisted the day a learner opts in. Per *earn-it*, each has a named consumer here.

---

## 5. The class is a first-class citizen — the enabling data model

§2's coverage curve only survives teacher churn if the class is the durable entity and the teacher a *time-bounded relationship* to it. Today the model doesn't quite honour that: `classes.teacher_user_id NOT NULL` makes the class one teacher's property. But the fix is small, because the model is already 90% there — the class is durable, students are already a `user_tags` relationship (168 live, soft-deleted), each session already stamps its own driver. The one fossil is the ownership column, and the tell is the data: **168 `class/student` tags, 0 `class/teacher` tags**. Teachers are the single actor still hard-owned instead of related.

The move: **teacher↔class becomes `user_tags(tag_type='class', role_in_context='teacher')`** — the same pattern as students, as school-teachers, and as the ACT tutor roster the superseded first draft proposed. `removed_at` gives time-bounding (handover, departure); multiple active rows give co-teaching and supply; `class_sessions.teacher_user_id` stays as the per-session driver. `classes.teacher_user_id` becomes a nullable lead-teacher pointer.

The data model, the additive migration (`20260613_class_first_class_citizen.sql` — drafted, **not applied**), the full blast radius (frontend, the `api/` server layer including a **financial commission decision**, and the RLS rebase that swaps ownership for membership while keeping the god and school-admin branches), and the rollout order are in the companion **`class-first-class-citizen.md`**. The headline: additive, non-breaking, reversible, and independently shippable before the coverage boards.

---

## 6. Better × simpler × cheaper

- **Better:** the highest-value class signal (pace, dosage, efficiency over wall-clock) goes to the people who can act on it — leaders — instead of being read back to the teacher who generated it; skip-ahead is finally legible as mastery; the durable class survives teacher churn.
- **Simpler:** two honest lanes instead of one muddled "teaching dashboard"; coverage is a group-by over existing rows; one relationship made symmetric with four that already exist; `AnalyticsView`'s bespoke aggregation and the three benchmark paths still get deleted, replaced by engine instances.
- **Cheaper:** coverage needs **zero** new event instrumentation and is independent of Lane B; the `device_class`/`class_id` patch is spent only where it's truly needed (attention/homework); the migration is additive and reversible.

---

## 7. Decisions (for Tom)

1. **Coverage audience first.** Single-school leader, or the multi-school/government roll-up? (Same query, different `GROUP BY`.) Lean: single-school leader — the live data is there.
2. **Efficiency's denominator.** Class-play `duration_seconds` only (the *taught* throughput), or include the roster's homework minutes? Lean: class-play minutes only — homework is the attention lane's.
3. **No teacher-facing class dashboard.** This paper's position is settled: class play needs none — only the forward content-briefing (§1) and a plain "where are we / what's next" bookmark for a covering teacher. It's the paper's firmest position — argue it down with evidence, not preference.
4. **First-class-class sequencing.** Ship the data-model migration + relationship reads (companion Phase 0–1) **before** the coverage boards — the boards read cleaner when the class is already the citizen, and it's independently shippable.
5. **The commission decision (money).** Companion §7, decision 1: when a paying student enrolls in a multi-teacher class, the £5 accrues to the lead or to the enrolling teacher? The one decision with cash attached. Plus the three smaller data-model calls in companion §7 (supply-as-role needs a real CHECK change, not "additive"; server-side teacher-tag writes; `ClassInfo` shape).

---

## Appendix — what changed from the 2026-06-12 draft

The first draft split the world into *administration vs teaching* and built a *teaching* dashboard aimed at the teacher: a post-class debrief, a class snapshot as the teacher's standing read, in-class triage. Tom's correction: that mis-aims the most valuable signal. The line is **attention vs coverage** — solo play, where someone must look (the draft's good half, kept as §4), versus class play, where a leader needs the rate and the teacher already knows (now §1–§3). The draft's class surfaces are replaced by the leadership coverage product; the class becomes the durable citizen (§5) the coverage product needs.
