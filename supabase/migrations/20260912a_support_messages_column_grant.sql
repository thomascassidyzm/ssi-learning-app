-- support_messages: the browser may read ONLY the columns the app shows
-- ======================================================================
--
-- SEC0912-B-01 (job #297, confirmed live by job #299, fixed by job #300).
-- 20260911_support_channel.sql granted `authenticated` a TABLE-LEVEL SELECT on
-- support_messages, so every one of its 25 columns — envelope, draft_reply,
-- escalation_evidence, move_reason, model_ladder, the asker's auth uid — was
-- readable straight from PostgREST by any admin whose RLS row test passed.
-- The handlers project MESSAGE_VIEW_COLUMNS (api/support/_shared.ts) but a
-- projection in TypeScript never narrows a grant in Postgres. Nothing has
-- leaked: the table held zero messages when this landed.
--
-- The fix is a COLUMN-LEVEL grant: exactly MESSAGE_VIEW_COLUMNS plus thread_id
-- (the filter key a direct read needs; the row policy already keys on it).
-- A test pins the two lists together — api/_security/sec0912-b-support-channel
-- — so a column added to one without the other goes red.
--
-- Why not a view: the app never reads this table from the browser today (both
-- handlers and the doorbell cron use the service key); a view is a second
-- object to keep in step for a reader that does not exist. The column grant
-- is the smaller change and future columns are UNREADABLE by default.
--
-- Consequences worth knowing:
--   * `select=*` from PostgREST as `authenticated` now answers
--     "permission denied" — a caller must name the columns. No shipped code
--     does `select('*')` on this table as a browser session.
--   * RLS doctrine rule 2: the REVOKE and its GRANT ride in the same file.
--   * Canary: supabase/secfix-toolkit/canary_20260912_support_grant_and_govt_subtree.cjs
--
-- Applied live 2026-09-12 (job #300), canary style, one transaction.

BEGIN;

REVOKE SELECT ON public.support_messages FROM authenticated;

GRANT SELECT (
  id,
  thread_id,
  body,
  direction,
  author_source,
  author_name,
  in_reply_to,
  escalated_at,
  escalation_resolved_at,
  answered_at,
  created_at
) ON public.support_messages TO authenticated;

-- The row policy support_messages_own_read is unchanged: rows are still
-- "is this my school's / my org's thread?", columns are now the app's view.

NOTIFY pgrst, 'reload schema';

COMMIT;
