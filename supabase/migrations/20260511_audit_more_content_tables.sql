-- ============================================================================
-- Extend content audit log to 7 more at-risk content tables
-- ============================================================================
-- Builds on 20260510_content_audit_history.sql. Adds triggers to the tables
-- that an agent could plausibly corrupt:
--
--   canonical_seeds                — master seed list shared across courses
--   canonical_seed_translations    — translations of canonical seeds
--   listening_pod_sentences        — pod content (actively authored)
--   listening_pods                 — pod metadata / configuration
--   lego_introductions             — LEGO intro phrases
--   voices                         — voice configuration
--   shared_audio                   — shared audio mappings
--
-- Also extends the audit_content_change() trigger function to recognise
-- `voice_id` as a primary key (the `voices` table uses it instead of `id`).
-- All other new tables use `id`, already covered.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. Update trigger function — add voice_id to the PK extraction list
-- ---------------------------------------------------------------------------
-- CREATE OR REPLACE preserves the existing triggers attached to this function;
-- they all start writing the new PK key on their next fire.
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
    old_json->>'seed_id',
    old_json->>'voice_id'
  );

  INSERT INTO content_audit_log (
    table_name, change_type, primary_key, old_row, changed_by_uid
  ) VALUES (
    TG_TABLE_NAME,
    TG_OP,
    pk_val,
    old_json,
    auth.uid()
  );

  RETURN NULL;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

-- ---------------------------------------------------------------------------
-- 2. Attach triggers to the 7 new tables
-- ---------------------------------------------------------------------------
DROP TRIGGER IF EXISTS canonical_seeds_audit ON canonical_seeds;
CREATE TRIGGER canonical_seeds_audit
  AFTER UPDATE OR DELETE ON canonical_seeds
  FOR EACH ROW EXECUTE FUNCTION audit_content_change();

DROP TRIGGER IF EXISTS canonical_seed_translations_audit ON canonical_seed_translations;
CREATE TRIGGER canonical_seed_translations_audit
  AFTER UPDATE OR DELETE ON canonical_seed_translations
  FOR EACH ROW EXECUTE FUNCTION audit_content_change();

DROP TRIGGER IF EXISTS listening_pod_sentences_audit ON listening_pod_sentences;
CREATE TRIGGER listening_pod_sentences_audit
  AFTER UPDATE OR DELETE ON listening_pod_sentences
  FOR EACH ROW EXECUTE FUNCTION audit_content_change();

DROP TRIGGER IF EXISTS listening_pods_audit ON listening_pods;
CREATE TRIGGER listening_pods_audit
  AFTER UPDATE OR DELETE ON listening_pods
  FOR EACH ROW EXECUTE FUNCTION audit_content_change();

DROP TRIGGER IF EXISTS lego_introductions_audit ON lego_introductions;
CREATE TRIGGER lego_introductions_audit
  AFTER UPDATE OR DELETE ON lego_introductions
  FOR EACH ROW EXECUTE FUNCTION audit_content_change();

DROP TRIGGER IF EXISTS voices_audit ON voices;
CREATE TRIGGER voices_audit
  AFTER UPDATE OR DELETE ON voices
  FOR EACH ROW EXECUTE FUNCTION audit_content_change();

DROP TRIGGER IF EXISTS shared_audio_audit ON shared_audio;
CREATE TRIGGER shared_audio_audit
  AFTER UPDATE OR DELETE ON shared_audio
  FOR EACH ROW EXECUTE FUNCTION audit_content_change();
