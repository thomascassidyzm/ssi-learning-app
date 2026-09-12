# cym_s_for_eng — "sent back to the start of White belt" — census and cause (job #326·F, 2026-09-12)

Read-only census over production (one DB serves dev, staging and production), then a headless
reproduction on production build `5ea385e`, then the fix. Every number sits beside the query that
produced it. Learner set throughout: `learners` rows with `is_demo`, `is_internal` and
`is_class_entity` all false. `player_events.user_id` holds `learners.id`. `lego_id` is not
course-unique, so every query is scoped to `course_code = 'cym_s_for_eng'`.

## The cause, in one paragraph

Since 2026-09-03 the flagship boots off a course bundle (`BUNDLE_BOOTSTRAP_COURSES` in
`useInstantPlayback.ts`; cym_s_for_eng is the only Welsh course on that list, cym_n_for_eng is
not). An anonymous, pre-session or unentitled caller gets the free-preview bundle: 33 rounds,
S0001L01 to S0019L01, the end of Yellow belt. The player writes the whole script it built into the
IndexedDB script cache (`ssi-script-cache`), keyed by course only. When entitlement arrives the
bundle heals itself (`bundle_tier_heal`), but the script cache never did. On the next cold start
the cache fast-path in `LearningPlayer.vue` hydrates those 33 rounds, looks for the enrolment
cursor in them, does not find a cursor past Yellow, prints one console warning, and starts at
round 1. The cursor row is untouched by the forward-only guard, which is the "well it saves your
progress" half of the complaint. Nothing in telemetry named it: the only trace is
`tap_play {legoId: S0001L01, roundIndex: 0}` from a learner whose cursor is hundreds of rounds on.

## 1. Who is on the course

```sql
select count(*), count(*) filter (where l.is_demo or l.is_internal or l.is_class_entity) as excluded,
       count(*) filter (where e.last_completed_lego_id is not null) as with_cursor
from course_enrollments e join learners l on l.id=e.learner_id where e.course_id='cym_s_for_eng';
-- 173 enrolments, 119 excluded (demo/internal/class entities), 54 real learners
```

Real learners with a cursor past Yellow (`last_completed_lego_id >= 'S0020'`): four.

| learner | cursor | mode | last practised | entitlement |
|---|---|---|---|---|
| ieuan422 | S0214L01 (round 322) | main | 2026-09-12 | SSi Premium, active from 2026-09-12 04:17Z |
| fransetter | S0217L01 (round 327) | main | 2026-08-22 | none |
| lea.weber94 | S0334L05 | infplay | 2026-08-16 | none |
| reillyfeatherstone | S0334L05 | infplay | 2026-07-12 | SSi Premium, cancelled |

```sql
select l.display_name, e.last_completed_lego_id, e.current_mode, e.last_practiced_at::date,
  (select string_agg(s.status||'/'||coalesce(s.plan_name,''),';') from subscriptions s where s.learner_id=l.id) subs,
  (select string_agg(u.access_type||':'||array_to_string(u.granted_courses,'+'),';') from user_entitlements u where u.learner_id=l.id) ents
from course_enrollments e join learners l on l.id=e.learner_id
where e.course_id='cym_s_for_eng' and not (l.is_demo or l.is_internal or l.is_class_entity)
order by e.last_completed_lego_id desc nulls last;
```

Backwards cursor moves: none found. `highest_completed_lego_id` is null on 50 of 54 rows (the
ratchet trigger honours an explicit null as a reset, and the client writes never carry the column),
so the ceiling is not a usable signal on this course; the event ceiling was used instead.

## 2. The signature: a returning learner landing on round 1

Signed-in learners who tapped play or pause on `S0001L01` at round index 0 in the last 30 days,
joined to their enrolment cursor:

