-- daily_contributions is a non-PII community aggregate (target_language,
-- contribution_date, phrases_count, minutes_practiced, unique_speakers). It is
-- the "SSi community" counter shown to everyone — guests AND signed-in users.
--
-- The live DB was denying SELECT to anon/authenticated ("permission denied for
-- table daily_contributions"), so the stats modal's today/7d/30d windows read
-- 0 for everyone (only the client-side all-time OFFSET showed). RLS is DISABLED
-- on this table (see 20260326100000_disable_all_rls.sql) — this was never a
-- row-policy issue, the table-level grant was simply never issued live.
--
-- Restore public read. The table holds no PII and is meant to be world-readable.
grant select on table public.daily_contributions to anon, authenticated;

notify pgrst, 'reload schema';
