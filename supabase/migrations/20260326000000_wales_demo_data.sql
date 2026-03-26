-- ============================================
-- Wales Demo Data for Schools Dashboard
-- ============================================
-- 3 Welsh-medium schools across Wales
-- 2 class groups (Blwyddyn 5, Blwyddyn 6) × 3 languages each per school
-- 60 students, 12 teachers, 3 school admins, 1 govt admin
-- Realistic progress data spread across belt levels
--
-- Courses: cym_for_eng (Welsh), fra_for_eng (French), spa_for_eng (Spanish)
-- Region: wales (already seeded in schools_system migration)
--
-- Date: 2026-03-26

-- ============================================
-- 1. STABLE UUIDs (deterministic for idempotency)
-- ============================================

DO $wales_demo$
DECLARE
  -- Schools
  v_school1_id UUID := 'e0000000-0000-0000-0000-000000000001';
  v_school2_id UUID := 'e0000000-0000-0000-0000-000000000002';
  v_school3_id UUID := 'e0000000-0000-0000-0000-000000000003';

  v_school_ids UUID[];
  v_school_names TEXT[];
  v_school_codes TEXT[];

  -- Govt admin
  v_govt_uid TEXT := 'test_govt_gwilym';
  v_govt_lid UUID := 'e0100000-0000-0000-0000-000000000001';

  -- School admin UIDs
  v_school_admin_uids TEXT[] := ARRAY[
    'test_admin_elen',
    'test_admin_dewi',
    'test_admin_cerys'
  ];
  v_school_admin_names TEXT[] := ARRAY[
    'Elen Rhys',
    'Dewi Morgan',
    'Cerys Williams'
  ];
  v_school_admin_lids UUID[] := ARRAY[
    'e0100000-0000-0000-0000-000000000010'::UUID,
    'e0100000-0000-0000-0000-000000000020'::UUID,
    'e0100000-0000-0000-0000-000000000030'::UUID
  ];

  -- Teacher UIDs (4 per school = 12 total)
  v_teacher_uids TEXT[] := ARRAY[
    -- School 1: Ysgol Gymraeg Aberystwyth
    'test_teacher_rhian',    'test_teacher_gethin',   'test_teacher_megan',    'test_teacher_hywel',
    -- School 2: Ysgol Glan Clwyd
    'test_teacher_lowri',    'test_teacher_iwan',     'test_teacher_ffion',    'test_teacher_carwyn',
    -- School 3: Ysgol Bro Morgannwg
    'test_teacher_sioned',   'test_teacher_dafydd',   'test_teacher_catrin',   'test_teacher_owain'
  ];
  v_teacher_names TEXT[] := ARRAY[
    'Rhian Puw',        'Gethin Llŷr Evans',  'Megan Haf Davies',    'Hywel Gruffydd',
    'Lowri Angharad',   'Iwan Rees',          'Ffion Mair Thomas',   'Carwyn Hughes',
    'Sioned Elan',      'Dafydd Wyn Roberts', 'Catrin Heledd Jones', 'Owain Glyn Price'
  ];

  -- Student UIDs (20 per school = 60 total)
  v_students TEXT[] := ARRAY[
    -- School 1: Ysgol Gymraeg Aberystwyth (students 1-20)
    'test_student_wales_angharad',  'test_student_wales_gruffydd',  'test_student_wales_bethan',
    'test_student_wales_iolo',      'test_student_wales_efa',       'test_student_wales_macsen',
    'test_student_wales_gwen',      'test_student_wales_osian',     'test_student_wales_heledd',
    'test_student_wales_rhodri',    'test_student_wales_llio',      'test_student_wales_tomos',
    'test_student_wales_mali',      'test_student_wales_efan',      'test_student_wales_non',
    'test_student_wales_harri',     'test_student_wales_seren',     'test_student_wales_steffan',
    'test_student_wales_tirion',    'test_student_wales_llyr',
    -- School 2: Ysgol Glan Clwyd (students 21-40)
    'test_student_wales_mabli',     'test_student_wales_gwion',     'test_student_wales_awen',
    'test_student_wales_cai',       'test_student_wales_ffraid',    'test_student_wales_iago',
    'test_student_wales_elan',      'test_student_wales_bedwyr',    'test_student_wales_gwenno',
    'test_student_wales_emrys',     'test_student_wales_eleri',     'test_student_wales_deiniol',
    'test_student_wales_manon',     'test_student_wales_tegid',     'test_student_wales_marged',
    'test_student_wales_idris',     'test_student_wales_cadi',      'test_student_wales_taliesin',
    'test_student_wales_nia',       'test_student_wales_guto',
    -- School 3: Ysgol Bro Morgannwg (students 41-60)
    'test_student_wales_cerith',    'test_student_wales_anest',     'test_student_wales_pryderi',
    'test_student_wales_branwen',   'test_student_wales_owain_s',   'test_student_wales_sian',
    'test_student_wales_brychan',   'test_student_wales_morfudd',   'test_student_wales_einion',
    'test_student_wales_tesni',     'test_student_wales_glyndwr',   'test_student_wales_elen_s',
    'test_student_wales_hefin',     'test_student_wales_lowri_s',   'test_student_wales_carys',
    'test_student_wales_rhun',      'test_student_wales_mair',      'test_student_wales_deri',
    'test_student_wales_alis',      'test_student_wales_iestyn'
  ];

  v_student_names TEXT[] := ARRAY[
    -- School 1: Ysgol Gymraeg Aberystwyth
    'Angharad Jones',      'Gruffydd Evans',      'Bethan Davies',
    'Iolo Thomas',         'Efa Roberts',         'Macsen Hughes',
    'Gwen Lewis',          'Osian Morgan',        'Heledd Griffiths',
    'Rhodri Williams',     'Llio Price',          'Tomos Rees',
    'Mali Jenkins',        'Efan Owen',           'Non Phillips',
    'Harri Griffiths',     'Seren Davies',        'Steffan Morgan',
    'Tirion Jones',        'Llŷr Evans',
    -- School 2: Ysgol Glan Clwyd
    'Mabli Roberts',       'Gwion Hughes',        'Awen Thomas',
    'Cai Lewis',           'Ffraid Williams',     'Iago Price',
    'Elan Morgan',         'Bedwyr Jones',        'Gwenno Rees',
    'Emrys Davies',        'Eleri Owen',          'Deiniol Evans',
    'Manon Jenkins',       'Tegid Phillips',      'Marged Griffiths',
    'Idris Hughes',        'Cadi Thomas',         'Taliesin Roberts',
    'Nia Lewis',           'Guto Williams',
    -- School 3: Ysgol Bro Morgannwg
    'Cerith Jones',        'Anest Davies',        'Pryderi Evans',
    'Branwen Thomas',      'Owain Roberts',       'Siân Hughes',
    'Brychan Lewis',       'Morfudd Morgan',      'Einion Griffiths',
    'Tesni Williams',      'Glyndŵr Price',       'Elen Rees',
    'Hefin Jenkins',       'Lowri Owen',          'Carys Phillips',
    'Rhun Davies',         'Mair Evans',          'Deri Thomas',
    'Alis Roberts',        'Iestyn Hughes'
  ];

  -- Course codes and labels
  v_course_codes TEXT[] := ARRAY['cym_for_eng', 'fra_for_eng', 'spa_for_eng'];
  v_course_labels TEXT[] := ARRAY['Cymraeg', 'Ffrangeg', 'Sbaeneg'];

  -- Class seed progress per school (varies by school)
  -- Blwyddyn 5
  v_school_cym_seeds INTEGER[] := ARRAY[55, 40, 48];
  v_school_fra_seeds INTEGER[] := ARRAY[30, 35, 25];
  v_school_spa_seeds INTEGER[] := ARRAY[22, 28, 32];
  -- Blwyddyn 6 (more progress)
  v_school_cym_seeds_b6 INTEGER[] := ARRAY[95, 75, 85];
  v_school_fra_seeds_b6 INTEGER[] := ARRAY[58, 65, 50];
  v_school_spa_seeds_b6 INTEGER[] := ARRAY[42, 50, 45];

  -- Loop vars
  v_s INTEGER;   -- school index
  v_i INTEGER;   -- student index within school
  v_gi INTEGER;  -- global student index
  v_j INTEGER;
  v_uid TEXT;
  v_lid UUID;
  v_name TEXT;
  v_cc TEXT;
  v_cid UUID;
  v_seeds INTEGER;
  v_legos INTEGER;
  v_practice_secs INTEGER;
  v_session_date TIMESTAMPTZ;
  v_school_id UUID;
  v_admin_uid TEXT;
  v_class_base INTEGER;
  v_teacher_base INTEGER;