```sql
with landings as (
  select p.course_code, p.user_id, min(p.occurred_at) first_land, count(*) n
  from player_events p
  where p.event_type in ('tap_pause','tap_play') and p.payload->>'legoId'='S0001L01'
    and (p.payload->>'roundIndex')::int=0 and p.user_id is not null and p.occurred_at>now()-interval '30 days'
  group by 1,2)
select l.course_code, count(*) learners_landed_r1,
  count(*) filter (where e.last_completed_lego_id>='S0020') cursor_past_yellow,
  (select count(distinct user_id) from player_events q where q.course_code=l.course_code
     and q.event_type in ('tap_pause','tap_play') and q.user_id is not null and q.occurred_at>now()-interval '30 days') active_learners
from landings l join course_enrollments e on e.learner_id=l.user_id and e.course_id=l.course_code
join learners le on le.id=l.user_id and not (le.is_demo or le.is_internal or le.is_class_entity)
group by 1 order by 2 desc;
```

| course | active learners (30d) | landed on round 1 | of whom cursor past Yellow |
|---|---|---|---|
| cym_s_for_eng | 76 | 36 | 2 (ieuan422 today; lea.weber94 once on 2026-08-16, pre-cutover) |
| cym_n_for_eng | 9 | 4 | 2 (richardbuck on enrolment day 2026-08-25; ieuan422 today) |
| spa_for_eng | 18 | 2 | 1 |
| zho_for_eng | 46 | 16 | 0 |

The other cym_s round-1 landers all carry a cursor inside the preview slice (S0001 to S0008), so
their cached script covers them and the mechanism below cannot have fired for them.

## 3. The live specimen: ieuan422, production, 2026-09-12

Enrolled 03:59Z today, Firefox on Windows, `app_shell: web`, build `5ea385e`, signed in
throughout (`cold_start.guest=false`). Subscribed at 04:17Z: `bundle_tier_heal {stored_tier:
preview, resolved_tier: full, outcome: healed}`. From then on, with the cursor written by explicit
navigation to S0215L01 at 05:29:32Z, every cold start landed on S0001L01:

```
05:29:32  cursor_move  explicit_nav → S0215L01 (round 323)
05:30:09  cold_start   scriptPath=cache, returnUser=true
05:30:27  tap_pause    S0001L01 roundIndex 0
05:42:35  cold_start   scriptPath=cache
05:42:41  tap_pause    S0001L01 roundIndex 0
05:47:17  cold_start   → 05:47:21 tap_play S0001L01 roundIndex 0
06:08:39  cold_start   → 06:08:48 tap_play S0001L01 roundIndex 0
```

39 round-1 landings and 40 belt skips in one morning. Before the subscription, at 04:16Z, the
same learner got `belt_skip_blocked {cause: unresolved_target, toBelt: orange, targetSeed: 20,
attempts: 6}`: the preview round map has no seed 20.

```sql
select occurred_at, event_type, payload->>'legoId', payload->>'roundIndex', payload->>'toBelt', payload->>'outcome'
from player_events where user_id='c430906f-7c05-47c7-b0ed-9c3407f505d2' and course_code='cym_s_for_eng'
  and event_type in ('cold_start','tap_play','tap_pause','belt_skip','bundle_tier_heal','cursor_move')
  and occurred_at>'2026-09-12 04:17' order by occurred_at;
```

`scriptPath: cache` on every one of those cold starts is the cache fast-path, not the bootstrap.

## 4. Why Southern Welsh specifically

- Only cym_s_for_eng is bundle-booted among the Welsh courses; cym_n_for_eng takes the old path.
- Both are `pricing_tier = premium`, so the preview slice applies to both, but only the bundle
  path writes a preview-sized script into the cache and then trusts it.
- The bundle path first appears on production for cym_s on 2026-09-03 06:40Z (`min(occurred_at)`
  of `bundle_boot_path`, env production), which is "this version of the app".
- The anonymous production bundle today: `previewOnly: true`, 33 rounds, last `S0019L01`
  (`curl https://saysomethingin.app/api/courses/cym_s_for_eng/bundle`).

