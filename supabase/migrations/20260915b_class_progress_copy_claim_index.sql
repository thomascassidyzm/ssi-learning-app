-- 20260915b_class_progress_copy_claim_index
--
-- WHY
-- ---
-- Two concurrent POST /api/school/copy-teacher-play/apply requests for the
-- same teacher and course both passed the prior-copy scan, both inserted the
-- teacher's rows onto the class learner, and both wrote an audit row: class
-- 7E was credited 22 + 29 duplicated items (job #811, from the cold
-- verification of #790). Planning, inserting and the audit write were three
-- separate steps with nothing atomic between them.
--
-- WHAT
-- ----
-- The apply now inserts its audit row FIRST, as a claim whose record is
-- {"state":"running", ...}, and only then reads and copies; the row is updated
-- in place into the full record when the run ends (api/_utils/classProgressCopy.ts,
-- takeClaim/applyCopy). This partial unique index is the atomic guard: at most
-- one running claim per (source_learner_id, course_code), so the second
-- request's claim insert raises unique_violation (23505) and it answers 409
-- having written nothing. A finished, failed, abandoned or undo row carries no
-- state 'running' and never occupies the slot.
--
-- Keyed by SOURCE and course, not by target: the ONE CLASS rule (a teacher's
-- play is credited to one class) means two classes copying the same teacher
-- at once is the same race.
--
-- No progress row is touched. Posture of the table is unchanged
-- (service-role only, RLS on, zero policies — 20260911b).

CREATE UNIQUE INDEX IF NOT EXISTS uq_class_progress_copy_audit_running_claim
  ON public.class_progress_copy_audit (source_learner_id, course_code)
  WHERE (record->>'state') = 'running';

COMMENT ON INDEX public.uq_class_progress_copy_audit_running_claim IS
  'One running copy claim per teacher (source learner) and course. The apply inserts a {state: running} audit row before it plans; a concurrent second apply hits this index and answers 409 (job #811).';

NOTIFY pgrst, 'reload schema';
