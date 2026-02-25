-- ============================================
-- Ireland Demo Data for Schools Dashboard
-- ============================================
-- Gaelscoil na Cruaiche (fictional school in Mayo, Ireland)
-- 2 class groups (Rang 5, Rang 6) × 4 languages each
-- 20 students, 4 teachers, 1 school admin, 1 govt admin
-- Realistic progress data spread across belt levels
--
-- Courses: gle_for_eng, fra_for_eng, spa_for_eng, cmn_for_eng
-- Region: ireland (already seeded)
--
-- Date: 2026-02-25

-- ============================================
-- 1. STABLE UUIDs (deterministic for idempotency)
-- ============================================

-- Use DO block for variable scoping
DO $$
DECLARE
  -- School
  v_school_id UUID := 'a0000000-0000-0000-0000-000000000001';

  -- Teachers
  v_teacher1_uid TEXT := 'test_teacher_maire';
  v_teacher2_uid TEXT := 'test_teacher_padraig';
  v_teacher3_uid TEXT := 'test_teacher_siobhan';
  v_teacher4_uid TEXT := 'test_teacher_colm';

  -- School admin
  v_admin_uid TEXT := 'test_admin_fionnuala';

  -- Govt admin
  v_govt_uid TEXT := 'test_govt_eamon';

  -- Learner UUIDs (for teachers + admin + govt)
  v_teacher1_lid UUID := 'b0000000-0000-0000-0000-000000000001';
  v_teacher2_lid UUID := 'b0000000-0000-0000-0000-000000000002';
  v_teacher3_lid UUID := 'b0000000-0000-0000-0000-000000000003';
  v_teacher4_lid UUID := 'b0000000-0000-0000-0000-000000000004';
  v_admin_lid UUID := 'b0000000-0000-0000-0000-000000000010';
  v_govt_lid UUID := 'b0000000-0000-0000-0000-000000000020';

  -- Student user IDs and learner UUIDs
  v_students TEXT[] := ARRAY[
    'test_student_aoife',    'test_student_ciaran',   'test_student_saoirse',
    'test_student_oisin',    'test_student_niamh',    'test_student_cormac',
    'test_student_grainne',  'test_student_fionn',    'test_student_aisling',
    'test_student_darragh',  'test_student_roisin',   'test_student_sean',
    'test_student_caoimhe',  'test_student_tadhg',    'test_student_sinead',
    'test_student_eoin',     'test_student_orlaith',  'test_student_conor',
    'test_student_clodagh',  'test_student_liam'
  ];

  v_student_names TEXT[] := ARRAY[
    'Aoife Ní Mhurchú',     'Ciarán Ó Briain',      'Saoirse Ní Cheallaigh',
    'Oisín Mac Suibhne',    'Niamh Ní Dhomhnaill',  'Cormac Ó Flatharta',
    'Gráinne Nic Giolla',   'Fionn Ó Dálaigh',      'Aisling Ní Riain',
    'Darragh Mac Cárthaigh', 'Róisín Ní Shé',        'Seán Ó Maolchatha',
    'Caoimhe Nic Lochlainn', 'Tadhg Ó hÉalaighthe',  'Sinéad Ní Ghallchóir',
    'Eoin Mac Mathúna',      'Orlaith Ní Bhraonáin',  'Conor Ó Ceallaigh',
    'Clodagh Nic Aodha',     'Liam Ó Dubhghaill'
  ];

  -- Class UUIDs (8 classes: 2 groups × 4 languages)
  -- Rang 5: Irish, French, Spanish, Chinese
  v_r5_gle UUID := 'c0000000-0000-0000-0000-000000000001';
  v_r5_fra UUID := 'c0000000-0000-0000-0000-000000000002';
  v_r5_spa UUID := 'c0000000-0000-0000-0000-000000000003';
  v_r5_cmn UUID := 'c0000000-0000-0000-0000-000000000004';
  -- Rang 6: Irish, French, Spanish, Chinese
  v_r6_gle UUID := 'c0000000-0000-0000-0000-000000000005';
  v_r6_fra UUID := 'c0000000-0000-0000-0000-000000000006';
  v_r6_spa UUID := 'c0000000-0000-0000-0000-000000000007';
  v_r6_cmn UUID := 'c0000000-0000-0000-0000-000000000008';

  -- Loop vars
  i INTEGER;
  v_uid TEXT;
  v_lid UUID;
  v_name TEXT;
  v_seeds_per_course INTEGER[];
  v_course_codes TEXT[] := ARRAY['gle_for_eng', 'fra_for_eng', 'spa_for_eng', 'cmn_for_eng'];
  v_class_ids_r5 UUID[];
  v_class_ids_r6 UUID[];
  v_cc TEXT;
  v_cid UUID;
  v_seeds INTEGER;
  v_legos INTEGER;
  v_practice_secs INTEGER;
  v_session_date TIMESTAMPTZ;
  v_j INTEGER;

