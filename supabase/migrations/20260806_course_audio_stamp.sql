-- 20260806_course_audio_stamp.sql
-- Per-clip versioned audio URLs, the last mile: courses.audio_stamp is a
-- per-course "a clip's BYTES changed" timestamp, maintained by a DB trigger on
-- course_audio.
--
-- Why this exists. The app hands the player `<uuid>.vN` for a replaced clip, so
-- a repaired clip gets its own URL and its own AudioCache key. That fixes the
-- caches — but only for a client that actually re-fetches the content. A client
-- holding a script cached BEFORE the repair keeps replaying the bare `<uuid>`
-- it cached, and hears the damaged clip indefinitely. Observed live on staging
-- 2026-08-06: a device that cached the course two minutes before the deploy
-- played nine repaired German clips at their old revision, every request a
-- cache hit, no error anywhere.
--
-- Deliberately a THIRD stamp, not a reuse of:
--   * content_stamp — trigger-maintained, but its contract is
--     stale-while-revalidate with audio caches explicitly left alone, on the
--     assumption that "audio is content-addressed by id, so text fixes never
--     require re-clearing it". A repair breaks that assumption: the id is
--     stable and the BYTES change. SWR is also the wrong remedy here — it
--     plays the damaged clip for one more session, and "damaged" is precisely
--     what we declared it.
--   * content_version — the hand-bumped "clear everything" escape hatch. Too
--     blunt: it nukes the audio store estate-wide for one repaired clip.
--
-- The remedy this enables is cheap precisely BECAUSE audio is per-clip
-- versioned now: the client drops only its SCRIPT cache (a small JSON refetch)
-- and re-downloads audio for the changed clips alone, because only their refs
-- moved. Before versioned URLs this would have meant re-downloading a course.
--
-- Fires on UPDATE only, and only when the bytes behind a clip actually move
-- (audio_revision or s3_key). An INSERT is a new clip nobody has cached, and
-- relinking a lego/phrase to it already moves content_stamp via that table's
-- own trigger.

BEGIN;

ALTER TABLE courses
  ADD COLUMN IF NOT EXISTS audio_stamp timestamptz NOT NULL DEFAULT now();

CREATE OR REPLACE FUNCTION touch_course_audio_stamp() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  IF NEW.course_code IS NOT NULL AND NEW.course_code <> '' THEN
    -- Debounce: now() is constant within a transaction, so a bulk repair of
    -- 95 clips updates the courses row once, not 95 times.
    UPDATE courses SET audio_stamp = now()
    WHERE course_code = NEW.course_code AND audio_stamp IS DISTINCT FROM now();
  END IF;
  RETURN NULL; -- AFTER trigger, return value ignored
EXCEPTION WHEN OTHERS THEN
  -- Freshness stamping must NEVER break an audio write. A missed stamp costs
  -- one stale session; a failed swap costs the make-before-break guarantee.
  RETURN NULL;
END $$;

DROP TRIGGER IF EXISTS course_audio_touch_audio_stamp ON course_audio;
CREATE TRIGGER course_audio_touch_audio_stamp
  AFTER UPDATE OF audio_revision, s3_key ON course_audio
  FOR EACH ROW
  WHEN (
    OLD.audio_revision IS DISTINCT FROM NEW.audio_revision
    OR OLD.s3_key IS DISTINCT FROM NEW.s3_key
  )
  EXECUTE FUNCTION touch_course_audio_stamp();

COMMIT;
