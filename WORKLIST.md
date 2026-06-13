# WORKLIST — ssi-learning-app · shared, multi-agent. READ THIS HEADER BEFORE EDITING.

The live "what's next" for this repo, for **all** agents (local, cloud/web, any account).
Coarse on purpose — for Opus: **directions, things to build, areas to think through.** One line per
item; if it needs detail, **link a doc** (the plans under `docs/methodology/`), don't inline it.
This is *not* a bug tracker or a subtask list, and it sits **on top of** the dev-branch rail in
`CLAUDE.md` — it doesn't restate it. Per-doc status lives in `docs/methodology/README.md`.

### How to use (the whole protocol)

**Status marks** — one box + a suffix, nothing else:
- `[ ]` open — free to grab
- `[~] @handle MM-DD` — claimed / in progress (e.g. `[~] @tom-local 06-13`)
- `[x] @handle MM-DD` — done (leave it; the groomer archives it)
- `[!] @handle MM-DD — why` — blocked / parked

`@handle` = a stable tag you pick for yourself (`@tom-local`, `@cloud-3`, `@web-acctB`). Date = today, `MM-DD`.

- **Grab:** flip `[ ]`→`[~] @you MM-DD` and commit **only that one line** (`worklist: claim <slug>`). If it's already `[~]`, pick another. A `[~]` older than **5 days** with no branch behind it is stale — re-grab it, note `(was @x, stale)`.
- **Add:** append `[ ]` to the **end** of the relevant section. Never renumber/reorder/reflow existing lines (append-only keeps merges trivial).
- **Finish:** flip `[~]`→`[x] @you MM-DD`, same one-line commit.
- **Merge conflicts here are always two independent line edits → keep BOTH, strip the markers.** Never overwrite the other side. Don't bundle worklist edits with code commits.
- **Branch hygiene** (inherits `CLAUDE.md`): claim/finish commits ride your normal working branch. **Never** add a worklist commit onto someone else's `claude/**` branch (it auto-merges wholesale to dev).

---

## 🧭 Directions / bets   (the why — changes rarely)

- **The Insight Engine is the spine.** Every new analytics surface is an *instance of the engine* (a registry metric + a library widget + a `discover`/`explain` call), never a one-off page. → `docs/methodology/insight-engine.md`
- **Measure speaking without ASR.** Behavioural tier now (taps, skips, latency, calibration); prosody/VAD later, adoption-paced. → `docs/methodology/metrics-architecture.md`
- **One substrate, many lenses: `learner → class → group → school → chain`.** Same metrics rolled up a level. The **class is a first-class learner-equivalent** (gets the learner self-view), read by its teacher and the leaders above. → `docs/methodology/tutor-insights.md`
- **Tags & relationships, not folders & ownership** — but a real *belonging* stays a hard FK (a class belongs to a school). Grouping above the class is flexible overlapping tags.
- **Database-first; quality bar for schools is zero-tolerance** (no audio that mismatches text). Promotion is `dev → staging → main`.
- **Every decision passes the BSC test — Better × Simpler × Cheaper (multiplicative).** Write the three-bullet narrative or don't do it. Agents self-apply it and proceed at >90% narrative confidence (no need to ask Tom). → `CLAUDE.md` "Decision heuristic: the BSC test"

## 🔨 To build   (claimable — one line, link the plan)