## 5. Reproduction, headless, production build 5ea385e

Fresh persistent Chrome profile, test account `thomas.cassidy+cs326repro@gmail.com`
(learner `d0ca980b-…`, then marked `is_internal`, `platform_role = tester` so it is entitled).

1. As a guest, open `/?course=cym_s_for_eng`, play 45 s. IndexedDB `ssi-script-cache`:
   33 rounds, S0001L01 to S0019L01.
2. Sign in, grant entitlement, reload: `bundle_tier_heal … healed → full`. Tap "Next belt"
   twice, play a minute. Enrolment row: `last_completed_lego_id = S0020L01`, round 33. Script
   cache: still 33 rounds.
3. Reload. Header reads "13 percent to yellow belt", screen says White Belt, first event
   `tap_play {legoId: S0001L01, roundIndex: 0}`. Reproduced.

After step 3 the device's local position snapshot reads S0001L01 with a fresher stamp than the
server row, so on a device that has already been reset once, position authority can keep choosing
the local round-1 snapshot until the server row is stamped again by a forward write. That is a
consequence of the reset, not a separate cause, and it heals on the learner's next completed
round or belt skip.

## 6. The fix (branch `cs/326-cym-s-for-eng-resume-reset-to-wh`)

- `utils/cachedScriptCoversLearner.ts`: a cached script that cannot place a learner who has a
  server position is not their course view. The cache fast-path in `LearningPlayer.vue` now skips
  such a cache and lets the bootstrap resolve against the live bundle's round map; the
  full-script handoff then rewrites the cache. Test: red on the pre-fix decision, green after.
- `utils/resolveResumeStart.ts`: a cursor past the last seed the round map holds now lands on the
  map's last round (the paywall wall for an unentitled learner) instead of resolving as "fresh
  learner, round 1". Test: red on the pre-fix code, green after.

### 6a. The second trap, found verifying on staging

With the cache fix live on staging (build 0992d2c), both test profiles still landed on White:
the fast-path was skipped and the cache rewritten to 3,262 rounds, but the device's local
position snapshot read S0001L01 with a stamp fresher than the server row, so position authority
chose it. Two ways a device gets there: a resume that landed on round 1 by the bug above and was
then played, or a guest session on the device before signing in. Fix: `resolveAuthoritativePosition`
lets a fresher local snapshot outrank the server only when it is at or past the server cursor;
fresher-but-behind is a stale cache. Test red on the pre-fix code, green after. Offline progress
ahead of the cursor still wins as before.

### 6b. Verified live on staging, build 890c379 (2026-09-12 12:17Z)

- Guest plays on a fresh profile (script cache 33 rounds), signs in as the entitled test account
  whose cursor is S0020L01, reloads: header "0 percent to green belt", screen Orange Belt,
  `cold_start {seedId: S0020, roundIndex: 33}`, cache rewritten to 3,262 rounds. Before the fix
  the same walk landed on White.
- Same signed-in profile with the local snapshot forced to S0001L01 stamped now, behind the
  server cursor: reload lands on Orange, `cold_start {seedId: S0020, roundIndex: 33}`.

## 7. Cursor repairs

None needed. No real learner's cursor moved backwards; the four learners past Yellow keep the
positions above. ieuan422 will resume correctly once the fix is live. fransetter, lea.weber94 and
reillyfeatherstone are unentitled and will land on the preview's last round with the paywall
ahead rather than at round 1, which is the designed wall behaviour; whether Welsh should be
premium at all is Tom's call and is outside this job.

## 8. Not verified / gaps

- The forum learner is not identifiable; ieuan422 is the one production row that shows the exact
  path today. Others with the same shape may exist among guests (no `user_id`) or among learners
  whose events predate the 60-day window used here.
- `pnpm --filter player-vue typecheck` fails on `views/schools/HandbookView.showMe.test.ts`, a file
  this job did not touch, on current `dev`.
