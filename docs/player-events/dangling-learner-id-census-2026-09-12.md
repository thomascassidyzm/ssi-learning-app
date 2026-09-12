# Job #317 — the 568 player_events rows whose learner_id points at no learner

Read-only census, 2026-09-12. Nothing in this document wrote to the database. Every number sits
beside the query that produced it; all queries ran inside one `set transaction read only`
transaction against the live Supabase project through the same `DATABASE_URL` the #307 backfill
used. These rows are a DIFFERENT set from #307's 747 UUID-payload orphans, which have a NULL
`learner_id`; these have a non-null `learner_id` that no `learners` row carries.

## 1. The anti-join, reproduced

```sql
select now() as ran_at, count(*) as dangling, count(distinct pe.learner_id) as distinct_ids
from player_events pe
left join learners l on l.id = pe.learner_id
where pe.learner_id is not null and l.id is null;
```

| ran_at | dangling | distinct_ids |
|---|---|---|
| 2026-09-12T03:37:13Z | 568 | 100 |

Astra's 568 reproduces exactly. For scale, `player_events` holds 670,119 attributed rows for 433
distinct learners, so the dangling set is 0.08% of attributed rows and 100 of 533 ids ever attributed.

Every one of the 568 rows also carries the same value in the legacy `user_id` column, so the dual
write was intact at the time; the learner row went away afterwards.

```sql
-- user_id_null = 0, user_id_same = 568 across the set
select count(*) filter (where user_id is null) user_id_null,
       count(*) filter (where user_id = learner_id) user_id_same
from player_events pe left join learners l on l.id = pe.learner_id
where pe.learner_id is not null and l.id is null;
```

## 2. Rows per id

```sql
with d as (select pe.* from player_events pe left join learners l on l.id = pe.learner_id
           where pe.learner_id is not null and l.id is null)
select rows_per_id, count(*) as ids
from (select learner_id, count(*) rows_per_id from d group by 1) x
group by 1 order by 1;
```

| rows per id | ids |
|---|---|
| 1 | 25 |
| 2 | 39 |
| 3 | 2 |
| 4 | 5 |
| 5 | 11 |
| 7 | 1 |
| 8 | 3 |
| 9 | 1 |
| 13 | 4 |
| 14 | 1 |
| 15 | 2 |
| 21 | 3 |
| 22 | 2 |
| 141 | 1 |

Sixty-six of the 100 ids have three rows or fewer. One id, `78ce1e3d-f495-4793-8a64-cb0a60ed1e20`,
carries 141 rows on its own.

## 3. When they were written

`player_events` has no `created_at`; `occurred_at` is the client's stamp and the only time on the row.

```sql
with d as (...same anti-join...)
select date_trunc('day', occurred_at)::date as dd, count(*) n, count(distinct learner_id) ids,
       array_agg(distinct ip_country) countries, array_agg(distinct env) envs,
       array_agg(distinct client_version) versions,
       count(*) filter (where payload->>'userAgent' ilike '%headless%') headless_rows
from d group by 1 order by 1;
```

| day | rows | ids | countries | envs | client versions | headless rows |
|---|---|---|---|---|---|---|
| 2026-07-13 | 5 | 4 | GB | staging | 1 | 0 |
| 2026-07-16 | 157 | 7 | GB, null | dev, staging | 2 + null | 11 |
| 2026-07-17 | 3 | 2 | GB | production | 1 | 0 |
| 2026-07-20 | 3 | 2 | GB | dev | 1 | 3 |
| 2026-08-05 | 13 | 9 | FI | production | 3 | 12 |
| 2026-09-02 | 73 | 41 | FI, null | dev, production, staging | 1 + null | 29 |
| 2026-09-07 | 304 | 33 | FI | dev, production, staging | 16 | 75 |
| 2026-09-09 | 10 | 2 | FI | dev | 5 | 10 |

Eight days in two months, not a spread. Per id the write windows are minutes wide: every one of the
33 ids of 2026-09-07 has its first and last row inside a two-minute span, and the 141-row id's rows
all fall between 19:58 and 20:33 UTC on 2026-07-16. FI is watson-1's egress, which the telemetry
memory already lists as a non-human cohort, and every FI row whose payload carries a user agent is
HeadlessChrome.

## 4. Env, course, shell, event mix

