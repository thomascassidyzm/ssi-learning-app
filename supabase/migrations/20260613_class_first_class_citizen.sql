-- ============================================================================
-- CLASS AS A FIRST-CLASS CITIZEN — teacher↔class becomes a time-bounded
-- relationship; the class stops being owned by one teacher.
-- ============================================================================
-- Status: DRAFT — reviewable, NOT YET APPLIED. Tom's review gate before this
--         touches the live (shared) DB. Adversarially reviewed 2026-06-13;
--         the review caught a NOT-NULL violation, a view-crash, and a financial
--         upsert coupling — all fixed below.
-- Companion: docs/methodology/class-first-class-citizen.md (data model + the
--            full app-code/RLS blast radius this sets up).
-- Paper:     docs/methodology/tutor-insights.md §5 (why the class is the citizen).
--
-- WHY
--   classes.teacher_user_id TEXT NOT NULL asserts one class = one teacher,
--   forever. That can't express a class changing teacher, several teachers at
--   once, a supply/cover teacher, or a teacher leaving the school. It also
--   fights the coverage model: coverage is a property of the durable *class*
--   (it accrues across every session whoever drove each one), so a teacher
--   leaving must never snap the curve.
--
--   The fix is already 90% built. The class is durable (UUID PK; class_sessions
--   FK to class_id; it owns its own current_seed/helix_state). Students are
--   already a relationship — user_tags(tag_type='class', role_in_context=
--   'student'), 168 live rows, with removed_at soft-delete. Each session
--   already stamps its own driver — class_sessions.teacher_user_id. The ONE
--   fossil is the ownership column, and the tell is the data: 168 class/student
--   tags vs 0 class/teacher tags. Teachers are the one actor still hard-owned.
--   This makes them symmetric with students, reusing the exact pattern in use.
--
-- WHAT THIS DOES (additive / standalone-safe — see the safety note):
--   1. Backfill: every class with a teacher gets a class/teacher tag for it.
--   2. classes.teacher_user_id → NULLABLE, redefined as a "lead teacher" pointer;
--      the relationship becomes the source of truth.
--   3. Additive helpers: class_teachers view + is_class_teacher() — the reusable
--      membership read for the app, and the predicate the RLS rebase reuses.
--
-- WHY NO PARTIAL-UNIQUE CHANGE (a v1 idea the review killed)
--   A draft of this migration swapped user_tags' total UNIQUE(user_id, tag_type,
--   tag_value) for a partial (active-only) index, to allow a *history* of removed
--   teacher rows. That breaks money: api/teacher/paddle-webhook.ts upserts the
--   student tag with onConflict:'user_id,tag_type,tag_value' on PAID enrollment,
--   and PostgREST cannot infer a partial index as the conflict arbiter — the
--   upsert (and paid enrollment) would fail. And it isn't needed: co-teaching
--   (different users), handover (remove A, add B), and supply (a bounded teacher
--   window) all work fine under the total constraint. The only thing it bought
--   was multi-row gap-history for the rare "same teacher returns" case — handled
--   instead by REACTIVATING the existing row (clear removed_at). So we KEEP the
--   total constraint. Richer handover history, if ever wanted, is a future change
--   coupled to a paddle-webhook upsert fix — not this migration.
--
-- WHAT THIS DELIBERATELY DOES NOT DO
--   * It enables/alters NO RLS. RLS is already LIVE on these tables (Lane B /
--     20260610_secfix_15 is APPLIED: relink_user_tags exists; user_tags &
--     class_sessions RLS are on). Applying THIS as service-role bypasses RLS, so
--     the backfill/ALTER run cleanly. The ownership→membership policy rebase
--     (swap `c.teacher_user_id = auth.uid()` for `is_class_teacher(...)`, keeping
--     the is_god_user() and school-admin branches) is specified in the companion
--     doc §5 and lands as its own migration — is_class_teacher() is provided here
--     for it to reuse.
--   * It does not drop classes.teacher_user_id (the app still reads it as the
--     lead pointer; dropped only after the companion-doc reads migrate).
--   * It writes no client-reachable teacher tags: the live user_tags_insert
--     policy forbids non-god authenticated users from inserting role='teacher'.
--     This backfill is service-role; the app's add/reassign-teacher path must go
--     through a service-role server route (companion doc §4).
--
-- REVERSAL (before classes.teacher_user_id is dropped elsewhere):
--   DROP VIEW IF EXISTS public.class_teachers;
--   DROP FUNCTION IF EXISTS public.is_class_teacher(uuid, text);
--   UPDATE public.user_tags SET removed_at = NOW()
--     WHERE tag_type='class' AND role_in_context='teacher'
--       AND added_by = 'migration:first-class-class' AND removed_at IS NULL;
--   -- (optional) re-impose NOT NULL only once every class has a lead pointer:
--   --   ALTER TABLE public.classes ALTER COLUMN teacher_user_id SET NOT NULL;
-- ============================================================================

BEGIN;

-- ----------------------------------------------------------------------------
-- 1. Backfill: lift each class's current owner into a class/teacher tag.
--    Idempotent: the NOT EXISTS guard skips any class that already has ANY
--    class/teacher tag for that user (active OR removed) — so re-runs never
--    violate the total unique constraint, and a deliberately-removed teacher is
--    not resurrected. added_at inherits the class's creation time so the
--    relationship's start date is honest. added_by carries a sentinel (the
--    column is NOT NULL) that also drives the reversal above.
-- ----------------------------------------------------------------------------
INSERT INTO public.user_tags (user_id, tag_type, tag_value, role_in_context, added_by, added_at)
SELECT
  c.teacher_user_id,
  'class',
  'CLASS:' || c.id::text,
  'teacher',
  'migration:first-class-class',
  COALESCE(c.created_at, NOW())
