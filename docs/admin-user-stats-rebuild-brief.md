# Brief: rebuild the admin per-user stats on real telemetry

*Written 2026-06-16. Context: the SSi Admin → Users → per-user course cards show all
zeros (0 seeds touched / legos seen / mastered / L1 fires, "Practice <1m") for users
who are clearly deep into a course (brown belt, position `S0300L02`). Diagnosis below.
The fix needs DB access (a migration), so this is the desktop to-do.*

---

## TL;DR

The per-user admin cards read **boutique tables that a normal speaking learner never
fills**. The position/belt and last-active survive (ratchet + speaking-opportunities);
everything else reads zero. The real signal — every audio play, with `seedId`/`legoId`
— is in `player_events.audio_play` and is keyed by the **learner PK**. The platform
Analytics already work because they read `player_events` via SECURITY DEFINER RPCs.
**Do the same, scoped to one learner.**

Already shipped (client-side, no DB): fixed the `player_events` keying bug in
`useAdminUserDetail.ts` (was filtering by auth uid; column holds the learner PK).

---

## Root cause, tile by tile

File: `packages/player-vue/src/composables/admin/useAdminUserDetail.ts`
View: `packages/player-vue/src/views/admin/AdminUserDetail.vue`

| Tile | Current source | Why it's 0 / wrong |
|---|---|---|
| Belt + position `S0300L02` | `course_enrollments.highest_completed_lego_id` (ratchet) | ✅ works |
| Last active | `learner_speaking_opportunities` | ✅ works |
| **Seeds touched** | `learner_l1_state` row count | Written **only in Layer-1 *listening* mode** (`LearningPlayer.vue:1434`). Speaking-only learner → 0 rows. |
| **L1 fires** | `learner_l1_state.fire_count` sum | same table, same reason |
| **Legos seen** | `learner_lego_metrics` row count | Written **only when VAD detects pause latency** (`LearningPlayer.vue:1511`). Absent VAD → 0. |
| **Mastered** | `learner_lego_metrics.mastery_state` | same table. **Per Tom: leave until the full VAD engine is wired** — don't proxy it. |
| **Practice "<1m"** | `course_enrollments.total_practice_minutes` | Written by a legacy round-based path that doesn't fire under SimplePlayer. Impossible "<1m at seed 300". |

Keying note (the trap): `player_events.user_id` and every `learner_id` column hold
the **learner PK** (`learners.id`), not the auth uid. `learners.user_id` IS the auth
uid. Mixing them returns empty silently. (CLAUDE.md "Canonical RLS / auth pattern".)

---

## The reliable sources

1. **`player_events` (event_type `audio_play`)** — THE firehose. Fires on every played
   phase (~3/cycle) at `LearningPlayer.vue:1467`, payload:
   `{ url, role, cycleId, cycleType, legoId, seedId, playbackSpeed, cacheHit }`.
   Keyed by `user_id` = learner PK. Best-effort (buffered, dropped on network failure,
   `MAX_BUFFER` cap) — fine for aggregates. From this, per learner per course:
   - seeds touched = `COUNT(DISTINCT seedId)`
   - legos seen = `COUNT(DISTINCT legoId)`
   - plays / cycles = `COUNT(*)` / `COUNT(DISTINCT cycleId)`
   - reps-per-lego (future mastery proxy) = group by `legoId`
   - recency = `MAX(occurred_at)`
2. **`learner_speaking_opportunities`** — bumped every cycle boundary via
   `bump_speaking_opportunities` RPC (`useLearningSession.ts:76`). One row per
   (learner, course, day): `opportunities` (cycles), `play_seconds` (real practice
   time). Canonical for minutes / active-days. Keyed by learner PK.
3. **`course_enrollments`** — `highest_completed_lego_id` ratchet (belt/position). ✅

---

## Proposed work (at the desktop, needs DB)

