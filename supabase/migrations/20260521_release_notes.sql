-- ============================================================================
-- release_notes — admin-authored "What's new" entries shown in Settings
-- ============================================================================
-- One row per release (typically a main-merge). Admins curate 3–5 plain-string
-- headline bullets per entry; learners see the latest published ones in the
-- Settings screen alongside the existing build hash + timestamp.
--
-- Drafts (is_published = false) are visible to admins only; once toggled to
-- published, anyone (anon + authenticated) can read them. Writes are gated to
-- ssi_admin via the existing public.is_ssi_admin() helper.
--
-- Service role bypasses RLS as usual (for any scripted seeding).
--
-- Rollback: at bottom.
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.release_notes (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  version      text NOT NULL,                          -- date-style "2026-05-21" by convention
  released_at  timestamptz NOT NULL DEFAULT now(),     -- when the entry is for (user-visible date)
  headline     text,                                   -- optional one-line summary
  bullets      text[] NOT NULL DEFAULT '{}',           -- 3–5 plain-string headline changes
  is_published boolean NOT NULL DEFAULT false,
  created_at   timestamptz NOT NULL DEFAULT now(),
  created_by   uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  updated_at   timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS release_notes_released_at_idx
  ON public.release_notes (released_at DESC);

CREATE INDEX IF NOT EXISTS release_notes_published_released_at_idx
  ON public.release_notes (is_published, released_at DESC);

-- Auto-bump updated_at on every UPDATE.
CREATE OR REPLACE FUNCTION public.tg_release_notes_touch_updated_at()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS release_notes_touch_updated_at ON public.release_notes;
CREATE TRIGGER release_notes_touch_updated_at
  BEFORE UPDATE ON public.release_notes
  FOR EACH ROW
  EXECUTE FUNCTION public.tg_release_notes_touch_updated_at();

ALTER TABLE public.release_notes ENABLE ROW LEVEL SECURITY;

-- Published rows: anyone can read. Drafts: admin only.
CREATE POLICY "release_notes_select_published_or_admin"
  ON public.release_notes FOR SELECT
  USING (is_published OR public.is_ssi_admin());

CREATE POLICY "release_notes_insert_admin"
  ON public.release_notes FOR INSERT
  WITH CHECK (public.is_ssi_admin());

CREATE POLICY "release_notes_update_admin"
  ON public.release_notes FOR UPDATE
  USING (public.is_ssi_admin())
  WITH CHECK (public.is_ssi_admin());

CREATE POLICY "release_notes_delete_admin"
  ON public.release_notes FOR DELETE
  USING (public.is_ssi_admin());

NOTIFY pgrst, 'reload schema';

-- ============================================================================
-- ROLLBACK (paste these lines into the SQL editor if anything breaks):
-- ============================================================================
-- ALTER TABLE public.release_notes DISABLE ROW LEVEL SECURITY;
-- DROP POLICY IF EXISTS "release_notes_select_published_or_admin" ON public.release_notes;
-- DROP POLICY IF EXISTS "release_notes_insert_admin" ON public.release_notes;
-- DROP POLICY IF EXISTS "release_notes_update_admin" ON public.release_notes;
-- DROP POLICY IF EXISTS "release_notes_delete_admin" ON public.release_notes;
-- DROP TRIGGER IF EXISTS release_notes_touch_updated_at ON public.release_notes;
-- DROP FUNCTION IF EXISTS public.tg_release_notes_touch_updated_at();
-- DROP TABLE IF EXISTS public.release_notes;
-- NOTIFY pgrst, 'reload schema';
