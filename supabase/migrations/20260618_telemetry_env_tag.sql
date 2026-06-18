-- ============================================================================
-- player_events: env tag
--
-- The shared DB is used by dev / staging / prod, but player_events has no
-- environment column, so production telemetry can't be isolated. Add a
-- nullable `env` column. Existing rows stay NULL (= 'unknown' environment;
-- they predate this tag and we don't retro-classify).
--
-- The value is set SERVER-SIDE in api/player-events.ts from the request
-- Host/Origin header (one source of truth; can't be spoofed by the client):
--   saysomethingin.app          -> 'production'
--   staging.saysomethingin.app  -> 'staging'
--   anything else               -> 'dev'   (vercel preview alias, localhost)
--
-- No backfill. No NOT NULL constraint (would break the insert path for any
-- old/unset caller and reject historical-shaped rows).
-- ============================================================================

ALTER TABLE public.player_events
  ADD COLUMN IF NOT EXISTS env text;

COMMENT ON COLUMN public.player_events.env IS
  'Deployment environment the event came from, derived server-side from the request host: production | staging | dev. NULL = unknown (rows predating this column).';

-- Analytics filter by env will be common; partial index keeps prod reads cheap.
CREATE INDEX IF NOT EXISTS player_events_env_idx
  ON public.player_events (env);

NOTIFY pgrst, 'reload schema';
