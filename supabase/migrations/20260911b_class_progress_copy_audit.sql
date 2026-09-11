-- 20260911b_class_progress_copy_audit
--
-- WHY
-- ---
-- A teacher who runs lessons signed in as THEMSELVES instead of using Play as
-- class leaves the class's own learner account (classes.class_learner_id)
-- reading "not started" forever. The school admin copies that teacher's play
-- for the class's course onto the class account (api/school/copy-teacher-play
-- preview + apply). Every apply writes ONE append-only row here: who ran it,
-- from which learner to which, the class and course, every copied row id per
-- table, every table deliberately skipped with its reason, and the cursor on
-- both sides before and after. The record is also the idempotency key — a
-- second run reads prior rows for the same source/target/course and skips
-- every source row already copied, so nothing is ever double-counted.
--
-- Shape follows api/_utils/identity/mergeAudit.ts (MovedRows) as a JSONB
-- record, per the brief; posture follows 20260717b_admin_impersonation_audit
-- (RLS doctrine rule 7): RLS on with ZERO policies, default grants revoked,
-- service_role only. No client ever reads or writes this table.

CREATE TABLE IF NOT EXISTS public.class_progress_copy_audit (
    id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    created_at          timestamp with time zone NOT NULL DEFAULT now(),
    actor_user_id       text NOT NULL,
    class_id            uuid NOT NULL,
    course_code         text NOT NULL,
    source_learner_id   uuid NOT NULL,
    target_learner_id   uuid NOT NULL,
    record              jsonb NOT NULL
);

COMMENT ON TABLE public.class_progress_copy_audit IS
  'Append-only audit of a school admin copying a teacher''s own-account play onto the class''s play-as-class learner. Service-role-only (RLS on, no policies) — written only by api/school/copy-teacher-play/apply.ts. record = { copied: {table: {sourceId: newId}}, skipped: [{table, reason}], cursorBefore, cursorAfter, minutesAdded }.';
COMMENT ON COLUMN public.class_progress_copy_audit.actor_user_id IS
  'auth uid (learners.user_id) of the school admin who ran the copy.';
COMMENT ON COLUMN public.class_progress_copy_audit.source_learner_id IS
  'learners.id of the teacher''s own account the rows were copied FROM. Rows stay in place there.';
COMMENT ON COLUMN public.class_progress_copy_audit.target_learner_id IS
  'learners.id of the class''s own learner (classes.class_learner_id) the rows were copied ONTO.';

CREATE INDEX IF NOT EXISTS idx_class_progress_copy_audit_pair
  ON public.class_progress_copy_audit (source_learner_id, target_learner_id, course_code, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_class_progress_copy_audit_class
  ON public.class_progress_copy_audit (class_id, created_at DESC);

ALTER TABLE public.class_progress_copy_audit ENABLE ROW LEVEL SECURITY;
-- Deliberately zero CREATE POLICY statements — deny-by-default for anon/authenticated.

REVOKE ALL ON TABLE public.class_progress_copy_audit FROM anon;
REVOKE ALL ON TABLE public.class_progress_copy_audit FROM authenticated;
GRANT ALL ON TABLE public.class_progress_copy_audit TO service_role;

NOTIFY pgrst, 'reload schema';
