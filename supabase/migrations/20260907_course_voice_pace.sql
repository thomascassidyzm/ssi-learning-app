-- 20260907_course_voice_pace
--
-- THE PER-COURSE, PER-ROLE VOICE PACE, DERIVED FROM THE RENDERED CLIPS.
--
-- WHY THIS IS A DERIVATION AND NOT A TABLE OF COURSE -> VOICE
-- ----------------------------------------------------------
-- Tom's ruling (2026-08-29, plate S-345) retires the belt ramp and makes
-- playback speed a function of ROLE and MODE, corrected by the pace of the
-- voice the learner is actually hearing. The recurring defect shape on this
-- estate is CASTING AND PACE DISAGREEING: `courses.voice_config` says one
-- voice, the clips in `course_audio` were rendered by another, and the player
-- corrects for a voice that is not speaking.
--
-- The proof that it is not hypothetical, measured on live data 2026-09-07:
-- `deu_at_for_eng` target2 is cast as `human_sasha_wanasky_deu_at` in
-- voice_config, while 13,279 of its 13,808 referenced target2 clips were
-- rendered by `azure_de-AT-JonasNeural`. Keying pace off the config would
-- have corrected for a voice the learner never hears.
--
-- So the key is the RENDERED ARTEFACT: `course_audio.voice_id`. Casting and
-- pace cannot disagree if the pace is read off the clip.
--
-- WHY A FUNCTION RATHER THAN A CLIENT-SIDE TALLY
-- ----------------------------------------------
-- The tally must be restricted to the clips the course actually REFERENCES —
-- `course_audio` carries orphan rows from earlier renders (spa_for_eng: 79,950
-- rows, of which ~15k target1 are referenced and ~1.4k are orphans of a
-- retired casting). That restriction is a join, PostgREST aggregates are
-- disabled on this project (PGRST123, verified 2026-09-07), and paging ~46k
-- rows per course load is not a cost anyone should pay. One STABLE SQL
-- function answers it in one round trip. That is the "one small query per
-- course load, not a query per clip" the brief asks for.
--
-- WHAT IT DELIBERATELY DOES NOT DO
-- --------------------------------
-- It does not normalise voice ids. `azure_es-ES-ElviraNeural` and
-- `es-ES-ElviraNeural` are the same Azure voice under two id shapes, and
-- stripping the `azure_` prefix would more than double measured coverage
-- (105 -> 231 of the 346 distinct rendered target voices, measured
-- 2026-09-07). It is still a GUESS, and on the most exposed surface there is a
-- guess that attributes one engine's measured pace to another engine's clips
-- is worse than admitting we have not looked. An unmatched voice comes back
-- with a null ratio, which the player treats as "never measured" and plays the
-- target number uncorrected — i.e. exactly as it behaves today. The gap is
-- reported in the payload, by voice id, so it is fixable upstream (measure
-- those voices under the ids that appear on clips) rather than papered over
-- here. CONSERVATIVE DEFAULT taken 2026-09-07, flagged for Tom.
--
-- It also does not decide anything. The arithmetic — target pace by role and
-- mode, the correction, the clamp — lives in exactly two places, both of which
-- are the same rule: `services/shared/voice-pace.cjs` (dashboard) and
-- `packages/core/src/script/voicePace.ts` (player). This function ships facts.
--
-- Read-only, additive, no new table. Applied to the live DB 2026-09-07.