### 1. New SECURITY DEFINER RPC: `admin_user_course_stats(p_learner_id uuid)`
Mirror the existing analytics RPC pattern (`supabase/migrations/20260602_analytics_health_rpc.sql`,
`..._friction_extended.sql`). SECURITY DEFINER so an ssi_admin can read any learner's
aggregates regardless of own-row RLS (this is also why the current client-side
`player_events` read may return nothing even after the keying fix). Returns one row per
course:
```
course_code,
seeds_touched      := count(distinct payload->>'seedId') from player_events
                      where user_id = p_learner_id and event_type = 'audio_play',
legos_seen         := count(distinct payload->>'legoId') ...,
total_plays        := count(*) ...,
cycles             := count(distinct payload->>'cycleId') ...,
active_minutes     := (select sum(play_seconds)/60 from learner_speaking_opportunities
                       where learner_id = p_learner_id group by course_code),
active_days        := count(distinct day) from learner_speaking_opportunities ...,
last_active        := max(occurred_at) ...
```
**Full copy-paste migration is at the end of this doc** (`## Migration SQL`). It gates
inside the function on `is_ssi_admin() OR is_god_user()` — the exact union the client's
`canAccessAdmin` enforces (`platform_role='ssi_admin'` OR `educational_role='god'`,
verified in `useUserRole.ts`), so anyone who can open the admin page can call it. The
admin calls it directly via the authed Supabase client with their own JWT — no separate
`/api/admin` endpoint needed, though you can still wrap it if you prefer. Remember
`NOTIFY pgrst, 'reload schema';` (included).

### 2. Rewire `useAdminUserDetail.ts`
Replace the `learner_l1_state` / `learner_lego_metrics` read for the general tiles with
the RPC result. Keep `learner_lego_metrics` **only** for the VAD-fed tiles (Legos seen
detail / Mastered), which stay dormant until the VAD engine lands.

### 3. Fix the "Practice" minutes now-ish
Per-course practice should come from `learner_speaking_opportunities.play_seconds`
(already loaded into `sessions`), not `course_enrollments.total_practice_minutes`.
This one is doable client-side without the RPC — left out of the immediate fix only
because it's a UI change worth eyeballing against real data.

### 4. Tile set
- Keep: Belt/position, Last active.
- Fix to firehose: **Seeds touched**, **Legos seen**, add **Cycles** and **Active days**,
  real **Practice minutes**.
- Leave dormant (per Tom): **Mastered** — wire when the full VAD engine is in.

---

## Diagnostic SQL to run first (confirm the live picture)

```sql
-- Is the firehose actually populated, and with seed/lego payload?
select count(*) as audio_play_rows,
       count(distinct user_id) as learners,
       count(*) filter (where payload ? 'seedId') as with_seed,
       count(*) filter (where payload ? 'legoId') as with_lego
from player_events where event_type = 'audio_play';

-- event_type breakdown (how much beyond audio_play?)
select event_type, count(*) from player_events group by 1 order by 2 desc;

-- Pick the brown-belt user (their learners.id) and sanity-check each source:
select count(*) from player_events where user_id = '<LEARNER_PK>' and event_type='audio_play';
select * from learner_speaking_opportunities where learner_id = '<LEARNER_PK>' order by day desc limit 10;
select count(*) from learner_l1_state where learner_id = '<LEARNER_PK>';
select count(*) from learner_lego_metrics where learner_id = '<LEARNER_PK>';
select highest_completed_lego_id, total_practice_minutes, last_practiced_at
  from course_enrollments where learner_id = '<LEARNER_PK>';

-- Confirm the keying fact (PK vs auth uid) on a sample:
select pe.user_id,
       exists(select 1 from learners l where l.id = pe.user_id) as matches_pk,
       exists(select 1 from learners l where l.user_id = pe.user_id::text) as matches_authuid
from player_events pe where pe.event_type='audio_play' order by pe.occurred_at desc limit 20;
```

If `audio_play` rows are plentiful and carry `seedId`/`legoId`, the RPC rebuild is a
straight win. If `with_seed`/`with_lego` is low, check that older clients emitted those
payload keys (they were added alongside the Cycle refactor).

---

## Bonus lane: behavioural-navigation metrics (the buttons ARE the data)

