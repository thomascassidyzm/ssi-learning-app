-- ============================================
-- Japan Demo Data for Schools Dashboard
-- ============================================
-- 5 schools across Japan with Japanese naming conventions
-- 2 class groups (1年/2年) × 4 languages each per school
-- 100 students, 20 teachers, 5 school admins, 1 govt admin
-- Realistic progress data spread across belt levels
--
-- Courses: jpn_for_eng, fra_for_eng, spa_for_eng, cmn_for_eng
-- Region: japan
--
-- Date: 2026-02-25

-- ============================================
-- 1. STABLE UUIDs (deterministic for idempotency)
-- ============================================

DO $$
DECLARE
  -- Schools
  v_school1_id UUID := 'd1000000-0000-0000-0000-000000000001';
  v_school2_id UUID := 'd1000000-0000-0000-0000-000000000002';
  v_school3_id UUID := 'd1000000-0000-0000-0000-000000000003';
  v_school4_id UUID := 'd1000000-0000-0000-0000-000000000004';
  v_school5_id UUID := 'd1000000-0000-0000-0000-000000000005';

  v_school_ids UUID[];
  v_school_names TEXT[];
  v_school_codes TEXT[];

  -- Govt admin
  v_govt_uid TEXT := 'test_govt_tanaka';
  v_govt_lid UUID := 'd0100000-0000-0000-0000-000000000001';

  -- School admin UIDs
  v_school_admin_uids TEXT[] := ARRAY[
    'test_admin_yamamoto',
    'test_admin_nakamura',
    'test_admin_watanabe',
    'test_admin_kobayashi',
    'test_admin_yoshida'
  ];
  v_school_admin_names TEXT[] := ARRAY[
    '山本 真理子',
    '中村 健太郎',
    '渡辺 美咲',
    '小林 大輔',
    '吉田 恵子'
  ];
  v_school_admin_lids UUID[] := ARRAY[
    'd2000000-0000-0000-0000-000000000001'::UUID,
    'd2000000-0000-0000-0000-000000000002'::UUID,
    'd2000000-0000-0000-0000-000000000003'::UUID,
    'd2000000-0000-0000-0000-000000000004'::UUID,
    'd2000000-0000-0000-0000-000000000005'::UUID
  ];

  -- Teacher UIDs (4 per school = 20 total)
  v_teacher_uids TEXT[] := ARRAY[
    -- School 1: Tokyo
    'test_teacher_sato',     'test_teacher_suzuki_a',  'test_teacher_takahashi', 'test_teacher_ito',
    -- School 2: Osaka
    'test_teacher_kimura',   'test_teacher_hayashi',   'test_teacher_shimizu',   'test_teacher_yamazaki',
    -- School 3: Kyoto
    'test_teacher_mori',     'test_teacher_ikeda',     'test_teacher_hashimoto', 'test_teacher_ishikawa',
    -- School 4: Sapporo
    'test_teacher_ogawa',    'test_teacher_okada',     'test_teacher_maeda',     'test_teacher_fujita',
    -- School 5: Fukuoka
    'test_teacher_goto',     'test_teacher_hasegawa',  'test_teacher_murakami',  'test_teacher_kondo'
  ];
  v_teacher_names TEXT[] := ARRAY[
    '佐藤 雅人',   '鈴木 彩花',   '高橋 隆',     '伊藤 由美',
    '木村 拓哉',   '林 智子',     '清水 太郎',   '山崎 恵',
    '森 裕子',     '池田 誠',     '橋本 花',     '石川 修',
    '小川 直美',   '岡田 剛',     '前田 千尋',   '藤田 浩二',
    '後藤 明美',   '長谷川 翔太', '村上 さくら', '近藤 和也'
  ];

  -- Student UIDs (20 per school = 100 total)
  v_students TEXT[] := ARRAY[
    -- School 1: Tokyo (students 1-20)
    'test_student_jp_aoki',      'test_student_jp_endo',      'test_student_jp_fujimoto',
    'test_student_jp_harada',    'test_student_jp_inoue',     'test_student_jp_kato_a',
    'test_student_jp_matsuda',   'test_student_jp_nishimura', 'test_student_jp_otsuka',
    'test_student_jp_saito',     'test_student_jp_taniguchi', 'test_student_jp_ueda',
    'test_student_jp_wada',      'test_student_jp_yasuda',    'test_student_jp_akiyama',
    'test_student_jp_chiba',     'test_student_jp_doi',       'test_student_jp_fukuda',
    'test_student_jp_hara',      'test_student_jp_iwata',
    -- School 2: Osaka (students 21-40)
    'test_student_jp_kaneko',    'test_student_jp_matsumoto', 'test_student_jp_naito',
    'test_student_jp_ono',       'test_student_jp_sakamoto',  'test_student_jp_tsuchiya',
    'test_student_jp_uchida',    'test_student_jp_yano',      'test_student_jp_abe',
    'test_student_jp_baba',      'test_student_jp_eguchi',    'test_student_jp_fujioka',
    'test_student_jp_hamada',    'test_student_jp_ishibashi', 'test_student_jp_kamiya',
    'test_student_jp_miura',     'test_student_jp_nagai',     'test_student_jp_ozaki',
    'test_student_jp_sugiyama',  'test_student_jp_takeda',
    -- School 3: Kyoto (students 41-60)
    'test_student_jp_umeda',     'test_student_jp_wakabayashi','test_student_jp_yamagishi',
    'test_student_jp_arai',      'test_student_jp_bando',     'test_student_jp_enomoto',
    'test_student_jp_furukawa',  'test_student_jp_hagiwara',  'test_student_jp_imamura',
    'test_student_jp_kawai',     'test_student_jp_mizuno',    'test_student_jp_nomura',
    'test_student_jp_otani',     'test_student_jp_sakai',     'test_student_jp_tsuji',
    'test_student_jp_usui',      'test_student_jp_watabe',    'test_student_jp_yanagida',
    'test_student_jp_azuma',     'test_student_jp_chino',
    -- School 4: Sapporo (students 61-80)
    'test_student_jp_daimon',    'test_student_jp_fukazawa',  'test_student_jp_hattori',
    'test_student_jp_ide',       'test_student_jp_katayama',  'test_student_jp_maruyama',
    'test_student_jp_nishida',   'test_student_jp_okamoto',   'test_student_jp_shibata',
    'test_student_jp_tamura',    'test_student_jp_ueno',      'test_student_jp_yagi',
    'test_student_jp_adachi',    'test_student_jp_fujii',     'test_student_jp_hirata',
    'test_student_jp_ishida',    'test_student_jp_kubo',      'test_student_jp_morimoto',
    'test_student_jp_nakano',    'test_student_jp_ota',
    -- School 5: Fukuoka (students 81-100)
    'test_student_jp_sekiguchi', 'test_student_jp_taguchi',   'test_student_jp_uyama',
    'test_student_jp_yamashita', 'test_student_jp_aoyama',    'test_student_jp_endo_b',
    'test_student_jp_hamaguchi', 'test_student_jp_iwamoto',   'test_student_jp_kojima',
    'test_student_jp_matsui',    'test_student_jp_noda',      'test_student_jp_oishi',
    'test_student_jp_sakurai',   'test_student_jp_tani',      'test_student_jp_uemura',
    'test_student_jp_yajima',    'test_student_jp_asano',     'test_student_jp_fujiwara',
    'test_student_jp_hino',      'test_student_jp_igarashi'
  ];

  v_student_names TEXT[] := ARRAY[
    -- School 1: Tokyo
    '青木 遥',     '遠藤 翔',     '藤本 美月',   '原田 蓮',
    '井上 結衣',   '加藤 大翔',   '松田 凛',     '西村 悠真',
    '大塚 芽依',   '斉藤 陽太',   '谷口 さら',   '上田 颯太',
    '和田 心',     '安田 朝陽',   '秋山 美桜',   '千葉 湊',
    '土井 陽菜',   '福田 樹',     '原 杏',       '岩田 奏',
    -- School 2: Osaka
    '金子 紬',     '松本 陸',     '内藤 花音',   '小野 悠人',
    '坂本 詩',     '土屋 大和',   '内田 莉子',   '矢野 瑛太',
    '阿部 ひまり', '馬場 颯',     '江口 凪',     '藤岡 律',
    '浜田 つむぎ', '石橋 蒼',     '神谷 結菜',   '三浦 暖',
    '永井 陽葵',   '尾崎 新',     '杉山 澪',     '武田 碧',
    -- School 3: Kyoto
    '梅田 柚葉',   '若林 蒼空',   '山岸 彩葉',   '新井 壮真',
    '坂東 琴音',   '榎本 陽向',   '古川 一花',   '萩原 悠斗',
    '今村 芽生',   '河合 湊斗',   '水野 紗良',   '野村 大翔',
    '大谷 栞',     '酒井 春翔',   '辻 楓',       '臼井 和真',
    '渡部 日葵',   '柳田 絢斗',   '東 朱莉',     '知野 智',
    -- School 4: Sapporo
    '大門 結月',   '深沢 想',     '服部 咲良',   '井手 蓮翔',
    '片山 七海',   '丸山 湊翔',   '西田 彩月',   '岡本 悠',
    '柴田 穂乃花', '田村 陽',     '上野 凪咲',   '八木 律希',
    '足立 芽吹',   '藤井 奏太',   '平田 千咲',   '石田 健',
    '久保 美羽',   '森本 翔太',   '中野 日和',   '太田 晴',
    -- School 5: Fukuoka
    '関口 葵',     '田口 悠真',   '宇山 百花',   '山下 空',
    '青山 和花',   '遠藤 拓海',   '浜口 彩花',   '岩本 凛太朗',
    '小島 心春',   '松井 大雅',   '野田 咲',     '大石 陽斗',
    '桜井 瑠花',   '谷 海斗',     '植村 楓花',   '矢島 蒼真',
    '浅野 絆',     '藤原 煌',     '日野 琴',     '五十嵐 翼'
  ];

  -- Class UUIDs (8 per school = 40 total)
  -- d5000000-0000-0000-0000-0000000000XX (01-40)

  -- Course codes
  v_course_codes TEXT[] := ARRAY['jpn_for_eng', 'fra_for_eng', 'spa_for_eng', 'cmn_for_eng'];
  v_course_labels TEXT[] := ARRAY['日本語', 'フランス語', 'スペイン語', '中国語'];

  -- Loop vars
  v_s INTEGER;  -- school index
  v_i INTEGER;  -- student index within school
  v_gi INTEGER; -- global student index
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
  v_class_y1 UUID[];
  v_class_y2 UUID[];
  v_class_base INTEGER;
  v_teacher_base INTEGER;

  -- Class seed progress per school (varies by school)
  v_school_jpn_seeds INTEGER[] := ARRAY[50, 35, 60, 25, 42];
  v_school_fra_seeds INTEGER[] := ARRAY[30, 45, 28, 20, 38];
  v_school_spa_seeds INTEGER[] := ARRAY[25, 30, 35, 22, 28];
  v_school_cmn_seeds INTEGER[] := ARRAY[18, 15, 22, 12, 20];
  -- Year 2 gets more progress
  v_school_jpn_seeds_y2 INTEGER[] := ARRAY[85, 70, 95, 55, 78];
  v_school_fra_seeds_y2 INTEGER[] := ARRAY[60, 72, 55, 45, 65];
  v_school_spa_seeds_y2 INTEGER[] := ARRAY[48, 55, 50, 38, 52];
  v_school_cmn_seeds_y2 INTEGER[] := ARRAY[30, 28, 38, 22, 35];

