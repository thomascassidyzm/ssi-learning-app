# PLAY-AS-CLASS as the primary school metric — report

**Founder ruling:** "we absolutely MUST HAVE play-as-class — that is the only metric that is
important in a school — that is the model for how they learn at school in all their classes.
Individual student accounts are an optional bonus."

Working session 2026-07-20. Incremental findings land here as the work proceeds.

---

## 1. AUDIT — what production code actually does today (verified 2026-07-20)

### 1.1 What play-as-class already records against the class learning identity ✅

- **The class IS a first-class learner in the play path.** While `props.classContext` is active,
  `LearningPlayer.vue` keys every downstream read/write off `class_learner_id`
  (`learnerId = classContext.class_learner_id || staffLearnerId` — LearningPlayer.vue:692).
- **Course journey / cursor / LEGO progress: recorded, server-mediated.** All
  `course_enrollments` + `lego_progress` writes in class mode route through
  `POST /api/school/class-progress` (RLS is own-row, so the browser can't write the class's row —
  by design). The class's enrollment cursor (`last/highest_completed_lego_id`) DOES advance when a
  teacher plays as class. 11 methods covered (`useClassProgressStore.ts`).
- **Telemetry attribution: recorded.** The `ssi-user-id` cookie flips to the class learner id for
  the session, so `player_events` (audio_play etc.) attribute to the class identity.
- **`class_sessions`: recorded.** Start/end LEGO, cycles, duration, teacher-keyed
  (LearningPlayer `startClassSessionTracking`/`endClassSessionTracking`). This is the source for
  `analytics_class_sessions_scoped`.
- **THE LENS is already class-practice-first.** All four insight measures — `rate` (LEGOs/week),
  `minutes_per_class`, `hours_total`, `active_classes` — compute from `class_sessions` rows
  (`api/_utils/rateCompare.ts`). No change of levers needed there.

### 1.2 The gap — the practice-hours spine never sees class practice ❌

