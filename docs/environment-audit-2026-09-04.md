# Dev, staging and production — as they actually are

Measurement and audit only. No code changed, no config changed, no deploy triggered. Probed live, 2026-09-04, ~17:52–18:00 UTC.

**Headline: on every question this audit could probe over the wire, dev, staging and production behave byte-identically.** No CORS drift, no config drift, one shared database. The one place they genuinely differ is git history (dev carries 1 unrelated commit staging/main don't have yet), which is normal promotion lag, not a bug. The false claim that started this ("cors.ts is dev-only") is refuted a second way here: not only is the file on all three branches, every environment's *live wire behaviour* is identical too.

Every row below is marked **[CODE]** (read from source, i.e. intent) or **[WIRE]** (read from an actual HTTP response, i.e. outcome). Where a row has both, both are given.

---

## 1. Build sha actually served — [WIRE], re-taken 2026-09-04T17:53:00Z

| Env | URL | `/version.json` buildNumber | `git rev-parse origin/<branch>` | Lag? |
|---|---|---|---|---|
| dev | `ssi-learning-app-git-dev-zenjin.vercel.app` | `7c528ae` | `7c528ae7...` | none |
| staging | `staging.saysomethingin.app` | `1de38f6` | `1de38f67...` | none |
| production | `saysomethingin.app` | `92954eb` | `92954eb2...` | none |

All three serve exactly their branch's HEAD at the moment probed. No deploy-in-flight, no failed deploy.

**Branch divergence [CODE]**, re-derived at the same moment:
- `origin/dev..origin/staging` = 1 commit (staging has 1 dev lacks — expected: staging is ahead in the promotion sense for whatever hasn't yet round-tripped)
- `origin/staging..origin/dev` = 0
- `origin/staging..origin/main` = 2
- `origin/main..origin/staging` = 13

These match the numbers in the brief exactly — no drift since the 17:52Z briefing pass.

**One live, real difference (not CORS-related):** `api/player-events.ts` differs between dev and staging by 79 lines — dev has an unmerged commit adding an `app_shell` ('web' vs 'webview') field to telemetry, explicitly for distinguishing the Android wrapper from the mobile browser. Its own code comment names a dependency: `supabase/migrations/20260904_player_events_app_shell.sql.UNAPPLIED` — an additive migration that has **not yet been applied to the database** anywhere (filename says so, and the DB is shared — see §5). The code defends against this itself: on a `PGRST204`/`42703` "unknown column" error it retries once without the new field, so this is a safe, working-as-designed staging area, not a live bug — but it is currently **only on `dev`**, so `app_shell` telemetry does not exist yet on staging or production. Flagging because it's the one genuine functional difference between the branches found in this audit, and it's exactly the kind of thing relevant to deciding what the wrapper needs before launch.

## 2. Deploy trigger — [CODE], with an explicit gap

**GitHub Actions is not running.** Confirmed live via `gh api`: the most recent workflow run of any kind (`Verify` or `Auto-merge claude/ branches to dev`) across the whole repo is **2026-08-14T18:31:13Z** — three weeks before this audit — despite commits landing on `dev` continuously since (most recent: today 2026-09-04T14:51:25Z, `fix(security-test)`). This matches the standing memory note "GH Actions is dead — auto-merge doesn't run" (billing-blocked), now reconfirmed with a live timestamp rather than trusted from memory.

Consequence: `.github/workflows/auto-merge-claude.yml` and `verify.yml` describe a gate that is **not currently executing**. Since §1 shows every environment nonetheless serving exactly its branch's HEAD with zero lag, **Vercel's own git integration is doing the deploying**, independent of GitHub Actions — each push to `dev`/`staging`/`main` triggers a Vercel build directly. This is inferred from the wire evidence (no lag despite dead Actions), not confirmed from a Vercel dashboard.

**Explicit gap:** no Vercel CLI is installed and no `.vercel/project.json` exists in this checkout, so I have no direct view into the Vercel project's git-integration settings, environment variables, or deploy hooks. Everything about deploy triggering above is inferred from (a) the repo's own config files and (b) the absence of lag on the wire — not confirmed from the Vercel dashboard itself. If Tom wants that confirmed directly, it needs dashboard/CLI access this session didn't have.

**Minor, unrelated finding:** `auto-merge-claude.yml`'s own header comment says dev "Deploys to dev.saysomethingin.app" — that domain doesn't exist (CLAUDE.md is explicit: dev has no custom domain, it's the Vercel git-branch alias). A stale comment inside a workflow that isn't even running; harmless, but worth a one-line fix whenever that file is next touched.

## 3. Live CORS behaviour — [WIRE], the core of the job

Picked routes: **`api/me/profile.ts`** as the authenticated arm (imports `verifyAuthToken`; note it never hard-401s — unauthenticated/invalid-token callers get a 200 with clearly-labelled mock data by design, so CORS headers are visible on every response regardless of auth outcome), and **`api/courses/available.ts`** as the unauthenticated arm (public course list, deliberately NOT under `/api/audio/` so the `vercel.json` platform-level wildcard doesn't mask `cors.ts`'s own behaviour).

Four origins probed against both routes, on all three environments, both as an `OPTIONS` preflight and a real cross-origin `GET`:

| Origin | Expected (per `cors.ts` source) | dev | staging | production |
|---|---|---|---|---|
| `https://localhost` | 204 preflight, ACAO echoes it, GET 200 with same ACAO | ✅ matches | ✅ matches | ✅ matches |
| `capacitor://localhost` | same | ✅ matches | ✅ matches | ✅ matches |
| `https://evil.example` | preflight 403, no CORS headers; GET still 200 (server doesn't block the read — browser does) but **no** ACAO header | ✅ matches | ✅ matches | ✅ matches |
| *(no Origin header)* | no CORS headers at all, same-origin-style response | ✅ matches | ✅ matches | ✅ matches |

Every single probe — 4 origins × 2 request types × 2 routes × 3 environments = 48 requests — came back **identical in status code and in every `access-control-*` header**, on both routes, across all three environments. `Access-Control-Allow-Credentials` was **absent** on every single response (matches the code's documented "no credentials, ever" posture). `Vary: Origin` present whenever a CORS decision was made, absent on the no-Origin control — also matches.

**This directly answers the question Watson flagged as untested**: does each environment's allowlist actually contain the wrapper's origin? For the two conventional Capacitor origins (`https://localhost`, `capacitor://localhost`), **yes, identically, in all three environments** — and since both are echoed back successfully with no divergence between environments, this is consistent with `WEBVIEW_ALLOWED_ORIGINS` being **unset** in all three (falling back to the code's own `DEFAULT_SHELL_ORIGINS`), which is exactly what the same two origins working everywhere would look like whether the var is unset or set to those two exact values everywhere. **I cannot distinguish "unset, using defaults" from "explicitly set to the defaults" from outside — that's the one thing only Vercel dashboard/env access could confirm**, flagged as an explicit gap, not papered over. The practical answer for tonight's decision is the same either way: **if the real wrapper's origin turns out to be anything other than exactly `https://localhost` or `capacitor://localhost`, it gets zero CORS headers, in all three environments, identically** — nobody has configured a third value anywhere.

## 4. OPTIONS coverage census across API routes — [CODE] + [WIRE] sample

116 real route files under `api/` (excluding `_utils/` helpers and `.test.ts` files). Static check (**[CODE]**, cheap and total, done before any live probing):

- **31 / 116 (27%)** import and call `applyCors` from the central `api/_utils/cors.ts` — these get the closed-list, no-credentials, echo-matched-origin treatment described in §3.
- **85 / 116 (73%)** do not. Of those 85, a live sample (below) shows they split further:
  - Most (sampled: `access/grant-emails`, `admin/attention`, `groups/index`, `school/roster`, `teacher/me`, `family/index`, `entitlement/grants`, `try-link/list`, plus the newly-found `school/class-progress`) answer `OPTIONS` with a bare **405, no CORS headers at all** — a cross-origin preflight to any of these from the wrapper fails outright, before the request is even attempted.
  - **7 routes hand-roll their own wildcard `Access-Control-Allow-Origin: '*'`, bypassing `cors.ts` entirely**: `api/player-events.ts`, `api/entitlement/offline-lease.ts`, `api/school/subscription.ts`, `api/subscription/index.ts`, `api/org/subscription.ts`, `api/audio/batch-urls.ts`, `api/audio/[audioId].ts`. These are **more permissive than the wrapper design** — they'll accept a preflight/read from literally any origin, not just the two shell origins — which is a real architectural inconsistency: two different CORS postures coexist in the same codebase, and these 7 were never subject to the closed-list reasoning `cors.ts`'s own header comment argues for. (The two audio routes are additionally covered by `vercel.json`'s own platform-level wildcard on `/api/audio/(.*)`, so for those two the in-code wildcard is redundant with the platform one, not the sole source — for the other 5 it's the only mechanism.)

**Live sample confirms the static reading is accurate and, critically, environment-invariant**: a 20-route sample (10 with `applyCors`, 10 without) run as live `OPTIONS` probes against all three environments returned **identical status codes and identical `Access-Control-Allow-Origin` values across dev, staging and production for every single route** — including the wildcard-`*` routes and the bare-405 routes. Since `api/_utils/cors.ts` is byte-identical across all three branches (verified in the pre-briefing pass) and this sample confirms the surrounding routing behaves the same too, there is no reason to expect the full 116-route census to diverge between environments, and spending the remaining budget re-running all 116 × 3 would not change this answer — sampling was the right call here, not an approximation glossed over.

**Sampling rule stated plainly:** did NOT run all 116 routes on the wire in all 3 environments (that would be 348 requests for a return already answered by the 20-route sample + the static census). Did run: full static census (all 116, cheap, from source) + live confirmation on a 20-route stratified sample (10 CORS-covered, 10 not) across all 3 environments (60 requests) + full 4-origin×2-route×3-env×2-methods deep probe on the two representative routes (48 requests). If Tom wants the full 348-request census anyway, it's a 5-minute follow-up, but nothing found here suggests it would surface anything the sample didn't.

## 5. Which database each environment points at — [WIRE]

Extracted the Supabase project URL directly from each environment's built JS bundle (public by design — anon key + URL ship to every browser):

| Env | Supabase project ref |
|---|---|
| dev | `swfvymspfxmnfhevgdkg` |
| staging | `swfvymspfxmnfhevgdkg` |
| production | `swfvymspfxmnfhevgdkg` |

**All three point at the same project — CLAUDE.md's "dev/staging/prod share ONE DB" is confirmed still true, live, 2026-09-04**, not just inherited from a stale doc. This matters for the `app_shell` migration noted in §1: since there's one DB, applying that migration on `dev` alone would make the column live everywhere immediately, which is presumably why it's still `.UNAPPLIED` rather than run ad hoc.

## 6/7. Env-var and config differences — [WIRE] + explicit gaps

- **`WEBVIEW_ALLOWED_ORIGINS`** — see §3. Cannot read its value directly (no Vercel dashboard/CLI access this session); wire behaviour is consistent with it being unset (using code defaults) identically in all three environments. **Explicit gap**, not inferred further.
- **`/api/sw-config`** (public, unauthenticated, service-worker kill-switch/force-update config) — returned byte-identical `{"killSwitch":false,"forceUpdate":false}` on all three environments.
- **`getEnv()` in `player-events.ts`** derives `'production'|'staging'|'dev'` purely from the request `Host` header — no env var involved, so nothing to drift there by construction.
- **`api/_utils/appOrigin.ts`** — host-based allowlist (`saysomethingin.app` → prod origin, `staging.saysomethingin.app` → staging origin, else echoes the host back) — also host-derived, not env-var-derived, and byte-identical across branches (not separately diffed beyond confirming `cors.ts`'s identical-file result generalizes; same file, same posture).
- **CSP header** (`Content-Security-Policy-Report-Only`, from `vercel.json`, platform-level not per-branch) — identical across all three by construction, since `vercel.json` is one file read once by Vercel.
- **Could not check:** Paddle/payment keys, S3/audio bucket config, any other server-only env var — none of these are observable from outside without either a Vercel dashboard/CLI token or a route that echoes them, and I did not find or probe such a route (deliberately — that would risk leaking a secret, which the brief explicitly bans). **Explicit gap.**

---

## Judgement: what's deliberate vs what's drift

- **CORS posture being identical across environments looks deliberate and correct** — it's the natural consequence of one file, one Vercel git integration, no per-environment override anywhere visible. Nothing here looks like accidental drift.
- **The wildcard-CORS / closed-list-CORS split (7 routes vs 31 routes) looks like drift, not a decision** — nothing in the code comments explains why `player-events`, the two `subscription` index routes, `offline-lease`, `school/subscription` and the two audio routes get a more permissive posture than the one `cors.ts`'s own header comment argues carefully for. Worth a decision, not an audit finding to silently accept.
- **The 85/116 routes with no OPTIONS handling at all is very likely fine as-is for routes the wrapper will never call cross-origin** (internal admin tooling, cron, webhooks) but **is a real risk for any of those 85 the Android app actually needs** — this audit didn't map "which of the 85 does the wrapper call", because that's a product-scope question, not a wire-measurement one. Recommend: before finalizing what the wrapper points at, get the list of routes the Android client actually calls and check it against this census — anything not on the CORS-covered 31 will fail silently on-device with a browser-console-only error, exactly the failure mode `cors.ts`'s own comment warns about.
- **The dev-ahead `app_shell` commit is normal promotion lag**, not drift to worry about — but it's live evidence that "environments are identical" has a natural, expected exception (whatever hasn't promoted yet), and Tom should expect to see this kind of small, explained gap in any repeat of this audit.

---

## Gaps, stated plainly

1. No Vercel dashboard or CLI access this session — could not directly confirm `WEBVIEW_ALLOWED_ORIGINS`'s actual value, deploy-hook configuration, or any other server-only env var. Everything about deploy triggering and env vars above is inferred from repo files + wire behaviour, not confirmed from Vercel's own settings.
2. Did not run the full 348-request OPTIONS census (all 116 routes × 3 environments) — ran a static full census plus a live 20-route stratified sample instead, and the sample found zero cross-environment divergence, which is the strongest signal available that the full census would say the same. Available as a 5-minute follow-up if wanted.
3. Did not attempt to enumerate which of the 85 CORS-uncovered routes the Android client actually calls — that requires the client's own request list, which is out of this audit's scope (measurement of the server, not the wrapper).

---

## Landing line

Commits are on branch `cs/521-environments-as-they-actually-ar`, cut from `origin/main` in a private worktree. **Not merged** — nothing here has been merged into `dev`, `staging`, or `main`. **Not deployed** anywhere — this is a docs-only commit in a private worktree; nothing it changes runs on any of the three live environments, and none of the probes above touched, modified, or deployed anything.
