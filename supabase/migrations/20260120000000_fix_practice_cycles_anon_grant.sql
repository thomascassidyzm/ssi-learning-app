-- Migration: Fix practice_cycles view permissions
-- Date: 2026-01-20
-- Purpose: Grant SELECT on practice_cycles to anon role
--
-- The 20260118 migration dropped and recreated practice_cycles view but
-- only granted SELECT to authenticated role, not anon. This breaks the
-- learning app which uses the anon key for public course access.

-- Grant anon access to practice_cycles (same as lego_cycles)
GRANT SELECT ON practice_cycles TO anon;

-- Verify both roles now have access
COMMENT ON VIEW practice_cycles IS 'Practice phrase cycles with audio refs. Access: anon, authenticated';
