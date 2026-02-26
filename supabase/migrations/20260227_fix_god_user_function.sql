-- Fix is_god_user() to use Supabase Auth instead of Clerk JWT
CREATE OR REPLACE FUNCTION is_god_user() RETURNS boolean AS $$
  SELECT EXISTS (
    SELECT 1 FROM learners
    WHERE user_id = (SELECT auth.uid()::text)
    AND educational_role = 'god'
  )
$$ LANGUAGE sql SECURITY DEFINER STABLE;