BEGIN
  -- Ensure region exists (should already exist from schools_system migration)
  INSERT INTO regions (code, name, country_code, primary_language) VALUES ('wales', 'Wales', 'GB', 'cym')
  ON CONFLICT (code) DO NOTHING;

  v_school_ids := ARRAY[v_school1_id, v_school2_id, v_school3_id];
  v_school_names := ARRAY[
    'Ysgol Gymraeg Aberystwyth',
    'Ysgol Glan Clwyd',
    'Ysgol Bro Morgannwg'
  ];
  v_school_codes := ARRAY['YGA', 'YGC', 'YBM'];

  -- ============================================
  -- 2. GOVT ADMIN
  -- ============================================

  INSERT INTO learners (id, user_id, display_name, educational_role, platform_role)
  VALUES (v_govt_lid, v_govt_uid, 'Gwilym ap Dafydd', 'govt_admin', NULL)
  ON CONFLICT (user_id) DO NOTHING;

  INSERT INTO govt_admins (user_id, region_code, organization_name, created_by)
  VALUES (v_govt_uid, 'wales', 'Llywodraeth Cymru - Adran Addysg', v_govt_uid)
  ON CONFLICT (user_id) DO NOTHING;

  -- ============================================
  -- 3. SCHOOLS + SCHOOL ADMINS + TEACHERS
  -- ============================================

  FOR v_s IN 1..3 LOOP
    v_school_id := v_school_ids[v_s];
    v_admin_uid := v_school_admin_uids[v_s];

    -- School admin learner record
    INSERT INTO learners (id, user_id, display_name, educational_role, platform_role)
    VALUES (v_school_admin_lids[v_s], v_admin_uid, v_school_admin_names[v_s], 'school_admin', NULL)
    ON CONFLICT (user_id) DO NOTHING;

    -- School
    INSERT INTO schools (id, admin_user_id, school_name, region_code, teacher_join_code)
    VALUES (v_school_id, v_admin_uid, v_school_names[v_s], 'wales', v_school_codes[v_s] || '-JOIN')
    ON CONFLICT (id) DO NOTHING;

    -- Teachers (4 per school)
    v_teacher_base := (v_s - 1) * 4;
    FOR v_j IN 1..4 LOOP
      INSERT INTO learners (id, user_id, display_name, educational_role)
      VALUES (
        ('e0200000-0000-0000-0000-' || LPAD((v_teacher_base + v_j)::TEXT, 12, '0'))::UUID,
        v_teacher_uids[v_teacher_base + v_j],
        v_teacher_names[v_teacher_base + v_j],
        'teacher'
      )
      ON CONFLICT (user_id) DO NOTHING;

      -- Teacher school tag
      INSERT INTO user_tags (user_id, tag_type, tag_value, role_in_context, added_by, added_at)
      VALUES (v_teacher_uids[v_teacher_base + v_j], 'school', 'SCHOOL:' || v_school_id, 'teacher', v_admin_uid, '2025-09-01')
      ON CONFLICT (user_id, tag_type, tag_value) DO NOTHING;
    END LOOP;

    -- ============================================
    -- 4. CLASSES (6 per school: 2 groups × 3 languages)
    -- ============================================

    v_class_base := (v_s - 1) * 6;

    -- Blwyddyn 5 classes (teacher 1 teaches Welsh & French, teacher 2 teaches Spanish)
    INSERT INTO classes (id, school_id, teacher_user_id, class_name, course_code, student_join_code, current_seed, is_active, created_at) VALUES
      (('e0300000-0000-0000-0000-' || LPAD((v_class_base + 1)::TEXT, 12, '0'))::UUID,
       v_school_id, v_teacher_uids[v_teacher_base + 1],
       'Blwyddyn 5 - ' || v_course_labels[1], v_course_codes[1],
       v_school_codes[v_s] || '5C-001', v_school_cym_seeds[v_s], true, '2025-09-01'),
      (('e0300000-0000-0000-0000-' || LPAD((v_class_base + 2)::TEXT, 12, '0'))::UUID,
       v_school_id, v_teacher_uids[v_teacher_base + 1],
       'Blwyddyn 5 - ' || v_course_labels[2], v_course_codes[2],
       v_school_codes[v_s] || '5F-001', v_school_fra_seeds[v_s], true, '2025-09-01'),
      (('e0300000-0000-0000-0000-' || LPAD((v_class_base + 3)::TEXT, 12, '0'))::UUID,
       v_school_id, v_teacher_uids[v_teacher_base + 2],
       'Blwyddyn 5 - ' || v_course_labels[3], v_course_codes[3],
       v_school_codes[v_s] || '5S-001', v_school_spa_seeds[v_s], true, '2025-09-01')
    ON CONFLICT (id) DO NOTHING;

    -- Blwyddyn 6 classes (teacher 3 teaches Welsh & Spanish, teacher 4 teaches French)
    INSERT INTO classes (id, school_id, teacher_user_id, class_name, course_code, student_join_code, current_seed, is_active, created_at) VALUES
      (('e0300000-0000-0000-0000-' || LPAD((v_class_base + 4)::TEXT, 12, '0'))::UUID,
       v_school_id, v_teacher_uids[v_teacher_base + 3],
       'Blwyddyn 6 - ' || v_course_labels[1], v_course_codes[1],
       v_school_codes[v_s] || '6C-001', v_school_cym_seeds_b6[v_s], true, '2025-09-01'),
      (('e0300000-0000-0000-0000-' || LPAD((v_class_base + 5)::TEXT, 12, '0'))::UUID,
       v_school_id, v_teacher_uids[v_teacher_base + 4],
       'Blwyddyn 6 - ' || v_course_labels[2], v_course_codes[2],
       v_school_codes[v_s] || '6F-001', v_school_fra_seeds_b6[v_s], true, '2025-09-01'),
      (('e0300000-0000-0000-0000-' || LPAD((v_class_base + 6)::TEXT, 12, '0'))::UUID,
       v_school_id, v_teacher_uids[v_teacher_base + 3],
       'Blwyddyn 6 - ' || v_course_labels[3], v_course_codes[3],
       v_school_codes[v_s] || '6S-001', v_school_spa_seeds_b6[v_s], true, '2025-09-01')
    ON CONFLICT (id) DO NOTHING;

    -- ============================================
    -- 5. STUDENTS + CLASS TAGS + PROGRESS
    -- ============================================

    FOR v_i IN 1..20 LOOP
      v_gi := (v_s - 1) * 20 + v_i;  -- global student index (1-60)
      v_uid := v_students[v_gi];
      v_lid := ('e0200000-0000-0000-0000-' || LPAD((100 + v_gi)::TEXT, 12, '0'))::UUID;
      v_name := v_student_names[v_gi];

      -- Student learner record
      INSERT INTO learners (id, user_id, display_name, educational_role)
      VALUES (v_lid, v_uid, v_name, 'student')
      ON CONFLICT (user_id) DO NOTHING;

      FOR v_j IN 1..3 LOOP
        v_cc := v_course_codes[v_j];

        IF v_i <= 10 THEN
          -- Blwyddyn 5
          v_cid := ('e0300000-0000-0000-0000-' || LPAD((v_class_base + v_j)::TEXT, 12, '0'))::UUID;
        ELSE
          -- Blwyddyn 6
          v_cid := ('e0300000-0000-0000-0000-' || LPAD((v_class_base + 3 + v_j)::TEXT, 12, '0'))::UUID;
        END IF;

        -- Student class tag
        INSERT INTO user_tags (user_id, tag_type, tag_value, role_in_context, added_by, added_at)
        VALUES (v_uid, 'class', 'CLASS:' || v_cid, 'student', v_admin_uid, '2025-09-01')
        ON CONFLICT (user_id, tag_type, tag_value) DO NOTHING;

        -- Course enrollment (vary practice minutes by course, student, year)
        INSERT INTO course_enrollments (learner_id, course_id, total_practice_minutes)
        VALUES (v_lid, v_cc,
          CASE v_j
            WHEN 1 THEN (20 + v_i * 8 + v_gi % 11 + CASE WHEN v_i > 10 THEN 45 ELSE 0 END)  -- Welsh: most practice
            WHEN 2 THEN (12 + v_i * 5 + v_gi % 8  + CASE WHEN v_i > 10 THEN 30 ELSE 0 END)  -- French
            WHEN 3 THEN ( 8 + v_i * 4 + v_gi % 7  + CASE WHEN v_i > 10 THEN 25 ELSE 0 END)  -- Spanish
          END
        )
        ON CONFLICT (learner_id, course_id) DO NOTHING;

        -- Seed progress (vary by course, student position, year group)
        v_seeds := CASE v_j
          WHEN 1 THEN GREATEST(1, CASE WHEN v_i <= 10
            THEN v_school_cym_seeds[v_s] - 15 + v_i * 2 + v_gi % 5
            ELSE v_school_cym_seeds_b6[v_s] - 20 + (v_i - 10) * 3 + v_gi % 7 END)
          WHEN 2 THEN GREATEST(1, CASE WHEN v_i <= 10
            THEN v_school_fra_seeds[v_s] - 12 + v_i * 2 + v_gi % 4
            ELSE v_school_fra_seeds_b6[v_s] - 18 + (v_i - 10) * 3 + v_gi % 6 END)
          WHEN 3 THEN GREATEST(1, CASE WHEN v_i <= 10
            THEN v_school_spa_seeds[v_s] - 10 + v_i * 2 + v_gi % 3
            ELSE v_school_spa_seeds_b6[v_s] - 15 + (v_i - 10) * 2 + v_gi % 5 END)
        END;

        FOR v_j IN 1..v_seeds LOOP
          INSERT INTO seed_progress (learner_id, seed_id, course_id, thread_id, is_introduced, introduced_at)
          VALUES (v_lid, 'S' || LPAD(v_j::TEXT, 4, '0'), v_cc, ((v_j - 1) % 3) + 1, true,
                  '2025-09-08'::TIMESTAMPTZ + (v_j || ' days')::INTERVAL)
          ON CONFLICT (learner_id, seed_id) DO NOTHING;
        END LOOP;

        -- Lego progress (~2 legos per seed)
        v_legos := v_seeds * 2;
        FOR v_j IN 1..v_legos LOOP
          INSERT INTO lego_progress (learner_id, lego_id, course_id, thread_id, is_retired,
                                     fibonacci_position, skip_number, reps_completed)
          VALUES (v_lid,
                  'S' || LPAD(((v_j - 1) / 2 + 1)::TEXT, 4, '0') || 'L' || LPAD(((v_j - 1) % 2 + 1)::TEXT, 2, '0'),
                  v_cc,
                  ((v_j - 1) % 3) + 1,
                  v_j < v_legos * 0.6,
                  LEAST(v_j % 8, 7),
                  CASE WHEN v_j < v_legos * 0.6 THEN 34 ELSE v_j % 13 END,
                  CASE WHEN v_j < v_legos * 0.6 THEN 10 + (v_j % 5) ELSE v_j % 6 END)
          ON CONFLICT (learner_id, lego_id) DO NOTHING;
        END LOOP;

        -- Sessions (3 per student per course over last 30 days)
        v_practice_secs := CASE v_j
          WHEN 1 THEN 1100 + v_gi * 8 + v_i * 30   -- Welsh: longer sessions
          WHEN 2 THEN 900 + v_gi * 6 + v_i * 25     -- French
          WHEN 3 THEN 800 + v_gi * 5 + v_i * 20     -- Spanish
        END;

        FOR v_j IN 1..3 LOOP
          v_session_date := NOW() - ((v_j * 7 + (v_gi % 5) + (v_i % 3)) || ' days')::INTERVAL;
          INSERT INTO sessions (learner_id, course_id, started_at, ended_at, duration_seconds, items_practiced)
          VALUES (v_lid, v_cc, v_session_date, v_session_date + (v_practice_secs || ' seconds')::INTERVAL,
                  v_practice_secs, v_practice_secs / 11)
          ON CONFLICT DO NOTHING;
        END LOOP;
      END LOOP;  -- courses
    END LOOP;  -- students

    -- ============================================
    -- 6. CLASS SESSIONS (recent teacher-led sessions)
    -- ============================================

    INSERT INTO class_sessions (class_id, teacher_user_id, started_at, ended_at, start_lego_id, end_lego_id, cycles_completed, duration_seconds) VALUES
      -- Blwyddyn 5 Welsh
      (('e0300000-0000-0000-0000-' || LPAD((v_class_base + 1)::TEXT, 12, '0'))::UUID,
       v_teacher_uids[v_teacher_base + 1],
       NOW() - INTERVAL '2 days', NOW() - INTERVAL '2 days' + INTERVAL '25 minutes',
       'S' || LPAD((v_school_cym_seeds[v_s] - 5)::TEXT, 4, '0') || 'L01',
       'S' || LPAD(v_school_cym_seeds[v_s]::TEXT, 4, '0') || 'L02',
       120, 1500),
      -- Blwyddyn 6 French
      (('e0300000-0000-0000-0000-' || LPAD((v_class_base + 5)::TEXT, 12, '0'))::UUID,
       v_teacher_uids[v_teacher_base + 4],
       NOW() - INTERVAL '3 days', NOW() - INTERVAL '3 days' + INTERVAL '30 minutes',
       'S' || LPAD((v_school_fra_seeds_b6[v_s] - 5)::TEXT, 4, '0') || 'L01',
       'S' || LPAD(v_school_fra_seeds_b6[v_s]::TEXT, 4, '0') || 'L02',
       140, 1800),
      -- Blwyddyn 5 Spanish
      (('e0300000-0000-0000-0000-' || LPAD((v_class_base + 3)::TEXT, 12, '0'))::UUID,
       v_teacher_uids[v_teacher_base + 2],
       NOW() - INTERVAL '5 days', NOW() - INTERVAL '5 days' + INTERVAL '20 minutes',
       'S' || LPAD((v_school_spa_seeds[v_s] - 4)::TEXT, 4, '0') || 'L01',
       'S' || LPAD(v_school_spa_seeds[v_s]::TEXT, 4, '0') || 'L02',
       95, 1200)
    ON CONFLICT DO NOTHING;

  END LOOP;  -- schools

  -- ============================================
  -- 7. INVITE CODES
  -- ============================================

  FOR v_s IN 1..3 LOOP
    v_class_base := (v_s - 1) * 6;
    v_school_id := v_school_ids[v_s];

    FOR v_j IN 1..6 LOOP
      v_cid := ('e0300000-0000-0000-0000-' || LPAD((v_class_base + v_j)::TEXT, 12, '0'))::UUID;
      INSERT INTO invite_codes (
        code,
        code_type,
        grants_school_id,
        grants_class_id,
        created_by,
        is_active
      ) VALUES (
        v_school_codes[v_s] ||
          CASE WHEN v_j <= 3 THEN '5' ELSE '6' END ||
          CASE ((v_j - 1) % 3) + 1
            WHEN 1 THEN 'C'
            WHEN 2 THEN 'F'
            WHEN 3 THEN 'S'
          END || '-001',
        'student',
        v_school_id,
        v_cid,
        v_school_admin_uids[v_s],
        true
      )
      ON CONFLICT (code) DO NOTHING;
    END LOOP;
  END LOOP;

  RAISE NOTICE 'Wales demo data seeded successfully!';
  RAISE NOTICE 'Region: wales';
  RAISE NOTICE 'Govt admin: Gwilym ap Dafydd (%)', v_govt_uid;
  RAISE NOTICE '3 schools: Ysgol Gymraeg Aberystwyth, Ysgol Glan Clwyd, Ysgol Bro Morgannwg';
  RAISE NOTICE '3 school admins, 12 teachers, 60 students, 18 classes across 3 languages';

END $wales_demo$;