CREATE OR REPLACE FUNCTION public.course_voice_pace(p_course_code text)
RETURNS jsonb
LANGUAGE sql
STABLE
PARALLEL SAFE
SET search_path TO 'public'
AS $function$
WITH referenced AS MATERIALIZED (
  -- Every audio id this course's content actually points at. UNION ALL, not
  -- UNION: a clip reused by twenty phrases is twenty clips the learner hears,
  -- and the tally is about what they hear.
  --
  -- MATERIALIZED is load-bearing, not decoration. Inlined, the planner picked a
  -- nested loop and probed `course_audio` once per reference — 52k index probes,
  -- 260k buffers, 9.5s on fra_for_eng. Materialising the CTE and folding
  -- duplicate ids first (`ref` below) lets it hash-join the distinct set:
  -- ~400ms warm on the three largest courses, measured 2026-09-07.
  -- One scan per content table via unnest, rather than six via UNION ALL.
  SELECT unnest(ARRAY[l.known_audio_id, l.target1_audio_id, l.target2_audio_id]) AS id
    FROM course_legos l WHERE l.course_code = p_course_code
  UNION ALL
  SELECT unnest(ARRAY[p.known_audio_id, p.target1_audio_id, p.target2_audio_id])
    FROM course_practice_phrases p WHERE p.course_code = p_course_code
),
ref AS MATERIALIZED (
  SELECT id, count(*)::bigint AS n FROM referenced WHERE id IS NOT NULL GROUP BY id
),
tally AS MATERIALIZED (
  SELECT
    ca.role,
    ca.voice_id,
    sum(ref.n)::bigint AS clips,
    row_number() OVER (PARTITION BY ca.role ORDER BY sum(ref.n) DESC, ca.voice_id) AS rk
  FROM course_audio ca
  JOIN ref ON ref.id = ca.id
  WHERE ca.course_code = p_course_code
    AND ca.voice_id IS NOT NULL
  GROUP BY ca.role, ca.voice_id
),
facts AS MATERIALIZED (
  SELECT
    t.role,
    t.rk,
    t.clips,
    jsonb_build_object(
      'voiceId', t.voice_id,
      'clips', t.clips,
      -- The three numbers the player needs, kept SEPARATE on purpose: the raw
      -- measurement, the human's nudge, and the product. A caller that only
      -- reads `effectivePaceRatio` still sees, in the same object, what it was
      -- made of. NULL means never measured — never 1.0.
      'naturalPaceRatio', v.natural_pace_ratio,
      'naturalPaceNudge', v.natural_pace_nudge,
      'effectivePaceRatio', CASE
        WHEN v.natural_pace_ratio IS NULL OR v.natural_pace_ratio <= 0 THEN NULL
        WHEN v.natural_pace_nudge IS NULL OR v.natural_pace_nudge <= 0 THEN v.natural_pace_ratio
        ELSE v.natural_pace_ratio * v.natural_pace_nudge
      END,
      -- The EXPLICIT never-measured flag the brief asks for. Derived here
      -- rather than left to every caller to infer from a null, because
      -- "unmeasured" is a claim about what we know, not a missing field.
      'measured', (v.natural_pace_ratio IS NOT NULL AND v.natural_pace_ratio > 0),
      'knownVoice', (v.voice_id IS NOT NULL),
      'samples', v.natural_pace_samples,
      'method', v.natural_pace_method,
      'measuredAt', v.natural_pace_measured_at,
      'nudgeNote', v.natural_pace_nudge_note
    ) AS fact
  FROM tally t
  LEFT JOIN voices v ON v.voice_id = t.voice_id
)
SELECT jsonb_build_object(
  'courseCode', p_course_code,
  'derivedFrom', 'course_audio.voice_id over referenced clips',
  'roles', COALESCE((
    SELECT jsonb_object_agg(role, role_obj) FROM (
      SELECT
        f.role,
        jsonb_build_object(
          -- The voice on the most clips for this role. One number per role is
          -- what the player applies, so the payload names which voice it is.
          'primary', (SELECT f2.fact FROM facts f2 WHERE f2.role = f.role AND f2.rk = 1),
          -- Everything else rendered under this role, most clips first, capped
          -- at four. This is how a partial recast becomes VISIBLE rather than
          -- being silently outvoted: if `others` carries a voice with a
          -- materially different pace, somebody should look.
          'others', COALESCE((
            SELECT jsonb_agg(f3.fact ORDER BY f3.clips DESC)
            FROM (SELECT * FROM facts f4 WHERE f4.role = f.role AND f4.rk BETWEEN 2 AND 5) f3
          ), '[]'::jsonb),
          'totalClips', (SELECT sum(f5.clips) FROM facts f5 WHERE f5.role = f.role)
        ) AS role_obj
      FROM facts f
      WHERE f.rk = 1
    ) roles_src
  ), '{}'::jsonb)
);
$function$;

COMMENT ON FUNCTION public.course_voice_pace(text) IS
  'Per-course, per-role natural-pace facts for the voices that ACTUALLY rendered this course''s referenced clips (plate S-345, 2026-08-29). Facts only — the speed rule lives in packages/core/src/script/voicePace.ts and services/shared/voice-pace.cjs. A voice with no `voices` row, or no measurement, comes back measured:false with a null ratio, which callers must treat as "never measured", never as 1.0.';

-- EXECUTE is service_role only: the sole caller is the server-side bundle
-- route, which already runs as service_role. Postgres grants EXECUTE to PUBLIC
-- by default, so the revoke is the actual lockdown (grant-layer posture, per
-- CLAUDE.md's RLS doctrine rule 2 — the grants ship in the same file).
REVOKE ALL ON FUNCTION public.course_voice_pace(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.course_voice_pace(text) TO service_role;

NOTIFY pgrst, 'reload schema';
