# SSi DB security sweep — state of the nation (handoff for Fable 5)

> ## ✅ ADDENDUM 2026-06-10 (Fable 5): Lanes A + C + drift are DONE
> - **Lane A (secfix_12)**: applied via `keystone_canary.cjs --commit`, 11/11 green; persisted-verified 21/21 views invoker-on. Filed `91a3183d` on learner-app `dev` (local, push pending Tom).
> - **Lane C (secfix_13)**: cross-repo consumer scan found the real anon surface = 7 tables, incl. THREE missed by the original plan (Popty browser also reads `content_feedback`; learner-app browser writes `content_feedback`/`sample_flags`/`tester_feedback` + reads `lego_introductions`). ALL Camberley `services/` are service-key, so NO Popty code move was needed — calibrated policies instead (23 service-only / 4 read-only / 3 feedback write-paths preserved). `laneC_canary.cjs --commit` 33/33 green; persisted 30/30 RLS-on, 0 anon DELETE/TRUNCATE; re-verified end-to-end through PostgREST with the shipped anon key (3 allowed reads 200, 3 locked 401). Filed `01c0a856` on Popty `main` with the **drift capture** (`20260610_drift_capture_dashboard_auth_rls.sql`) — local, push pending Tom.
> - **DB-wide:** public tables RLS-off **58 → 28**.
> - ~~Remaining: Lane B only~~ **LANE B0+B1 ALSO DONE (later same day, Tom-blessed):** `secfix_14` = `current_learner_id()` bridge fn + own-row RLS on the 5 (verified EMPTY) learner tables + `player_events` client lockout (b0_canary 21/21). `secfix_15` = `class_sessions` backfilled to uniform auth uid (81 mapped, 8 guest demo rows deleted → 157/157) + full RLS; `relink_user_tags()` DEFINER bridge + full `user_tags` RLS with principal-scoped policies (b1_canary 29/29 + fixture cleanup). App pair: LearningPlayer writes auth uid (guests skip), useAuth re-points via RPC — commit `ada59a29` on dev, PUSHED. Until dev→main promotion, prod class-telemetry + tag re-point are policy-blocked (soft failures; all schools data demo). Design + remaining B2/B3: `LANE_B_identity_design.md`.
> - ~~Remaining now: B2 only~~ **B2 ALSO DONE (same night — Tom: "any reason we can't do B2 now?" + spare plan budget):** `secfix_16` = own-row RLS on **learners, sessions, course_enrollments, lego_progress, seed_progress, daily_contributions** (b2_canary 35/35 + fixtures). Reads via `can_view_learner_data()` (own/god/ssi_admin/govt/principal/class-teacher); writes own-row via the bridge; `claim_learner()` DEFINER fn replaces the client multi-email re-point (app pair `dfd71cc8` on dev, PUSHED); daily_contributions trigger flipped DEFINER, table client-read-only; **all 23 stale `jwt->>'sub'` policies replaced (live count 0)**; the learners.user_id account-takeover hole CLOSED. Then verified END-TO-END with a REAL JWT (synthetic auth user → real PostgREST → signup/play/scoping/takeover all correct → cleaned up). E2e discovery: signup's learner row comes from an auth.users trigger.
> - **THE SWEEP IS DONE. RLS-off public tables: 58 → 15**, all either content-by-design (course_*, canonical_*, listening_*, shared_audio) or the schools ORG tables (schools, classes, groups, govt_admins, invite_codes, entitlement_grants — anon already revoked 06-02; full org-table RLS = a future schools pass). B3 (TEXT→uuid retyping) = no-deal under better×simpler×cheaper (cast centralised in 2 fns).
> - **PROMOTED:** dev verified (Vercel build green, shipped bundle carries the bridge RPCs) → `staging` fast-forwarded `93896fff..dfd71cc8` same night for the proper soak (Tom's call). Prod (`main`) keeps the OLD app code until staging→main: class telemetry writes, tag re-point, multi-email re-point are policy-blocked there — soft failures, demo-data-only, play unaffected.
> - **Soak watch-list:** signup/login (auth-trigger learner row + own-row visibility), multi-email linking (`claim_learner`), class-play telemetry as a signed-in teacher, feedback forms; schools dashboards are EXPECTED dark on the Clerk-fake-id demo data until it's regenerated.

**Date:** 2026-06-10 · Live DB `swfvymspfxmnfhevgdkg` (Supabase). This is a HANDOFF: Tier 1 is already applied + verified + on `dev`. Read this before touching anything.

---

## 0. PRIME DIRECTIVES (read or you'll break prod / waste Tom's time)

1. **ONE shared Supabase = dev/staging/prod all hit the same DB.** There is NO separate staging DB. Every change is instantly live in production. "Test on staging first" is impossible.
2. **Tom must NOT be the tester.** Verify with the transaction-scoped **canary** (below): apply on live inside a txn, replay real app queries as anon/authenticated/service-role via simulated JWT claims, assert, COMMIT only if all green, else ROLLBACK. Dry-run rolls back = zero-write rehearsal on real prod data.
3. **Always assert BOTH halves:** the leak is CLOSED (anon → denied) **and** the legit paths STILL WORK (service-role read, authed dashboard read, guest read, teacher write). A migration that closes a hole but empties the player is a regression.
4. **Never `git add -A`** (tree carries other agents' work) and **never commit onto an existing `claude/**` branch** (auto-merges wholesale to dev). Isolate on a `fix/…` or `docs/…` branch; fast-forward/cherry-pick onto `dev`; confirm before push.
5. **DON'T blanket-REVOKE anon on course-prod tables** — Popty (the dashboard repo) reads many of them via the ANON key. Revoking breaks Popty. Those need a Popty-repo service-role migration FIRST.

---

## 1. WHAT'S ALREADY DONE — do NOT redo (live + committed, dev `5ac56c80`)

**Tier 1 secfix #5–#11**, applied 2026-06-10 via the canary (24/24 assertions green, independently re-verified persisted):

| # | Object(s) | Change | Verified still-works |
|---|---|---|---|
| 05 | 8 views: `learner_subscription_status` (who-pays), `learner_stats`, `learner_consistency`, `course_progress`, `weekly_leaderboard`, `school_summary`, `group_summary`, `feedback_aggregated` | `security_invoker=on` + REVOKE anon | service-role API + authed schools dashboards |
| 06 | `dashboard_invite_codes` | REVOKE anon/auth + RLS deny-all | service-role redeem path |
| 07 | `algorithm_config` (keep anon READ, kill write) + `app_config`,`gamification_config`,`phase_prompts`,`practice_prompts`,`presentation_templates`,`evolution_levels` (full anon lockout + RLS) | RLS + grants | guest player still reads algorithm_config |
| 08 | `user_tags` PARTIAL | REVOKE authenticated INSERT (close self-promote-via-INSERT) | admin soft-delete + service create-staff |
| 09 | `class_sessions` PARTIAL | REVOKE anon | teacher class-play writes |
| 10 | `regions` | RLS + REVOKE anon write (keep read) | authed admin read |
| 11 | `learner_emails` | codify RLS-on (drift) + REVOKE anon | service-role read |

**Current live counts (post-Tier-1):** tables **29 RLS-on / 58 off**; views **8/21 `security_invoker=on`**.

---

## 2. THE REMAINING WORK SURFACE (three lanes)

### Lane A — KEYSTONE: flip the other 13 views to `security_invoker=on` (drafted: `secfix_12`)
> **READY TO RUN.** `keystone_canary.cjs` (this folder) applies `secfix_12` + replays all the consumers below. **Dry-run already passed 11/11 green (2026-06-10).** To apply: `node ~/Desktop/SSi-secfix-2026-06-09/keystone_canary.cjs --commit` (commits only if still green against live state), then fast-forward/cherry-pick `secfix_12` onto `dev` per the branch rules. Dry-run anytime with no flag.

The 8 sensitive views are flipped; **13 remain off**. Until all are on, turning on base-table RLS (Lane C) buys dashboards nothing (views bypass it as owner). **CANARY-CRITICAL consumers to assert before commit:**
- `invite_code_validation`, `entitlement_code_validation` — **SECURITY-DEFINER by design**, read by the **signup** path (`api/code/validate.ts`) via service-role. Assert a known-good code still validates after the flip.
- `class_student_progress`, `class_activity_stats`, `demographic_cycle_averages`, `region_summary` + the already-flipped `school_summary`/`group_summary` — the `/schools` dashboards (authenticated). Assert they still populate.
- `course_stats`, `seed_with_legos`, `course_*`, `seed_cycles` — guest (anon) course discovery + content load. Assert a logged-out load still lists courses.
- **7 views still anon-readable** (all content, low-sev): `course_audio_inventory`, `course_phrases_unified`, `course_practice_phrases_with_type`, `course_stats`, `course_voice_breakdown`, `seed_cycles`, `seed_with_legos`. `course_stats` is needed by logged-out CourseSelector/BrowseScreen — **keep anon read**. The rest sit over content tables anon-readable by design.

### Lane B — Phase-B core learner tables (own-row RLS) — IDENTITY-BLOCKED
Still RLS-off + anon-writable: **`learner_points`, `learner_milestones`, `learner_practice_history`, `response_metrics`, `spike_events`**.
⚠ **The blocker is real and bit us already.** Enabling own-row RLS here breaks live client writes because **the app writes `learner.id` / synthetic ids, and writes as the anon key, not `auth.uid()`**. Concretely proven on the two B1 tables (see `PHASE_B_BLOCKED_user_tags_class_sessions.md`):
- `class_sessions` stores `teacher_user_id = learner.id` but policies check `auth.uid()` (= `learner.user_id`) → WITH CHECK fails → writes break.
- `user_tags` `useAuth.ts:226-237` re-points `user_id` OLD→NEW as the authenticated client → own-row `USING` evaluates the OLD row → blocked.
**Do NOT enable RLS on a client-written table without first** either (a) mapping identity in the predicate (`x IN (SELECT id::text FROM learners WHERE user_id=auth.uid()::text)`), or (b) moving the write to a service-role/DEFINER bridge. This is the same root the data-arch doc calls "the identity rework is the hard prerequisite." Verify each table's live write path (which client, what id) with a consumer scan before drafting its policy.

### Lane C — course-prod / Popty tables (30) — needs a POPTY-REPO pass first
Still RLS-off + anon-writable, but **Popty reads them via the anon key**, so they can't be locked from the learner-app side alone:
`apml_documents, audio_flags, build_jobs, build_lessons, checkpoint_approvals, content_feedback, conversations, course_audio_usage, course_checkpoint_config, course_checkpoint_results, course_export_states, course_gender_expansions, course_lego_positions, course_qa_flags, course_seed_drafts, language_briefs, language_pair_briefs, lego_introductions, orchestrator_messages, raw_seed_uploads, recording_provenance, sample_flags, target_audio, target_legos, target_phrases, target_seed_texts, tester_feedback, try_link_visits, try_links, voices`.
**Path:** in the Popty repo (`ssi-dashboard-v7-clean`), move its anon-key reads of these to the service-role client, THEN REVOKE anon + enable RLS. Same canary method, but the consumer-scan + code change is in Popty.

### Also: drift to capture (no behaviour change, just version control)
`canonical_pod_scenarios` (anon SELECT, RLS-on, zero migration) + `dashboard_login_codes`/`dashboard_sessions`/`dashboard_users` (RLS-on live, never in any migration) — Popty-owned; record their state in the Popty repo.

---

## 3. THE METHOD (canary harness — reuse it, don't reinvent, don't hand-test)

- **How it works:** Postgres DDL is transactional; Supabase RLS reads `auth.uid()` from `request.jwt.claims->>'sub'`. So in ONE txn: `BEGIN` → apply migration → per caller `select set_config('request.jwt.claims', '{"sub":"<uuid>","role":"authenticated","aud":"authenticated"}', true)` + `set local role <role>` → run the app's exact query in a SAVEPOINT → assert → `COMMIT` iff all green.
- **Files** (rebuild from these notes if `/tmp` was wiped on reboot): runner `/tmp/sqlrunner/run.cjs` (read-only default, `--write` commits); generic canary `/tmp/sqlrunner/canary.cjs` (`--spec X.json [--commit]`); the Tier-1 driver `/tmp/sqlrunner/tier1_canary.cjs` (good template). Connection = `ssi-dashboard-v7-clean/.env.psql` DATABASE_URL (pooler, connects as `postgres` → can `set role` anything).
- **Get real test identities read-only first** (a real learner id+user_id, a school-admin user_id who owns a user_tags row, a class_id, a real lego code) so write-replays don't false-fail on NOT NULL / FK. See `/tmp/ssi-probe/identities.sql`.
- **Bonus:** because `--commit` re-asserts against live state at commit time, a concurrent conflicting change shows up as RED and refuses to commit — so it also de-risks the "is another session touching the DB?" unknown.
- **Honest limit:** verifies the DB authorization layer (RLS+grants) — exactly what these migrations change. Can't see browser-only behaviour; mitigate with a cross-repo consumer scan (which query paths exist, as which role) BEFORE drafting.

---

## 4. ARTIFACTS & LOCATIONS

- **This bundle** `~/Desktop/SSi-secfix-2026-06-09/`: applied migrations `05`–`11`, the un-applied keystone `secfix_12_..._KEYSTONE.sql`, `PHASE_B_BLOCKED_…md`, `README_RUNBOOK.md`, this handoff.
- **Live probe snapshots** `/tmp/ssi-probe/*.json` (access_matrix, policies, view_defs, view_basetables — regenerate if `/tmp` wiped).
- **Full prior synthesis** `~/Desktop/SSi-dataarch-security-ACT-status-2026-06-09.md`.
- **Memory:** `project_ssi_status_resume_2026_06_09` (the gate + applied state), `reference_ssi_db_canary_method` (the method), `project_ssi_live_db_security_state`, `feedback_calibrate_security_advice_to_blast_radius`.
- **Repos:** learner-app `/Users/tomcassidy/SSi/ssi-learning-app` (on `dev` @ `5ac56c80`), Popty `/Users/tomcassidy/SSi/ssi-dashboard-v7-clean`.

## 5. RECOMMENDED ORDER for the sweep
1. **Lane A keystone** (`secfix_12`) — canary the signup + schools + guest paths, then commit. Completes the #1 doc prerequisite. Low risk, high structural value.
2. **Lane C Popty pass** — consumer-scan Popty's anon-key reads of the 30 course-prod tables, move to service-role, then REVOKE+RLS via canary. Biggest count, fully separable.
3. **Lane B identity bridge** — the deep one: persistent `auth.uid()` identity / server-write bridge, then own-row RLS on the 5 learner tables + full `user_tags`/`class_sessions`. This is the data-arch "identity rework" — treat as a project, not a migration.
4. **Drift capture** in Popty repo.

**Stop-ship reminder:** Lanes A + B are the gate before real paying freelancers (the ACT loop puts money behind `subscriptions`/`learner_subscription_status`). The payment TABLES themselves are already RLS-on + correct.
