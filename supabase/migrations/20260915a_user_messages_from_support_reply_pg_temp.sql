-- user_messages_from_support_reply() landed in 20260914e_user_messages.sql as a
-- SECURITY DEFINER trigger pinned to `search_path = public` — without pg_temp.
-- Postgres searches the temporary schema FIRST when pg_temp is not named, so a
-- caller who can CREATE TEMP TABLE could shadow an unqualified relation inside
-- the definer body with the owner's rights. The manual's advice, and the rule
-- api/_utils/definerSearchPath.security.test.ts enforces over schema.sql, is
-- pg_temp explicit and LAST. Config-only: the body is untouched.
-- Nightly red 2026-09-15 on dev, staging and main (job #774).

ALTER FUNCTION public.user_messages_from_support_reply()
  SET search_path TO 'public', 'pg_temp';

NOTIFY pgrst, 'reload schema';
