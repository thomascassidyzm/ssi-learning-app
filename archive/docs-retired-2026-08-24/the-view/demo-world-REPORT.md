# IME rich demo world — REPORT

Founder ruling (2026-07-20): *"more classes, more students, more courses they
are taking, more schools, more school types — this would really make all those
learner insights pop."* Built on `dev`, verified against the deployed dev build
with a real admin session. Evidence in `docs/the-view/demo-world/` (JPEG).

## The world (two believable IME segments, 379 learners — cap 400)

**Segment 1 — state/public schools learning English** (existing Pilot +
Coastal regions, grown): 5 schools, 15 classes, 300 learners, every class at
20 students, six REAL English-for-X courses spread regionally-coherently —
`eng_for_hin` (Pune/Jaipur/Kochi legacy classes), `eng_for_mar` (Pune),
`eng_for_kan` (Kochi), `eng_for_guj` (Jaipur), `eng_for_tam` (Chennai),
`eng_for_tel` (Visakhapatnam). Course codes are verified against the
`courses` table at runtime — the generator aborts on anything that doesn't
exist. **Green Valley International, Jaipur** — previously an empty shell
school (no staff, no classes) — is now the STAR school (3 classes seeded at
seed 27–39, own admin + 3 teachers); **Harbour View, Visakhapatnam** stays the
struggling one (seed 3–6). Also cut one piece of debris: the empty duplicate
"Grade 7A" class at Sunrise Pune (0 students, seed 1).

**Segment 2 — NEW "Metro International Schools" region** (taught in English,
learners take X-for-English): 3 schools, 9 classes, 79 learners.
- **Oakridge International School, Bengaluru** — 7A French (`fra_for_eng`),
  7B Spanish (`spa_for_eng`, 4 dual-course kids from 7A).
- **Global Edge Academy, Mumbai** — Grade 8 German (`deu_for_eng`), Grade 9
  Mandarin (`zho_for_eng`), plus 8A/9A French electives dual-populated from
  the German/Mandarin rosters.
- **Lotus Valley International, Delhi** — Year 6 + Year 7 Spanish, and the
  founder's wink: a small **Welsh Club** (`cym_n_for_eng`, 8 kids, 5 of them
  doubling up from Year 6 Spanish).

**21 dual-course learners** across the segment — per-course vs all-courses
views genuinely differ.

Entitlements ride the standard machinery: every school keeps
`platform_status='trial'`; multi-course schools get `trial_course_code=NULL`,
which the app already reads as "no course lock". No bypasses.

## What shipped (code)

- **`cb032707` — refresh engine extension** (`api/_utils/demoNodeRefresh.ts`):
  telemetry now generated per **(learner, class) pair**, each course anchored
  to its OWN enrollment cursor, personas drawn per pair (a dual learner can be
  fast in French and idle in Spanish). Previously last-tag-won and a dual
  learner's second course read dead after the replace-delete. Hard-safety
  guards unchanged; new test pins both-courses + own-anchor + distinct
  learner count. api suite 638/638.
- **`e1c502bb` + peer-fix — `scripts/demo-data/enrich-ime-world.cjs`**: the
  whole world above, idempotent (Metro region is replace-idiom like the
  coastal generator; state enrichment is skip-if-exists + top-up-to-target;
  two consecutive runs both settle at the same counts). Cap enforced twice:
  plan-side against live counts, and a post-write re-count (would exit 2 over
  400).

## The one structural finding (and its DATA fix)

A school's insights default to its **busiest course** (ties alphabetical) and
compare against **peer schools on that course**. With every intl school on
unique courses, the default landed on a peerless course → honest k-floor
"Not enough data" on first open (Oakridge→French/no peer; Lotus would have
defaulted to the *Welsh Club*). Fixed with data, not code: French runs at TWO
classes at Global Edge (so `deu` can't win the tie) and Spanish at TWO at
Lotus (so `cym` can't) — now every intl school's default course has a real
peer and insights render on first open, while the k-floor stays honest.

## Verification on deployed dev (`e2e/the-view/demo-world-walk.mjs`) — 17/17 PASS

- Programme rate-compare carries **11 course options** (all real codes).
- Compare-to **'global · this course' vs 'global · all courses'** resolve
  differently (this-course honestly insufficient — global cohorts exclude
  demo by design; all-courses renders with cohort 3).
- **Per-course selector changes the entity data** (eng_for_hin vs fra_for_eng).
- **International school insights render full data** (Oakridge: 4.90 v 6.7 vs
  Metro region average, 2nd of 2, French default) — `intl-school-insights.jpg`;
  **state star school** too (Green Valley) — `state-school-insights-star.jpg`.
- **Dual-course learner (Sara D'Souza) appears in BOTH class views**
  (`class-7a-french.jpg`, `class-7b-spanish.jpg`); Welsh Club renders
  (`class-welsh-club.jpg`).
- **Measure picker** (rate / minutes_per_class / hours_total) present at an
  intl class and a state class.
- **Cold programme node-home: 1.1s wall to stats** (379 learners / 19
  teachers / 24 classes / 1320.7h) — `programme-node-home.jpg`.
- **Safety probe re-run**: refresh on a non-demo node (Welsh Gov Lang Office)
  → **403, zero writes**.

Refresh over the full programme (deployed endpoint, new engine): 8 schools,
24 classes, **379 learners, 4,797 sessions, 283 class sessions, 12,723 seed
rows, 44,551 lego rows in ~50s**, activity through the minute of the call.
DB probe: dual learners have sessions in BOTH their courses; 13 courses carry
sessions with latest timestamps today.

Suites green: api 638/638, player-vue 957/957, typecheck clean.

## Noted, not chased

- The course picker shows raw codes (`fra_for_eng`) rather than display
  names — pre-existing UI polish item on the lens, not demo-data.
- Programme-level "this course" global compare stays honestly insufficient by
  design (feat_17: global cohorts exclude demo data); the world comes alive at
  region/school/class where the cohort is its own peers.

*Last updated: 2026-07-20*
