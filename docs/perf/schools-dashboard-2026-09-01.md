# Where the schools dashboard is actually slow

Measured 2026-09-01 against real deployed builds — `staging.saysomethingin.app`
(before) and the `dev` alias (after). Read-only measurement; no product code
was changed to produce the "before" column.

Harness: `packages/player-vue/e2e/schools/run.mjs`, built on the learner-journey
instrument (`e2e/journeys/lib.mjs`) and keeping its refusals: real deployed
build, Chrome DevTools' own network presets (never unthrottled), median plus
full spread plus `n`, and **a surface that never renders its content is recorded
as one rather than dropped from the median**.

Re-run: `BASE_URL=https://staging.saysomethingin.app NET=good RUNS=3 node e2e/schools/run.mjs`

**The stop condition is content on the glass**, not a resolved navigation. The
first version of this harness reported `/schools/classes` at 1,413ms; it had
stopped on the "Loading your classes…" placeholder, which carries the same
CSS class as the real empty state. Every number below waits for a row a human
could read.

## The tenant these numbers came from

**Sunrise Public School, Pune** — the largest school in the live database:
**4 classes, 82 learners, 33,391 `lego_progress` rows, 9,545 `seed_progress`
rows, 590 sessions.** It is a demo tenant, but the progress volume behind it is
real. Measured as its real school admin and as one of its real teachers, via
minted sessions (no impersonation, no service-role reads in the browser).

**Gap, stated plainly:** there is no school in this database bigger than 4
classes / 82 learners. Nothing here tells you how the dashboard behaves at 20
classes and 600 learners. The dominant finding below gets *worse* with size, so
that gap matters — but it did not need a bigger tenant to find.

---

## The headline: the class roster query times out, for everyone

`class_student_progress` is the view behind the class roster, the class list's
student counts and the belt distribution. Timed directly against the live DB as
three different real principals, on a class of 22 students:

| Selected columns | School admin | Lead teacher | Co-teacher |
|---|---|---|---|
| `select=*` (what ClassDetail asks for) | **500 — 57014 statement timeout, 8.1s** | **500 — timeout, 8.1s** | 98ms (sees 0 rows) |
| `class_id,seeds_completed,total_practice_seconds` (what the class list asks for) | **5,424ms** | 5,164ms | 128ms |

The cost is entirely in two columns of the view. Per-column, same class, same
session, two runs each:

| Column | Cost |
|---|---|
| `class_id` | 254 / 242 ms |
| `student_user_id, learner_id, student_name, joined_class_at` | 243 / 243 ms |
| `total_practice_seconds` | 521 / 495 ms |
| `last_active_at` | 498 / 499 ms |
| **`seeds_completed`** (correlated count over `seed_progress`) | **5,010 / 5,043 ms** |
| **`legos_mastered`** (correlated count over `lego_progress`) | **timeout, never returns** |

It is not the row volume and it is not a missing index —
`idx_seed_progress_learner_course` and `idx_lego_progress_learner_course` both
exist and both match the predicate. Batching the same counts by hand, as a
single `learner_id=in.(22 ids)` read instead of the view's per-student
subqueries, is **no faster** (7.2s for seed_progress, timeout for
lego_progress), which rules out the query shape and points at the row-level
policy:

```sql
CREATE POLICY lego_progress_scoped_select ON public.lego_progress
  FOR SELECT TO authenticated USING (public.can_view_learner_data(learner_id));
CREATE POLICY seed_progress_scoped_select ON public.seed_progress
  FOR SELECT TO authenticated USING (public.can_view_learner_data(learner_id));
```

A `SECURITY DEFINER` call per candidate row, across tens of thousands of rows,
to answer a question about one class of 22.

**This is the same bug class as `20260807_co_teacher_class_page_perf.sql`, one
table down.** That migration fixed exactly this shape on `user_tags` and
`learners` by replacing per-row correlated policy quals with an uncorrelated
`IN (SELECT my_readable_tag_values())` that plans as a single hashed InitPlan —
and took the co-teacher's class page from ~2,050ms to ~85ms with byte-identical
visible row sets. The same treatment applied to `lego_progress` and
`seed_progress` is the obvious candidate.

**What a teacher sees today:** the ClassDetail roster never renders. The page
says *"student count unavailable"* and shows an empty roster for a class with
22 students in it. Reproduced on every run, as the school admin and as a
teacher.

**This is a live-database change and therefore Tom's call, not mine.** It is an
RLS policy edit, which under the repo's own doctrine requires the canary method
(apply in one txn, replay real app queries as real roles, assert leak-closed
AND every-legit-path-alive, COMMIT iff green) and a staging soak. The toolkit
and a directly analogous canary already exist:
`supabase/secfix-toolkit/canary_co_teacher_class_page_perf.cjs`.

---

## The surface table (network profile `good` = 12/4 Mbps, 40ms)

"Content" = milliseconds from navigation to a readable row. `n` = completed
runs. `serial` = the longest chain of requests where each one starts only after
the previous finished — the number a 900ms round trip multiplies.

### Before (staging `9cf8be3`, n=1 per surface — a scouting pass)

| Surface | Content | Requests | KB | Serial depth |
|---|---|---|---|---|
| org node home (school admin) | 2,248* | 90 | 2,237 | 13 |
| `/schools/classes` (teacher) | 7,675 | 85 | 2,022 | 15 |
| `/schools/classes/:id` (teacher) | **roster never rendered** | 87 | 2,009 | 16 |
| `/schools/students` (admin) | 2,672 | 75 | 2,137 | 11 |
| `/schools/teachers` (admin) | 9,490** | 94 | 2,309 | 14 |
| `/schools/analytics` (teacher) | 5,140 | 87 | 3,088 | 10 |
| `/org/:id/insights` (admin) | 3,059 | 97 | 3,382 | 10 |

