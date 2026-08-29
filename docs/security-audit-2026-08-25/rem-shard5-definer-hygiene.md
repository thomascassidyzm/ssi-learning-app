# Remediation shard 5 — DEFINER search_path, the ungated course endpoint, repo hygiene

2026-08-25. Branch `security/rem-0825-w5`, cut from `security/remediation-2026-08-25`.
Code, tests and one migration only — no live database, no production HTTP, no deploys.

| Finding | State | Evidence |
|---|---|---|
| SEC25-D-01 | **fixed** | `20260825_sec25_d01_definer_search_path.sql` + `schema.sql`; test flipped to "zero unpinned DEFINER functions" |
| SEC25-X-01 | **fixed** | round-map 503 body is now `Course temporarily unavailable`; relation + DDL go to `console.error` |
| SEC25-X-02 | **fixed** | anon-key fallback deleted in `round-map.ts` AND `_utils/audioAccess.ts`; both fail closed |
| AUTH-CORE-08 / INPUT-10 | **fixed** | `appOrigin.ts` is an allowlist with production as the default; behavioural test |
| SEC25-B-01 | **fixed (origin half)** | `https://popty.app` added to the report-only `connect-src`; collector half deliberately left open |
| SEC25-D-04 | **fixed** | `.gitignore` ignores the root-dotfile scratch class, `*.db*`, `.env*`, `*.pem`, `*.key` |
| SEC25-D-05 | **fixed** | all three Actions pinned to commit SHAs in both workflows |
| SEC25-D-06 | **assessed — no code change; see below** | none of the seven advisories is reachable from our code |

---

## SEC25-D-01 — the search_path pin

`ALTER FUNCTION … SET search_path TO 'public', 'pg_temp'` over all 16 functions of the
roster. `ALTER`, not a body rewrite: this changes name *resolution*, not logic, so it is a
no-op for every legitimate caller and a hard stop for one that has planted a shadowing
object earlier in its own search_path.

`pg_temp` is listed **last** on purpose. Omitting it entirely leaves it implicitly first on
some Postgres versions — which is the hole, not the fix. The flipped test asserts the exact
`'public', 'pg_temp'` ordering, not merely the presence of a pin, and additionally asserts
that the migration exists and ends with `notify pgrst, 'reload schema';` so a future
`schema.sql` re-dump cannot silently revert the fix without going red.

`admin_practice_minutes()` / `admin_practice_minutes_by_course()` were left exactly as
found — they are SEC25-D-02, already fixed on the base commit, and their search_path was
never the problem.

**Not applied to the DB.** No live database contact was in scope. The migration is parked
and needs the usual canary run (`supabase/secfix-toolkit/`) before it goes anywhere near
production.

## SEC25-X-01 — the 503 that handed out DDL

The body used to be `round map not yet materialised, run REFRESH MATERIALIZED VIEW
course_round_index` — an internal relation name plus the exact command to run against it,
returned to an **unauthenticated** caller, on an endpoint that requires no auth at all. It
is now a fixed `Course temporarily unavailable`; the relation name, the course code and the
remedy go to `console.error`, where the operator who actually has to act on it can see them.
Matches `api/board/snapshot/[code].ts`.

## SEC25-X-02 — fail closed on a missing service key

Two places, one shape: `createClient(url, serviceKey || anonKey)`. A missing or mistyped
`SUPABASE_SERVICE_ROLE_KEY` did not fail — it **swapped the identity the query ran as**.

- **`round-map.ts`**: the swap was literally undetectable, because `schema.sql` grants
  `course_round_index` to `anon`, so responses stayed byte-identical. Now guarded *before*
  the client is constructed: `500 Server misconfigured`, `Cache-Control: no-store`.
- **`_utils/audioAccess.ts`**: this is the client behind **both** `audio/[audioId].ts` and
  `audio/batch-urls.ts` — the two endpoints that decide audio entitlement. The factory now
  throws `Server misconfigured: missing SUPABASE_SERVICE_ROLE_KEY`.

  The throw is deliberately **inside the function, not at module load**. Both call sites
  already construct the client inside a `try` whose `catch` returns 500, so a missing key
  becomes a loud server error on the request that needed it, rather than an import-time
  crash taking unrelated routes down with it. Checked the callers before choosing: neither
  test that touches this module relied on the anon fallback — `api/_utils/audioAccess.test.ts`
  and `api/try-link/validate.test.ts` both set `SUPABASE_SERVICE_ROLE_KEY` explicitly, and
  the whole `api/audio/**` suite is green. **Nothing relied on the fallback**, so there is
  no playback behaviour change on any correctly-configured environment.

