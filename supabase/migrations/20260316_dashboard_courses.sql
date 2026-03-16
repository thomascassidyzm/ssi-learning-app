-- Per-user course access for the dashboard (Popty)
-- NULL = no specific courses (ssi_admin/god get all implicitly)
-- ['*'] = all courses
-- ['fra_for_eng', 'spa_for_eng'] = specific courses only
ALTER TABLE learners ADD COLUMN IF NOT EXISTS dashboard_courses text[];

NOTIFY pgrst, 'reload schema';
