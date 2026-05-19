-- Migration: drop audio_plays table
-- Purpose: 2026-05-19 — audio_plays was intended as a per-play analytics
--          log, but SW CacheFirst on /api/audio/* means the proxy only
--          runs on cache MISSES (first play of each unique audio). After
--          that, repeat plays are served from the SW cache and never
--          touch the backend — so audio_plays can't reflect actual
--          listening behaviour. Play-level analytics live in
--          player_events.audio_play (fired client-side on every play),
--          which is genuinely the source of truth.
--
-- The audio proxy at api/audio/[audioId].ts no longer inserts into this
-- table as of the same commit.
--
-- Drops the table with CASCADE so any RLS policies / views / indices
-- attached to it go too.

DROP TABLE IF EXISTS public.audio_plays CASCADE;

NOTIFY pgrst, 'reload schema';