## AUTH-CORE-08 / INPUT-10 — the Host header

`getAppOrigin()` pinned two canonical hosts and then echoed **any** other caller-written
`Host` verbatim into an `https://` origin. `Host` is client-written; a poisoned one pointed a
freshly minted invite/redeem URL at an attacker's domain, on a link the legitimate system
then hands out under its own name.

Now an allowlist with production as the fallback:

- `saysomethingin.app`, `www.` → production
- `staging.saysomethingin.app` → staging
- any other `*.saysomethingin.app` we own → itself
- this project's Vercel preview aliases: host must start `ssi-learning-app-` **and** end
  `-zenjin.vercel.app`. Both ends must match, so an attacker's own `*.vercel.app` project
  cannot qualify, and no non-project host can.
- everything else, including empty → production

**Call sites, all confirmed working.** The shared helper is imported by exactly one file,
`api/groups/[id]/invites.ts`, which uses it at five points (lines 205, 257, 335, 417, 590 —
resend URL, rotated URL, and three mint/list paths). The whole `api/groups` suite is green.

Two further handlers, `api/admin/create-signin-link.ts:31` and
`api/groups/[id]/demo-mint.ts:60`, carry their **own verbatim copy** of the old vulnerable
function — both are outside this shard's file boundary and are **untouched**. See Gaps.

No regression for real users: bare `localhost` is not allowed, but the port is stripped a
line earlier, so a local dev host already produced the unusable `https://localhost` under
the old code. One test fixture in `api/groups/[id]/invites.get.test.ts` used the invented
host `app.example.com`; swapped for `staging.saysomethingin.app`.

## SEC25-B-01 — the CSP trap

`usePublishedExplainers.ts` fetches learner-facing HTW copy from `https://popty.app`; the
`connect-src` inventory was built before that feature existed. Today the header is
Report-Only so nothing breaks — but promoting it to enforced would have silently and
permanently killed the fetch, and `fetchPublished()` fails closed by design, so the copy
would simply have stopped updating with no error anywhere a human would see.

**Fixed on the CSP side, not the fetch side**: Popty is our own dashboard product and the
feature is shipped and wanted. Exact host, no wildcard.

**The collector half stays open on purpose.** Adding `report-to` with no endpoint behind it
reports nothing, and choosing/hosting a CSP report collector is a product decision, not a
code fix — kept as a characterization + `it.todo` so it stays visible.

## SEC25-D-04 / D-05 — hygiene

`.gitignore` now ignores the whole root-dotfile class with a named re-admit list
(`.gitignore`, `.gitattributes`, `.github/`, `.claude/settings.json`, the usual tool rc
files), plus `*.db*` / `*.sqlite*`, `.env*` anywhere, `*.pem`, `*.key`. Verified both ways:
**no tracked file becomes ignored**, and every probe/db/env/key shape does.

All three Actions pinned to the commit SHAs their tags resolved to on 2026-08-25 — zero
behaviour change, the same code runs, it just cannot be swapped underneath us. The
`pnpm/action-setup` `v4` tag is *annotated* and dereferences to **v4.3.0**, not the newest
v4.4.0; pinned to what CI actually runs today rather than quietly upgrading.

| Action | Pinned SHA | Version |
|---|---|---|
| `actions/checkout` | `11bd71901bbe5b1630ceea73d27597364c9af683` | v4.2.2 |
| `pnpm/action-setup` | `b906affcce14559ad1aafd4ab0e942779e9f58b1` | v4.3.0 |
| `actions/setup-node` | `49933ea5288caeca8642d1e84afbd3f7d6820020` | v4.4.0 |

## SEC25-D-06 — the seven advisories, assessed

`corepack pnpm audit --prod` (this repo is pnpm-only; `npm audit` fails `ENOLOCK`).
**Every one of the seven is unreachable from our code.** No override was applied — see the
decision at the bottom.

| Package | Installed | Sev | Prod/build | Reachable? | Non-breaking fix |
|---|---|---|---|---|---|
| postcss | 8.5.6 | high ×2, moderate ×2 | **build-time only** | **No** | yes — `>=8.5.23` (patch) |
| nanoid | 3.3.11 | high ×2 | **build-time only** | **No** | yes — `>=3.3.18` (patch) |
| echarts | 5.6.0 | moderate | prod, ships to browser | **No** | **no — needs a major bump to 6.1.0** |