BEGIN
  v_class_ids_r5 := ARRAY[v_r5_gle, v_r5_fra, v_r5_spa, v_r5_cmn];
  v_class_ids_r6 := ARRAY[v_r6_gle, v_r6_fra, v_r6_spa, v_r6_cmn];

  -- ============================================
  -- 2. LEARNER RECORDS (all roles)
  -- ============================================

  -- Govt admin
  INSERT INTO learners (id, user_id, display_name, educational_role, platform_role)
  VALUES (v_govt_lid, v_govt_uid, 'Éamon Ó Cuív', 'govt_admin', NULL)
  ON CONFLICT (user_id) DO NOTHING;

  -- School admin
  INSERT INTO learners (id, user_id, display_name, educational_role, platform_role)
  VALUES (v_admin_lid, v_admin_uid, 'Fionnuala Nic Amhlaoibh', 'school_admin', NULL)
  ON CONFLICT (user_id) DO NOTHING;

  -- Teachers
  INSERT INTO learners (id, user_id, display_name, educational_role) VALUES
    (v_teacher1_lid, v_teacher1_uid, 'Máire Ní Bhriain', 'teacher'),
    (v_teacher2_lid, v_teacher2_uid, 'Pádraig Ó Sé', 'teacher'),
    (v_teacher3_lid, v_teacher3_uid, 'Siobhán Nic Dhonncha', 'teacher'),
    (v_teacher4_lid, v_teacher4_uid, 'Colm Ó Treasaigh', 'teacher')
  ON CONFLICT (user_id) DO NOTHING;

  -- Students
  FOR i IN 1..20 LOOP
    v_uid := v_students[i];
    v_lid := ('d0000000-0000-0000-0000-' || LPAD(i::TEXT, 12, '0'))::UUID;
    v_name := v_student_names[i];

    INSERT INTO learners (id, user_id, display_name, educational_role)
    VALUES (v_lid, v_uid, v_name, 'student')
    ON CONFLICT (user_id) DO NOTHING;
  END LOOP;

  -- ============================================
  -- 3. GOVT ADMIN
  -- ============================================

  INSERT INTO govt_admins (user_id, region_code, organization_name, created_by)
  VALUES (v_govt_uid, 'ireland', 'An Roinn Oideachais - Aonad na Gaeltachta', v_govt_uid)
  ON CONFLICT (user_id) DO NOTHING;

  -- ============================================
  -- 4. SCHOOL
  -- ============================================

  INSERT INTO schools (id, admin_user_id, school_name, region_code, teacher_join_code)
  VALUES (v_school_id, v_admin_uid, 'Gaelscoil na Cruaiche', 'ireland', 'GNC-001')
  ON CONFLICT (id) DO NOTHING;

  -- ============================================
  -- 5. TEACHER SCHOOL TAGS
  -- ============================================

  INSERT INTO user_tags (user_id, tag_type, tag_value, role_in_context, added_by, added_at) VALUES
    (v_teacher1_uid, 'school', 'SCHOOL:' || v_school_id, 'teacher', v_admin_uid, '2025-09-01'),
    (v_teacher2_uid, 'school', 'SCHOOL:' || v_school_id, 'teacher', v_admin_uid, '2025-09-01'),
    (v_teacher3_uid, 'school', 'SCHOOL:' || v_school_id, 'teacher', v_admin_uid, '2025-09-01'),
    (v_teacher4_uid, 'school', 'SCHOOL:' || v_school_id, 'teacher', v_admin_uid, '2025-10-15')
  ON CONFLICT (user_id, tag_type, tag_value) DO NOTHING;

  -- ============================================
  -- 6. CLASSES (8 total: 2 groups × 4 languages)
  -- ============================================

  -- Rang 5 classes (Máire teaches Irish & French, Pádraig teaches Spanish & Chinese)
  INSERT INTO classes (id, school_id, teacher_user_id, class_name, course_code, student_join_code, current_seed, is_active, created_at) VALUES
    (v_r5_gle, v_school_id, v_teacher1_uid, 'Rang 5 - Gaeilge',  'gle_for_eng', 'R5G-001', 45, true, '2025-09-01'),
    (v_r5_fra, v_school_id, v_teacher1_uid, 'Rang 5 - Fraincis',  'fra_for_eng', 'R5F-001', 32, true, '2025-09-01'),
    (v_r5_spa, v_school_id, v_teacher2_uid, 'Rang 5 - Spáinnis',  'spa_for_eng', 'R5S-001', 28, true, '2025-09-01'),
    (v_r5_cmn, v_school_id, v_teacher2_uid, 'Rang 5 - Sínis',     'cmn_for_eng', 'R5C-001', 15, true, '2025-10-01')
  ON CONFLICT (id) DO NOTHING;

  -- Rang 6 classes (Siobhán teaches Irish & Spanish, Colm teaches French & Chinese)
  INSERT INTO classes (id, school_id, teacher_user_id, class_name, course_code, student_join_code, current_seed, is_active, created_at) VALUES
    (v_r6_gle, v_school_id, v_teacher3_uid, 'Rang 6 - Gaeilge',  'gle_for_eng', 'R6G-001', 80, true, '2025-09-01'),
    (v_r6_fra, v_school_id, v_teacher4_uid, 'Rang 6 - Fraincis',  'fra_for_eng', 'R6F-001', 55, true, '2025-09-01'),
    (v_r6_spa, v_school_id, v_teacher3_uid, 'Rang 6 - Spáinnis',  'spa_for_eng', 'R6S-001', 40, true, '2025-09-01'),
    (v_r6_cmn, v_school_id, v_teacher4_uid, 'Rang 6 - Sínis',     'cmn_for_eng', 'R6C-001', 20, true, '2025-10-01')
  ON CONFLICT (id) DO NOTHING;

  -- ============================================
  -- 7. STUDENT CLASS TAGS + PROGRESS DATA
  -- ============================================
  -- Students 1-10 = Rang 5, Students 11-20 = Rang 6
  -- Each student joins all 4 language classes in their rang

  FOR i IN 1..20 LOOP
    v_uid := v_students[i];
    v_lid := ('d0000000-0000-0000-0000-' || LPAD(i::TEXT, 12, '0'))::UUID;

    FOR v_j IN 1..4 LOOP
      v_cc := v_course_codes[v_j];

      IF i <= 10 THEN
        v_cid := v_class_ids_r5[v_j];
      ELSE
        v_cid := v_class_ids_r6[v_j];
      END IF;

      -- Student class tag
      INSERT INTO user_tags (user_id, tag_type, tag_value, role_in_context, added_by, added_at)
      VALUES (v_uid, 'class', 'CLASS:' || v_cid, 'student', v_admin_uid, '2025-09-01')
      ON CONFLICT (user_id, tag_type, tag_value) DO NOTHING;

      -- Course enrollment
      INSERT INTO course_enrollments (learner_id, course_id, total_practice_minutes)
      VALUES (v_lid, v_cc,
        -- Vary practice: Irish most, Chinese least; Rang 6 > Rang 5
        CASE v_j
          WHEN 1 THEN (20 + i * 8 + (i % 5) * 3)  -- Irish: 28-108 mins
          WHEN 2 THEN (15 + i * 5 + (i % 4) * 2)  -- French: 20-75 mins
          WHEN 3 THEN (10 + i * 4 + (i % 3) * 3)  -- Spanish: 13-59 mins
          WHEN 4 THEN (5  + i * 3 + (i % 6))       -- Chinese: 8-38 mins
        END
      )
      ON CONFLICT (learner_id, course_id) DO NOTHING;

      -- Seed progress (seeds completed varies by student + course)
      v_seeds := CASE v_j
        WHEN 1 THEN GREATEST(1, (i * 4 + (i % 7) * 2))  -- Irish: 6-86
        WHEN 2 THEN GREATEST(1, (i * 3 + (i % 5)))       -- French: 4-65
        WHEN 3 THEN GREATEST(1, (i * 2 + (i % 4) * 2))   -- Spanish: 4-48
        WHEN 4 THEN GREATEST(1, (i + (i % 3) * 2))        -- Chinese: 1-26
      END;

      FOR v_j IN 1..v_seeds LOOP
        INSERT INTO seed_progress (learner_id, seed_id, course_id, thread_id, is_introduced, introduced_at)
        VALUES (v_lid, 'S' || LPAD(v_j::TEXT, 4, '0'), v_cc, ((v_j - 1) % 3) + 1, true,
                '2025-09-01'::TIMESTAMPTZ + (v_j || ' days')::INTERVAL)
        ON CONFLICT (learner_id, seed_id) DO NOTHING;
      END LOOP;

      -- Lego progress (roughly 2 legos per seed, some retired)
      v_legos := v_seeds * 2;
      FOR v_j IN 1..v_legos LOOP
        INSERT INTO lego_progress (learner_id, lego_id, course_id, thread_id, is_retired,
                                   fibonacci_position, skip_number, reps_completed)
        VALUES (v_lid,
                'S' || LPAD(((v_j - 1) / 2 + 1)::TEXT, 4, '0') || 'L' || LPAD(((v_j - 1) % 2 + 1)::TEXT, 2, '0'),
                v_cc,
                ((v_j - 1) % 3) + 1,
                v_j < v_legos * 0.6,  -- 60% retired
                LEAST(v_j % 8, 7),
                CASE WHEN v_j < v_legos * 0.6 THEN 34 ELSE v_j % 13 END,
                CASE WHEN v_j < v_legos * 0.6 THEN 10 + (v_j % 5) ELSE v_j % 6 END)
        ON CONFLICT (learner_id, lego_id) DO NOTHING;
      END LOOP;

      -- Sessions (2-4 sessions per student per course over the last 30 days)
      v_practice_secs := CASE v_j
        WHEN 1 THEN 1200 + i * 60
        WHEN 2 THEN 900 + i * 45
        WHEN 3 THEN 800 + i * 40
        WHEN 4 THEN 600 + i * 30
      END;

      FOR v_j IN 1..3 LOOP
        v_session_date := NOW() - ((v_j * 7 + (i % 5)) || ' days')::INTERVAL;
        INSERT INTO sessions (learner_id, course_id, started_at, ended_at, duration_seconds, items_practiced)
        VALUES (v_lid, v_cc, v_session_date, v_session_date + (v_practice_secs || ' seconds')::INTERVAL,
                v_practice_secs, v_practice_secs / 11)  -- ~1 item per 11 seconds
        ON CONFLICT DO NOTHING;
      END LOOP;
    END LOOP;
  END LOOP;

  -- ============================================
  -- 8. CLASS SESSIONS (teacher-led sessions)
  -- ============================================

  -- Recent class sessions for each class (last 2-3 weeks)
  INSERT INTO class_sessions (class_id, teacher_user_id, started_at, ended_at, start_lego_id, end_lego_id, cycles_completed, duration_seconds) VALUES
    -- Rang 5 Irish (Máire)
    (v_r5_gle, v_teacher1_uid, NOW() - INTERVAL '2 days',  NOW() - INTERVAL '2 days'  + INTERVAL '25 minutes', 'S0040L01', 'S0045L02', 120, 1500),
    (v_r5_gle, v_teacher1_uid, NOW() - INTERVAL '9 days',  NOW() - INTERVAL '9 days'  + INTERVAL '30 minutes', 'S0035L01', 'S0040L01', 150, 1800),
    (v_r5_gle, v_teacher1_uid, NOW() - INTERVAL '16 days', NOW() - INTERVAL '16 days' + INTERVAL '20 minutes', 'S0030L01', 'S0035L01', 100, 1200),
    -- Rang 5 French (Máire)
    (v_r5_fra, v_teacher1_uid, NOW() - INTERVAL '3 days',  NOW() - INTERVAL '3 days'  + INTERVAL '25 minutes', 'S0028L01', 'S0032L02', 110, 1500),
    (v_r5_fra, v_teacher1_uid, NOW() - INTERVAL '10 days', NOW() - INTERVAL '10 days' + INTERVAL '20 minutes', 'S0024L01', 'S0028L01',  90, 1200),
    -- Rang 5 Spanish (Pádraig)
    (v_r5_spa, v_teacher2_uid, NOW() - INTERVAL '1 day',   NOW() - INTERVAL '1 day'   + INTERVAL '30 minutes', 'S0025L01', 'S0028L02', 130, 1800),
    (v_r5_spa, v_teacher2_uid, NOW() - INTERVAL '8 days',  NOW() - INTERVAL '8 days'  + INTERVAL '25 minutes', 'S0020L01', 'S0025L01', 110, 1500),
    -- Rang 5 Chinese (Pádraig)
    (v_r5_cmn, v_teacher2_uid, NOW() - INTERVAL '4 days',  NOW() - INTERVAL '4 days'  + INTERVAL '20 minutes', 'S0012L01', 'S0015L02',  80, 1200),
    -- Rang 6 Irish (Siobhán)
    (v_r6_gle, v_teacher3_uid, NOW() - INTERVAL '1 day',   NOW() - INTERVAL '1 day'   + INTERVAL '30 minutes', 'S0075L01', 'S0080L02', 160, 1800),
    (v_r6_gle, v_teacher3_uid, NOW() - INTERVAL '8 days',  NOW() - INTERVAL '8 days'  + INTERVAL '30 minutes', 'S0070L01', 'S0075L01', 150, 1800),
    (v_r6_gle, v_teacher3_uid, NOW() - INTERVAL '15 days', NOW() - INTERVAL '15 days' + INTERVAL '25 minutes', 'S0065L01', 'S0070L01', 130, 1500),
    -- Rang 6 French (Colm)
    (v_r6_fra, v_teacher4_uid, NOW() - INTERVAL '2 days',  NOW() - INTERVAL '2 days'  + INTERVAL '25 minutes', 'S0050L01', 'S0055L02', 120, 1500),
    (v_r6_fra, v_teacher4_uid, NOW() - INTERVAL '9 days',  NOW() - INTERVAL '9 days'  + INTERVAL '20 minutes', 'S0045L01', 'S0050L01', 100, 1200),
    -- Rang 6 Spanish (Siobhán)
    (v_r6_spa, v_teacher3_uid, NOW() - INTERVAL '3 days',  NOW() - INTERVAL '3 days'  + INTERVAL '25 minutes', 'S0035L01', 'S0040L02', 115, 1500),
    -- Rang 6 Chinese (Colm)
    (v_r6_cmn, v_teacher4_uid, NOW() - INTERVAL '5 days',  NOW() - INTERVAL '5 days'  + INTERVAL '20 minutes', 'S0016L01', 'S0020L02',  85, 1200);

  RAISE NOTICE 'Ireland demo data seeded successfully!';
  RAISE NOTICE 'School: Gaelscoil na Cruaiche (%)' , v_school_id;
  RAISE NOTICE 'Govt admin: Éamon Ó Cuív (%)' , v_govt_uid;
  RAISE NOTICE 'School admin: Fionnuala Nic Amhlaoibh (%)' , v_admin_uid;
  RAISE NOTICE '4 teachers, 20 students, 8 classes across 4 languages';

END $$;
