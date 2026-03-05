-- Admin Dashboard RLS: God mode SELECT policies for course_enrollments and subscriptions
-- Run manually in Supabase SQL editor

-- course_enrollments: allow god users to read all enrollments
CREATE POLICY "God users can read all course_enrollments"
  ON course_enrollments FOR SELECT TO authenticated
  USING (is_god_user());

-- subscriptions: allow god users to read all subscriptions
CREATE POLICY "God users can read all subscriptions"
  ON subscriptions FOR SELECT TO authenticated
  USING (is_god_user());
