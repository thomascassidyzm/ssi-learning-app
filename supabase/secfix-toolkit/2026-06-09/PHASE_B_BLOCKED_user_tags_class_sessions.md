# Phase B full RLS-enable — BLOCKED on the identity bridge

`user_tags` and `class_sessions` cannot have RLS turned on as-is: their live
**client write paths write the learner PK (`learner.id`) while the policies match
`auth.uid()` (= `learner.user_id`)**, and `user_tags` also has a post-login
re-point that updates rows the caller doesn't yet own. Enabling RLS today =
silent write-break (the exact failure that caused the original RLS disable).

Verified 2026-06-09. The safe-today partials (`secfix_08`, `secfix_09`) close the
anon/INSERT vectors without enabling RLS. This note holds the **full enable** to
apply *after* the bridge.

---

## class_sessions — full enable (identity-mapped policies)

The write value is `teacher_user_id = learner.id` (uuid PK as text). Map identity
in the predicate instead of comparing to `auth.uid()`:

```sql
ALTER TABLE public.class_sessions ENABLE ROW LEVEL SECURITY;

-- drop the cross-tenant open read
DROP POLICY IF EXISTS "Authenticated can read class_sessions" ON public.class_sessions;

-- identity-mapped owner predicate: the caller's learner row -> its id -> teacher_user_id
CREATE POLICY "Tenant can read class_sessions" ON public.class_sessions
  FOR SELECT TO authenticated
  USING (
    is_god_user()
    OR teacher_user_id IN (SELECT l.id::text FROM public.learners l WHERE l.user_id = (auth.uid())::text)
    OR EXISTS (
      SELECT 1 FROM public.classes c
      WHERE c.id = class_sessions.class_id
        AND c.teacher_user_id IN (SELECT l.id::text FROM public.learners l WHERE l.user_id = (auth.uid())::text)
    )
  );

-- REPLACE the existing write policy (it compares to auth.uid() and would break writes)
DROP POLICY IF EXISTS "Teachers can write own class_sessions" ON public.class_sessions;
CREATE POLICY "Teachers can write own class_sessions" ON public.class_sessions
  FOR ALL TO authenticated
  USING      (teacher_user_id IN (SELECT l.id::text FROM public.learners l WHERE l.user_id = (auth.uid())::text))
  WITH CHECK (teacher_user_id IN (SELECT l.id::text FROM public.learners l WHERE l.user_id = (auth.uid())::text));
-- keep "God users can write class_sessions"
NOTIFY pgrst, 'reload schema';
```

**Pre-req to verify before applying:** confirm `useClassesData.startClassSession`
callers also pass `teacherUserId = learner.id` (LearningPlayer already does).
**Canary (real teacher JWT):** start + end a class session → both succeed; a
different teacher cannot SELECT the first teacher's sessions.

⚠ Open question for the identity rework: `classes.teacher_user_id` — does it store
`learner.id` or `learner.user_id`? The second branch above assumes `learner.id`;
verify against `classes` before enabling, or that branch silently returns nothing.

---

## user_tags — full enable (needs the re-point bridged first)

Blocker: `useAuth.ts:226-237` re-points `user_tags.user_id` from OLD→NEW as the
authenticated client. Own-row RLS evaluates `USING` against the OLD row → blocked.

**Bridge (pick one) BEFORE enabling RLS:**
- (A) Move the re-point into a `SECURITY DEFINER` function
  `relink_user_tags(old_id text, new_id text)` that asserts `new_id = auth.uid()`
  and updates `WHERE user_id = old_id`; call it from `useAuth`. (preferred)
- (B) Move the re-point + the `removed_at` soft-deletes
  (TeachersView.vue:88 / ClassDetail.vue:235) into a service-role API route.

**Then enable** (with the tightened INSERT/UPDATE policies from the original
draft — self-serve may not set `role_in_context` to 'teacher'/'admin'):

```sql
DROP POLICY IF EXISTS "user_tags_insert" ON public.user_tags;
CREATE POLICY "user_tags_insert" ON public.user_tags FOR INSERT TO authenticated
  WITH CHECK (user_id = (auth.uid())::text
    AND role_in_context IS DISTINCT FROM 'teacher'
    AND role_in_context IS DISTINCT FROM 'admin');
DROP POLICY IF EXISTS "user_tags_update" ON public.user_tags;
CREATE POLICY "user_tags_update" ON public.user_tags FOR UPDATE TO authenticated
  USING (user_id = (auth.uid())::text)
  WITH CHECK (user_id = (auth.uid())::text
    AND role_in_context IS DISTINCT FROM 'teacher'
    AND role_in_context IS DISTINCT FROM 'admin');
ALTER TABLE public.user_tags ENABLE ROW LEVEL SECURITY;
NOTIFY pgrst, 'reload schema';
```
(If using bridge A/B, the soft-delete `removed_at` UPDATE either runs via the
definer/service route OR is covered by the own-row `user_tags_update` policy above
— confirm in canary.)

**Canary:** own-row soft-delete succeeds; re-point (via bridge) succeeds; forging
`role_in_context='teacher'` via INSERT *or* UPDATE → 42501.

---

## This is the real "identity rework is a hard prerequisite"

Both blockers reduce to the same root the data-arch doc names: **the app writes
operational rows keyed on `learner.id` / synthetic ids, not on a persistent
`auth.uid()` identity, and writes as the anon key.** `SSi-rls-on-identity-architecture.md`
is the upstream fix; these two tables are concrete instances. Until that lands,
Phase-B own-row RLS on client-written tables stays gated behind per-table bridges.
