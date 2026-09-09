# Check one: how long does "pending" actually last?

Job #713, 2026-09-09. Read-only query against the live database, re-derived rather than quoted from
the design. The design (`school-belonging-design-2026-09-09.md`) named this as an open uncertainty:
mechanism A leaves an unvouched arrival sitting under "Not yet given classes" until their admin gives
them a class, so the mechanism is only comfortable if that wait is short.

**Answer: at real schools it is very short. No nudge is needed.**

## The counts, re-derived

A "teacher" here is a learner with `educational_role = 'teacher'` holding at least one active
`user_tags` row of `tag_type = 'school'`. "Has a class" is the same union `taughtClassIds` uses in
`api/_utils/schoolScope.ts`: a `class_teachers` row, or a legacy `classes.teacher_user_id` pointer on
an active class.

| | Count |
|---|---|
| Teachers holding a school tag | 97 |
| Of those, holding at least one class | 75 |
| Of those, holding none | 22 |

The design quoted 102 and 74 on 2026-09-09 morning; the drift is ordinary and it warned about it.

## How long the assignment takes, at real schools

Time from the school tag being written to the first class being given, excluding demo and test
schools:

| Gap | Teachers |
|---|---|
| Under 1 hour | 36 |
| 1 to 7 days | 5 |
| Longer | 0 |

Thirty-six of forty-one within the hour and no tail at all. The admin assigns classes as part of the
same sitting in which they hand over the link. Across all schools including demo estate the picture
is noisier — 41 under an hour, 6 within a day, 5 within a week, 22 at 7 to 30 days — but every one of
that 7-to-30-day bucket is demo or test data, generated rather than lived.

## Who is pending right now, and for how long

All 22 unassigned teachers, by the school their tag points at:

| School | Real? | Unassigned | Oldest |
|---|---|---|---|
| Ysgol Gyfun Tredegar | yes | 6 | 5 days |
| Ysgol Cas-gwent Chepstow School | yes | 2 | 6 days |
| Newport High School | yes | 2 | 54 days |
| Demo and test schools | no | 7 | 51 days |
| Tags pointing at a school row that no longer exists | debris | 5 | 34 days |

Ten pending arrivals at real schools. Eight of them arrived in the last six days at two schools that
are onboarding right now, which is the mechanism working rather than failing. Two at Newport High
were tagged on 17 July and never given a class — 54 days pending, and under mechanism A that is
exactly the visible, removable state the design wants them in rather than a silent membership.

The five orphan tags point at school ids with no row in `schools` and no row in `groups`. They are
almost certainly residue of the expired-demo-school cleanup, not live people, and they are noted here
rather than acted on because they are outside this job.

## What I read into it

Pending is short where it matters and the design does not need a nudge, a reminder or a timer. The
one case worth the admin's eye is the arrival who has been pending for weeks — Newport High's two —
and mechanism A already surfaces exactly that: they sit under "Not yet given classes" on the Teachers
page with a Remove button next to them. Sorting that section oldest-first would put them at the top
without adding anything, and that is what this build does.
