# The India demo now has VAD data — run report

*6 August 2026. Written after the run, against the live database and a real browser.*

The IME Demo Programme's 381 students had **zero** VAD data this morning. They now sit at **48%** coverage, with the other half genuinely empty — which is the honest half of the story, and the half that sells.

Nothing was regenerated. The July world — three regions, eight schools, eleven courses, the dual-enrolment showcase, the join codes — is untouched. Only two tables gained rows.

---

## The split

**181 of 381 students (48%) now carry VAD data.** 200 carry none at all — no rows, no zeros, no empty placeholders, which is exactly how a learner without a mic really presents.

Coverage was drawn per class at 40–60%, not per school and not flat, so it aggregates unevenly the way a real roster does:

| School | With VAD | Students | Coverage |
|---|---|---|---|
| Sunrise Public School, Pune | 42 | 82 | 51% |
| Green Valley International, Jaipur | 26 | 60 | 43% |
| St. Mary's Academy, Kochi | 25 | 60 | 42% |
| Seaside Model School, Chennai | 30 | 60 | 50% |
| Harbour View School, Visakhapatnam | 22 | 40 | 55% |
| Global Edge Academy, Mumbai | 10 | 29 | 34% |
| Lotus Valley International, Delhi | 16 | 29 | 55% |
| Oakridge International School, Bengaluru | 14 | 21 | 67% |
| **Total** | **181** | **381** | **48%** |

**What was written:** 1,672 mastery-metric rows and 2,148 real prosody traces. Within those, 133 clearly-struggling and 137 clearly-easing difficulty curves, so the difficulty boards have signal per school without reading as all-red.

Four students drew VAD but had no practice history on their main course to attach it to, so they were left alone rather than given invented history — they fall into the no-VAD half.

## What the data actually is

Not hand-written numbers. The prosody traces are produced by running the **real energy-envelope extractor the live player uses** over a synthesised 60-frames-per-second speech trace, so each row carries the same fields, the same contour encoding and the same extractor version a real learner's microphone produces. The difficulty curves come from the same tested source the schools demo uses. It is the identical logic proven this morning, now shared by both scripts rather than copied — and verified byte-for-byte identical to what it replaced.

Each learner's metrics attach to the LEGOs they actually practised, on the course they are actually enrolled in, and each prosody trace is timestamped inside one of their real past sessions. Nothing floats free of their existing history.

## Verified live in the browser

Two real India students, opened in the live admin view on the dev deployment, signed in as a real admin account:

**Kavya Chandra** — topped up. Her page shows **Adaptive pause mastery, 12 LEGOs: Confident 8 · Mastered 4**, sitting under her English-for-Hindi course card and her recent activity. Populated, coherent, no gaps.

**Riya Pillai** — deliberately no VAD. Purple belt, two hours twenty of practice, 590 LEGOs of progress, last active 28 July — a rich, busy student. With diagnostics expanded, the mastery section **is simply not there.** No zeros, no "0 of 0", no broken widget. It reads as a student who never had a mic, because that is what it is.

Both pages loaded clean with no errors.

## Safety

The script only ever inserts, into exactly two tables. It never deletes and never updates. Schools, regions, classes, courses, enrolments, join codes and learner identities were not touched by a single statement.

It is also safe to run again: a class that already carries VAD is skipped whole, including its deliberately empty half. A second run writes nothing — confirmed by running it again and getting "nothing to do". That guard matters, because filling in the empty half on each run would quietly walk coverage from 48% to 74% to 87% and destroy the point of the mix.

A read-only dry run was done first and matched the real run exactly.

---

*Live database figures, queried after the run. Browser verification on the dev deployment, 6 August 2026.*
