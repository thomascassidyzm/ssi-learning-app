# The founding-admin fix, applied live — 2026-08-07

Both halves of the founding-admin membership fix were applied to the shared
production database tonight, before the code that depends on them shipped.

## The read half — migration 20260807

`school_summary.teacher_count` and `region_summary.teacher_count` widened from
`role_in_context = 'teacher'` to `IN ('teacher','admin')`, matching the
definition `staff_practice_hours` has used since 20260718.

Applied under canary — one transaction, five assertions, COMMIT only on green:

1. no school's staff count may decrease
2. no region's staff count may decrease
3. no school may vanish from the view
4. `group_summary`, which sums `teacher_count`, must still parse
5. both views must keep `security_invoker=on`

All five passed. Thirteen schools gained staff, every change an increase:
Gaelscoil na Mara 4→5, Global Edge Academy 3→4, Green Valley International 3→4,
Harbour View 3→4, Hillcrest Primary 2→3, Lotus Valley 2→3, Oakridge 2→3, Sakura
2→3, Seaside Model 3→6, Sherbourne College 2→3, St. Mary's Academy 5→7, Sunrise
Public 5→8, Ysgol Gynradd y Garn 2→3.

## The write half — the backfill

`tools/backfill-founding-admin-tags.mjs --apply` gave eight founding admins the
`SCHOOL:` membership row they never got. Insert-only, idempotent, and the
re-audit came back clean: zero schools still untagged. The row-level log sits
next to this note.

Schools touched: LA SIS (EAS), Newport High School, Salesian College, Salesian-2,
Ysgol Cas-gwent Chepstow School, Ysgol Croesyceiliog, and two ZZ test schools.

## What it fixed, in the case that prompted it

Angharad, the head at Ysgol Cas-gwent Chepstow, had 76 minutes across 19 sessions
and her own dashboard read 7m — the two invited teachers only — because she held
no membership row in her own school. After both halves, Chepstow reads **3 staff
and 1.38 staff hours**, with its head counted among them.
