-- ============================================================================
-- Collapse the god / ssi_admin asymmetry at its source.
--
-- THE BUG (latent tech debt): the client treats god as implying ssi_admin --
--   useUserRole.ts:38  isSsiAdmin = platformRole === 'ssi_admin' || isGod
-- -- but the DATABASE did not: is_ssi_admin() checked ONLY
-- platform_role = 'ssi_admin' and ignored educational_role = 'god'. So a
-- god-only learner (educational_role='god', platform_role NULL) passes every
-- client-side admin gate, then is silently rejected by every RLS policy /
-- SECURITY DEFINER function gated on is_ssi_admin() (player_events reads,
-- payments, entitlement_codes, courses, audio_plays, content audit, release
-- notes...). It has not bitten because Tom/Aran happen to hold BOTH roles --
-- but it is a real trap and the kind of silent-empty failure the admin-stats
-- rebuild brief exists to kill.
--
-- THE FIX: god is the TOP of the role hierarchy (god > ssi_admin > govt_admin >
-- school_admin > teacher > student), so a god user IS an ssi_admin by
-- definition. Make is_ssi_admin() reflect that. is_god_user() stays STRICT
-- (god is the narrower, higher privilege; not every admin is a god). This makes
-- the DB == the client's `ssi_admin || god`, everywhere, in one place.
--
-- Safe by construction: strictly MORE permissive, and only for god users (the
-- highest role, held only by us). Changes nothing for anyone who already holds
-- platform_role='ssi_admin'.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.is_ssi_admin() RETURNS boolean
  LANGUAGE sql SECURITY DEFINER STABLE
  SET search_path = public, pg_temp
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.learners
    WHERE user_id = (auth.uid()::text)
    AND (platform_role = 'ssi_admin' OR educational_role = 'god')
  );
$$;

NOTIFY pgrst, 'reload schema';
