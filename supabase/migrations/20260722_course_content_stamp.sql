-- 20260722_course_content_stamp.sql
-- Structural cache freshness: courses.content_stamp is a per-course
-- "learner-visible content last changed" timestamp maintained by DB triggers,
-- so no human ever has to remember to bump a version for a content fix.
--
-- The app fetches it in the one tiny courses query it already makes on boot
-- (checkContentVersion) and compares it against the stamp recorded on each
-- device cache entry (script cache, listening metadata cache). Mismatch while
-- online → background refresh. Offline devices never invalidate (a stale
-- cache offline is correct behaviour).
--
-- Deliberately a NEW column, not a reuse of:
--   * courses.version (int) — that is the decomposition-staleness key
--     (decomposition_course_version < courses.version) and DELIBERATELY
--     excludes audio; entangling it risks dashboard regressions.
--   * courses.content_version (semver) — hand-bumped editorial releases;
--     stays as the "audio regenerated, clear everything" escape hatch.
--
-- Applied live (shared DB) 2026-07-22.

BEGIN;

ALTER TABLE courses
  ADD COLUMN IF NOT EXISTS content_stamp timestamptz NOT NULL DEFAULT now();

CREATE OR REPLACE FUNCTION touch_course_content_stamp() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_course text;
BEGIN
  IF TG_TABLE_NAME = 'listening_pod_sentences' THEN
    -- pod_id is '<course_code>:pod-<n>'
    IF TG_OP = 'DELETE' THEN v_course := split_part(OLD.pod_id, ':', 1);
    ELSE v_course := split_part(NEW.pod_id, ':', 1); END IF;
  ELSE
    IF TG_OP = 'DELETE' THEN v_course := OLD.course_code;
    ELSE v_course := NEW.course_code; END IF;
  END IF;
  IF v_course IS NOT NULL AND v_course <> '' THEN
    -- Debounce: now() is constant within a transaction, so only the first
    -- row of a bulk write actually updates the courses row; every later row
    -- in the same transaction is a no-op match (no row churn, no bloat).
    UPDATE courses SET content_stamp = now()
    WHERE course_code = v_course AND content_stamp IS DISTINCT FROM now();
  END IF;
  RETURN NULL; -- AFTER trigger, return value ignored
EXCEPTION WHEN OTHERS THEN
  -- Freshness stamping must NEVER break a content write.
  RETURN NULL;
END $$;

DROP TRIGGER IF EXISTS course_seeds_touch_content_stamp ON course_seeds;
CREATE TRIGGER course_seeds_touch_content_stamp
  AFTER INSERT OR UPDATE OR DELETE ON course_seeds
  FOR EACH ROW EXECUTE FUNCTION touch_course_content_stamp();

DROP TRIGGER IF EXISTS course_legos_touch_content_stamp ON course_legos;
CREATE TRIGGER course_legos_touch_content_stamp
  AFTER INSERT OR UPDATE OR DELETE ON course_legos
  FOR EACH ROW EXECUTE FUNCTION touch_course_content_stamp();

DROP TRIGGER IF EXISTS course_practice_phrases_touch_content_stamp ON course_practice_phrases;
CREATE TRIGGER course_practice_phrases_touch_content_stamp
  AFTER INSERT OR UPDATE OR DELETE ON course_practice_phrases
  FOR EACH ROW EXECUTE FUNCTION touch_course_content_stamp();

DROP TRIGGER IF EXISTS course_audio_touch_content_stamp ON course_audio;
CREATE TRIGGER course_audio_touch_content_stamp
  AFTER INSERT OR UPDATE OR DELETE ON course_audio
  FOR EACH ROW EXECUTE FUNCTION touch_course_content_stamp();

DROP TRIGGER IF EXISTS listening_pod_sentences_touch_content_stamp ON listening_pod_sentences;
CREATE TRIGGER listening_pod_sentences_touch_content_stamp
  AFTER INSERT OR UPDATE OR DELETE ON listening_pod_sentences
  FOR EACH ROW EXECUTE FUNCTION touch_course_content_stamp();

DROP TRIGGER IF EXISTS lego_introductions_touch_content_stamp ON lego_introductions;
CREATE TRIGGER lego_introductions_touch_content_stamp
  AFTER INSERT OR UPDATE OR DELETE ON lego_introductions
  FOR EACH ROW EXECUTE FUNCTION touch_course_content_stamp();

NOTIFY pgrst, 'reload schema';

COMMIT;
