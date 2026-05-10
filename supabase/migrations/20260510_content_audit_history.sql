-- ============================================================================
-- Content audit history — automatic row-level rollback log
-- ============================================================================
-- Captures every UPDATE and DELETE on at-risk content tables so a corruption
-- (agent goes wild on `known_text`, accidental bulk DELETE, etc.) can be
-- rolled back row-by-row from the captured snapshot, without restoring the
-- whole DB and losing legitimate work.
--
-- Why this exists: 2026-05 a teammate's Claude corrupted lego known_text
-- across all courses. We had no granular rollback path; only a full DB PITR
-- restore which would also have erased every other change since the snapshot.
-- This trigger captures the OLD row before each mutation so we can selectively
-- restore.
--
-- Cost: a doubled write on every UPDATE/DELETE to the audited tables.
-- Acceptable — content tables churn slowly (course authoring), not on the
-- learner-write hot path.
--
-- Retention: manual cleanup. Content corruptions get noticed within hours
-- (someone opens the app and sees broken text), so the audit log stays
-- useful for ~3 days then is pure noise. Run the cleanup query at the
-- bottom of this file weekly (or whenever you remember) to keep the table
-- from accumulating.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. Single audit log table for all content tables
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS content_audit_log (
  id BIGSERIAL PRIMARY KEY,
  table_name TEXT NOT NULL,
  change_type TEXT NOT NULL CHECK (change_type IN ('UPDATE', 'DELETE')),
  changed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  changed_by_role TEXT NOT NULL DEFAULT current_user,
  changed_by_uid UUID,                       -- auth.uid() if available (NULL for service-role / cron)
  primary_key TEXT,                          -- string repr of the row's PK for fast lookup
  old_row JSONB NOT NULL                     -- complete OLD record
);

-- Most queries are "what changed in this table since X" or "what was this row's value before"
CREATE INDEX IF NOT EXISTS idx_content_audit_table_time
  ON content_audit_log (table_name, changed_at DESC);

CREATE INDEX IF NOT EXISTS idx_content_audit_pk
  ON content_audit_log (table_name, primary_key, changed_at DESC);

COMMENT ON TABLE content_audit_log IS
  'Append-only history of UPDATE/DELETE on at-risk content tables. Used for granular rollback when an agent or human corrupts content. See migration 20260510 for restore patterns.';

-- ---------------------------------------------------------------------------
-- 2. Generic trigger function — copies OLD row to the audit log
-- ---------------------------------------------------------------------------
-- Picks the primary key string from common column names. Most content tables
-- use `id` (UUID); `courses` uses `course_code`. Falls back gracefully if
-- neither is present (audit row still inserted, just without a PK lookup
-- shortcut — old_row JSONB still contains everything).
CREATE OR REPLACE FUNCTION audit_content_change()
RETURNS TRIGGER AS $$
DECLARE
  pk_val TEXT;
  old_json JSONB;
BEGIN
  old_json := to_jsonb(OLD);
  pk_val := COALESCE(
    old_json->>'id',
    old_json->>'course_code',
    old_json->>'lego_id',
    old_json->>'seed_id'
  );

  INSERT INTO content_audit_log (
    table_name, change_type, primary_key, old_row, changed_by_uid
  ) VALUES (
    TG_TABLE_NAME,
    TG_OP,
    pk_val,
    old_json,
    -- auth.uid() returns NULL for service-role connections (most agent traffic)
    -- but is set when the request is JWT-authenticated as a user.
    auth.uid()
  );

  RETURN NULL;  -- AFTER trigger; return value ignored
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

-- ---------------------------------------------------------------------------
-- 3. Attach trigger to at-risk content tables
-- ---------------------------------------------------------------------------
-- AFTER UPDATE OR DELETE — captures the row state right before the change
-- committed. INSERT is not audited (no prior state to rollback to).
DROP TRIGGER IF EXISTS course_seeds_audit ON course_seeds;
CREATE TRIGGER course_seeds_audit
  AFTER UPDATE OR DELETE ON course_seeds
  FOR EACH ROW EXECUTE FUNCTION audit_content_change();