- [x] @claude-local 06-13 **Metrics rollup (workstream A → B4) — SHIPPED** (`f9929aaf`): the per-(learner,lego) difficulty *series* B1/B4 read is now persisted (Option 2 via BSC — series in Layer 1). `LegoMetricsStore.upsertSeries` + a bounded ring in `useAdaptationEngine` (seeded on init → carries across sessions), written in an **isolated upsert** so it can't regress mastery. core 416 + player-vue 344 + typecheck + build green. **ACTIVATED 06-14** (migration applied — the series now persists live; **M0 complete**). Next: M1 consumers read the live series (teacher 'needs attention' + curvature overlay, D3).
- [ ] **Class-as-first-class, in order:** ~~migration~~ ✅ → ~~relationship reads~~ ✅ (`90dd857e`) → ~~tag-write endpoint~~ ✅ (`31b35312`) → **RLS rebase** (last co-teaching gate, below) → **coverage boards**. Co-teaching is now wired end-to-end except a non-lead teacher can't yet SELECT a co-taught class until the RLS swaps ownership→membership. → `docs/methodology/class-first-class-citizen.md` (rollout §6)
- [ ] **Coverage boards (class-as-learner):** pace / dosage / efficiency over wall-clock, for the leader stack. *After* the migration lands. → `tutor-insights.md` §2
- [x] @claude-local 06-14 **Teacher-tag write endpoint — SHIPPED** (`31b35312`): `POST /api/teacher/class-teachers` (add/remove/hand-over, service-role, authz = class teacher / platform / school admin) + `addClassTeacher`/`removeClassTeacher` client helpers; `createClass` now seeds the creator's relationship (closes the lead-pointer-only gap). The **RLS rebase below is the only remaining piece** for a non-lead teacher to SELECT a co-taught class.
- [ ] **RLS rebase (with Lane B): ownership→membership** — swap `c.teacher_user_id = auth.uid()` for `is_class_teacher(...)` in the live policies (keep `is_god_user()` + school-admin branches) so a non-lead teacher can actually SELECT a co-taught class. *The other half that makes co-teaching function.* → `class-first-class-citizen.md` §5
- [ ] **Insight Engine boards beyond the Discovery feed** — course scoreboard, content-friction queue, health strip. → `docs/methodology/insight-engine-build-plan.md`
- [ ] **Atom-fusion upstream (Popty):** persist the 3 files + atom map and forced-align the clause once; the compute core already landed on dev. → `docs/atom-fusion-introduction.md`
- [ ] **Forced-alignment path** (remove the Azure-timings dependency; covers Welsh-human + xAI-no-timings). Re-validation in progress.
- [ ] **Schools loose ends:** bulk-invite-staff endpoint (`SetupView.vue` TODO); wire school/global benchmarks (`AnalyticsView.vue:290` shows class-avg only); verify `contentFriction` RPC migration `20260602` is applied.
- [x] @web 06-13 **Curvature engine (metrics B1)** — level/velocity/acceleration via trailing local quadratic fit + own-noise alarm; pure `@ssi/core` `learning/curvature.ts` (17 tests, APML spec). The start-now compute primitive; consumers B4/C2/D3 gated on it. → `docs/methodology/metrics-implementation-plan.md` §1 B1
- [x] @web 06-13 **Competence band (metrics G1)** — flat hours-on-task estimate (30h/100h anchors) in pure `@ssi/core` `learning/competenceBand.ts` (10 tests, APML). Reads `total_practice_minutes` (exists today). Compute only; admin/tutor surface + legal framing copy left for Tom/Aran. → `metrics-implementation-plan.md` §1 G1 / `metrics-architecture.md` §12 H2
- [x] @web 06-13 **Local difficulty sensing (metrics B4)** — curvature per (learner, unit) in pure `@ssi/core` `learning/localDifficulty.ts` (9 tests, APML). Sensing only (struggling/easing/steady); the bridge from B1 to the M2 controller. Live wiring needs persisted Layer-1 (A3 migration). → `metrics-implementation-plan.md` §1 B4

## 🤔 Areas to think through   (open design — link the think-piece)

- [ ] **Flexible grouping layer** — the tag vocabulary for year / department / faculty / chain, and how a leader declares scope over it. The next-design-area for teaching insights. → `tutor-insights.md` §5
- [ ] **Adaptation engine (M2)** — the defer / drill / consolidate budget driven by curvature. Design explored 06-13 (`docs/methodology/adaptation-budget.md`); **next code step is B4** (curvature per unit) + Layer-1 persistence, not the controller itself. → `metrics-architecture.md` §4
- [ ] **Prosody / VAD axis (M3)** — what to capture, when; gated on opt-in adoption. Orphaned VAD fields are computed-then-dropped today. → `metrics-architecture.md` §6
- [ ] **CEFR-via-calibration (M4–M5)** — the research roadmap; pilot-coupled timeframe.
- [ ] **Daily agent routines** — which sensible analyses are worth a ProMax routine. Repo-only ones (e.g. a WORKLIST groomer) work in cloud today; Supabase ones need the service key in the routine env (no Supabase MCP yet).

## 🚧 In flight / don't collide

- teacher↔class M2M stream — **merged to dev; migration APPLIED 06-13** (edge endpoints + `20260613` live). Branch `feat/class-teachers-edge` cleaned up — don't go looking for it on the remote. Coordinate via dev before touching the class/teacher data model.
- `fix/pod-phase0-explainer-stage` — listening v2 + Phase 0 explainer; awaiting Tom's ear/merge.
- Atom-fusion **compute core** is on dev (`4cccc6f1`); the Popty persistence upstream is unbuilt (see To build).
- `worktree-agent-*` branches are parallel scratch — don't reuse those names.

## ⛔ Blocked / parked

- [x] @tom 06-13 **Migration `20260613_class_first_class_citizen.sql`** — APPLIED & verified (7 lead tags backfilled, `class_teachers` view + `is_class_teacher()` live; additive, app still reads the lead pointer). The app-read migration ownership→membership is the next step (see To build), not this.
- [ ] **Metrics M1 — UNBLOCKED 06-14** (M0 complete: A1 + A3 + the series write all live). The series now flows; build the M1 consumers that read it — teacher "needs attention" (group-relative + who-just-changed curvature overlay, D3) on real data. → `metrics-implementation-plan.md` §1 D3 / M1
- [!] **Supabase cloud sentinels** (health pulse / webhook integrity) — need the service key in the routine environment, or a Supabase MCP connector. No path from cloud today.

## ✅ Done (archive — groomer-managed, don't hand-edit)

- 2026-06-13 — Tutor-insights v2 (attention vs coverage; class-as-learner) + class-first-class-citizen migration drafted.
- 2026-06 — Listening mode v2 (stage modes, teleprompter, cache-horizon, glosses); Insight Engine Discovery feed at `/admin/insights`; secfix #1–16 (RLS hardening + identity bridge).

---

*Cross-SSi: this is the learning-app worklist. Popty (`ssi-dashboard-v7-clean`) and other repos get their own `WORKLIST.md` of the same shape. A daily repo-only "groomer" routine can archive `[x]`s, free stale `[~]`s, and surface shipped/dead items as a commit for review — it never silently rewrites live intent.*