\* first pass recorded this as "never rendered" — a harness bug (the selector
matched a hidden duplicate node), fixed and re-measured, not a product fault.
\*\* `/schools/teachers` redirects a school-scoped admin to the node home with a
teachers lens; the number is that redirected page.

### After (dev `7a56bb1`, n=2 per surface)

| Surface | Content | Requests | KB | Serial depth |
|---|---|---|---|---|
| org node home | 2,248 | 80 | 2,591 | **8** (was 13) |
| `/schools/classes` | 8,816 | 87 | 2,552 | 15 |
| `/schools/classes/:id` | roster still never renders | 89 | 2,539 | 15 |
| `/schools/students` | 2,524 | 69 | 2,468 | **8** (was 11) |
| `/schools/analytics` | 3,630 | 90 | 3,628 | 10 |
| `/org/:id/insights` | 2,741 | 96 | 3,799 | 10 |

Every surface is 70–100 requests and 2–3.5 MB. Most of that is the shared app
shell, which this job did not touch.

---

## What was fixed

### 1. `/api/school/roster` fired four times per page load → once

`useSchoolData` (`.school`), `useTeachersData` (`.teachers`) and
`useStudentsData` (`.students`) each take a different slice of the same
response, and `SchoolsContainer` prefetches all three on entry, so they raced.

Measured on `/schools/students`:

| | Requests | Bytes on the wire | Individual durations |
|---|---|---|---|
| Before | **4** | 145 KB | 1,768 / 1,431 / 1,056 / 657 ms |
| After | **1** | 36 KB | 1,002 / 891 ms (two runs) |

Confirmed 1 request on every schools surface after the change, except
class-detail (below). The server-side roster aggregation now runs once per page
load instead of four times.

Implementation: `composables/schools/schoolRoster.ts` — in-flight coalescing
only, **no TTL cache**, so a Retry or a post-write refresh always hits the
network and nothing shown can go stale. Pinned by
`schoolRoster.test.ts`, which asserts the request *count*.

### 2. Class detail's four reads now go out together — measured, and it bought nothing

`fetchClassDetail` ran five queries strictly in series; only the first (the
class row, which supplies `course_code`) is a real dependency. The other four
now go out as one wave.

**It made no measurable difference end to end**, and this note is not going to
pretend otherwise:

| Network | Before (median, n=3) | After (median, n=3) |
|---|---|---|
| good (12/4, 40ms) | 9,490 ms (9,418–9,965) | 9,735 ms (9,478–9,891) |
| highlatency (8/2, 900ms RTT) | 16,949 ms (16,713–17,019) | 17,198 ms (16,706–17,198) |

The page's wall clock is set by the roster read hitting the 8s statement
timeout, and three saved round trips disappear inside that. The change was kept
because it strictly reduces serial depth, its tests pin the panel-by-panel
error semantics unchanged, and it forced a genuine correction to the test
double (below) — **not because it is a measured win. It is not one.**

**The test double it corrected was wrong.** Ten schools spec files build a mock
Supabase client that stored the current table in ONE module-level variable, set
by `from()` and read lazily at await time. With two queries in flight, whichever
`from()` ran last decided what *both* resolved to — so any parallel read was
untestable by construction, and would have failed for a reason that had nothing
to do with the product. Corrected in the two files that exercise this path;
the other eight still carry the old shape and will need the same one-line
change the first time anyone parallelises a read in them.

---

## Measured, deliberately not fixed

- **`class_student_progress` is read three times per class-detail load**
  (`select=*&class_id=eq.`, `select=*&class_id=in.`, and the narrow list-level
  read), each burning ~8s of Postgres. Two of the three come from
  `SchoolsContainer` prefetching `fetchClasses()` on every schools surface —
  a deliberate warm-the-cache design, not an accident. Collapsing it is a
  product decision about prefetch policy, not a perf cleanup, and it is worth
  nothing until the view itself is fixed.
- **`/api/school/roster?class_id=…` fires twice on class detail** — a different
  URL from a different call site (`teacherCandidates`), 784 bytes each. Real,
  and not worth a change.
- **`/api/courses/<code>/bundle` — 440 KB of learner course content — is
  fetched at app boot on every schools page.** One copy comes from the service
  worker in 3ms; the other is a genuine 1.3s network fetch. Skipping it on
  `/schools` and `/org` routes would save 440 KB per load, but the schools
  shell carries a Play button (play-as-class), so deferring it moves the cost
  onto that tap instead of removing it. That is a product call about which
  wait the teacher should have, not a free win.
- **`courses?select=<15 columns>` is 173 KB** on every schools surface, for
  course labels. Shared app-shell boot; narrowing it touches the player.
- **`rpc/get_my_verified_emails` fires twice.** ~50 bytes. Noise.

## Nothing fixed here changed what any page shows

Both changes are request-plumbing only. Verified by: 167 schools-composable
unit tests green (they assert the rendered values, e.g. `student_count`,
`avg_seeds_completed`, per-panel error text); the full `player-vue` suite green
except a pre-existing i18n locale-parity failure (21 tests) that fails
identically on unmodified `dev`; and screenshots of every surface before and
after in `$CS_SCRATCH/schools-perf/`.

## What needs Tom

**One decision: the `lego_progress` / `seed_progress` RLS policy fix.** It is
the whole of the class roster problem, it is worth roughly 8,000ms on the two
worst surfaces, it gets worse as the learner table grows rather than as the
class grows, and it is a live-database change with a proven canary sitting next
to it. Everything else measured here is small change by comparison.
