-- ============================================
-- TEMPORARY: Make all courses visible
-- This removes visibility filtering until entitlements are ready
--
-- Status options for new_app_status:
--   - draft: hidden from users (work in progress)
--   - beta: visible with beta badge
--   - live: fully visible to all users
-- ============================================

-- Migrate any 'released' status to 'live' (standardizing on draft/beta/live)
UPDATE courses SET new_app_status = 'live' WHERE new_app_status = 'released';

-- Drop the restrictive visibility policies (if they exist)
DROP POLICY IF EXISTS "Public users can view visible courses" ON courses;
DROP POLICY IF EXISTS "Authenticated users can view visible courses" ON courses;

-- Create permissive policies - all beta/live courses visible to everyone
-- (entitlement checks happen at playback time, not listing time)
CREATE POLICY "Public users can view all courses"
  ON courses FOR SELECT TO anon
  USING (new_app_status IN ('live', 'beta'));

CREATE POLICY "Authenticated users can view all courses"
  ON courses FOR SELECT TO authenticated
  USING (new_app_status IN ('live', 'beta'));
