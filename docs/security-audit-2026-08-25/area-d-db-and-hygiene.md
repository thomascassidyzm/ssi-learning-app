# Area D — database posture, repo hygiene, security-test machinery integrity

2026-08-25 audit, Area D. Branch `security/audit-0825-d-gates`. Static analysis only —
no SQL run against production, no writes, no live HTTP/DB contact of any kind.

Do not re-file anything the shared digest already lists as open (TENANCY-01, AUTH-CORE-01,
INPUT-01, CLIENT-01, the 08-18 IP-spoof throttle key, class-progress untrusted args) or
closed (Paddle webhook tenant-hijack, SEC22-01 join-code CSPRNG). Nothing below duplicates
those.

## Findings

| ID | Severity | What | Where | Test |
|---|---|---|---|---|
| SEC25-D-02 | **High** | `admin_practice_minutes()` / `admin_practice_minutes_by_course()` are `SECURITY DEFINER`, granted `EXECUTE` to `anon`, carry **no internal auth check**, and are called directly from browser code via `supabase.rpc(...)` | `supabase/schema.sql` (functions + grants); `packages/player-vue/src/composables/schools/useAnalyticsData.ts:196`, `StudentProgressView.vue:77`, `useAdminUserDetail.ts:184`, `useAdminCourses.ts:91`; `api/admin/attention.ts:112`, `api/admin/users.ts:213` | `api/_utils/adminPracticeMinutesAnonExposure.security.test.ts` |
| SEC25-D-01 | Medium | 16 `SECURITY DEFINER` functions have no `SET search_path`, so unqualified identifier resolution inside them follows the *caller's* search_path (the classic DEFINER trojan-horse-object primitive) | `supabase/schema.sql` — see roster below | `api/_utils/definerSearchPath.security.test.ts` |
| SEC25-D-03 | Low | 5 content/audio-pipeline tables have RLS off entirely, and are `GRANT ALL`-ed to `anon` (including INSERT/UPDATE/DELETE) — an anonymous PostgREST caller with only the public anon key can write to them directly | `supabase/schema.sql`: `audio_clip_promotions`, `audio_clips`, `audio_convergence_log`, `language_canonical`, `relink_refusals` | not written (see Gaps) |
| SEC25-D-04 | Low | `.gitignore` has no pattern for root-level scratch/probe files or `*.db` — `git add -A`/`git add .` in the main checkout would stage `command-surface.db` and ~50 dotfiles (`.aran-probe*.mjs`, `.census-*.mjs`, `.vadverify-*.mjs`, `.diagnosis-live-evidence.md`, …), some of which read the live `SUPABASE_SERVICE_ROLE_KEY` from disk at runtime | `.gitignore` (identical, tracked, in both `~/SSi/ssi-learning-app` and this worktree); files observed untracked in `~/SSi/ssi-learning-app` | not written — a `.gitignore` change is a production-adjacent hygiene fix, not a finding to characterize as a test |
| SEC25-D-05 | Low | `pnpm/action-setup@v4` and `actions/setup-node@v4` in both workflows are floating major-version tags, not commit-SHA pins (unlike `actions/checkout@v4.2.2`, which is at least a full release tag) | `.github/workflows/verify.yml`, `.github/workflows/auto-merge-claude.yml` | not written |
| SEC25-D-06 | Info | `pnpm audit --prod` reports 3 moderate + 4 high advisories in production dependencies: `postcss` (arbitrary `.map` file read via `sourceMappingURL`, path traversal), `echarts` (XSS, <6.1.0 — schools analytics dashboards render chart labels), `nanoid` (non-CSPRNG generators loop indefinitely on negative/zero size — DoS-shaped, not predictability) | `pnpm-lock.yaml` | not written (see Gaps — could not assess exploitability of each in this repo's actual call sites within scope) |

### SEC25-D-01 — the 16-function roster

`activate_brief_version`, `activate_prompt_version`, `analytics_course_comparison`,
`analytics_engagement`, `analytics_entitlement_funnel`, `analytics_friction_map`,
`analytics_growth`, `analytics_health`, `analytics_overview`, `analytics_retention_cohorts`,
`analytics_retention_days_active`, `analytics_trial_conversion`, `get_active_brief`,
`get_active_prompt`, `get_my_verified_emails`, `update_daily_contributions`.

Most of the `analytics_*` functions in this list DO gate on `is_god_user()` /
`is_ssi_admin()` internally (verified — `analytics_health`, `analytics_overview`, etc. all
`RAISE EXCEPTION 'Forbidden...'` when the check fails), so the *auth* posture is sound; the
finding here is specifically the missing `search_path` pin, which is a different (and
narrower) attack class — it requires the attacker to be able to create objects earlier in
their own search_path that the function then resolves unqualified, which for functions that
already gate on admin identity is a much smaller blast radius than for ungated ones.
`get_my_verified_emails()` is the one worth a second look: it's self-scoped by
`auth.uid()` (safe against cross-user reads) but still has no search_path pin.

The pattern IS understood and applied correctly elsewhere in the same schema —
`claim_learner`, `is_ssi_admin`, `admin_user_course_stats`, `find_learner_by_email` all pin
`SET search_path`. This reads as 16 misses in an otherwise-followed convention, not an
unknown technique.

### SEC25-D-02 — detail

`admin_practice_minutes(p_learner_ids uuid[])` and
`admin_practice_minutes_by_course(p_learner_ids uuid[] DEFAULT NULL)` are both:
- `LANGUAGE sql STABLE SECURITY DEFINER` with `SET search_path TO 'public'` (so *this*
  particular finding is orthogonal to SEC25-D-01 — the search_path is fine, the auth is not),
- granted `EXECUTE` to `anon`, `authenticated`, AND `service_role`,
- containing no `is_ssi_admin()` / `auth.uid()` / any gate at all.

Compare the sibling `admin_user_course_stats(p_learner_id uuid)` — same `admin_` prefix,
same `SECURITY DEFINER`, same underlying tables — which opens with
`IF NOT public.is_ssi_admin() THEN RAISE EXCEPTION 'Forbidden: admin required'; END IF;`.
That asymmetry between two functions that look like siblings is the tell this is a missed
caller, not an intentional public endpoint (same shape the 2026-08-22 audit found for
`generate_join_code()` against its own naming-convention siblings).

**Concrete attack:** an unauthenticated browser with only the public anon key runs
```js
supabase.rpc('admin_practice_minutes', { p_learner_ids: ['<any learner UUID>'] })
```
and receives that learner's practice-minutes-by-course, no session required. Calling
`admin_practice_minutes_by_course()` with **no argument** (its default is `NULL`, meaning
"every learner") returns platform-wide practice-minute totals per course — no PII, but no
gate either, and a business metric leak to any caller.

**Blast radius, confirmed live in the client:** `admin_practice_minutes_by_course` is called
directly from `packages/player-vue/src/composables/schools/useAnalyticsData.ts`,
`views/schools/StudentProgressView.vue`, `composables/admin/useAdminUserDetail.ts`, and
`composables/admin/useAdminCourses.ts` — all browser code, all using
`getSchoolsClient()` / the injected Supabase client set up in `App.vue`, i.e. the
anon/authenticated key, never a service-role client. Whatever role/route guard exists
around those Vue views is UI-only; the RPC itself has no server-side gate, so it is
reachable directly by anyone who opens devtools and copies the repo's public anon key —
which is meant to be public.

## Controls that hold

- **The six org tables** (`schools`, `classes`, `groups`, `govt_admins`, `invite_codes`,
  `entitlement_grants`) — CLAUDE.md's claim that all six carry `relrowsecurity=true`
  is confirmed against `supabase/schema.sql`: all six have `ALTER TABLE ... ENABLE ROW
  LEVEL SECURITY`. Their `anon` grants are schema-only (`REFERENCES, TRIGGER, MAINTAIN`
  on `invite_codes`/`entitlement_grants` — no `SELECT`/`INSERT`/`UPDATE`/`DELETE`), matching
  the SEC22-01 fix pattern applied broadly, not just to the one function that was found.
- **The SEC22-01 fix** (`generate_join_code()` CSPRNG + grant lockdown) is intact and its
  regression-guard test (`joinCodeEntropy.security.test.ts`) still passes.
- **Recent migrations are disciplined.** Read the last ~15 by filename date
  (2026-08-01 through 2026-08-22): the one new table created
  (`tutor_rebate_ledger`, `20260802_tutor_rebate_ledger.sql`) ships with an explicit
  `ALTER TABLE ... ENABLE ROW LEVEL SECURITY` and no policies (service-role-only posture,
  per CLAUDE.md rule 7) at creation time in the SAME file. The `phrases_spoken_ledger`
  migration (2026-08-19) explicitly comments on *why* no grant work was needed rather than
  silently relying on Postgres/Supabase's `ALTER DEFAULT PRIVILEGES` default (which is
  exactly the mechanism that caused SEC22-01) and explicitly scopes its one new `GRANT
  EXECUTE` to `authenticated, service_role` — `anon` is conspicuously, deliberately absent.
