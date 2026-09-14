-- ONE DOOR FOR EVERYONE: identity attached at report time, and the content flag
-- =========================================================================
--
-- Tom's ruling, 2026-09-14 15:01Z (job #677): every in-app door writes one
-- table with the account attached, so nobody has to ask "who are you and what
-- build are you on". Neil Dickson's report could not be found by email; Tom had
-- to ask for a screenshot of his Account page to read his account code. These
-- columns make that unnecessary. All nullable, all written server-side by
-- POST /api/report/bug from the VERIFIED bearer, never from the client, and
-- stored on the row because roles and emails change and the report must say
-- what they were when it was sent. A guest carries nulls throughout.
--
--   account_code      supportIdForLearnerId(learners.id), the code Settings shows
--   reporter_email    the signed-in email on the verified bearer
--   platform_role     learners.platform_role at report time
--   educational_role  learners.educational_role at report time
--   school_role       resolveVisibleScope's role for school staff, else null
--   school_id         the staff member's school, else null
--   group_id          a govt_admin's group, else null
--
-- source grows a fourth value, 'content_flag': the player's flag button
-- (ReportIssueButton.vue) now posts here too, with `context` naming the clip
-- { audio_id, lego_id, seed_id, known_text, target_text }. Its sample_flags
-- upsert stays because Popty's QA tooling reads that table.
--
-- Additive only: no drop, no delete, no update of existing rows. Still one
-- way, still service-role only (RLS on, no policies).
--
-- APPLIED 2026-09-14 by job #677 through the postgres role, one transaction.
-- Do not re-apply.

BEGIN;

ALTER TABLE public.bug_reports
  ADD COLUMN IF NOT EXISTS account_code     text,
  ADD COLUMN IF NOT EXISTS reporter_email   text,
  ADD COLUMN IF NOT EXISTS platform_role    text,
  ADD COLUMN IF NOT EXISTS educational_role text,
  ADD COLUMN IF NOT EXISTS school_role      text,
  ADD COLUMN IF NOT EXISTS school_id        uuid,
  ADD COLUMN IF NOT EXISTS group_id         uuid;

COMMENT ON COLUMN public.bug_reports.source IS
  'Which door the report came through: learner (player), schools_dashboard, tester_widget, or content_flag (the player''s flag button; context names the clip). Jobs #633, #652, #677, 2026-09-14.';
COMMENT ON COLUMN public.bug_reports.context IS
  'Dashboard reports: { role, school_id, school_name, group_id, class_id, node_id, page_title } in view when raised. Content flags: { audio_id, lego_id, seed_id, known_text, target_text }. Null otherwise.';
COMMENT ON COLUMN public.bug_reports.account_code IS
  'The account code Settings shows, derived from learners.id server-side at report time. Null for a guest. Job #677.';
COMMENT ON COLUMN public.bug_reports.reporter_email IS
  'The signed-in email on the verified bearer at report time. Never from the client. Job #677.';

NOTIFY pgrst, 'reload schema';

COMMIT;