FROM public.classes c
WHERE c.teacher_user_id IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM public.user_tags ut
    WHERE ut.tag_type = 'class'
      AND ut.tag_value = 'CLASS:' || c.id::text
      AND ut.role_in_context = 'teacher'
      AND ut.user_id = c.teacher_user_id
  );

-- ----------------------------------------------------------------------------
-- 2. The ownership column becomes a nullable lead-teacher pointer.
--    Not dropped — the app still reads it (companion doc blast radius); it stays
--    populated and correct as "the lead teacher" until those reads migrate.
-- ----------------------------------------------------------------------------
ALTER TABLE public.classes ALTER COLUMN teacher_user_id DROP NOT NULL;

COMMENT ON COLUMN public.classes.teacher_user_id IS
  'Lead-teacher pointer (denormalised convenience). NOT the source of truth for teacher↔class — that is user_tags(tag_type=''class'', role_in_context=''teacher''). Nullable since 2026-06-13 (first-class-class). Read teachers via class_teachers / is_class_teacher().';

-- ----------------------------------------------------------------------------
-- 3. Helpers — the relationship made readable, and the reusable membership
--    predicate for the app and the RLS rebase.
-- ----------------------------------------------------------------------------

-- All active teachers of every class, lead flagged. Mirrors how school_summary
-- already counts school/teacher tags. NOTE the safe join shape: we build the
-- 'CLASS:'||id string on the TRUSTED classes side and never cast an untrusted
-- substring of tag_value to uuid (a cast in the join key can crash the view if
-- the planner evaluates it over non-'CLASS:' rows, e.g. 'SCHOOL:...'). And
-- security_invoker=on so it enforces the live RLS of its base tables instead of
-- running as owner (the secfix_12 keystone invariant — all public views set it).
CREATE OR REPLACE VIEW public.class_teachers
WITH (security_invoker = on) AS
SELECT
  c.id                                                AS class_id,
  ut.user_id                                           AS teacher_user_id,
  ut.added_at,
  ut.added_by,
  (c.teacher_user_id IS NOT DISTINCT FROM ut.user_id)  AS is_lead
FROM public.user_tags ut
JOIN public.classes c
  ON ut.tag_value = 'CLASS:' || c.id::text
WHERE ut.tag_type = 'class'
  AND ut.role_in_context = 'teacher'
  AND ut.removed_at IS NULL;

COMMENT ON VIEW public.class_teachers IS
  'Active teacher↔class relationships (the source of truth), lead flagged. Replaces reads of classes.teacher_user_id for "who teaches this class". is_lead depends on the lead pointer and changes when that column is eventually dropped.';

-- Reusable membership predicate. SECURITY DEFINER so it can sit inside a
-- user_tags / class_sessions / classes RLS policy without recursing through
-- user_tags' own RLS. The building block the rebase reuses to swap ownership
-- predicates (c.teacher_user_id = auth.uid()) for membership ones
-- (is_class_teacher(c.id, auth.uid()::text)). No untrusted cast — cannot error.
CREATE OR REPLACE FUNCTION public.is_class_teacher(p_class_id uuid, p_uid text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.user_tags ut
    WHERE ut.tag_type = 'class'
      AND ut.role_in_context = 'teacher'
      AND ut.removed_at IS NULL
      AND ut.tag_value = 'CLASS:' || p_class_id::text
      AND ut.user_id = p_uid
  );
$$;

COMMENT ON FUNCTION public.is_class_teacher(uuid, text) IS
  'True if p_uid holds an active class/teacher tag for p_class_id. The membership predicate that replaces classes.teacher_user_id ownership checks in app reads and (as its own migration) in RLS.';

REVOKE ALL ON FUNCTION public.is_class_teacher(uuid, text) FROM public;
GRANT EXECUTE ON FUNCTION public.is_class_teacher(uuid, text) TO authenticated;

NOTIFY pgrst, 'reload schema';

COMMIT;

-- ============================================================================
-- POST-APPLY VERIFICATION (run by hand). The backfill keys on
-- teacher_user_id IS NOT NULL (not is_active), so the verification matches that
-- predicate. Expect: class_teacher_tags == classes-with-a-lead (7 today, across
-- 6 distinct teachers — one teacher leads two classes); classes_without_lead 0.
-- ============================================================================
-- SELECT
--   (SELECT count(*) FROM classes WHERE teacher_user_id IS NOT NULL) AS classes_with_lead,
--   (SELECT count(*) FROM user_tags
--      WHERE tag_type='class' AND role_in_context='teacher' AND removed_at IS NULL)
--      AS class_teacher_tags,
--   (SELECT count(DISTINCT user_id) FROM user_tags
--      WHERE tag_type='class' AND role_in_context='teacher' AND removed_at IS NULL)
--      AS distinct_teachers,
--   (SELECT count(*) FROM classes WHERE teacher_user_id IS NULL) AS classes_without_lead;
-- -- Spot-check the view matches the (soon-deprecated) lead column:
-- SELECT c.id, c.teacher_user_id AS lead_col, ct.teacher_user_id AS tag_teacher, ct.is_lead
-- FROM classes c LEFT JOIN class_teachers ct ON ct.class_id = c.id
-- ORDER BY c.created_at;