`player_events` already logs the interaction vocabulary — and the skip events carry a
`direction`, so "forward vs back vs replay" is computable from existing data:

| event_type | direction values | signal |
|---|---|---|
| `tap_skip` | `forward` / `back` | forward = confident move-on; back = regress/revisit (instrumented 2026-06-16 — `handleSkip` + `handleRevisit`) |
| `lego_skip` | `forward` / `back` | jump a whole LEGO fwd/back |
| `phase_skip` | `forward` / `back` / `replay` | within-cycle nav; **`replay` = repeat / consolidation** |
| `belt_skip` | `forward` / `back` / `restart` | belt-level jumps |
| `turbo_toggle` | (speed in payload) | speeding up ≈ confidence / ease |
| `tap_pause` / `tap_play` | — | hesitation / drop-off points |

**The lens (Tom's idea):** per-learner and per-seed navigation profile —
- **forward skips / turbo** → confidence (caveat: could also be *boredom / too easy* — needs pairing with completion to disambiguate),
- **back skips + `phase_skip:replay`** → struggle / revisiting → a *reliable behavioural friction map*,
- ratio of forward:back over a window → a single "flow" score per learner.

Why this matters: the current **Friction** insight reads `0.0% spike` — it's built on the
VAD/spike path (the same unreliable source as the dead admin tiles). This behavioural
data is **reliable and currently has no consumer**. Per CLAUDE.md Principle 5 ("never
build a signal before its consumer exists") this is the inverse case — the *signal*
already exists, so building the consumer is justified.

**Build:** fold into the same per-learner RPC (counts of each event_type × direction
over a window), and/or a per-seed aggregate RPC for the friction map. Same SECURITY
DEFINER pattern. Cheap — it's all `group by` over rows we already write.

---

## Migration SQL

Save as e.g. `supabase/migrations/20260616_admin_user_stats_rpcs.sql`, apply, done.
All three are `SECURITY DEFINER`, `search_path`-pinned, and gated on
`is_ssi_admin() OR is_god_user()` — the union the admin page's `canAccessAdmin` already
enforces (`platform_role='ssi_admin'` OR `educational_role='god'`). NB the existing
`analytics_*` RPCs gate on `is_god_user()` alone, so they're effectively god-only — if
you want those reachable by every ssi_admin too, widen them the same way. Schema facts
they rely on:
`player_events.user_id` = learner PK; `audio_play.payload` carries `seedId`/`legoId`;
skip events carry `direction` (+ `legoId` on `tap_skip`/`lego_skip`);
`learner_speaking_opportunities` is keyed by learner PK; `course_enrollments.course_id`
holds the course-code string.

```sql
-- ============================================================================
-- Admin per-user stats + behavioural navigation, all over player_events.
-- ============================================================================

-- 1) Per-course progress for one learner (the admin Users → cards).
CREATE OR REPLACE FUNCTION admin_user_course_stats(p_learner_id uuid)
RETURNS TABLE (
  course_code               text,
  seeds_touched             bigint,   -- distinct seedId from audio_play
  legos_seen                bigint,   -- distinct legoId from audio_play
  total_plays               bigint,   -- audio_play rows (~3/cycle)
  cycles                    bigint,   -- speaking_opportunities.opportunities
  active_minutes            bigint,   -- speaking_opportunities.play_seconds / 60
  active_days               bigint,   -- distinct days practised
  highest_completed_lego_id text,     -- ratchet (belt/position)
  last_active               timestamptz
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
BEGIN
  -- Gate = the client's canAccessAdmin: platform_role='ssi_admin' OR
  -- educational_role='god'. (is_god_user alone — as the analytics_* RPCs use —
  -- would 403 an ssi_admin who isn't god; is_ssi_admin alone would 403 a
  -- god-only admin. The page admits either, so the RPC must too.)
  IF NOT (is_ssi_admin() OR is_god_user()) THEN
    RAISE EXCEPTION 'Forbidden: admin required';
  END IF;

  RETURN QUERY
  WITH plays AS (
    SELECT pe.course_code,
           COUNT(DISTINCT pe.payload->>'seedId') AS seeds_touched,
           COUNT(DISTINCT pe.payload->>'legoId') AS legos_seen,
           COUNT(*)                              AS total_plays,
           MAX(pe.occurred_at)                   AS last_play
    FROM player_events pe
    WHERE pe.user_id = p_learner_id
      AND pe.event_type = 'audio_play'
      AND pe.course_code IS NOT NULL
    GROUP BY pe.course_code
  ),
  opps AS (
    SELECT lso.course_code,
           SUM(lso.opportunities)  AS cycles,
           SUM(lso.play_seconds)/60 AS active_minutes,
           COUNT(DISTINCT lso.day) AS active_days,
           MAX(lso.day)            AS last_day
    FROM learner_speaking_opportunities lso
    WHERE lso.learner_id = p_learner_id
    GROUP BY lso.course_code
  ),
  enr AS (
    SELECT ce.course_id AS course_code,
           ce.highest_completed_lego_id,
           ce.last_practiced_at
    FROM course_enrollments ce
    WHERE ce.learner_id = p_learner_id
  ),
  keys AS (
    SELECT course_code FROM plays
    UNION SELECT course_code FROM opps
    UNION SELECT course_code FROM enr
  )
  SELECT k.course_code,
         COALESCE(p.seeds_touched, 0),
         COALESCE(p.legos_seen, 0),
         COALESCE(p.total_plays, 0),
         COALESCE(o.cycles, 0),
         COALESCE(o.active_minutes, 0),
         COALESCE(o.active_days, 0),
         e.highest_completed_lego_id,
         GREATEST(p.last_play, e.last_practiced_at, (o.last_day + 1)::timestamptz)
  FROM keys k
  LEFT JOIN plays p ON p.course_code = k.course_code
  LEFT JOIN opps  o ON o.course_code = k.course_code
  LEFT JOIN enr   e ON e.course_code = k.course_code
  ORDER BY GREATEST(
    COALESCE(p.last_play, 'epoch'::timestamptz),
    COALESCE(e.last_practiced_at, 'epoch'::timestamptz)
  ) DESC;
END;
$function$;

-- 2) Behavioural navigation profile for one learner (forward/back/replay).
--    flow_score = forward / (forward + back) in [0,1]; higher = more confident flow.
CREATE OR REPLACE FUNCTION admin_user_navigation(p_learner_id uuid, p_days int DEFAULT 90)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_since timestamptz := now() - (p_days || ' days')::interval;
  v_fwd bigint; v_back bigint; v_replay bigint;
  v_turbo bigint; v_pause bigint; v_play bigint;
  v_skip_events text[] := ARRAY['tap_skip','lego_skip','phase_skip','belt_skip'];
BEGIN
  -- Gate = the client's canAccessAdmin: platform_role='ssi_admin' OR
  -- educational_role='god'. (is_god_user alone — as the analytics_* RPCs use —
  -- would 403 an ssi_admin who isn't god; is_ssi_admin alone would 403 a
  -- god-only admin. The page admits either, so the RPC must too.)
  IF NOT (is_ssi_admin() OR is_god_user()) THEN
    RAISE EXCEPTION 'Forbidden: admin required';
  END IF;

  SELECT
    COUNT(*) FILTER (WHERE event_type = ANY(v_skip_events) AND payload->>'direction' = 'forward'),
    COUNT(*) FILTER (WHERE event_type = ANY(v_skip_events) AND payload->>'direction' = 'back'),
    COUNT(*) FILTER (WHERE event_type = 'phase_skip'     AND payload->>'direction' = 'replay'),
    COUNT(*) FILTER (WHERE event_type = 'turbo_toggle'),
    COUNT(*) FILTER (WHERE event_type = 'tap_pause'),
    COUNT(*) FILTER (WHERE event_type = 'tap_play')
  INTO v_fwd, v_back, v_replay, v_turbo, v_pause, v_play
  FROM player_events
  WHERE user_id = p_learner_id
    AND occurred_at >= v_since;

  RETURN jsonb_build_object(
    'forward', v_fwd, 'back', v_back, 'replay', v_replay,
    'turbo', v_turbo, 'pause', v_pause, 'play', v_play,
    'flow_score', CASE WHEN (v_fwd + v_back) > 0
                       THEN round(v_fwd::numeric / (v_fwd + v_back), 3)
                       ELSE NULL END
  );
END;
$function$;

-- 3) Per-seed behavioural friction map for a course (all learners).
--    seed parsed from the skip event's legoId ('S0024L03' -> 'S0024').
--    Rows without legoId (e.g. some phase_skips) are excluded — safe.
CREATE OR REPLACE FUNCTION course_navigation_friction(p_course_code text, p_days int DEFAULT 90)
RETURNS TABLE (
  seed           text,
  back           bigint,
  replay         bigint,
  forward        bigint,
  friction_ratio numeric  -- (back + replay) / forward; higher = stickier seed
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
BEGIN
  -- Gate = the client's canAccessAdmin: platform_role='ssi_admin' OR
  -- educational_role='god'. (is_god_user alone — as the analytics_* RPCs use —
  -- would 403 an ssi_admin who isn't god; is_ssi_admin alone would 403 a
  -- god-only admin. The page admits either, so the RPC must too.)
  IF NOT (is_ssi_admin() OR is_god_user()) THEN
    RAISE EXCEPTION 'Forbidden: admin required';
  END IF;

  RETURN QUERY
  WITH nav AS (
    SELECT substring(payload->>'legoId' FROM '^(S[0-9]+)') AS seed,
           payload->>'direction' AS dir
    FROM player_events
    WHERE course_code = p_course_code
      AND occurred_at >= now() - (p_days || ' days')::interval
      AND event_type IN ('tap_skip','lego_skip','phase_skip','belt_skip')
      AND payload->>'legoId' IS NOT NULL
  )
  SELECT nav.seed,
         COUNT(*) FILTER (WHERE dir = 'back')   AS back,
         COUNT(*) FILTER (WHERE dir = 'replay') AS replay,
         COUNT(*) FILTER (WHERE dir = 'forward') AS forward,
         CASE WHEN COUNT(*) FILTER (WHERE dir = 'forward') > 0
              THEN round(
                (COUNT(*) FILTER (WHERE dir IN ('back','replay')))::numeric
                / COUNT(*) FILTER (WHERE dir = 'forward'), 3)
              ELSE NULL END                     AS friction_ratio
  FROM nav
  WHERE nav.seed IS NOT NULL
  GROUP BY nav.seed
  ORDER BY (COUNT(*) FILTER (WHERE dir = 'back')
            + COUNT(*) FILTER (WHERE dir = 'replay')) DESC;
END;
$function$;

-- PostgREST: expose the new functions.
NOTIFY pgrst, 'reload schema';
```

### Calling from the client (replaces the dead boutique-table reads)

```ts
// per-user cards — drop the learner_l1_state / learner_lego_metrics reads
const { data: courseStats } = await client.rpc('admin_user_course_stats', {
  p_learner_id: learnerId,                 // the learner PK, NOT auth uid
})
// behavioural profile
const { data: nav } = await client.rpc('admin_user_navigation', {
  p_learner_id: learnerId, p_days: 90,
})
// course friction map (new Friction view — reliable, unlike the VAD/spike one)
const { data: friction } = await client.rpc('course_navigation_friction', {
  p_course_code: 'spa_for_eng_v2', p_days: 90,
})
```

### Verify after applying

```sql
SELECT * FROM admin_user_course_stats('<LEARNER_PK>');
SELECT admin_user_navigation('<LEARNER_PK>', 90);
SELECT * FROM course_navigation_friction('<COURSE_CODE>', 90) LIMIT 20;
```

If `admin_user_course_stats` returns the right belt/position with non-zero
seeds/legos/cycles/minutes for the brown-belt user, the rebuild is good — wire the
view to it and retire the `learner_l1_state` / `learner_lego_metrics` reads (keep the
latter only for the VAD-fed Mastered tile when that lands).
