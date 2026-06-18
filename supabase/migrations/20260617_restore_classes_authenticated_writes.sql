-- Restore class create/edit/delete for teachers (2026-06-17)
--
-- BUG: creating a class failed with `POST .../createClass` → 403, Postgres
-- 42501 "permission denied for table classes". `createClass` does a client-side
-- `insert` into `classes` as the `authenticated` role.
--
-- ROOT CAUSE: 20260506_revoke_anon_writes_phase7.sql ran
--   REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.classes FROM anon, authenticated;
-- It should only have targeted `anon` — including `authenticated` stripped
-- teachers of the ability to create/edit their own classes. (Sibling schools
-- tables like user_tags kept their authenticated INSERT/UPDATE, so classes was
-- the outlier.) RLS is OFF on classes (schools tables are deliberately
-- permissive, Phase-1 RLS only), so the dormant classes_insert/classes_update
-- policies — which already scope writes to teacher_user_id = auth.uid()::text —
-- can't grant access either; the table GRANT is the only gate, and it was gone.
--
-- FIX: re-grant the writes to `authenticated` only. `anon` stays revoked (the
-- actual intent of phase 7). When schools RLS is later enabled, the existing
-- policies take over the row-scoping; this grant is what RLS expects underneath.

GRANT INSERT, UPDATE, DELETE ON public.classes TO authenticated;

NOTIFY pgrst, 'reload schema';
