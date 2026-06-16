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
Restrict EXECUTE to `service_role` and call it from an `/api/admin/...` endpoint with
`verifyAdmin` (same pattern as `api/entitlement/grant.ts`), OR grant to authenticated
and gate inside the function on an ssi_admin check. Remember `NOTIFY pgrst, 'reload schema';`.

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
