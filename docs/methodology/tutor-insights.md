# Teaching Insights — two lanes, one engine: attention and coverage

*The insight surfaces for the people around the learning — schools teachers, the leaders above them, and Anyone-Can-Teach tutors. Built to be argued with. (Supersedes the 2026-06-12 draft; what changed is in the appendix.)*

**Status:** Think-piece, revised — Tom + Claude, 2026-06-13. Core decisions settled (§7).
**Companions:** `metrics-architecture.md` (the measurement model), `insight-engine.md` (the delivery system), `admin-insights.md` (the company-lens sibling), `class-first-class-citizen.md` (the data-model + blast-radius behind §5).
**Ground truth:** the 2026-06-12 audit and live introspection on 2026-06-13 — 78 `class_sessions` on a clean `class_id` (100% with end-LEGO + duration), and the tell: 168 `class/student` tags, **0** `class/teacher`. (Pilot/test entities — what's real is the *shape* of the pipe.)

---

## 1. The cut: attention vs coverage

> **A learner who plays alone needs watching — *has anyone looked at them this week?* That's attention. A class that plays together is itself a learner — *track it like one, and let it roll up to whoever stands above it.* That's coverage.** The first is per-pupil and human-judged; the second treats the class as a first-class entity that gets the same self-view any learner gets, read by its teacher and the leaders above. Different lenses, different audiences — and conflating them is the category error that made the schools dashboard feel like a junk drawer.

The old framing split the world into *administration vs teaching* and aimed a teaching dashboard at the teacher. The right line is **attention vs coverage**, and it turns on one fact `metrics-architecture.md` §7 already states about class play: *"there is no way to attribute the captured audio to individual students… the metrics extracted here belong to the **class**, not to any student in it."* The class is the unit. So the class is the *learner* — and you measure it the way you measure any learner.

What the teacher does **not** need is a live in-class HUD, or a behavioural debrief that reads back the session they just drove ("you replayed S0055, you skipped ahead"). They were in the room for that; it answers a question they don't have. But the teacher runs *several* classes and time passes — so they very much want to **pull up any one class's record and summary**, exactly as a tutor pulls up a learner's. The class-as-learner view is for them, and for everyone above them. (§9 of the measurement doc was right to surface class metrics; it was wrong only in assuming the teacher wanted them as a real-time scoreboard rather than a learner-style record across their classes.)

One genuinely new fact a readout *could* carry the teacher — *"the third class this week to stall on S0055"* — is **content quality**, not class feedback (Tom's friction law, `admin-insights.md` §1: friction that stays with a *unit across classes* is a curriculum problem). It routes to Popty and the curriculum owner; if it reaches a teacher it's a *forward briefing* ("S0055 tends to be sticky"), never a backward debrief.

---

## 2. The coverage lane — the class as a learner

The class is a first-class learner-equivalent. It gets the **same self/standing view any learner gets about their own progress** — position, coverage, belt, days-active, summaries, and the detail of *what it has done* — at class scope. Its teacher consumes their classes as a roster of these learner-entities; the leaders above (head of department, school leader, multi-academy-trust or local-authority lead, inspectorate) read the same entity rolled up. Each tier is the same query at a higher `GROUP BY` — the `insight-engine.md` §5 promise ("a new entity is a different lens on one substrate"), now spanning `learner → class → group → school → chain`.

The leadership-facing distillation — the numbers that matter when you're accountable for *many* classes over time — is small:

- **Coverage** — where each class has reached in the program (its furthest LEGO; seed is the rollup).
- **Coverage over wall-clock time** — the *rate of advance through the program* in calendar terms, per week or month. The headline. A teacher who says "you've got this — straight to the next new item", often, with the class keeping up, shows up as a fast, healthy curve. (A performance lens misreads that skip as missing data; coverage reads it as the mastery signal it is. Skipping ahead is a feature, and only this framing makes it legible.)
- **Active minutes per class, per day / week / month** — dosage. The *flow rate* of use, not a cumulative "hours practised" vanity tile.
- **Coverage per active-minute** — efficiency. Two classes at the same coverage but very different minutes tell a leader two different stories; that contrast is the leadership question.

The one thing the class-as-learner view does **not** carry is *fabricated per-pupil* data — you cannot pull an individual's execution out of a collective classroom mic, and we don't pretend to. Individual signals live in the attention lane (§4), sourced from homework. Everything the learner self-view legitimately offers — progress, standing, summaries, what-it's-done — applies to the class.

Because coverage belongs to the durable class and accrues across every session whoever drove each one, **teacher churn is invisible to the curve** — a class changing teacher, sharing two, taking a supply, or losing one to another school never breaks it. That property is the whole point of §5.

The widgets already exist (`insight-engine.md` §3.4): the class self-view is the `standing` / `sovereign-comparison` widget; coverage-over-time and dosage are `time-series`; the per-class league of pace/efficiency is `ranked-bar`/`table`. Zero new widgets. (Sovereignty: a leader has *visibility* over their own classes, so named within-scope comparison is fine; anything shown across scopes, or to a teacher about peers, stays entity-vs-aggregate with the k-floor — `insight-engine.md` §7.)

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

For schools, this lane is the **homework roster**: the same triage scoped to a class, sourced **only** from `device_class = 'homework'`, with the honest state where it's missing — *"Maria keeps up in class but has no homework data — we can't tell how she's actually speaking."* That sentence is the feature (and the teacher's lever to drive homework, and later VAD opt-in). It is the **only** per-pupil teaching surface, homework-sourced by construction, never inferred from collective class play — exactly as `metrics-architecture.md` §7 demands. It complements the class-as-learner view of §2: §2 is the class's own progress; this is the individuals it can't speak for.

The one instrumentation this lane needs is the part coverage doesn't: **`device_class` (`class_play | homework | tutor_session`) + `class_id` on `player_events`**, carried explicitly (not inferred from the dirty `teacher_user_id`), plus the orphaned VAD fields persisted the day a learner opts in. Per *earn-it*, each has a named consumer here.

---

## 5. The class is a first-class citizen — the enabling data model

§2 only works if the class is a durable entity in its own right: a learner you can track, that survives teacher churn, that belongs somewhere and can be grouped any way a school needs. Three moves, all the same shape — **relationships and tags, not ownership and folders** — and all but the first already in the schema.

**Teacher↔class is a time-bounded relationship, not ownership.** Today `classes.teacher_user_id NOT NULL` makes the class one teacher's property; the tell is the data — 168 `class/student` tags, **0** `class/teacher` (students are already related; only teachers are still hard-owned). The move: teacher↔class becomes `user_tags(tag_type='class', role_in_context='teacher')` — same pattern as students and school-teachers. `removed_at` gives time-bounding (handover, departure); multiple active rows give co-teaching and supply (schools only — an ACT class has exactly one tutor); `class_sessions.teacher_user_id` stays as the per-session driver; `classes.teacher_user_id` becomes a nullable lead-teacher pointer.

**A class belongs to a school — hard.** This is *not* just another tag: `classes.school_id` is a real belonging, kept as a foreign key. The only no-school case is the ACT individual tutor, whose classes carry `school_id = null`. (That distinction — schools-class vs ACT-class — is also why co-teaching and supply are schools-only, and why commissions, which are an ACT mechanism, never meet a multi-teacher class.)

**Grouping above that is flexible — tags, not a tree.** Schools cut their classes many ways at once: by year, by department, by faculty, by key stage, by whole school; and a school can sit in a chain. None of these is *the* hierarchy, so none should be a folder path. A class (and a school) carries overlapping group memberships — the same relationship pattern again — and a leader's scope is "every class tagged into the group I lead." (There is a rigid `groups` path-tree in the schema today; this leans away from depending on it for anything a tag can express.) The payoff is that the engine's roll-up — `learner → class → group → school → chain` — works for *any* grouping a school invents, without a schema change per shape.

The data model, the additive migration (`20260613_class_first_class_citizen.sql` — drafted, **not applied**), the full blast radius (frontend, the `api/` server layer, and the RLS rebase that swaps ownership for membership while keeping the god and school-admin branches), and the rollout order are in the companion **`class-first-class-citizen.md`**. The teacher↔class migration is additive, non-breaking, reversible, and independently shippable; the grouping layer is a follow-on of the same shape.

---

## 6. Better × simpler × cheaper

- **Better:** the class becomes a learner you can actually track over a year and across a teacher's several classes; the leadership distillation (pace, dosage, efficiency over wall-clock) reaches the people who can act on it; skip-ahead is legible as mastery; the durable class survives teacher churn; any grouping a school needs just works.
- **Simpler:** two honest lanes instead of one muddled "teaching dashboard"; *no special teacher dashboard at all* — the class reuses the learner lens; coverage is a group-by over existing rows; relationships-and-tags replace one ownership column and one rigid tree; `AnalyticsView`'s bespoke aggregation and the three benchmark paths get deleted, replaced by engine instances.
- **Cheaper:** coverage needs **zero** new event instrumentation and is independent of Lane B; the `device_class`/`class_id` patch is spent only where it's truly needed (attention/homework); the teacher↔class migration is additive and reversible.

---

## 7. Decisions — settled 2026-06-13

1. **Audience first → single-school leader.** The live class data is there; ship the within-school class-as-learner / coverage view first, roll up to group / school / chain later (same query, higher `GROUP BY`).
2. **Efficiency denominator → class-play minutes only.** Coverage-per-minute measures *taught* throughput; homework minutes stay in the attention lane.
3. **No special teacher dashboard.** Resolved by the reframe, not by exclusion: the class *is* a learner, so the teacher gets the full class-as-learner view (summaries, standing, what-it's-done) across their classes — there's simply no separate teacher product to build. What's dropped is the live HUD and the behavioural debrief; what's added is the briefing + "where are we" bookmark for a covering teacher.
4. **Sequencing → migration first.** Land class-as-citizen (teacher↔class relationship) + relationship reads before the coverage boards; the boards read cleaner on a first-class class.
5. **Commission → the single ACT tutor (no decision needed).** Co-teaching is schools-only and schools classes don't generate commissions; an ACT class has one tutor, so the £5 is unambiguous. The lead pointer stays correct for it.
6. **Supply → a bounded teacher window** (no schema change); the session stamps the actual driver. A distinct `role_in_context='supply'` only if a leader later wants cover shown separately (that's a real CHECK + insert-guard change, not "additive").
7. **Teacher-tag writes → a service-role server endpoint** (the live `user_tags_insert` policy forbids non-god teacher tags), mirroring `/api/teacher/create-class-join-code`.
8. **`ClassInfo` → `teachers[]` + a retained lead pointer** the dashboard shows by default; no UI regression.

**Next design area (not yet specced):** the flexible grouping layer (§5) — the tag vocabulary for year / department / faculty / chain, and how a leader's scope is declared over it. The teacher↔class migration doesn't depend on it; it's the natural follow-on.

---

## Appendix — what changed

**From the 2026-06-12 draft:** it split the world *administration vs teaching* and aimed a teaching dashboard at the teacher (post-class debrief, in-class triage). The line is instead **attention vs coverage** — solo play, where someone must look (kept as §4), versus the class as a learner-equivalent, read by its teacher and the leaders above (§1–§3).

**From the 2026-06-13 review:** the class is not merely a *coverage* source for leaders — it is a **learner**, and gets the full learner self-view (summaries, standing, what-it's-done), because a teacher runs several classes over time and wants to pull any one up like a tutor pulls up a learner. Grouping above the class is **flexible tags** (year / department / faculty / whole-school / chain, overlapping), not a rigid hierarchy — while a class still *belongs to a school* as a hard foreign key (ACT classes being the no-school exception).
