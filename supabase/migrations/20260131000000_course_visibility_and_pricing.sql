-- ============================================
-- COURSE VISIBILITY AND PRICING
-- Adds visibility controls and pricing tier columns
-- for premium access enforcement and launch strategy
-- ============================================

-- ============================================
-- STEP 1: ADD NEW COLUMNS
-- ============================================

-- Visibility: controls who can see the course
-- - public: visible to all users
-- - hidden: only visible to admins (used for premium at launch)
-- - beta: visible but marked as beta
ALTER TABLE courses ADD COLUMN IF NOT EXISTS visibility TEXT NOT NULL DEFAULT 'hidden';

-- Pricing tier: determines access rules
-- - free: always free for everyone
-- - premium: free through Yellow Belt, then paid
-- - community: always free (community-created)
ALTER TABLE courses ADD COLUMN IF NOT EXISTS pricing_tier TEXT NOT NULL DEFAULT 'premium';

-- Community flag: explicit marker for community courses
-- (replaces prefix detection like 'community_')
ALTER TABLE courses ADD COLUMN IF NOT EXISTS is_community BOOLEAN NOT NULL DEFAULT FALSE;

-- Release timestamp: when course went public
ALTER TABLE courses ADD COLUMN IF NOT EXISTS released_at TIMESTAMPTZ;

-- Featured ordering: for course selector display order
ALTER TABLE courses ADD COLUMN IF NOT EXISTS featured_order INTEGER;

-- ============================================
-- STEP 2: CREATE INDEXES
-- ============================================

CREATE INDEX IF NOT EXISTS idx_courses_visibility ON courses(visibility);
CREATE INDEX IF NOT EXISTS idx_courses_pricing_tier ON courses(pricing_tier);
CREATE INDEX IF NOT EXISTS idx_courses_is_community ON courses(is_community);

-- ============================================
-- STEP 3: BACKFILL PRICING TIER
-- Based on target language (Big 10 = premium)
-- ============================================

-- Big 10 languages: eng, spa, fra, deu, ita, por, zho, jpn, ara, kor
UPDATE courses SET pricing_tier = CASE
  WHEN target_lang IN ('eng', 'spa', 'fra', 'deu', 'ita', 'por', 'zho', 'jpn', 'ara', 'kor')
    THEN 'premium'
  ELSE 'free'
END
WHERE pricing_tier = 'premium'; -- Only update if still at default

-- ============================================
-- STEP 4: BACKFILL COMMUNITY FLAG
-- Courses with 'community_' prefix are community courses
-- ============================================

UPDATE courses SET
  is_community = TRUE,
  pricing_tier = 'community'
WHERE course_code LIKE 'community_%'
  AND is_community = FALSE;

-- ============================================
-- STEP 5: SET INITIAL VISIBILITY
-- Development state: ALL courses visible for testing
-- At launch, run: UPDATE courses SET visibility = 'hidden' WHERE pricing_tier = 'premium';
-- ============================================

-- For development/testing: make all courses visible
-- Map from new_app_status to visibility for existing courses
UPDATE courses SET visibility = CASE
  WHEN new_app_status = 'beta' THEN 'beta'
  WHEN new_app_status = 'released' THEN 'public'
  ELSE 'public'  -- Default to public for testing
END
WHERE visibility = 'hidden'; -- Only update if still at default

-- ============================================
-- LAUNCH CHECKLIST (run these when ready to launch):
-- 1. Hide premium courses:
--    UPDATE courses SET visibility = 'hidden' WHERE pricing_tier = 'premium';
-- 2. Then when premium is ready (~6 months later):
--    UPDATE courses SET visibility = 'public' WHERE pricing_tier = 'premium';
-- ============================================

-- ============================================
-- STEP 6: UPDATE RLS POLICIES
-- Only show visible courses to public users
-- ============================================

-- Drop existing overly permissive policies
DROP POLICY IF EXISTS "Authenticated users can view courses" ON courses;
DROP POLICY IF EXISTS "Public users can view visible courses" ON courses;
DROP POLICY IF EXISTS "Authenticated users can view visible courses" ON courses;

-- Public (anon) users only see public and beta courses
CREATE POLICY "Public users can view visible courses"
  ON courses FOR SELECT TO anon
  USING (visibility IN ('public', 'beta'));

-- Authenticated users same visibility (they can access content via entitlement checks)
CREATE POLICY "Authenticated users can view visible courses"
  ON courses FOR SELECT TO authenticated
  USING (visibility IN ('public', 'beta'));

-- Service role can still manage all courses
-- (existing policy "Service role can manage courses" remains)

-- ============================================
-- STEP 7: ADD COMMENTS
-- ============================================

COMMENT ON COLUMN courses.visibility IS 'Course visibility: public (all users), hidden (admin only), beta (visible with beta badge)';
COMMENT ON COLUMN courses.pricing_tier IS 'Pricing tier: free (always free), premium (paid after Yellow Belt), community (always free, community-created)';
COMMENT ON COLUMN courses.is_community IS 'Whether this is a community-created course (always free)';
COMMENT ON COLUMN courses.released_at IS 'Timestamp when course was made public';
COMMENT ON COLUMN courses.featured_order IS 'Display order in course selector (lower = first)';
