# The class is a first-class citizen — data model + blast radius

*The engineering companion to `tutor-insights.md` §5. The paper argues *why* the class must be the durable entity and the teacher a time-bounded relationship; this maps *exactly* what changes to get there — the migration, every site (frontend, server, and RLS) that assumes one-teacher-per-class, and the order to land it in. Adversarially reviewed 2026-06-13; the review doubled the known blast radius (it surfaced the entire `api/` server layer, including a financial path) and is reflected here.*

**Status:** Build map for review — Tom + Claude, 2026-06-13.
**Migration:** `supabase/migrations/20260613_class_first_class_citizen.sql` (DRAFT, **not applied** — Tom's gate).
**Ground truth:** live introspection of the shared Supabase project, 2026-06-13 — 7 classes; 78 `class_sessions` (100% with end-LEGO + duration + clean `class_id`); 168 active `class/student` tags, **0** `class/teacher` tags, 6 `school/teacher`, 3 `school/admin`; `classes.teacher_user_id` and `class_sessions.teacher_user_id` both uniformly hold the auth uid (= `learners.user_id`); RLS is **live** on `classes` / `class_sessions` / `user_tags` (Lane B / `secfix_15` is applied — `relink_user_tags` exists). These are pilot/test entities (`added_by='demo-suite'`); the point is the *shape* of the pipe, which is real.

---

## 1. The model, in one line

> A **class** is a durable cohort moving through a program. A **teacher** has a *relationship* to a class that starts, can be shared, and can end — the class outlives any of them.

Today the schema says the opposite: `classes.teacher_user_id TEXT NOT NULL` makes a class the property of one teacher. That can't express any of the four realities:

| Reality | Today (ownership column) | With teacher↔class as a relationship |
|---|---|---|
| Class changes teacher | rewrite the column; old teacher vanishes | soft-remove old `class/teacher` tag (`removed_at`), add new — class + coverage untouched |
| Several teachers at once | impossible (one column) | several active `class/teacher` tags (different users) |
| Supply / cover teacher | impossible | a `class/teacher` tag with a short active window; the session they run still stamps them via `class_sessions.teacher_user_id` |
| Teacher leaves the school | class is orphaned / must be reassigned to keep working | soft-remove their school + class tags; class persists, coverage curve unbroken |

This is what makes the **coverage lane** (`tutor-insights.md` §2) coherent: coverage belongs to the class and accrues across every session regardless of who drove each one, so a teacher leaving never snaps the curve.

**Two clarifications from the 2026-06-13 review — same shape, different scope:**
- **A class belongs to a school, and that stays a hard belonging** — `classes.school_id` remains a foreign key, *not* a tag. The only no-school case is the ACT individual tutor (their classes carry `school_id = null`). This is also why the four realities above are **schools-only**: an ACT class has exactly one tutor — no co-teaching, no supply — so the membership change is, for ACT, just "one member," and behaviour there is unchanged.
- **Grouping *above* the class is flexible — overlapping tags, not a folder tree.** Schools cut classes by year / department / faculty / key stage / whole school at once, and a school can sit in a chain. Each is an overlapping group membership (the same relationship pattern as teacher↔class), so a leader's scope is "every class tagged into the group I lead," and the engine's roll-up (`learner → class → group → school → chain`) works for any shape a school invents. A rigid `groups` path-tree exists in the schema today; lean away from depending on it for anything a tag can express. **This grouping layer is a follow-on — specced separately, not in this migration.**

---

## 2. What is already right (the refactor is small because of this)

- **The class is already durable** — UUID PK; `class_sessions.class_id` FKs to it; it owns its own `current_seed` / `helix_state`.
- **Students are already a relationship** — `user_tags(tag_type='class', role_in_context='student')`, 168 live, `removed_at` soft-delete; the `class_student_progress` view already joins through it.
- **Each session already stamps its own driver** — `class_sessions.teacher_user_id` records who ran *that* session. No change — it is per-session, supply-correct.
- **School↔teacher is already a relationship** — `user_tags(tag_type='school', role_in_context='teacher')`, 6 live; `useTeachersData` and `school_summary` already read it.

`user_tags` is the established pattern for *every* actor-to-container link **except** teacher↔class, which alone is hard-owned. The tell: 168 `class/student` tags, 0 `class/teacher`. We make one relationship symmetric with four that already exist — and it is the pattern `tutor-insights.md`'s first draft proposed for the ACT tutor roster.

---

## 3. The migration (additive, standalone-safe)

`20260613_class_first_class_citizen.sql` does three safe things and **enables no RLS**:

1. **Backfill** — every class with a teacher gets a `class/teacher` tag, `added_at` inheriting the class's creation time, `added_by='migration:first-class-class'` (the column is `NOT NULL` — an earlier draft inserted `NULL` here and would have failed on apply; fixed). Idempotent.
2. **`classes.teacher_user_id` → nullable**, recommented as a denormalised *lead-teacher pointer*; the relationship is the source of truth. Not dropped — every current read still works.
3. **Helpers** — `class_teachers` view (active teachers per class, lead flagged) and `is_class_teacher(class_id, uid)` (the reusable membership predicate).

Two corrections the review forced, both now in the SQL:

- **We keep the total `unique_active_tag` constraint** (do *not* partial-ize it). The financial `paddle-webhook` upserts the student tag with `onConflict:'user_id,tag_type,tag_value'`; a partial unique index can't be inferred as the conflict arbiter, so partial-izing would break **paid enrollment**. It isn't needed anyway — co-teaching, handover, and supply all work under the total constraint; only "same teacher returns as a *separate* row" needed partial, and that's handled by reactivating the existing row (clear `removed_at`).
- **`class_teachers` joins on the trusted side** (`ON ut.tag_value = 'CLASS:'||c.id::text`) and never casts a substring of `tag_value` to `uuid` (a cast in the join key can crash the view on `'SCHOOL:…'` rows), and it sets `WITH (security_invoker = on)` so it enforces the live base-table RLS instead of running as owner (the `secfix_12` keystone all 21 views obey).

It is safe to apply (as service-role, which bypasses the live RLS) **before** any app change: nothing reads the new objects yet, and the lead pointer stays correct.

---

## 4. The blast radius — every site that assumes one-teacher-per-class

Three kinds: **ownership reads** (move to membership), **writes** (also write the tag, server-side), **per-session stamps** (correct — leave). The review's key addition: the `api/` server layer, not just the frontend composables — including a **financial** path.

### Frontend — ownership reads → `class_teachers` / `is_class_teacher`

| Site | Today | Becomes |
|---|---|---|
| `composables/schools/useClassesData.ts:149-151` `fetchClasses` (teacher branch) | `query.eq('teacher_user_id', selectedUser.user_id)` — "my classes" = classes I own | my `class/teacher` tags → `classIds`, then `query.in('id', classIds)` |
| `composables/schools/useClassesData.ts:201-206` RLS tripwire (`assertScope` on `teacher_user_id`) | asserts every row's `teacher_user_id == me` | assert every row's `id ∈ allowed classIds` (membership scope) |
| `composables/schools/useClassesData.ts:276, 398, 435, 634` map `teacher_user_id` into `ClassInfo`/`classDetail`/`createClass` return | single owner carried to UI | `lead_teacher_user_id` (the pointer) **plus** `teachers: {user_id, display_name, is_lead}[]` from `class_teachers`; the `ClassInfo` type at line 23 changes |
| `composables/schools/useTeachersData.ts:75-80` classes-per-teacher | `classes … .in('teacher_user_id', teacherUserIds)` | `class_teachers … .in('teacher_user_id', teacherUserIds)` → class_ids |
| `composables/schools/useTeachersData.ts:88-108` students-per-teacher | `class_student_progress.teacher_user_id` attribution | join `class_teachers` (teacher→class_ids) to `class_student_progress` on `class_id` |
| `composables/schools/useStudentsData.ts:57` "my students" | `.eq('teacher_user_id', selectedUser.user_id)` | students in classes I teach (`classIds` from `class_teachers`) |
| `composables/schools/useSchoolContext.ts:164` | comment: "a teacher's classes are scoped by teacher_user_id" | update comment to membership |
| `views/schools/TeacherDashboard.vue:72` | displays `c.teacher_user_id` | lead pointer, or the teachers list |

So: **four composables plus a view component** (the paper's earlier "three composables" was wrong).

### Server (`api/`) — the layer the first pass missed

| Site | Today | Becomes / decision |
|---|---|---|
| `api/teacher/classes.ts:72` GET my classes | `.eq('teacher_user_id', userId)` | classes I'm a `class/teacher` of |
| `api/teacher/classes.ts:103` 10-class cap count | counts classes I *own* | decide: cap on classes I *lead*, or all I teach (co-teaching shouldn't inflate the cap — likely count where `is_lead`) |
| `api/teacher/classes.ts:122` createClass | inserts `teacher_user_id = me` only | also seed a `class/teacher` tag (service-role; see write note) |
| `api/teacher/me.ts:71`, `api/teacher/signup.ts:113,157`, `api/teacher/by-code.ts:42,61` | resolve a teacher's classes / a class's teacher by ownership | membership / lead pointer as appropriate |
| `api/teacher/create-class-join-code.ts:83` authorize | `cls.teacher_user_id === callerUserId` | `is_class_teacher(cls.id, caller)` OR school admin — else a co-teacher/supply can't mint a join code |
| `api/invite/create.ts:128` "only the class teacher can create student codes" | `.eq('teacher_user_id', userId)` | membership — else co-teachers are locked out |
| **`api/teacher/paddle-webhook.ts:434-449` (FINANCIAL) — commission payee** | resolves the payee via `classes.teacher_user_id → learners → teachers.id` | **RESOLVED (2026-06-13): no change needed.** Commissions are an ACT mechanism, and an ACT class has exactly one tutor (co-teaching/supply are schools-only, and schools classes don't generate commissions). So the payee is unambiguous and the lead pointer stays correct here. *Guard:* if commissions ever extend to multi-teacher schools classes, this must be revisited (capture the enrolling teacher). |

`api/teacher/paddle-webhook.ts:372-381` (student-tag upsert) and the `wise-webhook` / `teacher-payouts` cron / `teacher_commissions` pipeline sit downstream of that attribution and inherit it — also fine, single-tutor.

### Writes — also create the relationship, **server-side only**

The live `user_tags_insert` policy (Lane B, `secfix_15:132-139`) **forbids any non-god authenticated user from inserting `role_in_context='teacher'`** — privileged tags arrive via service-role routes only. So `createClass`'s teacher-tag seed, and the new **add / remove / reassign teacher** surface (`addClassTeacher`, `removeClassTeacher` — the UI that lets a class change hands, gain a co-teacher, take a supply), must go through a service-role server endpoint, mirroring the existing `/api/teacher/create-class-join-code`. Removal is a soft-delete (`removed_at`), which a class teacher or school admin can do under `user_tags_update`; *adding* a teacher is god/service-role.

### Per-session stamps — CORRECT, leave alone

`useClassesData.ts:508-520` `startClassSession(classId, teacherUserId, …)`, `LearningPlayer.vue:640-671`, and `DashboardView.vue:170` (`teacherUserId: currentUser.user_id`) all record the *driver* of a session — already per-session, already supply-correct.

### Views

| View | Action |
|---|---|
| `class_student_progress` (`schools_system.sql:323`) | keep `teacher_user_id` (now the lead pointer) for back-compat; migrate the teacher-*attribution* read in `useTeachersData` to `class_teachers`; drop the column from the view only in Phase 3 **after** `useTeachersData.ts:89` stops reading it (ordering coupling) |
| `class_activity_stats`, `demographic_cycle_averages` (`20260223_class_reporting_views.sql`) | **Verified safe** — no teacher dependency (key on `class_id`/`school`/`region`/`course`). **But note for the coverage lane:** they aggregate the per-learner `sessions` table (homework/solo), **not** `class_sessions` — so they are *not* the class-play coverage aggregate; they're a dosage/activity view over individual sessions. Coverage (furthest `end_lego_id` per class over wall-clock) is in **no** view today and must be built as a new aggregate over `class_sessions`. |

### Tests & demo

`useClassesData.test.ts`, `useTeachersData.test.ts` assert ownership-shaped reads — update to membership; add multi-teacher / handover / supply cases. `composables/demo/populateDemoData.ts:121-196` and `useDemoController.ts:186` hardcode single-owner `teacher_user_id` on demo classes — if demo is the showcase for co-teaching, demo data needs `class/teacher` tags too.

---

## 5. The RLS rebase (its own migration; RLS is already live)

RLS is **applied** on these tables (Lane B / `secfix_15`). The teacher-facing policies key on `c.teacher_user_id = (auth.uid())::text` *ownership*; the rebase replaces that one clause with `public.is_class_teacher(c.id, (auth.uid())::text)`, **keeping the `is_god_user()` and school-admin branches** (dropping either is a regression). `is_class_teacher` is `SECURITY DEFINER` precisely so it can be used inside the `user_tags` policy without recursing through `user_tags`' own RLS.

Concretely, the swap in the live policies (verbatim from `secfix_15`):

- **`class_sessions_read`** (`secfix_15:84-97`) — has `teacher_user_id = auth.uid() OR is_god_user() OR (class owner OR school admin)`. Swap the *class-owner* clause `c.teacher_user_id = auth.uid()` → `is_class_teacher(c.id, auth.uid()::text)`, so **all** a class's teachers (and supply) read its sessions/coverage. The school-admin branch already grants leaders read — the coverage lane's audience is covered today; only co-teachers are the gap.
- **`class_sessions_teacher_insert/update`** (`secfix_15:77-83`) — `teacher_user_id = auth.uid()`. **Unchanged** — writing a session is own-driver-only, correctly.
- **`user_tags_select`** (`secfix_15:115-128`) and **`user_tags_update`** (`secfix_15:144-171`) — each has a CLASS-scoped branch `c.teacher_user_id = auth.uid() OR <school admin>`. Swap the class-owner clause → `is_class_teacher(...)` in both the `USING` and `WITH CHECK`.
- **`user_tags_insert`** (`secfix_15:132-139`) — `is_god_user() OR (own row AND role NOT IN ('teacher','admin'))`. **Unchanged** — this is exactly why teacher-tag writes are service-role (§4 write note).
- **`classes` policies** (`classes_select/insert/update`, live) and any teacher-read policies still active on `course_enrollments` / `lego_progress` / `seed_progress` / `sessions` — read their current predicates at rebase time and apply the same owner→membership swap, preserving god + school-admin. (Legacy `schools_system.sql` versions used the deprecated `auth.jwt()->>'sub'` pattern; if any survive `disable_all_rls` + the secfixes, normalise them too.)

If teacher↔class moves to membership but any of these keep the ownership clause, a co-teacher / new teacher / supply gets **zero** of: that class's sessions, its student tags, its student progress — i.e. they'd be a teacher who can see nothing. The rebase is mechanical with `is_class_teacher`, but it must hit every clause.

---

## 6. Rollout order

0. **Migration** (this file) — apply after review (service-role). Additive; lead pointer stays correct; nothing breaks. *(Tom's gate.)*
1. **App reads → relationship** (dev) — §4 frontend + server ownership rows; `ClassInfo` gains `teachers[]`; the add/remove/reassign-teacher server endpoint; tests + demo updated. The commission decision (§4) is made here. Lead pointer still used wherever one name is wanted, so the UI never regresses.
2. **RLS rebase** (its own migration) — §5 owner→membership via `is_class_teacher`, god + school-admin branches preserved.
3. **Cleanup** — drop `class_student_progress.teacher_user_id` (only after `useTeachersData.ts:89` migrates), then `classes.teacher_user_id` and the `is_lead` derivation, then the comment fossils.

Each step is independently shippable and reversible; the system is correct at every step.

---

## 7. Decisions — settled 2026-06-13 (one open: grouping)

1. **Commission payee — RESOLVED, no action.** No co-teachers exist in the ACT model (the only context with commissions); the single tutor is the payee, and the lead pointer is correct (see §4). Revisit only if commissions ever extend to multi-teacher schools classes.
2. **Supply — a bounded teacher window.** A `class/teacher` tag with a short active window; the session stamps the actual driver. No schema change. (A distinct `role_in_context='supply'` would need a `CHECK` change *and* an `user_tags_insert`-guard extension — it currently only blocks `'teacher'`/`'admin'`, so a new `'supply'` value would slip past forgery protection — so do that only if a leader later asks to see cover distinguished.)
3. **Teacher-tag writes — a service-role endpoint.** All add/remove/reassign-teacher goes through a service-role route mirroring `/api/teacher/create-class-join-code` (forced by the live `user_tags_insert` policy).
4. **`ClassInfo` — `teachers[]` + a retained lead pointer** the dashboard shows by default; keep `classes.teacher_user_id` as a fast lead pointer through Phase 1–2, revisit dropping it in Phase 3.

**Open (the follow-on grouping layer, §1):** the tag vocabulary for year / department / faculty / chain, and how a leader declares scope over it. Specced separately; the teacher↔class migration does not depend on it.
