# Friday release train — readiness, 7 August 2026

Prepared for the promotion hour. **Nothing was promoted, merged, deployed or applied** — this is the picture, the lever is yours.

---

## The one-minute version

**Ship `staging → main`.** It is a player release: a session that never stalls, Easy and Fast modes, listening that goes straight in, and repaired audio that actually reaches a returning learner. No money path, essentially no auth, and — the thing worth knowing — **no schools or orgs source files differ at all**; that work already went live earlier in the week. Full test suite green on staging. Production is exactly at `main` HEAD, so there is no lag to clear first.

**Do NOT apply the co-teacher perf migration** that is sitting on staging. It has gone stale against the live database in the last sixteen hours and would silently cut read access to six live school admins. It is not part of the promote — it is applied by hand — so this holds the migration, not the ship.

**Hold today's listening changes on dev for a week.** A-52 and T-13 are good work, tested, and small. But they change what a learner *hears* on their first listening lap and the speed Easy plays at, and nobody has listened to them yet. A week on staging costs nothing; a wrong pace shipped to production is the kind of bug you only notice slowly.

**The A-53 question is clear.** The hotfix that went straight to `main` on Wednesday is present on staging and has since been extended. Promoting does not regress it.

---

## 1. Staging vs production — what production is missing

`origin/staging` is 232 commits ahead of `origin/main`; 149 are real by patch-equivalence. **That number overstates it.** The schools and orgs commits are in the range by ancestry but their content is already identical in `main` — they landed via a different merge route. Judge by content:

| Bucket | Files | Lines |
|---|---:|---:|
| **Real source code** | **51** | **+2,604 / −859** |
| Unit + integration tests | 25 | +2,096 / −155 |
| e2e probe scripts | 29 | +3,188 / −2 |
| Locale files, 22 languages | 22 | +1,396 / −944 |
| APML specs | 10 | +649 / −34 |
| Docs, incl. one 87k-line audio census JSON | 29 | +90,499 / −3 |

The headline "100,818 insertions" is 90% one JSON file. **The thing you are shipping is 51 files and about 3,500 lines, with 2,096 lines of new test behind it.** A test-to-code ratio of 0.8:1 is the strongest quality signal in this candidate.

### What a learner actually notices

**A session never stalls, and never repeats itself into the ground.** The player carries on when an item has no audio instead of freezing, and no mode plays you the same prompt three times running. *5 files, +549/−61. Biggest blast radius in the release — it rewrites round assembly on the path every learner takes — and also the best-covered thing here, 754 new test lines. If it were wrong, the failure is a silent pedagogy change, not a crash.*

**Two modes: Easy and Fast. Turbo retired.** Easy halves the longest phrase and holds a beat after voice 2, new learners start on Easy, and the chosen mode is finally visible at White Belt. *7 files, +536/−224. Changes the default experience for every new learner. A wrong default is a worse course, noticed slowly.*

**Listening goes straight in, at the right speed.** Tapping Listening starts the exercise with no intro popup, and target clips follow the belt speed ramp instead of a flat 1.0×. Courses with no pods stop keeping a dead offline snapshot. *7 files, +198/−71. Worst case for an offline learner is a re-download.*

**Repaired audio actually reaches you.** When a clip has been re-recorded you hear the new one — including on the returning-learner cache path and inside downloaded listening snapshots. This is the German-still-sounds-old bug, now closed on every lane. *4 files, +248/−65. Low risk and asymmetric: a miss means a stale clip, which is exactly today's behaviour.*

**Components are never introduced.** No separate little introduction for each piece of a phrase — the M-LEGO's own introduction names its pieces, and that is the introduction. Your ruling of 6 August. *3 files, +33/−105 — a net deletion, so the risk runs in our favour. It reverts a two-day-old behaviour that never reached production.*

**The app stops dying halfway through an update.** A new build no longer rips the running app out from under a learner mid-session, and a plain reload gets fresh code. *3 files, +107/−38 in the service-worker lifecycle. This is the theme most able to affect everyone at once, but the change is in the safe direction — the new worker waits instead of claiming. The failure mode to watch is the opposite one: "nobody ever gets the next build", which stays invisible until the build after this.*

**The app speaks your language about languages.** Language names read in your own language, not English; French says *d'Anglais*, not *de Anglais*. *2 files plus 22 locale files. Cosmetic, per-locale.*

Smaller: the between-rounds encouragement card renders again; a production deep link lands on the right round and cycle; pause length and Layer-1 scheduling tighten slightly.

**Money path: untouched.** **Auth: one file**, `useAuth.ts`, deep-link intent handling only — no session, token or OTP logic. **Schools and orgs: zero source files differ.**

---

## 2. Dev vs staging — today's work

