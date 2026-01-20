-- ============================================
-- BRITTANY TEST DATA SEED
-- ============================================
-- Creates comprehensive test data for the Brittany region:
--   - 1 Government Admin (Ofis Publik ar Brezhoneg)
--   - 10 Schools across Brittany (Skol Diwan network)
--   - 20 Teachers (2 per school)
--   - 50 Classes (5 per school)
--   - 1000 Students (20 per class)
--
-- All users get learner records, course enrollments, and realistic progress data.
-- Courses (using existing released courses with audio):
--   - cym_n_for_eng (Welsh North) - All students (primary course)
--   - spa_for_eng (Spanish) - ~50% of students (secondary)
--   - cym_s_for_eng (Welsh South) - ~15% of students (tertiary)
--
-- Perfect for God Mode testing - impersonate any user to see their view.
--
-- To run: psql $DATABASE_URL -f supabase/seeds/brittany_test_data.sql
-- To reset: Run the cleanup section at the bottom first
--
-- Date: 2026-01-20

BEGIN;

-- ============================================
-- CONFIGURATION
-- ============================================
DO $$
DECLARE
  -- Course configuration (using existing released courses)
  -- Students get enrolled in 1-3 courses with varying progress
  v_courses TEXT[] := ARRAY['cym_n_for_eng', 'spa_for_eng', 'cym_s_for_eng'];
  v_course_code TEXT;  -- Will be set per-student

  -- Government Admin
  v_govt_admin_user_id TEXT := 'user_2bre_govt_admin_001';
  v_govt_admin_learner_id UUID;
  v_govt_admin_id UUID;

  -- School arrays (we'll iterate through these)
  v_school_names TEXT[] := ARRAY[
    'Skol Diwan Kemper',
    'Skol Diwan Brest',
    'Skol Diwan Roazhon',
    'Skol Diwan Gwened',
    'Skol Diwan Sant-Brieg',
    'Skol Diwan Lannuon',
    'Skol Diwan Karaez',
    'Skol Diwan Pondi',
    'Skol Diwan Montroulez',
    'Skol Diwan Naoned'
  ];

  -- Breton first names (mixed gender)
  v_first_names TEXT[] := ARRAY[
    'Yann', 'Erwan', 'Goulven', 'Tanguy', 'Malo', 'Corentin', 'Ronan', 'Gwenael', 'Brieuc', 'Tugdual',
    'Nolwenn', 'Enora', 'Morgane', 'Gwenaelle', 'Soizic', 'Maiwenn', 'Sterenn', 'Youna', 'Annaig', 'Katell',
    'Alan', 'Deniel', 'Ewen', 'Gurvan', 'Herve', 'Jakez', 'Loic', 'Mikael', 'Paol', 'Riwal',
    'Bleuenn', 'Kristell', 'Lena', 'Rozenn', 'Solenn', 'Tifenn', 'Aziliz', 'Efflam', 'Gwendal', 'Mael',
    'Armael', 'Brendan', 'Divi', 'Fanch', 'Gaelig', 'Gweltaz', 'Iwan', 'Jord', 'Kelig', 'Louarn',
    'Anaelle', 'Breizh', 'Clervie', 'Dahud', 'Elouan', 'Fanchon', 'Gladys', 'Houarn', 'Izel', 'Jezabel'
  ];

  -- Breton family names
  v_family_names TEXT[] := ARRAY[
    'Le Bihan', 'Le Gall', 'Le Roux', 'Le Corre', 'Le Floch', 'Le Goff', 'Le Meur', 'Le Fur', 'Le Bars', 'Le Guen',
    'Kerivel', 'Kerleau', 'Kerneis', 'Kergoat', 'Kermorgant', 'Kermarrec', 'Kerneur', 'Kerdiles', 'Kerampran', 'Kerbrat',
    'Morvan', 'Prigent', 'Quemener', 'Tanguy', 'Inizan', 'Jaouen', 'Cariou', 'Guillou', 'Madec', 'Pennec',
    'Abgrall', 'Bodenes', 'Cadiou', 'Derrien', 'Elegoet', 'Fave', 'Goalec', 'Hascoet', 'Jegou', 'Lagadic',
    'Nedelec', 'Olier', 'Poder', 'Queffelec', 'Riou', 'Salaun', 'Trebaol', 'Urvoy', 'Vigouroux', 'Yaouanc'
  ];

  -- Class name patterns
  v_class_levels TEXT[] := ARRAY['CM1', 'CM2', '6eme', '5eme', '4eme'];

  -- Counters and temp variables
  v_school_id UUID;
  v_school_admin_user_id TEXT;
  v_school_admin_learner_id UUID;
  v_teacher_user_id TEXT;
  v_teacher_learner_id UUID;
  v_class_id UUID;
  v_student_user_id TEXT;
  v_student_learner_id UUID;
  v_school_idx INT;
  v_teacher_idx INT;
  v_class_idx INT;
  v_student_idx INT;
  v_global_student_idx INT := 0;
  v_random_first TEXT;
  v_random_last TEXT;
  v_display_name TEXT;
  v_session_id UUID;
  v_practice_minutes INT;
  v_seeds_completed INT;
  v_legos_mastered INT;
  v_session_count INT;
  v_created_at TIMESTAMPTZ;
  v_last_active TIMESTAMPTZ;
  v_num_courses INT;
  v_course_idx INT;

BEGIN
  RAISE NOTICE 'Starting Brittany test data seed...';

  -- ============================================
  -- 1. GOVERNMENT ADMIN
  -- ============================================
  RAISE NOTICE 'Creating Government Admin...';

  -- Create learner record for govt admin
  INSERT INTO learners (user_id, display_name, educational_role)
  VALUES (v_govt_admin_user_id, 'Yann-Ber Thomin', 'govt_admin')
  RETURNING id INTO v_govt_admin_learner_id;

  -- Create govt admin record
  INSERT INTO govt_admins (user_id, region_code, organization_name, created_by)
  VALUES (
    v_govt_admin_user_id,
    'brittany',
    'Ofis Publik ar Brezhoneg',
    'user_ssi_admin_tom'  -- Created by SSi admin
  )
  RETURNING id INTO v_govt_admin_id;

  RAISE NOTICE 'Government Admin created: % (learner_id: %)', v_govt_admin_user_id, v_govt_admin_learner_id;

  -- ============================================
  -- 2. SCHOOLS, TEACHERS, CLASSES, STUDENTS
  -- ============================================

  FOR v_school_idx IN 1..10 LOOP
    -- Generate school admin user_id
    v_school_admin_user_id := 'user_2bre_school_' || LPAD(v_school_idx::TEXT, 2, '0') || '_admin';

    -- Random name for school admin
    v_random_first := v_first_names[1 + floor(random() * array_length(v_first_names, 1))::int];
    v_random_last := v_family_names[1 + floor(random() * array_length(v_family_names, 1))::int];
    v_display_name := v_random_first || ' ' || v_random_last;

    -- Create learner record for school admin
    INSERT INTO learners (user_id, display_name, educational_role)
    VALUES (v_school_admin_user_id, v_display_name, 'school_admin')
    RETURNING id INTO v_school_admin_learner_id;

    -- Create school (join code auto-generated by trigger)
    INSERT INTO schools (admin_user_id, school_name, region_code, teacher_join_code)
    VALUES (
      v_school_admin_user_id,
      v_school_names[v_school_idx],
      'brittany',
      generate_join_code()
    )
    RETURNING id INTO v_school_id;

    RAISE NOTICE 'School % created: % (admin: %)', v_school_idx, v_school_names[v_school_idx], v_display_name;

    -- Create 2 teachers per school
    FOR v_teacher_idx IN 1..2 LOOP
      v_teacher_user_id := 'user_2bre_school_' || LPAD(v_school_idx::TEXT, 2, '0') || '_teacher_' || v_teacher_idx;

      -- Random name for teacher
      v_random_first := v_first_names[1 + floor(random() * array_length(v_first_names, 1))::int];
      v_random_last := v_family_names[1 + floor(random() * array_length(v_family_names, 1))::int];
      v_display_name := v_random_first || ' ' || v_random_last;

      -- Create learner record for teacher
      INSERT INTO learners (user_id, display_name, educational_role)
      VALUES (v_teacher_user_id, v_display_name, 'teacher')
      RETURNING id INTO v_teacher_learner_id;

      -- Create user_tag linking teacher to school
      INSERT INTO user_tags (user_id, tag_type, tag_value, role_in_context, added_by)
      VALUES (
        v_teacher_user_id,
        'school',
        'SCHOOL:' || v_school_id::TEXT,
        'teacher',
        v_school_admin_user_id
      );

      RAISE NOTICE '  Teacher %: %', v_teacher_idx, v_display_name;
    END LOOP;

    -- Create 5 classes per school (alternating between teachers)
    FOR v_class_idx IN 1..5 LOOP
      -- Alternate teacher assignment
      v_teacher_user_id := 'user_2bre_school_' || LPAD(v_school_idx::TEXT, 2, '0') || '_teacher_' || (((v_class_idx - 1) % 2) + 1);

      -- Set class course (Welsh North for all classes)
      v_course_code := v_courses[1];  -- cym_n_for_eng

      -- Create class (join code auto-generated by trigger)
      INSERT INTO classes (school_id, teacher_user_id, class_name, course_code, student_join_code)
      VALUES (
        v_school_id,
        v_teacher_user_id,
        v_class_levels[v_class_idx] || ' Brezhoneg',
        v_course_code,
        generate_join_code()
      )
      RETURNING id INTO v_class_id;

      RAISE NOTICE '    Class %: % Brezhoneg', v_class_idx, v_class_levels[v_class_idx];

      -- Create 20 students per class
      FOR v_student_idx IN 1..20 LOOP
        v_global_student_idx := v_global_student_idx + 1;
        v_student_user_id := 'user_2bre_student_' || LPAD(v_global_student_idx::TEXT, 4, '0');

        -- Random name for student
        v_random_first := v_first_names[1 + floor(random() * array_length(v_first_names, 1))::int];
        v_random_last := v_family_names[1 + floor(random() * array_length(v_family_names, 1))::int];
        v_display_name := v_random_first || ' ' || v_random_last;

        -- Random creation date (within last 6 months)
        v_created_at := NOW() - (random() * INTERVAL '180 days');

        -- Create learner record for student
        INSERT INTO learners (user_id, display_name, educational_role, created_at)
        VALUES (v_student_user_id, v_display_name, 'student', v_created_at)
        RETURNING id INTO v_student_learner_id;

        -- Create user_tag linking student to class
        INSERT INTO user_tags (user_id, tag_type, tag_value, role_in_context, added_by, added_at)
        VALUES (
          v_student_user_id,
          'class',
          'CLASS:' || v_class_id::TEXT,
          'student',
          v_teacher_user_id,
          v_created_at + INTERVAL '1 day'
        );

        -- Each student gets 1-3 courses (weighted: 50% get 1, 35% get 2, 15% get 3)
        v_num_courses := CASE
          WHEN random() < 0.5 THEN 1
          WHEN random() < 0.85 THEN 2
          ELSE 3
        END;

        -- Enroll in courses and create progress
        FOR v_course_idx IN 1..v_num_courses LOOP
          v_course_code := v_courses[v_course_idx];

          -- Generate random progress (varying levels of engagement)
          -- Primary course gets more progress, secondary courses less
          IF v_course_idx = 1 THEN
            v_practice_minutes := (random() * 500 + 30)::INT;  -- 30-530 minutes for primary
          ELSE
            v_practice_minutes := (random() * 150 + 10)::INT;  -- 10-160 minutes for secondary
          END IF;

          v_seeds_completed := LEAST((v_practice_minutes / 15)::INT, 50);  -- Roughly 1 seed per 15 mins, max 50
          v_legos_mastered := LEAST((v_seeds_completed * 3)::INT, 100);  -- ~3 legos per seed, max 100
          v_session_count := GREATEST((v_practice_minutes / 20)::INT, 1);  -- ~20 min sessions
          v_last_active := NOW() - (random() * INTERVAL '30 days');

          -- Create course enrollment
          INSERT INTO course_enrollments (learner_id, course_id, enrolled_at, last_practiced_at, total_practice_minutes)
          VALUES (
            v_student_learner_id,
            v_course_code,
            v_created_at + INTERVAL '2 days' + (v_course_idx * INTERVAL '7 days'),
            v_last_active,
            v_practice_minutes
          );

          -- Create seed progress records
          FOR i IN 1..v_seeds_completed LOOP
            INSERT INTO seed_progress (learner_id, seed_id, course_id, thread_id, is_introduced, introduced_at, created_at)
            VALUES (
              v_student_learner_id,
              'S' || LPAD(i::TEXT, 4, '0'),
              v_course_code,
              ((i - 1) % 3) + 1,  -- Distribute across threads 1, 2, 3
              TRUE,
              v_created_at + (i * INTERVAL '1 day'),
              v_created_at + (i * INTERVAL '1 day')
            )
            ON CONFLICT (learner_id, seed_id) DO NOTHING;
          END LOOP;

          -- Create lego progress records
          FOR i IN 1..v_legos_mastered LOOP
            INSERT INTO lego_progress (
              learner_id, lego_id, course_id, thread_id,
              fibonacci_position, skip_number, reps_completed, is_retired,
              last_practiced_at, created_at
            )
            VALUES (
              v_student_learner_id,
              'S' || LPAD(((i - 1) / 3 + 1)::TEXT, 4, '0') || 'L' || LPAD(((i - 1) % 3 + 1)::TEXT, 2, '0'),
              v_course_code,
              ((i - 1) % 3) + 1,
              CASE WHEN random() > 0.7 THEN 8 ELSE (random() * 7)::INT END,  -- Some retired (pos 8+)
              CASE WHEN random() > 0.7 THEN 21 ELSE (random() * 20)::INT END,
              (random() * 10)::INT + 1,
              random() > 0.7,  -- 30% retired
              v_last_active - (random() * INTERVAL '7 days'),
              v_created_at + ((i / 3) * INTERVAL '1 day')
            )
            ON CONFLICT (learner_id, lego_id) DO NOTHING;
          END LOOP;

          -- Create session records
          FOR i IN 1..v_session_count LOOP
            INSERT INTO sessions (
              learner_id, course_id, started_at, ended_at,
              duration_seconds, items_practiced, spikes_detected, final_rolling_average
            )
            VALUES (
              v_student_learner_id,
              v_course_code,
              v_created_at + ((i * v_practice_minutes / v_session_count) * INTERVAL '1 minute'),
              v_created_at + ((i * v_practice_minutes / v_session_count + 20) * INTERVAL '1 minute'),
              (15 + random() * 15)::INT * 60,  -- 15-30 minute sessions in seconds
              (10 + random() * 30)::INT,  -- 10-40 items per session
              (random() * 3)::INT,  -- 0-3 spikes
              1.0 + random() * 0.5  -- Rolling average 1.0-1.5
            );
          END LOOP;

        END LOOP;  -- courses

      END LOOP;  -- students

    END LOOP;  -- classes

  END LOOP;  -- schools

  RAISE NOTICE '';
  RAISE NOTICE '============================================';
  RAISE NOTICE 'BRITTANY TEST DATA SEED COMPLETE';
  RAISE NOTICE '============================================';
  RAISE NOTICE 'Created:';
  RAISE NOTICE '  - 1 Government Admin (Ofis Publik ar Brezhoneg)';
  RAISE NOTICE '  - 10 Schools (Skol Diwan network)';
  RAISE NOTICE '  - 20 Teachers (2 per school)';
  RAISE NOTICE '  - 50 Classes (5 per school)';
  RAISE NOTICE '  - 1000 Students (20 per class)';
  RAISE NOTICE '';
  RAISE NOTICE 'Course enrollments (multi-course):';
  RAISE NOTICE '  - cym_n_for_eng: All 1000 students (primary)';
  RAISE NOTICE '  - spa_for_eng: ~500 students (secondary)';
  RAISE NOTICE '  - cym_s_for_eng: ~150 students (tertiary)';
  RAISE NOTICE '';
  RAISE NOTICE 'Key IDs for God Mode testing:';
  RAISE NOTICE '  Govt Admin: %', v_govt_admin_user_id;
  RAISE NOTICE '  First School Admin: user_2bre_school_01_admin';
  RAISE NOTICE '  First Teacher: user_2bre_school_01_teacher_1';
  RAISE NOTICE '  First Student: user_2bre_student_0001';
  RAISE NOTICE '============================================';

END $$;

COMMIT;

-- ============================================
-- CLEANUP SCRIPT (run this first if re-seeding)
-- ============================================
-- Uncomment and run this section to remove all Brittany test data
/*
BEGIN;

-- Delete in reverse dependency order
DELETE FROM spike_events WHERE learner_id IN (SELECT id FROM learners WHERE user_id LIKE 'user_2bre_%');
DELETE FROM response_metrics WHERE learner_id IN (SELECT id FROM learners WHERE user_id LIKE 'user_2bre_%');
DELETE FROM sessions WHERE learner_id IN (SELECT id FROM learners WHERE user_id LIKE 'user_2bre_%');
DELETE FROM lego_progress WHERE learner_id IN (SELECT id FROM learners WHERE user_id LIKE 'user_2bre_%');
DELETE FROM seed_progress WHERE learner_id IN (SELECT id FROM learners WHERE user_id LIKE 'user_2bre_%');
DELETE FROM course_enrollments WHERE learner_id IN (SELECT id FROM learners WHERE user_id LIKE 'user_2bre_%');
DELETE FROM user_tags WHERE user_id LIKE 'user_2bre_%';
DELETE FROM classes WHERE school_id IN (SELECT id FROM schools WHERE admin_user_id LIKE 'user_2bre_%');
DELETE FROM schools WHERE admin_user_id LIKE 'user_2bre_%';
DELETE FROM govt_admins WHERE user_id LIKE 'user_2bre_%';
DELETE FROM learners WHERE user_id LIKE 'user_2bre_%';

COMMIT;

RAISE NOTICE 'Brittany test data cleaned up.';
*/

-- ============================================
-- VERIFICATION QUERIES
-- ============================================
-- Run these after seeding to verify the data

/*
-- Count summary
SELECT 'govt_admins' as table_name, COUNT(*) as count FROM govt_admins WHERE user_id LIKE 'user_2bre_%'
UNION ALL SELECT 'schools', COUNT(*) FROM schools WHERE admin_user_id LIKE 'user_2bre_%'
UNION ALL SELECT 'teachers (user_tags)', COUNT(*) FROM user_tags WHERE user_id LIKE 'user_2bre_%' AND role_in_context = 'teacher'
UNION ALL SELECT 'classes', COUNT(*) FROM classes WHERE school_id IN (SELECT id FROM schools WHERE admin_user_id LIKE 'user_2bre_%')
UNION ALL SELECT 'students (learners)', COUNT(*) FROM learners WHERE user_id LIKE 'user_2bre_student_%'
UNION ALL SELECT 'course_enrollments', COUNT(*) FROM course_enrollments WHERE learner_id IN (SELECT id FROM learners WHERE user_id LIKE 'user_2bre_%')
UNION ALL SELECT 'sessions', COUNT(*) FROM sessions WHERE learner_id IN (SELECT id FROM learners WHERE user_id LIKE 'user_2bre_%')
UNION ALL SELECT 'seed_progress', COUNT(*) FROM seed_progress WHERE learner_id IN (SELECT id FROM learners WHERE user_id LIKE 'user_2bre_%')
UNION ALL SELECT 'lego_progress', COUNT(*) FROM lego_progress WHERE learner_id IN (SELECT id FROM learners WHERE user_id LIKE 'user_2bre_%');

-- Course enrollment distribution
SELECT course_id, COUNT(*) as student_count,
       ROUND(AVG(total_practice_minutes)::numeric, 1) as avg_practice_mins
FROM course_enrollments
WHERE learner_id IN (SELECT id FROM learners WHERE user_id LIKE 'user_2bre_student_%')
GROUP BY course_id
ORDER BY student_count DESC;

-- Test the region_summary view
SELECT * FROM region_summary WHERE region_code = 'brittany';

-- Test the school_summary view
SELECT school_name, teacher_count, class_count, student_count,
       ROUND(total_practice_hours::numeric, 1) as practice_hours
FROM school_summary
WHERE school_id IN (SELECT id FROM schools WHERE region_code = 'brittany')
ORDER BY student_count DESC;

-- Test the class_student_progress view
SELECT class_name, COUNT(*) as student_count,
       ROUND(AVG(seeds_completed)::numeric, 1) as avg_seeds,
       ROUND(AVG(total_practice_seconds)/3600::numeric, 2) as avg_hours
FROM class_student_progress
WHERE class_id IN (SELECT id FROM classes WHERE school_id IN (SELECT id FROM schools WHERE region_code = 'brittany'))
GROUP BY class_id, class_name
ORDER BY class_name
LIMIT 10;

-- God mode: Get a specific student's full profile
SELECT l.display_name, l.educational_role,
       ce.course_id, ce.total_practice_minutes,
       (SELECT COUNT(*) FROM seed_progress sp WHERE sp.learner_id = l.id AND sp.course_id = ce.course_id AND sp.is_introduced) as seeds_done,
       (SELECT COUNT(*) FROM lego_progress lp WHERE lp.learner_id = l.id AND lp.course_id = ce.course_id AND lp.is_retired) as legos_retired
FROM learners l
JOIN course_enrollments ce ON ce.learner_id = l.id
WHERE l.user_id = 'user_2bre_student_0001';
*/