BEGIN
  v_school_ids := ARRAY[v_school1_id, v_school2_id, v_school3_id, v_school4_id, v_school5_id];
  v_school_names := ARRAY[
    '東京国際中学校',
    '大阪言語学院',
    '京都外国語中学校',
    '札幌グローバル学園',
    '福岡多文化中学校'
  ];
  v_school_codes := ARRAY['TK', 'OS', 'KT', 'SP', 'FK'];

  -- ============================================
  -- 2. GOVT ADMIN
  -- ============================================

  INSERT INTO learners (id, user_id, display_name, educational_role, platform_role)
  VALUES (v_govt_lid, v_govt_uid, '田中 宏', 'govt_admin', NULL)
  ON CONFLICT (user_id) DO NOTHING;

  INSERT INTO govt_admins (user_id, region_code, organization_name, created_by)
  VALUES (v_govt_uid, 'japan', '文部科学省 国際教育課', v_govt_uid)
  ON CONFLICT (user_id) DO NOTHING;

  -- ============================================
  -- 3. SCHOOLS + SCHOOL ADMINS + TEACHERS
  -- ============================================

  FOR v_s IN 1..5 LOOP
    v_school_id := v_school_ids[v_s];
    v_admin_uid := v_school_admin_uids[v_s];

    -- School admin learner record
    INSERT INTO learners (id, user_id, display_name, educational_role, platform_role)
    VALUES (v_school_admin_lids[v_s], v_admin_uid, v_school_admin_names[v_s], 'school_admin', NULL)
    ON CONFLICT (user_id) DO NOTHING;

    -- School
    INSERT INTO schools (id, admin_user_id, school_name, region_code, teacher_join_code)
    VALUES (v_school_id, v_admin_uid, v_school_names[v_s], 'japan', v_school_codes[v_s] || '-JOIN')
    ON CONFLICT (id) DO NOTHING;

    -- Teachers (4 per school)
    v_teacher_base := (v_s - 1) * 4;
    FOR v_j IN 1..4 LOOP
      INSERT INTO learners (id, user_id, display_name, educational_role)
      VALUES (
        ('d3000000-0000-0000-0000-' || LPAD((v_teacher_base + v_j)::TEXT, 12, '0'))::UUID,
        v_teacher_uids[v_teacher_base + v_j],
        v_teacher_names[v_teacher_base + v_j],
        'teacher'
      )
      ON CONFLICT (user_id) DO NOTHING;

      -- Teacher school tag
      INSERT INTO user_tags (user_id, tag_type, tag_value, role_in_context, added_by, added_at)
      VALUES (v_teacher_uids[v_teacher_base + v_j], 'school', 'SCHOOL:' || v_school_id, 'teacher', v_admin_uid, '2025-04-01')
      ON CONFLICT (user_id, tag_type, tag_value) DO NOTHING;
    END LOOP;

    -- ============================================
    -- 4. CLASSES (8 per school: 2 groups × 4 languages)
    -- ============================================

    v_class_base := (v_s - 1) * 8;

    -- Year 1 classes (teacher 1 teaches jpn+fra, teacher 2 teaches spa+cmn)
    INSERT INTO classes (id, school_id, teacher_user_id, class_name, course_code, student_join_code, current_seed, is_active, created_at) VALUES
      (('d5000000-0000-0000-0000-' || LPAD((v_class_base + 1)::TEXT, 12, '0'))::UUID,
       v_school_id, v_teacher_uids[v_teacher_base + 1],
       '1年 - ' || v_course_labels[1], v_course_codes[1],
       v_school_codes[v_s] || '1J-001', v_school_jpn_seeds[v_s], true, '2025-04-01'),
      (('d5000000-0000-0000-0000-' || LPAD((v_class_base + 2)::TEXT, 12, '0'))::UUID,
       v_school_id, v_teacher_uids[v_teacher_base + 1],
       '1年 - ' || v_course_labels[2], v_course_codes[2],
       v_school_codes[v_s] || '1F-001', v_school_fra_seeds[v_s], true, '2025-04-01'),
      (('d5000000-0000-0000-0000-' || LPAD((v_class_base + 3)::TEXT, 12, '0'))::UUID,
       v_school_id, v_teacher_uids[v_teacher_base + 2],
       '1年 - ' || v_course_labels[3], v_course_codes[3],
       v_school_codes[v_s] || '1S-001', v_school_spa_seeds[v_s], true, '2025-04-01'),
      (('d5000000-0000-0000-0000-' || LPAD((v_class_base + 4)::TEXT, 12, '0'))::UUID,
       v_school_id, v_teacher_uids[v_teacher_base + 2],
       '1年 - ' || v_course_labels[4], v_course_codes[4],
       v_school_codes[v_s] || '1C-001', v_school_cmn_seeds[v_s], true, '2025-05-01')
    ON CONFLICT (id) DO NOTHING;

    -- Year 2 classes (teacher 3 teaches jpn+spa, teacher 4 teaches fra+cmn)
    INSERT INTO classes (id, school_id, teacher_user_id, class_name, course_code, student_join_code, current_seed, is_active, created_at) VALUES
      (('d5000000-0000-0000-0000-' || LPAD((v_class_base + 5)::TEXT, 12, '0'))::UUID,
       v_school_id, v_teacher_uids[v_teacher_base + 3],
       '2年 - ' || v_course_labels[1], v_course_codes[1],
       v_school_codes[v_s] || '2J-001', v_school_jpn_seeds_y2[v_s], true, '2025-04-01'),
      (('d5000000-0000-0000-0000-' || LPAD((v_class_base + 6)::TEXT, 12, '0'))::UUID,
       v_school_id, v_teacher_uids[v_teacher_base + 4],
       '2年 - ' || v_course_labels[2], v_course_codes[2],
       v_school_codes[v_s] || '2F-001', v_school_fra_seeds_y2[v_s], true, '2025-04-01'),
      (('d5000000-0000-0000-0000-' || LPAD((v_class_base + 7)::TEXT, 12, '0'))::UUID,
       v_school_id, v_teacher_uids[v_teacher_base + 3],
       '2年 - ' || v_course_labels[3], v_course_codes[3],
       v_school_codes[v_s] || '2S-001', v_school_spa_seeds_y2[v_s], true, '2025-04-01'),
      (('d5000000-0000-0000-0000-' || LPAD((v_class_base + 8)::TEXT, 12, '0'))::UUID,
       v_school_id, v_teacher_uids[v_teacher_base + 4],
       '2年 - ' || v_course_labels[4], v_course_codes[4],
       v_school_codes[v_s] || '2C-001', v_school_cmn_seeds_y2[v_s], true, '2025-05-01')
    ON CONFLICT (id) DO NOTHING;

    -- ============================================
    -- 5. STUDENTS + CLASS TAGS + PROGRESS
    -- ============================================

    FOR v_i IN 1..20 LOOP
      v_gi := (v_s - 1) * 20 + v_i;  -- global student index (1-100)
      v_uid := v_students[v_gi];
      v_lid := ('d4000000-0000-0000-0000-' || LPAD(v_gi::TEXT, 12, '0'))::UUID;
      v_name := v_student_names[v_gi];

      -- Student learner record
      INSERT INTO learners (id, user_id, display_name, educational_role)
      VALUES (v_lid, v_uid, v_name, 'student')
      ON CONFLICT (user_id) DO NOTHING;

      FOR v_j IN 1..4 LOOP
        v_cc := v_course_codes[v_j];

        IF v_i <= 10 THEN
          -- Year 1
          v_cid := ('d5000000-0000-0000-0000-' || LPAD((v_class_base + v_j)::TEXT, 12, '0'))::UUID;
        ELSE
          -- Year 2
          v_cid := ('d5000000-0000-0000-0000-' || LPAD((v_class_base + 4 + v_j)::TEXT, 12, '0'))::UUID;
        END IF;

        -- Student class tag
        INSERT INTO user_tags (user_id, tag_type, tag_value, role_in_context, added_by, added_at)
        VALUES (v_uid, 'class', 'CLASS:' || v_cid, 'student', v_admin_uid, '2025-04-01')
        ON CONFLICT (user_id, tag_type, tag_value) DO NOTHING;

        -- Course enrollment (vary practice minutes by course, student, year)
        INSERT INTO course_enrollments (learner_id, course_id, total_practice_minutes)
        VALUES (v_lid, v_cc,
          CASE v_j
            WHEN 1 THEN (15 + v_i * 7 + v_gi % 11 + CASE WHEN v_i > 10 THEN 40 ELSE 0 END)
            WHEN 2 THEN (10 + v_i * 5 + v_gi % 8  + CASE WHEN v_i > 10 THEN 30 ELSE 0 END)
            WHEN 3 THEN ( 8 + v_i * 4 + v_gi % 7  + CASE WHEN v_i > 10 THEN 25 ELSE 0 END)
            WHEN 4 THEN ( 5 + v_i * 3 + v_gi % 9  + CASE WHEN v_i > 10 THEN 20 ELSE 0 END)
          END
        )
        ON CONFLICT (learner_id, course_id) DO NOTHING;

        -- Seed progress (vary by course, student position, year group)
        v_seeds := CASE v_j
          WHEN 1 THEN GREATEST(1, CASE WHEN v_i <= 10
            THEN v_school_jpn_seeds[v_s] - 15 + v_i * 2 + v_gi % 5
            ELSE v_school_jpn_seeds_y2[v_s] - 20 + (v_i - 10) * 3 + v_gi % 7 END)
          WHEN 2 THEN GREATEST(1, CASE WHEN v_i <= 10
            THEN v_school_fra_seeds[v_s] - 12 + v_i * 2 + v_gi % 4
            ELSE v_school_fra_seeds_y2[v_s] - 18 + (v_i - 10) * 3 + v_gi % 6 END)
          WHEN 3 THEN GREATEST(1, CASE WHEN v_i <= 10
            THEN v_school_spa_seeds[v_s] - 10 + v_i * 2 + v_gi % 3
            ELSE v_school_spa_seeds_y2[v_s] - 15 + (v_i - 10) * 2 + v_gi % 5 END)
          WHEN 4 THEN GREATEST(1, CASE WHEN v_i <= 10
            THEN v_school_cmn_seeds[v_s] - 8 + v_i + v_gi % 4
            ELSE v_school_cmn_seeds_y2[v_s] - 10 + (v_i - 10) * 2 + v_gi % 4 END)
        END;

        FOR v_j IN 1..v_seeds LOOP
          INSERT INTO seed_progress (learner_id, seed_id, course_id, thread_id, is_introduced, introduced_at)
          VALUES (v_lid, 'S' || LPAD(v_j::TEXT, 4, '0'), v_cc, ((v_j - 1) % 3) + 1, true,
                  '2025-04-07'::TIMESTAMPTZ + (v_j || ' days')::INTERVAL)
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
          WHEN 1 THEN 1100 + v_gi * 8 + v_i * 30
          WHEN 2 THEN 900 + v_gi * 6 + v_i * 25
          WHEN 3 THEN 800 + v_gi * 5 + v_i * 20
          WHEN 4 THEN 600 + v_gi * 4 + v_i * 15
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
    -- 6. CLASS SESSIONS (3 per school)
    -- ============================================

    -- Most recent class sessions across this school's classes
    INSERT INTO class_sessions (class_id, teacher_user_id, started_at, ended_at, start_lego_id, end_lego_id, cycles_completed, duration_seconds) VALUES
      -- Year 1 Japanese
      (('d5000000-0000-0000-0000-' || LPAD((v_class_base + 1)::TEXT, 12, '0'))::UUID,
       v_teacher_uids[v_teacher_base + 1],
       NOW() - INTERVAL '2 days', NOW() - INTERVAL '2 days' + INTERVAL '25 minutes',
       'S' || LPAD((v_school_jpn_seeds[v_s] - 5)::TEXT, 4, '0') || 'L01',
       'S' || LPAD(v_school_jpn_seeds[v_s]::TEXT, 4, '0') || 'L02',
       120, 1500),
      -- Year 2 French
      (('d5000000-0000-0000-0000-' || LPAD((v_class_base + 6)::TEXT, 12, '0'))::UUID,
       v_teacher_uids[v_teacher_base + 4],
       NOW() - INTERVAL '3 days', NOW() - INTERVAL '3 days' + INTERVAL '30 minutes',
       'S' || LPAD((v_school_fra_seeds_y2[v_s] - 5)::TEXT, 4, '0') || 'L01',
       'S' || LPAD(v_school_fra_seeds_y2[v_s]::TEXT, 4, '0') || 'L02',
       140, 1800),
      -- Year 1 Spanish
      (('d5000000-0000-0000-0000-' || LPAD((v_class_base + 3)::TEXT, 12, '0'))::UUID,
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

  -- Insert invite codes for all 40 classes
  FOR v_s IN 1..5 LOOP
    v_class_base := (v_s - 1) * 8;
    v_school_id := v_school_ids[v_s];

    FOR v_j IN 1..8 LOOP
      v_cid := ('d5000000-0000-0000-0000-' || LPAD((v_class_base + v_j)::TEXT, 12, '0'))::UUID;
      INSERT INTO invite_codes (
        code,
        school_id,
        class_id,
        role,
        created_by,
        is_active
      ) VALUES (
        v_school_codes[v_s] ||
          CASE WHEN v_j <= 4 THEN '1' ELSE '2' END ||
          CASE ((v_j - 1) % 4) + 1
            WHEN 1 THEN 'J'
            WHEN 2 THEN 'F'
            WHEN 3 THEN 'S'
            WHEN 4 THEN 'C'
          END || '-001',
        v_school_id,
        v_cid,
        'student',
        v_school_admin_uids[v_s],
        true
      )
      ON CONFLICT DO NOTHING;
    END LOOP;
  END LOOP;

  RAISE NOTICE 'Japan demo data seeded successfully!';
  RAISE NOTICE 'Region: japan';
  RAISE NOTICE 'Govt admin: 田中 宏 (%)', v_govt_uid;
  RAISE NOTICE '5 schools: 東京国際中学校, 大阪言語学院, 京都外国語中学校, 札幌グローバル学園, 福岡多文化中学校';
  RAISE NOTICE '5 school admins, 20 teachers, 100 students, 40 classes across 4 languages';

END $$;