Dev is 11 real commits ahead: **19 code files, +1,608/−78**, in three separate strands. Dev is also 43 commits "behind" staging, but that is merge and promote residue — dev's content is a superset, nothing is missing.

### Strand A — the listening changes you asked about (A-52, T-13)

**The cold start is one full exchange, and Easy listens at 0.8×.** A first listening lap is never a single line on repeat any more; it opens with a complete exchange. And a learner on Easy hears listening at 0.8× — implemented as the white-belt rung of the existing belt ramp, held for as long as they stay on Easy, capped rather than layered so Easy is never faster than the belt would give. Legacy courses with already-slow voices take the same exemption the ramp does, so they are not slowed twice. Target clips only — the known-language meaning anchor is never slowed.

Tested: 38 speed-ramp tests on dev against 25 on staging, plus the pod-cohort and lap-scheduler suites. All green.

**My recommendation: hold for a week.** Not because of risk to the code — it is small, well-scoped and covered. Because these two changes are *about how something sounds*, and the only test that matters for that is your ear. Nothing has been verified by ear on either. A week on staging costs nothing and buys the one check the test suite cannot do. If you would rather hear it on staging tonight, promoting `dev → staging` is the cheap move — that is a separate lever from the one this doc is about.

### Strand B — the schools leader work, and a live incident you should know about

A school admin who holds the admin **tag** rather than being the founding **pointer** admin was blind to her own school's classes: Dashboard showed three classes, the Classes tab said "0 classes" and offered "Create your first class". An empty state is an assertion about the world, and that one was a lie. **It was never just one person — six live school-admin tags were affected.**

The database half of that fix **is already applied live**, so production is already fixed for it. The code half is on dev: a leader can now assign a teacher to classes from the people side, with a checkbox picker, pre-ticked, one interaction to move someone between classes. Adding a teacher to a class that already has one makes them a **co-teacher**; the existing lead keeps the lead. Say the word if you want assigning to take the lead over instead.

**The incident.** While that was being fixed, a second agent worked the same bug at the same time with live database access, reached the same diagnosis, and applied its own version — which dropped a guard clause on the rule governing who may edit user tags. Postgres fails open there: for a matter of minutes, any signed-in user could have promoted themselves to school admin. It was spotted, proved open, closed, and proved closed again, and the check that catches it is now permanent. **Nothing to do tonight** — it is closed and verified — but you should know it happened.

### Strand C — the CI cost fixes

Three fixes, landed at 17:01–17:04 today. Detail in §3.

---

## 3. Readiness

### Tests — green on both refs, zero failures, zero commands that could not run

Run in isolated worktrees, full CI-gated suite on both `origin/staging` and `origin/dev`:

| | staging | dev |
|---|---|---|
| `@ssi/core` test | 635 passed | 645 passed |
| `player-vue` typecheck | clean | clean |
| `player-vue` test | 1,829 passed | 1,871 passed |
| `player-vue` lint | 0 errors, 150 warnings | 0 errors, 151 warnings |
| `typecheck:api` | clean | clean |
| `test:api` | 1,139 passed | 1,139 passed |
| release-train tooling test | 25/25 | 25/25 |

Warnings are pre-existing and do not gate. **Staging is green enough to promote. Dev is green enough to promote.**

### GitHub Actions billing

Actions was blocked **13:30–16:26 UTC today** — every run failed in three to five seconds with a spending-limit annotation. Three cost fixes landed:

1. `verify.yml` no longer runs on `claude/**` pushes — the auto-merge workflow already ran a byte-identical verify on the same SHA. **452 CI-minutes reclaimed over four days.**
2. Concurrency groups with cancel-in-progress, with staging and main pushes exempted so promotion evidence runs are never cancelled.
3. Docs-only commits skip the full suite. **A further 168 minutes over four days.**

**Actions is running clean now** — verified, green runs after the fix, both gate workflows active, no billing failures since 16:26.

**If you promote right now:** CI runs on main, and **Vercel builds and deploys regardless** — Vercel builds off its own git webhook, not off Actions. Proved two ways: no workflow in this repo calls `vercel deploy`, and staging's live build stamp already matched its newest push while Actions was down. Actions being blocked earlier today never stopped a deploy; it only blocked the merge gate into dev.

### Migrations — one item, and it is a hold

**`20260807_co_teacher_class_page_perf.sql`** (on staging, not on main). A genuine performance fix: a non-lead co-teacher opening her class page got five 500s per load from a statement timeout, because an RLS predicate seq-scanned every class per row. The rewrite is claimed at 2,050 ms → 85 ms. It has a proper canary and a rollback script.