- **No secrets found in tracked files.** `git ls-files` scanned for AWS keys, Anthropic
  keys, private-key headers, committed `.env*`, `.pem`, `.key` files — none found.
  `SERVICE_ROLE_KEY`-shaped literal assignments in tracked files are all test fixture
  placeholders (`'service-role-key'`, `'service-role-key-for-tests'`), never real values.
- **No SQL/shell/S3-key injection** in `scripts/demo-data/topup-vad-recency.cjs` or
  `supabase/secfix-toolkit/*.cjs`. Every query is parameterized (`$1, $2, …`); the one
  `--group=<uuid>` CLI arg flows into a query parameter, never string-interpolated into
  SQL. The one `${role}` interpolation in `canary_phrases_spoken_ledger.cjs`'s
  `SET LOCAL ROLE ${role}` is always called with a hardcoded literal (`'authenticated'` or
  `'anon'`), never external input.
- **No `pull_request_target`** in either workflow, so there is no path for a fork PR to run
  with repo secrets.
- **`.github/workflows/*.yml` both declare `permissions:` blocks** (least-privilege-adjacent;
  `auto-merge-claude.yml` needs `contents: write` to push the merge, which is its actual job).

## JOB 3 verdict — security-test machinery integrity

**Yes, there is a real, currently-open path to losing a finding silently**, and it does not
require anyone to act in bad faith:

