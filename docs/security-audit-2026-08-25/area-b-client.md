# Security audit 2026-08-25 — Area B: the client surface

**Slug:** `area-b-client` · **Branch:** `security/audit-0825-b-client` · **Date:** 2026-08-25

**Scope:** `packages/player-vue/src/**` client code that has landed since the unmerged
2026-08-11 audit (`git diff df609ad45ef1b96f0dad7a2444f8d20f89de3728 HEAD -- packages/player-vue/src`
— 53 files, ~4,000 insertions), plus a full re-check of that audit's standing client questions
against today's `dev`. `api/**` is out of scope except where needed to confirm a client control is
actually backed server-side (matching the 08-11 report's own boundary).

**Method:** static reading of checked-out source, `git diff`/`git show` against history, and running
the package's real vitest/vue-tsc/eslint toolchains locally. No live HTTP traffic was sent to
staging or production, and no production file was modified — this branch adds a findings doc and
three test files only.

**One read-only note on repo tooling:** this worktree's `packages/{player-vue,core}/node_modules`
did not exist (git worktree add does not run `pnpm install`), and a `pnpm install` at the workspace
root prompted to delete-and-reinstall the *shared* `node_modules` that every other active worktree
symlinks to — refused. Instead, two new symlinks were created pointing at the main checkout's
already-installed `packages/{player-vue,core}/node_modules` (`ssi-learning-app` repo, same lockfile).
Untracked, harmless, and needed to actually run the toolchain rather than assert findings unverified.

---

## Headline

**No new vulnerability that reaches script execution or a credential.** The ~4,000 lines of new
client code since 08-11 are dominated by a bidi/RTL text-direction fix (`dirFor()` + `unicode-bidi:
isolate` across a dozen components — a correctness fix, not a security-relevant change) and a
new remote-copy feature that, on inspection, cannot reach an HTML sink. The one real finding is a
**config gap, not an active exploit**: the CSP's origin allowlist is stale against a feature that
shipped after the CSP did.

### Findings by severity

| ID | Severity | Finding |
|---|---|---|
| SEC25-B-01 | **low** | Report-only CSP `connect-src` has no `popty.app` entry for the new published-copy fetch, and the policy carries no `report-to`/`report-uri` — so promoting CLIENT-CONFIG-01's CSP to enforced will silently regress the live-copy feature, with nothing to have caught it during the soak. |

That's the whole table. Everything else investigated is either a control that holds (below) or a
standing item from 08-11 whose live status is unchanged (verdicts below).

---

## SEC25-B-01 — CSP origin inventory is stale against `usePublishedExplainers.ts` (low)

**Where:** `vercel.json:17-34` (the `Content-Security-Policy-Report-Only` value) vs.
`packages/player-vue/src/explainer/usePublishedExplainers.ts:32-33`.

**What shipped.** `usePublishedExplainers.ts` is new since 08-11: it fetches learner-facing "How
this works" / "Why this works" copy from Popty (`https://popty.app` by default, overridable via
`VITE_POPTY_BASE_URL`) so an editor can update the copy without a redeploy. The CSP's `connect-src`
was built by walking the live app on 08-11 and inventorying every origin it actually called —
before this feature existed, so `popty.app` was never added.

```
connect-src 'self' https://swfvymspfxmnfhevgdkg.supabase.co wss://...supabase.co
  https://*.s3.eu-west-1.amazonaws.com https://*.s3.amazonaws.com
  https://fonts.googleapis.com https://fonts.gstatic.com
  https://*.paddle.com https://*.profitwell.com
```

No `popty.app`.

**Impact today: none.** The header is `Content-Security-Policy-Report-Only`, which reports
violations but never blocks a request — the fetch works exactly as intended right now.