```sql
with d as (...) select env, app_shell, count(*) n, count(distinct learner_id) ids from d group by 1,2;
with d as (...) select course_code, count(*) n, count(distinct learner_id) ids from d group by 1;
with d as (...) select event_type, count(*) n, count(distinct learner_id) ids from d group by 1;
```

| env | rows | ids |
|---|---|---|
| staging | 272 | 27 |
| dev | 171 | 47 |
| production | 125 | 51 |

`app_shell` is null on all 568 rows. Twenty ids span dev and production, four span production and
staging: the same throwaway identity driven at more than one deployment inside its two-minute life.

| course_code | rows | ids |
|---|---|---|
| zho_for_eng | 244 | 70 |
| spa_for_eng | 226 | 13 |
| null | 49 | 40 |
| ita_for_eng | 21 | 1 |
| deu_for_eng | 13 | 9 |
| afr_for_eng | 12 | 3 |
| cym_s_for_eng | 3 | 2 |

| event_type | rows | ids |
|---|---|---|
| cold_start | 171 | 82 |
| bundle_boot_path | 161 | 31 |
| audio_play | 94 | 1 |
| tap_pause | 53 | 26 |
| school_signin_link_minted | 44 | 36 |
| belt_skip | 12 | 9 |
| bundle_tier_heal | 8 | 8 |
| tap_play | 6 | 1 |
| adaptation_plan | 5 | 1 |
| round_complete | 5 | 1 |
| admin_signin_link_minted | 3 | 3 |
| test_event | 2 | 1 |
| instant_playback_entitlement_fallback | 2 | 2 |
| learning_mode_selection | 1 | 1 |
| cursor_move | 1 | 1 |

The `audio_play`, `tap_play`, `adaptation_plan` and `round_complete` rows, the only ones that read
as a person practising, all belong to the single 141-row id. Everything else is boot events, a
pause, a belt skip, or a server-side sign-in-link mint.

## 5. Is any dangling id still referenced anywhere?

Every column in the public schema named `learner_id`, `*_learner_id`, `user_id` or `created_by`,
56 columns across 40 tables and including `classes.class_learner_id`, `sessions`,
`course_enrollments`, `lego_progress`, `seed_progress`, `user_tags`, `learner_emails`,
`family_members`, `learner_roles` and `org_enrolments`, was joined against the 100 ids, uuid columns
by value and text columns by `::text`. Script: the loop below, run read-only.

```js
// for each (table, column) from information_schema.columns matching the names above:
select count(*) from public."<table>" x
join (select distinct pe.learner_id from player_events pe
      left join learners l on l.id = pe.learner_id
      where pe.learner_id is not null and l.id is null) d
  on x.<column> = d.learner_id            -- or d.learner_id::text for text columns
```

**Result: zero references in every column.** No dangling id is a class account, has a session,
an enrolment, progress, a tag, an email, a family link or a role. `role_change_audit`,
`class_progress_copy_audit` and `pod_ratchet_reset_audit` also hold nothing for them.

## 6. Who do the rows really belong to?

```sql
with d as (...)
select count(distinct d.session_id) dangling_sessions,
       count(distinct d.session_id) filter (where exists (
         select 1 from player_events s join learners l on l.id = s.learner_id
         where s.session_id = d.session_id and s.learner_id <> d.learner_id)) shared_with_existing_learner,
       count(distinct d.session_id) filter (where exists (
         select 1 from player_events s where s.session_id = d.session_id and s.learner_id is null)) with_unattributed_rows
from d;
```

| dangling sessions | shared with an existing learner | with unattributed siblings |
|---|---|---|
| 174 | 0 | 6 |

No session ever carried both a dangling id and a surviving learner, so session corroboration cannot
re-point a single row. `payload.learnerId` equals the column on all 519 rows that carry it; the 49
without it are the server-minted sign-in-link rows.

```sql
with d as (...)
select count(*) filter (where payload ? 'actor_user_id') with_actor,
       count(*) filter (where exists (select 1 from learners l where l.user_id = d.payload->>'actor_user_id')) actor_exists,
       count(distinct payload->>'actor_user_id') distinct_actors
from d;
-- 52 rows carry an actor; 26 distinct actors; only 6 rows name an actor whose account still exists
with d as (...)
select count(*) minted_rows,
       count(*) filter (where exists (select 1 from learners l
         where l.user_id = d.payload->>'target_user_id' or l.id::text = d.payload->>'target_user_id')) target_still_exists
from d where event_type like '%signin_link_minted';
-- 47 minted rows; 0 targets still exist
```

