-- Schema Verification Script
-- Run this in Supabase SQL Editor after deploying the learner schema

-- ============================================
-- 1. CHECK TABLES EXIST
-- ============================================
SELECT 
  'Tables Created' as check_type,
  COUNT(*) as count,
  ARRAY_AGG(table_name ORDER BY table_name) as items
FROM information_schema.tables
WHERE table_schema = 'public'
AND table_name IN (
  'learners',
  'course_enrollments',
  'lego_progress',
  'seed_progress',
  'sessions',
  'response_metrics',
  'spike_events'
);

-- ============================================
-- 2. CHECK VIEWS EXIST
-- ============================================
SELECT 
  'Views Created' as check_type,
  COUNT(*) as count,
  ARRAY_AGG(table_name ORDER BY table_name) as items
FROM information_schema.views
WHERE table_schema = 'public'
AND table_name IN ('learner_stats', 'course_progress');

-- ============================================
-- 3. CHECK RLS IS ENABLED
-- ============================================
SELECT 
  'RLS Enabled' as check_type,
  tablename,
  rowsecurity as enabled
FROM pg_tables
WHERE schemaname = 'public'
AND tablename IN (
  'learners',
  'course_enrollments',
  'lego_progress',
  'seed_progress',
  'sessions',
  'response_metrics',
  'spike_events'
)
ORDER BY tablename;

-- ============================================
-- 4. CHECK POLICIES EXIST
-- ============================================
SELECT 
  'Policies Created' as check_type,
  schemaname,
  tablename,
  policyname
FROM pg_policies
WHERE schemaname = 'public'
ORDER BY tablename, policyname;

-- ============================================
-- 5. CHECK FUNCTIONS EXIST
-- ============================================
SELECT 
  'Functions Created' as check_type,
  routine_name,
  routine_type
FROM information_schema.routines
WHERE routine_schema = 'public'
AND routine_name IN ('update_updated_at_column', 'handle_new_user')
ORDER BY routine_name;

-- ============================================
-- 6. CHECK TRIGGERS EXIST
-- ============================================
SELECT 
  'Triggers Created' as check_type,
  trigger_name,
  event_object_table as table_name,
  action_timing,
  event_manipulation as event
FROM information_schema.triggers
WHERE trigger_schema = 'public'
AND (
  trigger_name LIKE '%updated_at%' OR
  trigger_name = 'on_auth_user_created'
)
ORDER BY event_object_table, trigger_name;

-- ============================================
-- 7. CHECK INDEXES EXIST
-- ============================================
SELECT 
  'Indexes Created' as check_type,
  schemaname,
  tablename,
  indexname
FROM pg_indexes
WHERE schemaname = 'public'
AND tablename IN (
  'course_enrollments',
  'lego_progress',
  'seed_progress',
  'sessions',
  'response_metrics',
  'spike_events'
)
ORDER BY tablename, indexname;

-- ============================================
-- 8. CHECK FOREIGN KEY CONSTRAINTS
-- ============================================
SELECT 
  'Foreign Keys' as check_type,
  tc.table_name,
  kcu.column_name,
  ccu.table_name AS foreign_table_name,
  ccu.column_name AS foreign_column_name
FROM information_schema.table_constraints AS tc
JOIN information_schema.key_column_usage AS kcu
  ON tc.constraint_name = kcu.constraint_name
  AND tc.table_schema = kcu.table_schema
JOIN information_schema.constraint_column_usage AS ccu
  ON ccu.constraint_name = tc.constraint_name
  AND ccu.table_schema = tc.table_schema
WHERE tc.constraint_type = 'FOREIGN KEY'
AND tc.table_schema = 'public'
AND tc.table_name IN (
  'learners',
  'course_enrollments',
  'lego_progress',
  'seed_progress',
  'sessions',
  'response_metrics',
  'spike_events'
)
ORDER BY tc.table_name, kcu.column_name;

-- ============================================
-- SUMMARY
-- ============================================
SELECT 
  'SUMMARY' as report,
  (SELECT COUNT(*) FROM information_schema.tables 
   WHERE table_schema = 'public' 
   AND table_name IN ('learners','course_enrollments','lego_progress','seed_progress','sessions','response_metrics','spike_events')) as tables_created,
  (SELECT COUNT(*) FROM information_schema.views 
   WHERE table_schema = 'public' 
   AND table_name IN ('learner_stats','course_progress')) as views_created,
  (SELECT COUNT(*) FROM pg_policies 
   WHERE schemaname = 'public' 
   AND tablename IN ('learners','course_enrollments','lego_progress','seed_progress','sessions','response_metrics','spike_events')) as policies_created,
  (SELECT COUNT(*) FROM information_schema.routines 
   WHERE routine_schema = 'public' 
   AND routine_name IN ('update_updated_at_column','handle_new_user')) as functions_created;
