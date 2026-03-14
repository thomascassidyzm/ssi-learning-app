-- Allow anonymous (unauthenticated) users to insert sessions
-- The app uses Supabase anon key — auth.uid() is NULL for most users.
-- Session inserts are gated by learner_id in application code.

-- Drop the old authenticated-only insert policy if it exists
DROP POLICY IF EXISTS "Users can insert own sessions" ON sessions;

-- Allow any request (anon or authenticated) to insert sessions
-- The learner_id is validated at the application level
CREATE POLICY "Anyone can insert sessions"
  ON sessions FOR INSERT
  WITH CHECK (true);

-- Also allow updates (for ending sessions, updating duration/items)
DROP POLICY IF EXISTS "Users can update own sessions" ON sessions;

CREATE POLICY "Anyone can update own sessions"
  ON sessions FOR UPDATE
  USING (true);