1. `api/**/*.security-audit.ts` (the deliberately-red convention) is **never referenced by
   either GitHub Actions workflow**. `pnpm run test:security-audit` is a human-run command
   only. Deleting or renaming a `*.security-audit.ts` file to any other suffix produces
   **zero CI signal**, in either direction — nothing was ever gating on it.
2. `api/**/*.security.test.ts` files ARE collected by `api/**/*.test.ts` (the glob used by
   `pnpm test:api`, which IS gated in both `verify.yml` and `auto-merge-claude.yml`) — but
   CI only asserts that whatever is currently collected passes. Deleting one of these files
   entirely makes the suite trivially *more* green, not red. There was, before this audit, no
   assertion anywhere that a specific roster of security-relevant files must continue to
   exist.
3. `tsconfig.api.json` currently excludes only `**/*.test.ts`, so `*.security-audit.ts`
   files ARE typechecked today by `pnpm typecheck:api` — but that's an absence of exclusion,
   not a positive guarantee. A future broadening of the exclude pattern (e.g. to catch
   `*.security*.ts` for some unrelated reason) would silently drop them from typecheck too.

**Mitigation shipped in this PR:** `api/_utils/securityTestMachineryIntegrity.security.test.ts`
pins the exact roster of both `*.security-audit.ts` and `*.security.test.ts` files on disk,
and pins the shape of `vitest.api.config.ts`, `vitest.security-audit.config.ts`,
`package.json`'s two `test:*` scripts, and `tsconfig.api.json`'s include/exclude. Because
this guard file is itself `*.security.test.ts`, it rides `pnpm test:api` — a real CI gate —
so from this point forward, deleting or renaming any pinned file, or loosening any of those
four config surfaces, **does** go red in CI. It also asserts (and will keep asserting) the
literal fact that `test:security-audit` is absent from both workflows, so the gap in point 1
stays visible rather than being quietly assumed away.

