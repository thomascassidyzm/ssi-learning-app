-- ============================================================================
-- SECURITY FIX #4 (Phase A, clean revoke) — close 2 leaky schools analytics views
-- ============================================================================
-- THE LEAK: class_activity_stats and demographic_cycle_averages are aggregate
-- analytics VIEWS over every school's/class's activity. Both were granted to
-- anon (the public key shipped in every browser bundle), so anyone with the
-- anon key could SELECT every school's class-level activity + benchmark
-- averages — a cross-tenant data leak.
--
-- The sibling migration 20260226_rls_entitlements_fix.sql already did exactly
-- this for the other 3 schools views (class_student_progress, school_summary,
-- region_summary) but MISSED these 2. This closes the gap with the same pattern.
--
-- WHY THIS IS SAFE: these views are READ-ONLY analytics, consumed only by the
-- authenticated schools dashboards (packages/player-vue/src/composables/schools/
-- useSchoolData.ts, useAnalyticsData.ts, useClassesData.ts) via the logged-in
-- supabase client. No code writes them; no guest/anon flow reads them (school
-- analytics require teacher/admin login). Verified 2026-06-08 against prod.
--
-- authenticated SELECT is preserved so teacher/school-admin/regional dashboards
-- keep working. anon loses everything (including the inert write grants that
-- blanket table grants had handed it on these non-updatable views).

REVOKE ALL ON class_activity_stats      FROM anon;
REVOKE ALL ON demographic_cycle_averages FROM anon;

-- Idempotent: ensure the legitimate authenticated readers keep SELECT.
GRANT SELECT ON class_activity_stats      TO authenticated;
GRANT SELECT ON demographic_cycle_averages TO authenticated;

-- Reload PostgREST so the grant change takes effect immediately.
NOTIFY pgrst, 'reload schema';