**Impact once the CSP is promoted to enforced** (CLIENT-CONFIG-01's own recorded follow-up: *"start
in Report-Only and promote once clean"* / the `it.todo` in `securityHeaders.security.test.ts`: *"…
promote … to enforced once a staging soak shows zero violations …"*): a bare `connect-src` with no
`popty.app` will **silently block** this `fetch()`. `usePublishedExplainers.ts` fails closed by
design — `fetchPublished()` never rejects, the hardcoded prose is already on screen and stays there
— so this would not break the app. It would just make a shipped, editor-facing feature stop
receiving updates, forever, with no error anywhere a human would see it.

**Why the planned soak wouldn't catch it either.** The report-only policy has no `report-to` or
`report-uri` directive. Report-Only violations with no collector are visible only in an individual
browser's own devtools console — nobody is aggregating them. So the exact process the 08-11 finding
proposed to de-risk enforcement (soak in Report-Only, promote once clean) has no instrument that
would surface this specific gap before someone promotes the policy on the strength of "looks clean."

**Confidence:** high — both the missing origin and the missing report collector are read directly
from `vercel.json` and locked by regression tests.

**Recommended fix (not applied).** Before promoting `Content-Security-Policy-Report-Only` to
enforced: add `https://popty.app` (and any other host `VITE_POPTY_BASE_URL` is actually set to per
environment) to `connect-src`; and add a `report-to`/`report-uri` collector so any future drift
between "what the app calls" and "what the CSP allows" is caught by the soak instead of discovered
as a silent feature regression.

**Tests:** `cspPoptyOrigin.security.test.ts` — characterization of the missing origin and missing
collector, plus a regression lock that today's enforced `Content-Security-Policy` stays narrow
(`frame-ancestors 'none'` only) so the gap is genuinely inert right now, and an `it.todo` naming the
fix.

---

## Controls verified as HOLDING (new code, this run)

### The highest-value question in the brief: does published copy reach an HTML sink? No.

`usePublishedExplainers.ts` + `parseHtwCopy.ts` fetch a markdown document from Popty and lift plain
strings (`body[]`, `points[]`, `intro`, `linkLabel`) out of it onto the two hardcoded
`ExplainerSection` objects. Traced the full path:

- **Both real consumers render every one of those fields with Vue text interpolation (`{{ }}`)
  only.** `HowThisWorksLearner.vue` and `WhyThisWorks.vue` contain zero `v-html`. Vue's `{{ }}`
  binding HTML-escapes by construction, so even a payload like `<img src=x onerror=alert(1)>` or a
  literal `<script>` tag arriving in the document's prose renders as inert visible text — verified
  by driving both payloads through `parseHtwCopy` → `buildSectionsFromMarkdown` and asserting the
  raw string survives unmodified as *data*, plus a source-level lock that both components' relevant
  bindings are `{{ }}`, not `v-html`.
- **Figure names are a closed compile-time union** (`ExplainerFigureName`) that `parseHtwCopy.ts`
  never assigns to — figures always come from the hardcoded base. Grep-level lock added.
- **Link `url` and `title` never come from the document — only `label` does.**
  `applyParsedSection` positionally overwrites `label` on the code's own `links[]` array and leaves
  `url`/`title` untouched; verified directly against the merge function. `WhyThisWorks.vue` drives
  `link.url` only into a JS call (`openInApp(link.url, link.title)`), never into an `href`/`src`
  binding — so even a hypothetically-poisoned url would still have to pass `useInAppBrowser.ts`'s
  host allowlist (`canFrame()`, unchanged since 08-11) before it could do anything beyond opening a
  plain new tab.
- **The fetch itself is `credentials: 'omit'`** — a compromised or MITM'd Popty response can steal
  nothing; the worst case is misleading text on a trusted page, not a session.
- **Nothing renders while unresolved.** There is no loading/error state; the hardcoded prose is the
  first frame and the only frame until a *complete*, successfully-parsed document lands — a
  malformed or partial response (not JSON, empty `content`, a 404, a timeout) is indistinguishable
  from "nobody has published yet."

**GAP, stated plainly:** this repo cannot verify who can publish to Popty's `doc=htw` endpoint or
what sanitisation (if any) Popty applies before storing it — that authz lives in
`ssi-dashboard-v7-clean`, a separate repo, out of scope here. The finding above is that *even a
maximally hostile Popty response* cannot reach script execution through this client code — which is
the strongest thing this audit can say without reading that other repo.

**Tests:** `htwPublishedContentXss.security.test.ts` — 8 tests: malicious-payload round-trip through
the real parser, the link label/url/title split, the figure-union lock, and a source-level lock on
both consumer components' render bindings.

### `useAdminGate.ts`'s new guest hand-off is not an open redirect

`useAdminGate.ts` added `deniedDestination(status, fullPath)`: a signed-out visitor hitting an
`/admin` deep link is sent to `/schools?next=<fullPath>` instead of bounced straight to `/`, so the
deep link survives an inline sign-in. `SchoolsContainer.vue` then replays `next` via
`router.replace(target)` once the caller's role resolves to `ssi_admin`.

- `deniedDestination` never treats `fullPath` as a URL — it is carried as a query-param **value** on
  a fixed `/schools` path object. A signed-in-but-non-admin visitor always gets `'/'`, `next`
  dropped entirely.
- The replay side (`adminNextTarget()` in `SchoolsContainer.vue`) gates on
  `/^\/(admin|methodology)(\/|\?|$)/`, verified directly against the live regex pulled from source:
  accepts `/admin`, `/admin/users/123`, `/admin?tab=x`, `/methodology`; rejects
  `//evil.example/admin`, `https://evil.example/admin`, `javascript:alert(1)`, and the
  prefix-without-boundary case `/adminx`.
- The replay call is `router.replace(target)` — vue-router SPA navigation, resolved against the
  app's own route table, never `window.location`.

**Tests:** `adminGateOpenRedirect.security.test.ts` — 7 tests covering `deniedDestination`'s two
branches plus a source-level lock on the replay regex and the `router.replace`-not-`window.location`
call site.

### Everything else scanned in the new diff

- **The client admin gate stays a UX affordance, not enforcement**, and says so in its own header
  comment (`useAdminGate.ts:5-28`) — unchanged in substance from CLIENT-CONFIG-04's assessment. Its
  claim that `docs/trinity/admin.md` shows "0 endpoint gaps" is a doc claim from the retired `docs/`
  tree and was **not** re-verified against live code in this pass (see Gaps) — the client-side
  spoofability itself was re-confirmed unchanged (`router/index.ts:899-903` still reads
  `localStorage`-cached role).
- **`VadPanel.vue` + `insight/data/vadScope.ts` (new, ~660 lines)** put no identifiers beyond a
  server-opaque `groupId`/`classId`/`learnerId` in a query string, send the bearer token only in an
  `Authorization` header, and log nothing to `console`. The scope check (`GET /api/org/vad`) is
  server-side per the same hierarchy-authz pattern the RLS doctrine calls for; this component reads
  as a pure adapter/presentation layer with no independent trust decision of its own.
- **`servedPod.ts` (new)** — a content-gating lookup (which listening pod slug a course serves), not
  an authz boundary; `courseCode` reaches Supabase only through a parameterized `.eq()`, never string
  concatenation.
- **`router/index.ts`'s 6-line deletion** is exactly the removal of the `admin-onboarding` route for
  the now-deleted `AdminOnboardingView.vue` — the third `v-html` sink the 08-11 report verified safe
  is simply gone, not moved or reintroduced elsewhere.
- **`PlayerContainer.vue`'s two new `/api/me/*` fetches** (`phrases-spoken`, `legos-learnt`) follow
  the existing pattern exactly: bearer token from `sb.auth.getSession()`, sent only in the
  `Authorization` header, `if (!token) return` for guests.
- **No new `postMessage` listener, `window.open`/`target="_blank"` without `rel=noopener"`, or
  `innerHTML`/`outerHTML`/`eval`/`new Function`** anywhere in the new diff (full-repo grep, not
  diff-scoped — see re-check section below for the repo-wide sweep).
- The bulk of the diff by line count — `dirFor()` + `unicode-bidi: isolate` across
  `TeleprompterScroll.vue`, `CourseExplorer.vue`, `PronunciationOverlay.vue`,
  `PodStageAuditioner.vue`, `LegoAssembly.vue`, `BrowseScreen.vue`, `ListeningOverlay.vue` — is a
  bidi-rendering correctness fix (Arabic/Urdu/Hebrew course text landing on the correct side of
  trailing punctuation). All of it renders course-authored text via `{{ }}` interpolation, same as
  before; `unicode-bidi: isolate` if anything *reduces* a bidi-spoofing surface by containing each
  run rather than letting it leak into the page's default direction. Not a security-relevant change.

---

## Re-check of the 2026-08-11 client-config report — live status today

| ID | 08-11 verdict | **Today's verdict** |
|---|---|---|
| CLIENT-CONFIG-01 (no security headers) | medium, open | **Live status: FIXED.** `vercel.json` now ships `X-Content-Type-Options`, `X-Frame-Options: DENY`, `Referrer-Policy`, `Strict-Transport-Security`, `Permissions-Policy`, and an enforced `frame-ancestors 'none'` on every route, per `securityHeaders.security.test.ts` (already on `dev`, unrelated to this branch). The full CSP remains `Report-Only`, exactly as CLIENT-CONFIG-01 itself recommended for the interim — **still open as the deliberately-staged remainder**, and its own follow-up `it.todo` is what SEC25-B-01 (this report) found a gap in. |
| CLIENT-CONFIG-02 (env files in git history) | medium, process-only | **Unchanged — still open.** Not re-verified this pass (no new evidence either way; out of this pass's diff scope; a history purge is the kind of action this brief explicitly says not to take). |
| CLIENT-CONFIG-03 (`?debug` reachable in prod) | low, open | **Unchanged — still open.** Not touched by this diff; `main.js`'s gate was not re-audited this pass since it carried no new code. |
| CLIENT-CONFIG-04 (spoofable client admin gate; server backing holds) | low, correct architecture | **Unchanged in substance, re-confirmed live.** `router/index.ts` still reads `localStorage` for the `/admin` guard; `useAdminGate.ts` (new machinery, same doctrine) is explicit in its own comments that it is UX only. Did **not** re-run the 08-11 report's 19/19 per-endpoint `verifyAdmin` sweep — `api/admin/*` now has 33 files (was 19 handlers; some of the growth is `.test.ts` files, some is genuinely new endpoints like `vad-prosody.ts`, which uses a different-but-consistent hierarchy-authz pattern, `resolveVadCaller`, rather than a flat `verifyAdmin`). That full re-sweep is `api/**` territory and belongs to another area of this audit round. |
| CLIENT-CONFIG-05 (prod source maps) | low, open | **Unchanged — still open.** `vite.config.js:247` still reads `sourcemap: true`. |
| CLIENT-CONFIG-06 (echarts XSS advisory) | low, one client-reachable moderate | **Unchanged — still open.** `package.json` still pins `"echarts": "^5.5.0"`; the `6.x` upgrade recommended in 08-11 was not taken. |
| CLIENT-CONFIG-07 (audio CORS wildcard, safe-by-design) | info, holds | **Unchanged — still holds**, and now regression-locked in `securityHeaders.security.test.ts` ("the audio CORS wildcard stays credential-free"). |
| CLIENT-CONFIG-08 (refresh token in CacheStorage, 30 days) | info, acceptable | **Not re-checked this pass** — `authHandoff.ts` was not touched by the new diff and this pass did not re-derive the finding independently. |

**Controls the 08-11 report verified as holding, re-checked against today's repo, still hold:** zero
`innerHTML`/`outerHTML`/`insertAdjacentHTML`/`document.write`/`eval`/`new Function` anywhere in
`packages/player-vue/src` (repo-wide grep, not diff-scoped); the `InstallGuide.vue` open-redirect
guard and the `router.onError` catch-all are unchanged; no server secret pattern
(`SERVICE_ROLE`/`PADDLE_API`/`AWS_SECRET`/`AWS_ACCESS`/`RESEND_`/`CRON_SECRET`) appears anywhere
under client source outside of test-fixture strings; the enumerated `VITE_*` surface is unchanged in
kind (Supabase URL/anon key, Paddle client token + price ids, S3 public config, feature flags) plus
the one new entry, `VITE_POPTY_BASE_URL`, which is a public CMS base URL, not a secret; the single
`onmessage` in `generateLearningScript.ts` remains a `MessageChannel` yield point, not a
cross-origin listener — no `postMessage` origin-check bug exists because there is still no
`window`/`document` `'message'` listener anywhere; the service worker's `runtimeCaching` still covers
exactly navigations + Google Fonts — **no `/api/*` pattern was added despite three new `/api/*`
endpoints landing in this diff** (`/api/me/phrases-spoken`, `/api/me/legos-learnt`,
`/api/org/vad`), so none of them can be replayed to a different signed-in user on a shared device.

---

## Gaps — what this pass could not check

1. **CLIENT-CONFIG-04's server-side claim was not fully re-swept.** The 08-11 report's headline
   number was "19/19 admin endpoints enforce `verifyAdmin` server-side." `api/admin/*.ts` today has
   33 files (mix of new handlers and new `.test.ts` files); a full re-count and re-classification by
   enforcement pattern (`verifyAdmin` vs. the newer hierarchy-authz pattern like
   `resolveVadCaller`) is `api/**` work and belongs to whichever area of this audit round owns that
   surface, not this client-scoped pass.
2. **`useAdminGate.ts`'s in-code citation of `docs/trinity/admin.md` ("0 endpoint gaps")** was read
   as a comment, not independently re-verified — per this repo's own rule that the retired `docs/`
   tree carries no standing, this claim should be treated as unverified until re-derived from live
   code, which is the gap noted in (1) above.
3. **CLIENT-CONFIG-02, -03, -08 were not re-derived this pass** — none of the touched files this
   diff introduces bear on them, and re-deriving each from scratch (git-history secret scan, `main.js`
   debug-gate re-read, `authHandoff.ts` re-read) was judged out of this pass's highest-value scope
   given the explicit new-code priority in the brief. Their 08-11 status is carried forward
   unchanged, not re-confirmed.
4. **No live HTTP access, matching the 08-11 report's own limitation.** Every header/CSP finding is
   read from `vercel.json` as committed; headers injected at the Vercel platform level (or removed by
   it) could not be checked.
5. **Popty's own publish-authz for `doc=htw`** — which account(s) can write it, whether Popty
   sanitises input before storing it — is out of this repo entirely (`ssi-dashboard-v7-clean`). The
   finding above is scoped to "what can a maximally hostile response do to this client," which holds
   regardless of the answer, but a reader wanting "who can actually cause that response" needs the
   other repo.

---

## Tests added

All three live under `packages/player-vue/src/security/`, following the existing file's convention
(`environment: 'happy-dom'`, no network, no live DB — source-text assertions and real function calls
against the actual modules).

| File | Tests | Covers |
|---|---|---|
| `htwPublishedContentXss.security.test.ts` | 8 | Published-copy XSS trace: malicious-payload round-trip, link label/url/title split, figure-union lock, both consumer components' render-binding lock, fetch credentials/fail-closed lock |
| `cspPoptyOrigin.security.test.ts` | 4 + 1 todo | SEC25-B-01: missing `popty.app` in report-only `connect-src`, missing report collector, today's-impact-is-nil regression lock |
| `adminGateOpenRedirect.security.test.ts` | 7 | `deniedDestination`'s two branches; `SchoolsContainer.vue`'s replay-regex lock (accepts/rejects); `router.replace`-not-`window.location` lock |
| **Total** | **19 passing, 1 todo** | |

**Verify:**

```bash
# from packages/player-vue
npx vitest run src/security          # 36 passed, 3 todo (includes the pre-existing securityHeaders suite)
npx vue-tsc --noEmit -p tsconfig.json  # clean
npx eslint src/security/*.security.test.ts  # clean
```

### Gate status at commit

| Gate | Result |
|---|---|
| `npx vitest run` (full player-vue suite) | **green** — 2454 passed, 3 skipped, 3 todo |
| `npx vue-tsc --noEmit -p tsconfig.json` | **clean** |
| `npx eslint src/security/*.security.test.ts` | **clean** |
| `npx tsc -p tsconfig.json --noEmit` (`@ssi/core`) | **clean** |