**postcss** (4 advisories, all the same `sourceMappingURL` family — arbitrary `.map` file
read / path traversal). Transitive only: `vue 3.5.25 → @vue/compiler-sfc → postcss`. Nothing
declares it directly (`corepack pnpm why postcss -r --prod`). `@vue/compiler-sfc` is the SFC
compiler — it runs in the Vite build, never in the shipped bundle. The vulnerable path
requires parsing **attacker-controlled CSS**; the only CSS this repo compiles is its own
tracked source. Not reachable.

**nanoid** (2 advisories, infinite loop on negative/zero `size` — DoS-shaped, not a
predictability problem, so it does not touch any credential path). Reachable only *through*
postcss: `vue → @vue/compiler-sfc → postcss → nanoid`. postcss calls it with a fixed size.
Nothing in this repo imports nanoid. Not reachable, and doubly build-time.

**echarts** — GHSA-fgmj-fm8m-jvvx. The advisory is narrow and its preconditions are all
required together: a **`lines` series**, a tooltip, **no** custom `tooltip.formatter`, and a
`series.data[i].name` carrying raw HTML, which then reaches an `innerHTML` sink. Inventoried
every series type across all 14 widgets in `packages/player-vue/src/insight/widgets/`:
`bar`, `line`, `scatter`, `pie`, `sankey`, `heatmap`, `funnel`, `treemap`. **There is no
`lines` series anywhere in the repo** (`line` is a different series type and is not
affected). So the one XSS sink the advisory describes does not exist in our chart code —
which is fortunate, because school and student names *are* user-typed and *do* reach chart
labels. The tripwire, if anyone wants one: adding a `lines` series would make this live.

---

## Gaps and decisions

1. **The two verbatim copies of the vulnerable `getAppOrigin`.**
   `api/admin/create-signin-link.ts:31` and `api/groups/[id]/demo-mint.ts:60` each carry
   their own copy of the old `if (host) return \`https://${host}\`` logic, both outside this
   shard's file boundary and therefore untouched. `create-signin-link.ts` is the worse of
   the two: its origin feeds `redirectTo` on a **magic link**. The shared helper now exists
   and is fixed — deleting both copies in favour of it is a two-line change someone with
   that boundary should make.
   → *Should the two local getAppOrigin copies be deleted in favour of the fixed shared helper?*

2. **The SEC25-D-01 migration has not been run.** Parked in `supabase/migrations/`, needs
   the standard canary run before production.
   → *Approve canary-applying the search_path migration?*

3. **The CSP report collector (SEC25-B-01 remainder).** Left open deliberately; needs an
   endpoint chosen before `report-to` means anything.
   → *Do we want a CSP report collector before promoting the CSP to enforced?*

4. **The postcss/nanoid patch overrides.** Both are transitive and unreachable, so there is
   no urgency, but both have a genuine non-breaking patch-level fix available via a root
   `pnpm.overrides` entry. Not applied here: it requires a `pnpm-lock.yaml` regeneration,
   and this worktree's `node_modules` is a **symlink to the shared
   `~/SSi/ssi-learning-app/node_modules`** used by many concurrent worktrees — running an
   install against it mid-sweep was out of scope and unsafe.
   → *Add pnpm overrides pinning postcss >=8.5.23 and nanoid >=3.3.18?*

5. **echarts needs a major bump (5.6.0 → 6.1.0) to clear its advisory, and this pass
   deliberately did not do that.** Unreachable today, so it is a housekeeping call, not a
   security one.
   → *Schedule an echarts 5→6 major upgrade?*

## Gate state

```
npx vitest run -c vitest.api.config.ts        129 passed | 1 skipped (130) · 1414 tests passed
npx tsc -p tsconfig.api.json --noEmit         clean — zero errors
npx vitest run -c vitest.security-audit.config.ts   2 failed (5 tests) — UNCHANGED, both
                                              deliberately-red specs still red; neither is
                                              touched by this shard
pnpm --filter player-vue test                 244 passed | 1 skipped (245) · 2454 tests passed
npx eslint <the one player-vue file touched>  clean
```

The `tsc` run came back with **zero** errors, not the two pre-existing
`courseBundle.ts` / `Cannot find module '@ssi/core'` errors the brief warned about —
`packages/core/dist` exists in this worktree, so they do not reproduce here.