DROP TRIGGER IF EXISTS course_legos_audit ON course_legos;
CREATE TRIGGER course_legos_audit
  AFTER UPDATE OR DELETE ON course_legos
  FOR EACH ROW EXECUTE FUNCTION audit_content_change();

DROP TRIGGER IF EXISTS course_practice_phrases_audit ON course_practice_phrases;
CREATE TRIGGER course_practice_phrases_audit
  AFTER UPDATE OR DELETE ON course_practice_phrases
  FOR EACH ROW EXECUTE FUNCTION audit_content_change();

DROP TRIGGER IF EXISTS course_audio_audit ON course_audio;
CREATE TRIGGER course_audio_audit
  AFTER UPDATE OR DELETE ON course_audio
  FOR EACH ROW EXECUTE FUNCTION audit_content_change();

DROP TRIGGER IF EXISTS courses_audit ON courses;
CREATE TRIGGER courses_audit
  AFTER UPDATE OR DELETE ON courses
  FOR EACH ROW EXECUTE FUNCTION audit_content_change();

-- ---------------------------------------------------------------------------
-- 4. RLS — admin-only read
-- ---------------------------------------------------------------------------
ALTER TABLE content_audit_log ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "ssi_admin reads content_audit_log" ON content_audit_log;
CREATE POLICY "ssi_admin reads content_audit_log"
  ON content_audit_log FOR SELECT
  USING (public.is_ssi_admin());

-- Writes are trigger-only; revoke direct INSERT/UPDATE/DELETE so nothing
-- can fabricate or tamper with the log itself.
REVOKE ALL ON content_audit_log FROM anon, authenticated;
GRANT SELECT ON content_audit_log TO authenticated;  -- RLS gates by ssi_admin

-- ============================================================================
-- ROLLBACK PATTERNS — paste into SQL editor when fixing a corruption
-- ============================================================================
-- All examples assume you know roughly when the bad change ran. Find it via:
--   SELECT changed_at, change_type, primary_key, old_row->>'known_text' AS known_text
--   FROM content_audit_log
--   WHERE table_name = 'course_legos'
--     AND changed_at > NOW() - INTERVAL '24 hours'
--   ORDER BY changed_at DESC LIMIT 100;
--
-- ----------------------------------------------------------------------------
-- A. Restore one column on rows changed in a window
-- ----------------------------------------------------------------------------
-- Example: a bulk update wiped course_legos.known_text between 13:00 and 14:00.
-- Restore each affected lego's known_text to its most recent value BEFORE 13:00.
--
-- WITH last_good AS (
--   SELECT DISTINCT ON (primary_key)
--     primary_key,
--     old_row->>'known_text' AS known_text
--   FROM content_audit_log
--   WHERE table_name = 'course_legos'
--     AND changed_at < '2026-05-10 13:00:00+00'
--   ORDER BY primary_key, changed_at DESC
-- )
-- UPDATE course_legos cl
-- SET known_text = lg.known_text
-- FROM last_good lg
-- WHERE cl.id::text = lg.primary_key
--   AND cl.known_text IS DISTINCT FROM lg.known_text;
--
-- ----------------------------------------------------------------------------
-- B. Restore deleted rows
-- ----------------------------------------------------------------------------
-- INSERT INTO course_legos
-- SELECT (jsonb_populate_record(NULL::course_legos, audit.old_row)).*
-- FROM content_audit_log audit
-- WHERE audit.table_name = 'course_legos'
--   AND audit.change_type = 'DELETE'
--   AND audit.changed_at BETWEEN '2026-05-10 13:00' AND '2026-05-10 14:00';
--
-- ----------------------------------------------------------------------------
-- C. Inspect what one specific row looked like at a past point
-- ----------------------------------------------------------------------------
-- SELECT changed_at, change_type, old_row
-- FROM content_audit_log
-- WHERE table_name = 'course_legos'
--   AND primary_key = '<the lego id>'
-- ORDER BY changed_at DESC LIMIT 10;
--
-- ----------------------------------------------------------------------------
-- D. Manual cleanup — run weekly so the table doesn't grow indefinitely
-- ----------------------------------------------------------------------------
-- DELETE FROM content_audit_log
-- WHERE changed_at < NOW() - INTERVAL '3 days';
-- ============================================================================
