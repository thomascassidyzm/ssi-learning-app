-- Fix Japan demo data: Japanese students study English (eng_for_jpn), not Japanese (jpn_for_eng)
-- jpn_for_eng = "Japanese for English speakers" (wrong - these ARE Japanese speakers)
-- eng_for_jpn = "English for Japanese speakers" (correct)

UPDATE classes SET course_code = 'eng_for_jpn' WHERE course_code = 'jpn_for_eng'
  AND school_id IN (
    'd1000000-0000-0000-0000-000000000001',
    'd1000000-0000-0000-0000-000000000002',
    'd1000000-0000-0000-0000-000000000003',
    'd1000000-0000-0000-0000-000000000004',
    'd1000000-0000-0000-0000-000000000005'
  );

UPDATE course_enrollments SET course_code = 'eng_for_jpn' WHERE course_code = 'jpn_for_eng'
  AND learner_id IN (
    SELECT id FROM learners WHERE user_id LIKE 'test_student_jp_%'
  );
