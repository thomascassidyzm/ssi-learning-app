# SSi DB security gate — runbook (2026-06-09)

Verified against live prod `swfvymspfxmnfhevgdkg` (read-only probes + cross-repo
consumer scan, both repos). **One shared Supabase — there is no separate staging
DB: any change here hits dev/staging/prod simultaneously.** So every step is
apply → verify-as-role → rollback-if-broken.

Apply tool (the runner rebuilt this session):
- read-only probe: `node /tmp/sqlrunner/run.cjs --sql "..."` (BEGIN READ ONLY, rolls back)
- **apply (commits):** `node /tmp/sqlrunner/run.cjs --file X.sql --write`

## Pre-flight
1. **Confirm the other RLS/data-model session is parked** (shared DB; don't apply blind over a concurrent lane).
2. Snapshot rollback state:
   `node /tmp/sqlrunner/run.cjs --sql "select grantee, table_name, privilege_type from information_schema.role_table_grants where table_schema='public' and grantee in ('anon','authenticated') order by table_name" > /tmp/ssi-probe/grants_before.json`

## Tier 1 — verified safe, apply now (no client-write dependency)
Apply in order; run the verify after each.

| File | Effect | Verify (expect) |
|---|---|---|
| `secfix_05_close_leaky_learner_views.sql` | security_invoker=on + REVOKE anon on 8 PII/intel views | as anon: `select * from learner_subscription_status limit 1` → **permission denied / 0** |
| `secfix_06_lock_dashboard_invite_codes.sql` | REVOKE anon/auth + RLS deny-all | as anon: select → **denied**; Popty redeem (service) still works |
| `secfix_07_lock_app_config_tables.sql` | algorithm_config keep-anon-READ/kill-write; 6 others anon-locked + RLS | as anon: `select key,config from algorithm_config limit 1` → **still returns** (player ok); `insert into app_config ...` as anon → **denied** |
| `secfix_10_regions_rls.sql` | RLS on (dormant policies) + REVOKE anon write | as anon: `select * from regions limit 1` → **returns**; `delete from regions` as anon → **denied** |
| `secfix_11_codify_learner_emails_rls.sql` | codify live RLS-on (idempotent) + REVOKE anon | as anon: select → **0/denied** |
| `secfix_08_user_tags_partial.sql` | REVOKE authenticated INSERT (close self-promote-via-INSERT) | as authenticated: `insert into user_tags(...)` → **denied**; schools dashboard read still works |
| `secfix_09_class_sessions_partial.sql` | REVOKE anon (close public read/forge/wipe) | as anon: `select * from class_sessions limit 1` → **denied**; class-play (authenticated) unaffected |

**Verify-as-role pattern** (anon example):
```
node /tmp/sqlrunner/run.cjs --sql "set local role anon; select count(*) from learner_subscription_status;"
```
(expect `permission denied for view ...` after secfix_05). Use `set local role authenticated` for the authenticated checks (note: bare authenticated has no JWT, so own-row policies return 0 — that's expected; the meaningful auth checks need a real session and are best smoke-tested in-app).

**Rollback any Tier-1 step:** the inverse grant, e.g.
`GRANT SELECT ON <view> TO anon;` / `ALTER TABLE <t> DISABLE ROW LEVEL SECURITY;` /
`GRANT INSERT ON user_tags TO authenticated;`

After Tier 1: smoke-test the live app — (a) logged-out cold load lists courses + plays first audio (Dublin demo path); (b) a teacher/school-admin dashboard still populates; (c) signup code validation still works.

## Tier 2 — KEYSTONE, canary-gated: `secfix_12_views_security_invoker_KEYSTONE.sql`
Flip all 21 views to security_invoker=on. **Do not blind-apply** — run inside one
transaction, test the canary-critical consumers as their roles, COMMIT only if green.
Harness:
```
# 1. apply in a held transaction is not possible across runner calls; instead:
# 1a. apply --write, then immediately run the in-app smoke tests below;
#     if any fails, run the per-view rollback (security_invoker=off) for the culprit.
node /tmp/sqlrunner/run.cjs --file 20260609_secfix_12_views_security_invoker_KEYSTONE.sql --write
```
Canary smoke tests (must all pass, else rollback the offending view):
- **Signup**: redeem a known-good invite + entitlement code → still `valid:true`
  (tests invite_code_validation / entitlement_code_validation under invoker).
- **Schools**: load a teacher + school-admin + govt-admin dashboard → populates
  (class_student_progress, class_activity_stats, school_summary, group_summary, region_summary).
- **Guest**: logged-out app load → course list + content load (course_stats, seed_with_legos, course_*).
Per-view rollback: `ALTER VIEW public.<view> SET (security_invoker = off);`

## Tier 3 — BLOCKED on identity bridge (do NOT enable RLS yet)
`PHASE_B_BLOCKED_user_tags_class_sessions.md` — full RLS-enable for user_tags +
class_sessions breaks live client writes (learner.id vs auth.uid() mismatch; the
useAuth re-point). Needs the write paths bridged to service-role/definer first.
The Tier-1 partials already close the anon/INSERT vectors.

## Not handled here (separate tracks)
- 45 RLS-off **course-prod** tables anon-writable (build_jobs, orchestrator_messages,
  target_*, voices, audio_flags, course_gender_expansions, raw_seed_uploads, …):
  **Popty reads many via the anon key** — cannot blanket-revoke; needs a Popty-repo
  pass to move its reads to service-role first, then lock. Separate from the learner-app gate.
- Drift: `canonical_pod_scenarios` (anon SELECT, RLS-on, no migration) + the
  `dashboard_*` tables — capture in the Popty repo.

## Version control
On GO, after live-apply, drop the applied `.sql` files into
`ssi-learning-app/supabase/migrations/` and commit on a **non-`claude/**` branch**
(e.g. `docs/secfix-phase-b`) so Tom cherry-picks the SHA into dev — never commit
onto an existing `claude/**` branch (auto-merges wholesale to dev).
