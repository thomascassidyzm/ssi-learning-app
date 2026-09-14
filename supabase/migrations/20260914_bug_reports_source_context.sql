-- THE POSTBOX GROWS A SECOND DOOR: "Report a bug" in the schools dashboard
-- ========================================================================
--
-- Tom's ruling, 2026-09-14: school admins and teachers get "Report a bug" in
-- the schools dashboard account menu, "because the bug might be with the
-- dashboard side of things". Same table, same route, same channel — one
-- postbox — plus two columns so a dashboard report is diagnosable:
--
--   source   'learner' (the player) or 'schools_dashboard'. Default 'learner'
--            so every row that exists keeps its meaning.
--   context  What the dashboard had in view when the report was raised:
--            { role, school_id, school_name, group_id, class_id, node_id,
--              page_title }. The page URL is already `route`. Null from the
--            player.
--
-- Still one way, still no reply path, still service-role only (RLS on, no
-- policies). Bug reports are NOT support messages: support_messages stays the
-- turn-taking channel and nothing here touches it.
--
-- APPLIED 2026-09-14 by job #633 through the postgres role. Do not re-apply.

BEGIN;

ALTER TABLE public.bug_reports
  ADD COLUMN IF NOT EXISTS source  text NOT NULL DEFAULT 'learner',
  ADD COLUMN IF NOT EXISTS context jsonb;

COMMENT ON COLUMN public.bug_reports.source IS
  'Which door the report came through: learner (player) or schools_dashboard. Job #633, 2026-09-14.';
COMMENT ON COLUMN public.bug_reports.context IS
  'Dashboard reports only: { role, school_id, school_name, group_id, class_id, node_id, page_title } in view when raised.';

NOTIFY pgrst, 'reload schema';

COMMIT;
