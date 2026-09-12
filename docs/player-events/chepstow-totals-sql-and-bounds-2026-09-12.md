# Job #317 — the SQL and bounds behind #307's player_events totals, and why 2,294 was not Chepstow

Read-only. Script: `scripts/player-events-chepstow-totals-2026-09-12.cjs` on dev. It takes
`--from` and `--to` UTC bounds as a half-open window, a `--school` id, and prints every total
beside its population rule. Both runs below are its verbatim output, trimmed to the numbers.

## The reconciliation, in one line

**#307's "2,294 Chepstow production rows" was the class accounts of EVERY school in the fleet over
the trailing fortnight, not Chepstow's.** The query was mis-scoped; the number itself is right for
what it counted. Chepstow alone is 1,818, as Astra found, and 1,831 when the class account is
named only in `payload.learnerId`. Window drift plays no part: the Chepstow class-account figure
is 1,818 under a trailing 14-day window, a fixed 29 August to 12 September window, a 30-day window
and all time minus older rows, because Chepstow's class accounts only began practising on
3 September.

| population rule | window | env | rows |
|---|---|---|---|
| every row | trailing 14 d at 03:43 UTC | production | 94,496 |
| every row | trailing 14 d | staging | 10,971 |
| every row | trailing 14 d | dev | 4,292 |
| every row | fixed 2026-08-29T00Z to 2026-09-12T00Z | production | 94,162 |
| every row | fixed | staging | 10,948 |
| every row | fixed | dev | 4,292 |
| Chepstow class accounts, `classes.class_learner_id` | trailing 14 d | production | 1,818 across 27 accounts |
| Chepstow class accounts | fixed | production | 1,818 |
| Chepstow class accounts + `payload.learnerId` naming one | trailing 14 d | production | 1,831 |
| Chepstow class accounts + payload | fixed | production | 1,831 |
| ALL schools' class accounts | trailing 14 d | production | 2,294 |
| ALL schools' class accounts | trailing 14 d | dev | 2 |
| ALL schools' class accounts | fixed | production | 2,294 |
| ALL schools' class accounts | fixed | dev | 2 |

The fleet-wide 2,294 decomposes as Chepstow 1,818 + St Alban's RC High School, Pontypool 442 +
Ysgol Croesyceiliog 19 + Ysgol Gyfun Tredegar 15. The 2 dev rows are Sunrise Public School,
Pune. #307's page showed exactly "dev 2, production 2294" under the heading "chepstow class
learners generally", which is this fleet query.

#307's fleet env numbers, 10,965 staging against 94,513 production, were a trailing 14-day window
at the moment it ran, a little after 02:00 UTC on 2026-09-12; the same query at 03:43 UTC reads
10,971 and 94,496, the difference being the window's leading edge on 29 August and rows written
since. They were never disputed and are reproduced here with fixed bounds for the record.

## Population definition used for "Chepstow"

- School: `schools.id = '0f5bd6e4-f40b-4dbf-ac4f-a93478d20255'`, Ysgol Cas-gwent Chepstow School.
  The test school "ZZ Test — Chepstow scenario" has one class account with no rows in the window,
  so including it changes nothing.
- Class accounts: `classes.class_learner_id` for that school, 34 accounts, 27 with rows in window.
- Pupils' own learner rows and staff's own learner rows are NOT included. Chepstow has no pupil
  accounts with events in the window, and adding staff through `user_tags` still reads 1,818 for
  the class-account rule; the school leader's own 221 rows and the driving teacher's rows are
  attributed to their own learners and are a different population.
- `payload.learnerId` identities are included only in the row marked "+ payload", which adds the
  13 unattributed boot rows #307 characterised.

## The SQL

```sql
-- $1 = from, $2 = to, half-open; $3 = school id
-- fleet-env
select env, count(*) from player_events
where occurred_at >= $1 and occurred_at < $2 group by env;

-- school-class
select env, count(*), count(distinct learner_id) from player_events pe
where pe.learner_id in (select class_learner_id from classes
                        where school_id = $3 and class_learner_id is not null)
  and occurred_at >= $1 and occurred_at < $2 group by env;

-- school-class+payload
select env, count(*) from player_events pe
where (pe.learner_id in (select class_learner_id from classes
                         where school_id = $3 and class_learner_id is not null)
    or pe.payload->>'learnerId' in (select class_learner_id::text from classes
                                    where school_id = $3 and class_learner_id is not null))
  and occurred_at >= $1 and occurred_at < $2 group by env;

-- fleet-class (the rule behind #307's 2,294)
select s.school_name, pe.env, count(*) from player_events pe
join classes c on c.class_learner_id = pe.learner_id
join schools s on s.id = c.school_id
where occurred_at >= $1 and occurred_at < $2
group by 1, 2 order by 3 desc;
```

Runs: trailing window `[2026-08-29T03:43:34.927Z, 2026-09-12T03:43:34.927Z)` at 03:43:35 UTC;
fixed window `[2026-08-29T00:00:00Z, 2026-09-12T00:00:00Z)` at 03:43:36 UTC.

## What #307's finding still says, corrected

The env finding survives the correction: Chepstow's class accounts practise on production,
1,818 rows, zero staging, and the schools helpers filter no env, so the decision to add no filter
stands. The sentence "2,294 Chepstow production rows" in #307's report, its evidence page and its
`docs/DECISIONS.md` entry should be read as 1,818, and the #317 entry beside it says so.
