-- ============================================
-- Class Reporting Views Migration
-- ============================================
-- Speaking opportunities (cycles) as the core metric.
-- Each prompt→pause→voice1→voice2 cycle = 1 speaking opportunity.
-- sessions.items_practiced already tracks cycle count.
--
-- Date: 2026-02-23

-- ============================================
-- 1. CLASS ACTIVITY STATS VIEW
-- Core class-level metrics aggregated from sessions
-- ============================================

CREATE OR REPLACE VIEW class_activity_stats AS
SELECT
  c.id AS class_id,
  c.class_name,
  c.school_id,
  c.course_code,
  s_school.region_code,

  -- Core metric: speaking opportunities (cycles)
  COALESCE(SUM(sess.items_practiced), 0) AS total_cycles,
  COUNT(DISTINCT sess.id) AS total_sessions,
  COALESCE(SUM(sess.duration_seconds), 0) AS total_practice_seconds,

  -- Student engagement
  COUNT(DISTINCT l.id) AS active_students,

  -- Averages
  CASE WHEN COUNT(DISTINCT sess.id) > 0
    THEN ROUND(SUM(sess.items_practiced)::numeric / COUNT(DISTINCT sess.id), 1)
    ELSE 0
  END AS avg_cycles_per_session,

  -- Active days in last 7 days
  COUNT(DISTINCT CASE
    WHEN sess.started_at >= NOW() - INTERVAL '7 days'
    THEN DATE(sess.started_at)
  END) AS active_days_last_7

FROM classes c
JOIN schools s_school ON s_school.id = c.school_id
LEFT JOIN user_tags ut
  ON ut.tag_value = 'CLASS:' || c.id::text
  AND ut.tag_type = 'class'
  AND ut.role_in_context = 'student'
  AND ut.removed_at IS NULL
LEFT JOIN learners l ON l.user_id = ut.user_id
LEFT JOIN sessions sess
  ON sess.learner_id = l.id
  AND sess.course_id = c.course_code
WHERE c.is_active = true
GROUP BY c.id, c.class_name, c.school_id, c.course_code, s_school.region_code;

COMMENT ON VIEW class_activity_stats IS 'Class-level speaking opportunity metrics. Core metric: total_cycles = completed 4-phase learning cycles.';

-- ============================================
-- 2. DEMOGRAPHIC CYCLE AVERAGES VIEW
-- Comparison benchmarks at school/region/course levels
-- ============================================

CREATE OR REPLACE VIEW demographic_cycle_averages AS

-- School level: avg cycles per class within each school
SELECT
  'school' AS level,
  cas.school_id::text AS group_id,
  ROUND(AVG(cas.total_cycles), 0) AS avg_total_cycles,
  ROUND(AVG(cas.avg_cycles_per_session), 1) AS avg_cycles_per_session,
  COUNT(*) AS class_count
FROM class_activity_stats cas
GROUP BY cas.school_id

UNION ALL

-- Region level: avg cycles per class within each region
SELECT
  'region' AS level,
  cas.region_code AS group_id,
  ROUND(AVG(cas.total_cycles), 0) AS avg_total_cycles,
  ROUND(AVG(cas.avg_cycles_per_session), 1) AS avg_cycles_per_session,
  COUNT(*) AS class_count
FROM class_activity_stats cas
WHERE cas.region_code IS NOT NULL
GROUP BY cas.region_code

UNION ALL

-- Course level: avg cycles per class across all classes doing a course
SELECT
  'course' AS level,
  cas.course_code AS group_id,
  ROUND(AVG(cas.total_cycles), 0) AS avg_total_cycles,
  ROUND(AVG(cas.avg_cycles_per_session), 1) AS avg_cycles_per_session,
  COUNT(*) AS class_count
FROM class_activity_stats cas
GROUP BY cas.course_code;

COMMENT ON VIEW demographic_cycle_averages IS 'Comparison benchmarks for class reporting. Never exposes individual student data.';

-- ============================================
-- 3. INDEX for time-windowed session queries
-- ============================================

CREATE INDEX IF NOT EXISTS idx_sessions_course_started
  ON sessions(course_id, started_at);

-- ============================================
-- 4. GRANTS for god mode testing (anon access)
-- ============================================

GRANT SELECT ON class_activity_stats TO anon;
GRANT SELECT ON demographic_cycle_averages TO anon;
GRANT SELECT ON class_activity_stats TO authenticated;
GRANT SELECT ON demographic_cycle_averages TO authenticated;