- **The learning `sessions` insert FAILS SILENTLY in class mode.** `useLearningSession` calls
  `sessionStore.startSession(learnerId, courseId)` — a DIRECT browser insert into `sessions` with
  `learner_id = class_learner_id`. RLS policy `sessions_own_insert` requires
  `learner_id = current_learner_id()` (the STAFF member's row) → the insert is rejected, the error
  is caught and logged, and the whole session-tracking layer (start/checkpoint/end) no-ops for the
  entire class session. **Real play-as-class produces ZERO rows in `sessions` for the class
  identity** — so practice-hours pipelines, daily contributions and any "hours" rollup never see
  class practice.
- **Class node home leads with the bonus layer, not the primary.** `api/groups/[id]/home.ts` class
  branch: `practiceHours` = Σ students' `total_practice_seconds` (`class_student_progress`);
  journey `done` = `classes.current_seed` (a static column — play-as-class only updates
  `classes.last_lego_id`); nothing on the page reads `class_sessions` or the class-entity's own
  enrollment. The class practising together is invisible on its own home page.
- **Demo world: class practice is the thin layer, not the primary.** `demoNodeRefresh.ts` seeds
  rich per-student `sessions` (personas, 8–56 rows/window) and 8–14 `class_sessions` per class —
  but NO class-identity `sessions` rows, NO class-entity `course_enrollments` advancement, and the
  class-entity learner may lack demo flags (board-metric exclusion relies on `test_learner_ids()`).

### 1.3 Where class data surfaces today

| Surface | Source | Class-practice-led? |
|---|---|---|
| THE LENS / insights (rate, minutes/class, hours, active classes) | `class_sessions` via `analytics_class_sessions_scoped` | ✅ already |
| Class node home stats + journey | students' seconds + `classes.current_seed` | ❌ student-led |
| School/programme node home practiceHours | `school_summary` (student hours) | ❌ student-led |
| Classes lens (practiceHours per class) | `class_student_progress` | ❌ student-led |
| Board metrics (minutes.total_30d) | `daily_contributions` (sessions-driven) | ❌ never sees class practice (1.2) |

## 2. THE PLAN (BSC)

- **A — production recording:** extend `/api/school/class-progress` with `startSession` /
  `checkpointSession` / `endSession`; class-aware session-store wrapper (same pattern as the
  progress wrapper); wire into LearningPlayer. Real class practice lands in `sessions` keyed on
  `class_learner_id`. *Better:* the founder's one metric becomes real telemetry. *Simpler:* the
  exact settled pattern, no new tables/policies. *Cheaper:* a few endpoint cases + a thin wrapper.
- **B — demo world re-anchor:** demo classes get play-as-class as PRIMARY — class-identity
  `sessions` derived from the SAME `class_sessions` arcs (one source of truth), class-entity
  enrollment advanced to the arc end (journey/belt from class play), `classes.last_lego_id`
  synced, class-entity learners carry demo flags, student layer thinned. Idempotent REPLACE, same
  hard demo-only guards.
- **C — dashboards lead with class practice:** class node home headline = the class practising
  together (sessions this window, last class session, class practice hours, journey from the
  class-entity enrollment); students stay below as the bonus layer. School/programme: class
  practice measures surfaced at node level. Copy says "Class practice" (the teacher-facing verb is
  already "Play as class" — kept).

## 3. BUILD LOG

### Lane C — dashboards lead with class practice ✅ (0cd92c08 + 39864b3c)

- **`/api/groups/:id/home` class kind:** new `classPractice` block (weekSessions, sessions28d,
  totalSessions, lastSessionAt, hours) straight from `class_sessions`; `journey` is now the CLASS's
  own play-as-class position as a **LEGO ordinal** (class-entity enrollment cursor → newest class
  session end LEGO → `classes.last_lego_id`), `source`-tagged `class-play` vs `estimate` (the old
  current_seed heuristic survives only for classes that have never played together — fixing the
  latent mixed-unit journey bug properly rather than working around it client-side).
- **Node kind (school/programme/region/nation):** subtree `classPractice` rollup — hours,
  sessions7d, activeClasses7d, classCount — from the same class-id union the lenses use.
- **NodeHomeView:** class home leads with a **Class practice** card (sessions this week, last class
  session, hours together); journey bar + class belt ride the class's play position; stats row
  leads with class practice at every level (`Class practice` hours + `Classes practising this
  week`); students stay below as the bonus layer. Classes lens rows lead with class practice hours
  + last class session. Copy says "Class practice"/"Play as class" — never internal jargon.
- **THE LENS: no change needed** — default measure is already `rate` (class_sessions-derived), and
  all four measures are class-practice measures. Individual measures remain in student rows/lenses.
- **Pins:** `home.test.ts` (CLASS-PRACTICE PIN, no-play fallback, subtree rollup, classes-lens
  columns — 13 green) + `NodeHomeView.test.ts` (leads-with-class-practice pin, no-practice
  invitation copy — 11 green). Typecheck green.

### Lane A — production session recording ✅ (in `0cd92c08`)

Closes audit gap §1.2: `POST /api/school/class-progress` gains `startSession` /
`checkpointSession` / `endSession` (server-mediated, ownership-guarded — checkpoint/end refuse a
sessionId belonging to a different learner); `useClassSessionStore.ts` wraps the core SessionStore
(passthrough outside class mode, endpoint-routed in class mode); wired into LearningPlayer beside
the progress wrapper. Real play-as-class now lands `sessions` rows keyed on the CLASS learner id.
14 endpoint + 8 wrapper tests green.

### Lane B — demo world re-anchor ✅ (`f646ab50` + fix `1ecd5c5b`)

Every demo class carries a full class learning identity: `ensureClassLearnerEntity` + `is_demo`
flag; class-identity `sessions` emitted 1:1 from the SAME `class_sessions` arc (one arc, two
projections); classroom cadence 12–24 sessions over the 8-week window (2–4/week, 15–35 min),
arc advancing to `current_seed` with the latest session today; class-entity enrollment + `classes.
last_lego_id` advanced to the arc end (journey/belt from class play); REPLACE deletes class-entity
sessions too (idempotent); student personas trimmed (fast 10–18 / steady 5–10 / idle 1–4) — the
bonus layer. 11 tests green.

**Live-caught fix (`1ecd5c5b`):** IME classes carrying teachers only in `class_teachers` (NULL
lead pointer) made the `class_sessions` re-insert violate NOT NULL *after* the replace-delete —
demo tree went class-practice-dark. Teacher now resolved via `class_teachers`; a class with no
teacher at all skips its arc loudly (24/25 IME classes carry arcs; 1 genuinely teacherless).

## 4. VERIFICATION — deployed dev (build `1ecd5c5`, 2026-07-20)

`e2e/the-view/play-as-class-walk.mjs` against the real deployment + DB, real admin session:

- demo-refresh on IME Demo Programme: 200 — 9 schools, 25 classes, 380 learners, 3,459 sessions,
  **429 class_sessions** written.
- every demo class has a class learning identity (25/25); class entities `is_demo` (board metrics
  never inflate).
- class-identity sessions mirror the class_sessions arc 24/24; newest class session within 3 days
  24/24; class-entity enrollment rides the arc end 24/24.
- `/api/groups/:classId/home`: classPractice weekSessions=3, hours=8.4; journey source
  `class-play`, done=36 LEGOs (S0012L03).
- programme rollup: classPractice hours=176.8, activeClasses7d=24/25.
- Screenshots (docs/the-view/play-as-class/): class home leading with Class practice card
  (+ "Last class session…", "travelled … LEGOs together", never "seed"), programme home stats row
  leading with class practice, insights on the demo tree.
- **Verb consistency fix** (`b5a2accd`): two DashboardView rows said bare "▶ Play" — now the one
  verb "▶ Play as class" everywhere.
- **LIVE TEACHER MOMENT — PASS (final run, build `b5a2acc`, ALL 16 GREEN).** A real demo teacher
  (Anke Weber) signed in on deployed dev, clicked "▶ Play as class" on her surface, the player
  booted PLAYING AS **9A French** (class identity bar + the class's own Yellow Belt), and a
  **`sessions` row landed on the CLASS's learner id** through the new server-mediated path — the
  exact spine the audit found silently broken. Evidence: `teacher-live-play-as-class.jpg`.
- Second-refresh finding (kept as designed): `course_enrollments.highest_completed_lego_id` is a
  forward-only ceiling (DB ratchet), so a re-refresh whose random arc ends a lego lower leaves the
  ceiling at the furthest-ever point while `last_completed_lego_id` rides the new arc end exactly.
  Correct semantics — the walk asserts it as such.

**Taste-tunable for later (logged, no action):** demo students' individual positions (e.g. 110
LEGOs average) can sit ahead of the class's together-journey (e.g. 52 LEGOs) because student
seeds anchor to older demo state. Real classrooms can look like this, but if the demo should tell
"the class leads, students follow", the student seed arcs want re-anchoring to the class arc.
