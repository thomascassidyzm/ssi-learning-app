# Founder Pass B — flat student rows · kill streaks · delete Class tools

**Date:** 2026-07-19 · **Branch:** dev (`33b8686b`, polish `2c71ab31`) · **Verified on deployed dev** (`ssi-learning-app-git-dev-zenjin.vercel.app`) with a real ssi_admin session.

## 1. Student data on one row — DONE

Every per-student figure now sits flat on the row on the class node home — no click, no expansion panel (the panel is deleted, not just hidden):

**health dot · name · last practised · course-journey bar (LEGOs done of course total) · last-7-days sparkline + week minutes · belt · LEGOs · practice hours**

- Journey numbers speak LEGOs ("79 of 635 LEGOs") — position-is-LEGO ruling respected, no "seed" anywhere.
- Phone: the row wraps — name line, then belt/LEGOs/hours strip, then the journey bar full-width. Sparkline is the one thing dropped on phone.
- Rows are static (nothing to click): there is no individual learner page (pass A) and now no expansion either. Simpler won.

Evidence: `founder-pass-b/class-home-flat-rows.jpg` (26 students, Blwyddyn 5) · `class-home-flat-rows-phone.jpg` (390px).

## 2. Streaks killed — DONE (and the database never had them)

Removed from every surface, honouring `docs/gamification-done-right.md` ("Streaks: creates guilt, shame, and dependency on external validation"):

| Surface | What went |
|---|---|
| Class node home student rows | "Streak Nd / no current streak" block (with the whole expansion) |
| `/api/groups/:id/home` | `streak_days` field + `streakFor()` computation |
| Admin user detail (`/admin/users/:id`) | Streak stat in the activity hero + `currentStreak` computed |
| StudentProgressView | "You're on a N-day streak" greeting + Streak stat card. (This view is currently **orphaned** — its mount died with the individual learner page in pass A — so these were unreachable, now gone anyway.) |
| `@ssi/core` types | dead `EnrolledCourseRow.streak` field |

**Database:** verified read-only against the live DB (`information_schema`): **zero streak columns, zero streak tables**. Streaks were only ever computed on the fly from daily-activity rows; every computation is now deleted. Expand-contract is satisfied with nothing to drop — no migration needed, nothing feeding anything else.

Deployed check: the word "streak" renders nowhere on class home or user detail (case-insensitive body scan). Evidence: `founder-pass-b/admin-user-detail-no-streak.jpg`.

## 3. Class tools deleted — DONE (admin surface)

- The "Class tools" verb is gone from the class node home.
- `/admin/schools/:schoolId/classes/:classId` now **redirects** to `/admin/classes/:classId` (no 404; verified live).
- **Verbs moved: none needed.** In the admin read-view that page had *zero* usable verbs — play-as-class is denied to the ssi_admin god-view by the 2026-07-16 owner ruling, and rename/delete/roster-edit/join-code are all teacher-side (`v-if="!isAdminView"`). It was a pure information duplicate, and the information now lives on the flat rows.
- **Scope note:** the teacher-facing `/schools/classes/:id` page (same component, real verbs: rename, delete, remove student, join code, play as class) is untouched — that's the teachers' working surface, not the admin "Class tools" page. If the ruling was meant to cover that surface too, it needs the teacher surface to grow a node home first — flagging rather than guessing.

## Checks

- player-vue suite: **108 files / 949 tests green** at dev HEAD (clean worktree; sibling agents' uncommitted work excluded). api suite: **69 files / 686 tests green**. Typecheck + core build green.
- Deployed walk (real admin session): flat rows ×26, journey bars ×26, sparklines ×26, expansion panels ×0, "Class tools" absent, "streak" absent, redirect lands on the class node home, phone stats visible.
- APML (`apml/schools/node-home.apml`, `insight-engine.apml`) + `docs/THE-VIEW.md` updated in lockstep.

## Promotion

dev → staging promoted after the above went green (standing authorization; main untouched).