**What this does NOT fix:** point 1 above. Closing it needs a product decision — either (a)
promote every `*.security-audit.ts` finding into `*.security.test.ts` the moment it's fixed
(the existing convention, already followed once for SEC22-01) and accept that an *unfixed*
finding stays invisible to CI between discovery and fix, or (b) add a CI step that runs
`pnpm run test:security-audit` and asserts only its **file count**, not its exit code (so the
suite can stay red-by-design without gating merges, but a silent deletion still trips CI).
Both are out of scope for this audit (a production/process change, not a finding to
characterize) and are left as `it.todo()` in the guard file.

## Gaps

- **`SEC25-D-03`** (RLS-off content tables) has no test — these are low-severity,
  content-pipeline metadata tables consistent with CLAUDE.md's "content tables stay
  permissive by design," and writing a characterization test for a by-design permissive
  posture seemed more likely to create a false "fix me" signal than a useful guard. Flagged
  in the table above for a human call on whether `relink_refusals` (an audit trail of
  refused audio relinks) should be tightened regardless.
- **`SEC25-D-04`** (`.gitignore` gap) has no test — a `.gitignore` change is itself the fix,
  and this audit's hard rule is findings-and-tests only, no production changes.
- **`SEC25-D-05`/`SEC25-D-06`** (workflow action pinning; prod dependency advisories) are
  reported but not tested — neither is expressible as a meaningful characterization test
  against this repo's own source (a version-pin check would just re-encode the same fact
  `pnpm audit`/reading the YAML already gives you), and assessing real exploitability of
  `echarts`'s XSS or `postcss`'s path traversal against this repo's actual build/render call
  sites is more investigation than Area D's static-reading scope covers. Recommend a
  follow-up pass if either is judged worth chasing.
- **`typecheck:api` could not be run fully clean in this worktree.** `npx tsc -p
  tsconfig.api.json --noEmit` reports 2 pre-existing errors, both in
  `packages/player-vue/src/types/courseBundle.ts` (`Cannot find module '@ssi/core'`),
  because this worktree's `@ssi/core` package has never been built here (`packages/core/dist`
  does not exist) and this worktree's `node_modules` is a **symlink to the shared
  `~/SSi/ssi-learning-app/node_modules`**, used by dozens of other active worktrees —
  `pnpm --filter @ssi/core build` requires `tsup`, which isn't resolvable without a full
  `pnpm install`, and running that against a shared, in-use `node_modules` felt too
  disruptive to attempt unsupervised (an interactive prompt confirming a full reinstall of
  that shared directory appeared and was left unanswered — nothing was deleted). Confirmed
  by grep that **neither error mentions any file this audit touched** — all three new test
  files typecheck clean in isolation, and the two errors are unrelated to `api/**`. Reported
  rather than worked around.
- **`pnpm audit`, not `npm audit`.** The job description named `npm audit --omit=dev`; this
  repo is pnpm-only (no `package-lock.json`), so `npm audit` fails immediately
  (`ENOLOCK`). Ran `pnpm audit --prod --json` instead (registry was reachable) — see
  SEC25-D-06.
- **The digest's untracked-file example** (`command-surface.db`, `.aran-probe*.mjs`, etc.)
  was found in `~/SSi/ssi-learning-app` (the main checkout), not in this worktree
  (`wt-sec-d-gates`, which is otherwise clean apart from `node_modules`) — but `.gitignore`
  is the same tracked file in both, so the SEC25-D-04 finding applies to every worktree of
  this repo equally, this one included.

## Test run

```
npx vitest run -c vitest.api.config.ts
  Test Files  122 passed | 1 skipped (123)
       Tests  1354 passed | 5 skipped | 12 todo (1371)
```
(includes the 3 new files: `definerSearchPath.security.test.ts`,
`adminPracticeMinutesAnonExposure.security.test.ts`,
`securityTestMachineryIntegrity.security.test.ts` — all green, characterization tests
included, since they assert today's actual state.)

```
npx tsc -p tsconfig.api.json --noEmit
  2 pre-existing errors in packages/player-vue/src/types/courseBundle.ts (@ssi/core not built
  in this worktree) — unrelated to any file this audit added or touched. See Gaps.
```