**Do not apply it as written.** A direct query of the live database found the migration is not applied *and the live schema has moved past the state its rollback captured at 01:29 UTC today*. The live policies now resolve school admins through `is_school_admin_of()`, which recognises **both** the founding-admin pointer and the admin tag. The migration's replacement helper only covers the pointer. Applying it today would silently drop read access for every non-founding, tag-based school admin — the exact silent-empty failure the RLS doctrine exists to prevent, and the same bug that was just fixed for those six people.

It needs rebasing onto the current live semantics, a rollback re-captured from current live state, and a canary re-run with a tag-based school admin among its principals. **None of this blocks the promote** — the migration is applied by hand, nothing in the staging code references it, and the co-teacher page stays exactly as slow as it is today.

> **Honest note on a disagreement between my two checks.** One worker recommended applying this migration; the other queried the live database and found the staleness. I have gone with the live-database evidence. If you want the perf fix tonight, the rebase is maybe an hour of work — but it is not a tonight job at speed.

The three dev-only school-admin migrations are already applied live and need no action.

### Config and environment

**Nothing to change in production.** `vercel.json` byte-identical across all three branches, no dependency changes, no new endpoint, and zero new `process.env` references anywhere in the API diffs in either direction.

**Explicit gap:** the Vercel CLI is not authenticated in this environment, so I could not run `vercel env ls` to cross-check the dashboard. Since no code reads a new variable, the risk is low, but treat "Vercel env vars are already correct" as unverified rather than confirmed.

### Deploy state

| | Serving | Branch HEAD | |
|---|---|---|---|
| `saysomethingin.app` | `283e81a` | `283e81a` | **exactly at main** |
| `staging.saysomethingin.app` | `52ab52c` | `52ab52c` | **exactly at staging** |

Production is not lagging. Nothing to clear before you pull the lever.

---

## 4. Recommended train manifest

| # | Change | Verdict | Reason |
|---|---|---|---|
| 1 | **`staging → main`** — the player release | **SHIP** | Green on the full suite, no money path, one auth file, zero schools source change, 2,096 new test lines behind 51 changed files. |
| 2 | Never-stall player + no triple repeat | **SHIP** | Largest blast radius, best-tested thing in the release. |
| 3 | Easy / Fast modes, turbo retired | **SHIP** | Soaked on staging since 6 August; failure mode is a worse default, not a break. |
| 4 | Listening straight in + belt speed ramp | **SHIP** | Already soaked; worst case for an offline learner is a re-download. |
| 5 | Repaired audio reaches every lane (A-53 / A-86) | **SHIP** | Extends a fix already in production; a miss just means today's behaviour. |
| 6 | Components never introduced | **SHIP** | Net deletion reverting a behaviour production never saw. Your ruling. |
| 7 | Service-worker lifecycle fix | **SHIP** | The safe direction — the new worker waits rather than tearing down a live session. Watch it after the *next* build, not this one. |
| 8 | Language names + French elision | **SHIP** | Cosmetic, per-locale, tested. |
| 9 | Docs, e2e probes, APML, locales | **SHIP** | Ride free, no runtime effect. |
| 10 | **`20260807_co_teacher_class_page_perf.sql`** | **HOLD** | Stale against the live schema; would silently cut read access to six tag-based school admins. Rebase, re-capture rollback, re-canary. |
| 11 | **A-52 / T-13 listening cold start + Easy 0.8×** (dev) | **HOLD one week** | Tested but not heard. These change how the product *sounds*; your ear is the only gate that counts. |
| 12 | Schools leader assign-to-classes (dev) | **HOLD one week** | Database half already live and fixing production. Code half is new UI on a surface with a zero-tolerance bar — let it soak. |
| 13 | CI cost fixes (dev) | **HOLD, no urgency** | Already doing their job on dev; nothing gained by rushing them to production. |

### After you deploy, three things to look at

1. **One real session on production.** `LearningPlayer.vue` absorbs five of these themes at once — it is the single file most worth a live look.
2. **The PWA update prompt.** First production build with the new service-worker lifecycle. The failure mode is "nobody ever gets the next build", invisible until the build after this one.
3. **A returning learner on a course with a repaired clip.** The A-53/A-86 path only exercises on a second session, by definition.

---

## Explicit gaps

- The migration canary was not run — that writes to the shared live database. The staleness finding comes from reading live `pg_proc` and `pg_policy`, not from a canary run.
- Not verified whether the canary's fifteen principals include a tag-based school admin. If none is present, the canary would pass the migration despite the regression.
- `useAuth.ts`'s deep-link change has no dedicated unit test; e2e coverage was inferred from probe filenames, not read probe by probe.
- The migration's own timing claims (2,050 ms → 85 ms) are quoted from its header, not re-measured.
- Vercel environment variables could not be listed — CLI not authenticated here.
