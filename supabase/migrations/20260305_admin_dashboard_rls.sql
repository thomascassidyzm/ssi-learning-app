-- Admin Dashboard RLS: God mode SELECT policy for course_enrollments
-- Run manually in Supabase SQL editor

-- course_enrollments: allow god users to read all enrollments
CREATE POLICY "God users can read all course_enrollments"
  ON course_enrollments FOR SELECT TO authenticated
  USING (is_god_user());
