CREATE POLICY "God users can read all course_enrollments" ON course_enrollments FOR SELECT TO authenticated USING (is_god_user());