The 47 sign-in-link mints were minted BY an account that no longer exists, FOR a target that no
longer exists, on dev or staging, on 2026-07-16 and 2026-09-02. That is a school-provisioning probe
creating a leader, minting a pupil link, and tearing both down.

## 7. Why the learner rows are gone

`learners` has no `deleted_at`, no `is_test`, no soft-delete of any kind; its only triggers are
`updated_at`, the verified-emails provenance guard, an email sync on insert and the Popty
auto-entitlement on role change. `player_events.learner_id` carries no foreign key, only the
primary key constraint exists on the table, so a learner delete leaves its telemetry standing.
No audit or provenance table in the schema records a learner delete, so the row-level provenance
CLAUDE.md describes does not cover this table's disappearance.

The physical delete paths in the code are `api/account/delete.ts`, the persona teardown in
`api/_utils/provisionPersona.ts`, `api/_utils/demoSchoolTeardown.ts`, `api/_utils/schoolGroupDeletion.ts`
for a class account, `api/admin/create-staff.ts` on a failed create, and the e2e probes under
`packages/player-vue/e2e/` that create a learner and `delete().eq('id', made.learner)` at the end.
None of them touches `player_events`.

## 8. Clusters, and what each is

- **Cluster A, 2026-09-07 plus 2026-09-09 and 2026-08-05: 327 rows, 44 ids.** All FI, all desktop,
  every user agent HeadlessChrome, 24 distinct client versions across a single afternoon, each id
  alive for one to two minutes across one to six sessions, spa and zho boot events. This is the
  automated release test pass and its probes creating a throwaway learner per run and deleting it
  at teardown. Proof: no other table has ever heard of these ids, the write windows are the length
  of a probe, and the browser is headless from watson-1's egress.
- **Cluster B, 2026-09-02 and the three 2026-07-16 admin mints: 47 rows, 39 ids.** Server-side
  `school_signin_link_minted` and `admin_signin_link_minted` rows on dev whose actor and target both
  no longer exist. School-provisioning probes, torn down. Same proof as A.
- **Cluster C, 2026-07-16 evening: 152 rows, 3 ids, GB, staging.** The 141-row id is a real iPhone
  on iOS Safari practising ita, spa and zho for 35 minutes on staging build `c9fc7e5`, plus two
  ids with cold starts only. Estate search for the id finds nothing. This reads as a tester
  account on the day of the play-as-class ruling, later deleted through account deletion. I cannot
  name the person from the data and do not guess.
- **Cluster D, 2026-07-13, 07-17, 07-20: 11 rows, 8 ids, GB.** One or two cold starts each on
  staging, production and dev, three of them headless. Tester or probe accounts since deleted; too
  small to say which.
- **The id `11111111-1111-4111-8111-111111111111`, 2 `test_event` rows.** A hand-typed test id
  from the 2026-07-16 endpoint check; never a learner.

## 9. Recommended treatment

**Leave them.** Better: every schools and intel read joins `player_events` to `learners` or scopes
through `classes.class_learner_id`, so these rows are already invisible to every dashboard, and no
session corroborates a re-point so there is nothing truthful to re-point them to. Simpler: no
script, no transaction, no log, no second census to reconcile. Cheaper: 568 rows in 670,000 cost
nothing to keep and a delete would buy no number a teacher or Tom reads. The one thing worth doing
is upstream, not here: a probe that creates a learner should delete that learner's `player_events`
in the same teardown, so the set stops growing at 300 rows per release-test afternoon. That is a
one-line addition to the e2e teardown helper and the persona teardown, and it is a separate,
small job. If Tom prefers the table clean, the safe delete is the anti-join above restricted to
rows whose `payload->>'userAgent'` contains `Headless` or whose `event_type` ends in
`signin_link_minted`, 374 rows, and Cluster C should be left because it is a person's practice
even though the account is gone. Nulling the column would be the worst of the three: it would
turn 568 provably-probe rows into 568 more rows that look exactly like #307's orphans.
