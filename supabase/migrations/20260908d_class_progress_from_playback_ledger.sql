-- 20260908d_class_progress_from_playback_ledger.sql
--
-- ONE DEFINITION OF A MINUTE — the class roster's practice time, too.
--
-- Companion to 20260908c. That migration moved the admin/schools practice
-- MINUTES rpcs onto the playback ledger. `class_student_progress` is the third
-- reader of the same idea and was missed: `total_practice_seconds` summed
-- `sessions.duration_seconds`, which was wall clock until the 2026-08-20
-- client fix. It feeds the teacher dashboard and the teachers page, so a
-- teacher looking at a pupil could read a bigger number than the pupil reads
-- for themselves — the same disagreement 20260908c exists to end.
--
-- Measured against production 2026-09-08: the view returns 99,356 minutes
-- across its 668 rows where the ledger holds 88,880 for the same
-- learner + course pairs.
--
-- `last_active_at` deliberately still comes from `sessions`. It is a
-- timestamp, not a duration; the wall-clock defect never touched it, and the
-- session row is the better record of when somebody last turned up.
--
-- Everything else about the view — its columns, its joins, its
-- security_invoker posture and its grants — is unchanged.

create or replace view public.class_student_progress
with (security_invoker = on) as
SELECT c.id AS class_id,
    c.class_name,
    c.course_code,
    c.school_id,
    c.teacher_user_id,
    ut.user_id AS student_user_id,
    l.id AS learner_id,
    l.display_name AS student_name,
    COALESCE(( SELECT count(*) AS count
           FROM seed_progress sp
          WHERE sp.learner_id = l.id AND sp.course_id = c.course_code AND sp.is_introduced = true), 0::bigint) AS seeds_completed,
    COALESCE(( SELECT count(*) AS count
           FROM lego_progress lp
          WHERE lp.learner_id = l.id AND lp.course_id = c.course_code AND lp.is_retired = true), 0::bigint) AS legos_mastered,
    -- play_seconds is bigint and sum(bigint) is numeric, so the cast is what
    -- keeps this column bigint, as it has always been. Lossless: play_seconds
    -- holds whole seconds. Without it CREATE OR REPLACE VIEW refuses, because
    -- it may not change a column's type.
    COALESCE(( SELECT sum(lso.play_seconds) AS sum
           FROM learner_speaking_opportunities lso
          WHERE lso.learner_id = l.id AND lso.course_code = c.course_code), 0::numeric)::bigint AS total_practice_seconds,
    ( SELECT max(s.ended_at) AS max
           FROM sessions s
          WHERE s.learner_id = l.id AND s.course_id = c.course_code) AS last_active_at,
    ut.added_at AS joined_class_at
   FROM classes c
     JOIN user_tags ut ON ut.tag_value = ('CLASS:'::text || c.id::text) AND ut.tag_type = 'class'::text AND ut.removed_at IS NULL AND ut.role_in_context = 'student'::text
     JOIN learners l ON l.user_id = ut.user_id;

notify pgrst, 'reload schema';
