-- Migration: insight_discoveries
-- Purpose: store the nightly Insight Engine "Discovery" deep-run.
--
-- The SSi Machine runs scripts/insight-discovery.cjs once a night: it builds an
-- aggregate digest from real telemetry (school-demo students excluded), asks Claude
-- (subscription CLI) to surface findings, and UPSERTs the result here using the
-- SERVICE ROLE key (which bypasses RLS, so no insert policy is needed).
--
-- The admin UI (/admin/insights → DiscoveryFeed.vue) READS the latest row via the
-- god-gated get_latest_insight_discovery() RPC over the anon admin client.
--
-- result shape: { generated_at, window_days, source, digest jsonb, findings jsonb }.
-- A finding = { widget, frame, title, story, tone, metric, annotate, actions:[{tier,owner,text}] }.

CREATE TABLE IF NOT EXISTS insight_discoveries (
  id           BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  generated_at TIMESTAMPTZ NOT NULL,
  window_days  INT,
  source       TEXT NOT NULL DEFAULT 'real',
  digest       JSONB,
  findings     JSONB NOT NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Latest-row lookups per source are the only read pattern.
CREATE INDEX IF NOT EXISTS idx_insight_discoveries_source_generated
  ON insight_discoveries (source, generated_at DESC);

-- ── RLS: god users may SELECT; the service role bypasses RLS for the insert ──
ALTER TABLE insight_discoveries ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "God users can read insight_discoveries" ON insight_discoveries;
CREATE POLICY "God users can read insight_discoveries"
  ON insight_discoveries FOR SELECT TO authenticated
  USING (is_god_user());

-- ── get_latest_insight_discovery(p_source) — the admin UI's read path ──
-- SECURITY DEFINER + is_god_user() gate (same pattern as the analytics_* RPCs),
-- so it is safe to call from the anon admin client. Returns the single latest
-- row for the requested source.
CREATE OR REPLACE FUNCTION get_latest_insight_discovery(p_source TEXT DEFAULT 'real')
RETURNS SETOF insight_discoveries
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
BEGIN
  IF NOT is_god_user() THEN
    RAISE EXCEPTION 'Forbidden: god mode required';
  END IF;

  RETURN QUERY
  SELECT *
  FROM insight_discoveries
  WHERE source = p_source
  ORDER BY generated_at DESC
  LIMIT 1;
END;
$function$;

-- PostgREST schema reload so the new table + RPC are immediately callable.
NOTIFY pgrst, 'reload schema';
