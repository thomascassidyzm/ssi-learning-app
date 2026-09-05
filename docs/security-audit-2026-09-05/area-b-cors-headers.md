# Area B — the cross-origin layer and response-header posture — 2026-09-05

Branch `cs/553-sec-b-cors-headers`, own worktree, cut from `origin/main`. Findings and tests only —
no production behaviour changed, nothing outward-facing beyond read-only DNS lookups (`dig`/`curl -I`
against public hostnames the app already owns/serves) and read-only Vercel documentation lookups
(`WebSearch`/`WebFetch`) to establish the one lead the coordinator asked me to prove or kill. No emails,
no writes, no live-DB contact.

## 0. Delta established

```
git diff 8755d4c8 origin/main -- api/_utils/cors.ts vercel.json packages/player-vue/src/platform/apiBase.ts packages/player-vue/src/security/
git log --oneline 8755d4c8..origin/main -- <same paths>
```

Two commits touch my area:
- `66341a0b` — `platform/` seam (`capabilities.ts`, `apiBase.ts`, `storage.ts`, `scanPlatformDoors.ts`):
  the WebView transport plumbing, no server code.
- `7e557f59` — `api/_utils/cors.ts` (new, 186 lines) wired into 30 handlers (31 counting
  `api/player-events.ts`, which took its own inline wildcard CORS instead — see B-05).

**Correction to the brief's premise on item 6**: `vercel.json` is **byte-identical** between `8755d4c8`
and `origin/main` (`git diff` returns nothing), and `packages/player-vue/src/security/securityHeaders
.security.test.ts` / `cspPoptyOrigin.security.test.ts` have exactly one touch in the window
(`5da49e70`), which only changes a code-comment's doc-path citation (from the `docs/` retirement sweep),
not an assertion. **There is no delta to re-check here.** Stated plainly per the "only report deltas"
rule — I did not re-run the 08-25 CSP/clickjacking audit these files encode.

`api/_utils/cors.test.ts` (204 lines, shipped in the same commit) already covers the same-origin
byte-identical path, the preview-alias allowlist shape, the native-shell origins, the `WEBVIEW_ALLOWED_
ORIGINS` override, and the no-credentials/no-wildcard invariants, in both directions. I did not duplicate
that coverage; the tests below add only what it doesn't already assert.

---

## 1. Findings

### SEC0905-B-01 — `isOwnHost()`'s Vercel-preview-alias check trusts a slug a stranger can register · **MEDIUM** · CONFIRMED

**File:** `api/_utils/cors.ts:71-76`

```ts
function isOwnHost(host: string): boolean {
  if (host === 'saysomethingin.app') return true
  if (host.endsWith('.saysomethingin.app')) return true
  if (host.startsWith(PREVIEW_PREFIX) && host.endsWith(PREVIEW_SUFFIX)) return true
  return false
}
```
with `PREVIEW_PREFIX = 'ssi-learning-app-'`, `PREVIEW_SUFFIX = '-zenjin.vercel.app'`.

**The coordinator's hypothesis is CONFIRMED**, established from Vercel's own current documentation
(fetched today, not recalled from training data — both pages carry `last_updated: 2026-08-28`/`2026-09-02`):

1. **The deployment-URL shape is exactly as hypothesised.** Per
   [Accessing Deployments through Generated URLs](https://vercel.com/docs/deployments/generated-urls):
   a commit-preview URL is `<project-name>-<unique-hash>-<scope-slug>.vercel.app`, where `<scope-slug>`
   is *"the slug (not the name) of the account or team that contains the project/deployment"* — freely
   chosen at team-creation time, not derived from anything Tom's project controls.
2. **Team slugs are self-service and not namespaced to an existing team.** Per
   [Account Management § Creating a team](https://vercel.com/docs/accounts#creating-a-team), team
   creation (dashboard or `POST /v1/teams {"slug": "<team-slug>", "name": "<team-name>"}`) takes an
   arbitrary slug chosen by the creator. Nothing in the API or dashboard flow requires proving
   affiliation with an existing team whose slug you resemble — the only constraint is that the exact
   string isn't already taken (first-come-first-served, same as project names).
3. **Project names are also free-form and only unique within the creator's own team**, so an attacker
   can name their own project literally `ssi-learning-app`.

So: register a team with a slug ending in `-zenjin` (e.g. `evil-zenjin` — verified below that the
suffix match requires a literal hyphen before `zenjin`, so `notzenjin`/`xzenjin` do **not** work, but
`evil-zenjin`, `x-zenjin`, or the bare `zenjin` slug if unclaimed all do), deploy a project named
`ssi-learning-app` under it, and Vercel mints exactly
`ssi-learning-app-<their-own-hash>-evil-zenjin.vercel.app` for it — satisfying both halves of
`isOwnHost()` with zero relationship to Tom's actual team. Verified mechanically:

```js
isOwnHost('ssi-learning-app-abc123xyz-evil-zenjin.vercel.app') // => true
isOwnHost('ssi-learning-app-abc123xyz-notzenjin.vercel.app')   // => false (no hyphen before "zenjin")
isOwnHost('ssi-learning-app-abc123xyz-zenjin.vercel.app')      // => true (if "zenjin" itself is free)
```

**Failure scenario:** an attacker deploys a real, live page at
`https://ssi-learning-app-<their-hash>-evil-zenjin.vercel.app`. Any of the 30 endpoints wired to
`applyCors` will, on a request whose `Origin` is that hostname, echo it back as
`Access-Control-Allow-Origin` and answer preflight with 204 — i.e. the browser will let that page's own
JS read the JSON response of any request it sends to those endpoints.

**Why this is MEDIUM and not HIGH/CRITICAL, stated explicitly rather than assumed:** the file's own
posture — verified true in B-04 below — is that **no ambient credential exists** (no cookie identity,
`credentials: 'omit'` on the client). CORS only gates whether attacker-controlled JS may **read** the
response of a request that JS **itself** constructs, with whatever headers that JS sets. It does not
grant the attacker anything they couldn't already get by calling the same endpoint directly from their
own server with the same bearer token (if they have one) or with no token (if the endpoint doesn't need
one) — a plain `curl` needs no CORS bypass at all. The one thing this bug adds that a curl doesn't have
is a **victim's browser as an unwitting relay carrying the victim's network vantage point** (IP,
geography) rather than the attacker's own — relevant only for endpoints gated by IP-based rate limiting
or geofencing, and even then the *request* already reaches the server via a plain `<img>`/`<form>`/
no-cors `fetch` regardless of whether this bug exists; this bug only affects whether the *response* can
be **read** back into attacker JS. I did not find such an IP/geo-gated endpoint among the 30. So the
practical blast radius of this specific instance, confined to `cors.ts`, is real but bounded — it is a
genuine allowlist defect, not a data-exfiltration primitive, given the app's own no-cookie design.

**Fix** (not applied — findings only): tie the check to something an attacker cannot register, e.g. a
`VERCEL_URL`/`VERCEL_BRANCH_URL` env-var comparison read at request time from Vercel's own injected
per-deployment env (which is unforgeable by a third party), or drop the preview-alias allowance entirely
for anything but a pinned list of specific, known preview hostnames.

### SEC0905-B-02 — the identical bypass in `appOrigin.ts` is far more severe: it can poison minted auth/invite links · **HIGH** · CONFIRMED, ADJACENT SCOPE

**File:** `api/_utils/appOrigin.ts:36-44` (not `api/_utils/cors.ts` — flagged here because it is the
literal same pattern, `cors.ts`'s own header cites it as precedent, and the coordinator's research
question — "can a stranger register a `-zenjin` team slug" — applies to it identically). This belongs to
whichever area owns the auth/invite/onboarding endpoints (adjacent to Area A/C); I'm surfacing it here
because nobody else was asked to re-derive the Vercel-slug fact and it changes the verdict on a file
that shares the exact code.

```ts
const PREVIEW_PREFIX = 'ssi-learning-app-'
const PREVIEW_SUFFIX = '-zenjin.vercel.app'
function isTrustedHost(host: string): boolean { /* byte-identical logic to isOwnHost() */ }
export function getAppOrigin(req: VercelRequest): string {
  const host = ((req.headers['host'] as string) || '').toLowerCase().replace(/:\d+$/, '')
  if (host === 'saysomethingin.app' || host === 'www.saysomethingin.app') return PRODUCTION_ORIGIN
  if (host === 'staging.saysomethingin.app') return 'https://staging.saysomethingin.app'
  if (isTrustedHost(host)) return `https://${host}`
  return PRODUCTION_ORIGIN
}
```

The file's own header explains why this matters: it was written specifically to fix **AUTH-CORE-08 /
INPUT-10** — a caller-controlled `Host` header used to be echoed verbatim into the origin of a minted,
emailed invite/redeem link. The comment asserts the replacement is safe because *"both halves of that
pattern must match — an attacker's own `*.vercel.app` project cannot satisfy the `-zenjin.vercel.app`
suffix."* **That claim is false, for the same reason as B-01**: the suffix is exactly as
attacker-satisfiable here as in `cors.ts`, because it's the same string comparison.

`getAppOrigin()`'s return value is used to build a URL handed to, or emailed to, **another person** —
not just echoed into a response header read by the requester's own JS. That is a materially worse
primitive: a redirect/link-origin, not a read-permission. Four call sites, in ascending order of
existing privilege required to trigger them (all already require *some* authenticated/privileged caller
— none of these are anonymous-reachable):

| Call site | Auth required | What `getAppOrigin()` builds |
|---|---|---|
| `api/admin/create-signin-link.ts:113` | `verifyAdmin` (ssi_admin) | Supabase `generateLink({type:'magiclink', redirectTo: getAppOrigin(req)})` for an **arbitrary target learner's email** — the `redirectTo` is where the browser lands (with the session in the URL) after the link is used |
| `api/school/staff-signin-link.ts:250,277` | `verifyAuthToken` + school-admin-scope check | an access-code `join_url` built on `getAppOrigin(req)` |
| `api/groups/[id]/invites.ts:219,279,357,439,623` | scoped to `leader`/`school_leader`/caller's own group | invite/redeem `resendUrl`/`rotatedUrl`/origin used for invite links |
| `api/groups/[id]/demo-mint.ts:275` | `verifyAdmin` | demo-mint origin |

**Failure scenario (the `create-signin-link.ts` instance, the worst of the four):** the *original*
AUTH-CORE-08 writeup already establishes that a raw, non-browser HTTP client can set an arbitrary `Host`
header on a request that reaches this function (that is what the old, fixed bug demonstrated was
possible — the fix changed the *validation*, not whether the value is attacker-reachable). So: an
attacker who holds — or an insider/compromised account that already holds — an `ssi_admin` bearer token
sends a raw request to the real `create-signin-link` endpoint with `Host:
ssi-learning-app-<attacker-hash>-evil-zenjin.vercel.app` and `learner_id` set to a target user. The
server mints a genuine Supabase magic-link whose `redirectTo` is the attacker's own live deployment at
that hostname. When the target clicks the link (handed to them via whatever out-of-band channel the
admin tool assumes — Slack/WhatsApp per the file's own docstring), Supabase completes the auth exchange
and redirects the browser to the attacker's page carrying the session tokens in the URL — full account
takeover of the target, not just of the admin.

**Why HIGH and not CRITICAL, stated explicitly:** every one of the four call sites requires an
already-privileged, already-authenticated caller (ssi_admin, or a school/group leader within their own
scope) — this is not exploitable by an anonymous attacker on its own. It converts "an already-privileged
account is compromised or malicious" into "that account can silently exfiltrate any other user's session,
not just act within its own declared scope" — a real escalation of blast radius for an existing
compromise, not a fresh unauthenticated hole.

**What I did NOT verify** (explicit gap, per the honesty rule): whether Vercel's edge, *today, on this
specific project*, still forwards a client-supplied `Host` header that mismatches the actual routing
domain through to the serverless function. AUTH-CORE-08 proves it was true at the time that bug was
found; I did not re-verify it live, because doing so would mean sending a crafted request to a real
endpoint that requires either an admin token I don't have or would exercise a write path
(`generateLink`/school join-code minting) I'm not authorised to trigger under this audit's "no
outward-facing contact" rule. The finding as CONFIRMED covers the slug-registration half; the
Host-header-reachability half is carried over from the prior, already-accepted finding rather than
independently re-proven here.

**Fix** (not applied): same as B-01 — stop trusting a client-suppliable value (`Host` here, `Origin` in
cors.ts) validated only by a spoofable string pattern; anchor to the platform-injected `VERCEL_URL`/
`VERCEL_BRANCH_URL` env vars, or a short, explicitly-pinned list of real preview hostnames.

### SEC0905-B-03 — the pre-existing wildcard-CORS endpoints are unchanged and out of this delta · **INFO**

`api/player-events.ts:186-188`, `api/audio/batch-urls.ts:77-79`, `api/entitlement/offline-lease.ts:88-90`
all set `Access-Control-Allow-Origin: '*'` directly (not via `applyCors`), each with an in-file comment
citing the same rationale: credential-free, `Authorization` listed only for attribution, matching a
posture "already shipped." `player-events.ts` is the one file the `7e557f59` commit message names as
touched *and* left on its own wildcard rather than moved to `applyCors` (its diff only changes
`Allow-Headers` to include `Authorization` and adds the `acting_learner_id` body-claim path — both
already covered by `api/playerEventsAttribution.security.test.ts`, added in that same commit). None of
these three files' `Access-Control-Allow-Origin` line is new in this window; `audio/batch-urls.ts`'s only
change since base is `e334c217` (SEC0901-D-01, entitlement not CORS). Not re-filed, not re-audited —
consistent with player-events.ts's stated design (write-only, no ambient credential, response body is
`{inserted:N}` or a generic error, nothing sensitive to read back).

### SEC0905-B-04 — credentials posture: no cookie is trusted as identity, client pins `credentials: 'omit'` · **SECURE ASSERTION**

Both halves of the header's claim, checked against the code rather than assumed:

- **Server side:** `grep -rn "req\.cookies" api --include=*.ts` (excluding tests) returns exactly one
  hit: `api/player-events.ts:128`, the `ssi-user-id` cookie read for the play-as-class claim. It is
  never trusted alone — `resolveIdentity()` treats it as an **unsigned claim**, honoured only when
  `isAuthorisedClassLearner()` independently confirms, via a **verified bearer token**'s
  `resolveVisibleScope`, that the caller may drive that class. No `Set-Cookie` is emitted anywhere in
  `api/**` (`grep -rn "Set-Cookie|setCookie" api` — no hits outside comments). The only place a cookie is
  *written* is client-side, `document.cookie` in `useAuth.ts:432/434` — `SameSite=Lax`, unsigned, exactly
  the value the server already treats as a mere claim.
- **Client side:** `apiBase.ts`'s `credentialFree()` pins `credentials: 'omit'` on every rewritten
  string/URL fetch unless the caller explicitly asked for a credentials mode (line 121:
  `if (init && init.credentials) return init`). The one branch that does *not* call `credentialFree()` —
  the `Request`-object rewrite path (`new Request(origin + rel, input)` at line 100) — is reasoned about
  correctly in its own comment rather than glossed over: a `Request` built with no explicit credentials
  mode defaults to `'same-origin'`, and because the rewrite changes the request's URL to a genuinely
  different origin, `'same-origin'` mode causes the browser to withhold credentials anyway — functionally
  identical to `'omit'` in exactly this rewrite scenario. I confirmed no call site in the app actually
  constructs a `Request` object at all (`grep -rn "new Request("` → the one hit is this line itself), so
  the branch is currently dead code from the app's own call sites, and safe regardless.

No finding. This is exactly what the file's docblock claims.

### SEC0905-B-05 — the `.saysomethingin.app` wildcard: DNS and Vercel's own ownership model make cross-team subdomain claiming infeasible · **SECURE ASSERTION**

Checked live (read-only `dig`/`curl -I` against hostnames this project already owns and serves; no
mutation, no auth, no write):

- The whole zone is delegated to Vercel's own nameservers (`dig +short NS saysomethingin.app` →
  `ns1.vercel-dns.com`, `ns2.vercel-dns.com`; SOA confirms), meaning DNS itself is entirely inside Tom's
  Vercel account — there is no independent third-party DNS provider in the chain to compromise.
- `api.`, `invite.`, `members.` (all real subdomains referenced in the code as synthetic **email address**
  domains, not web hosts) resolve to Vercel's shared anycast IPs and return a stock `server: Vercel` 404
  (`DEPLOYMENT_NOT_FOUND`-shape) — and so does a **freshly-invented random subdomain**
  (`doesnotexist<rand>.saysomethingin.app`), proving this is an ordinary **wildcard `*.saysomethingin.app`
  A record** pointed at Vercel's shared edge, not a set of individually-dangling per-subdomain CNAMEs to
  some decommissioned third-party host. `contact.saysomethingin.app` (the Resend-verified email sending
  domain) has **no A/CNAME/TXT record visible at all** from outside — it isn't even inside the wildcard's
  apparent scope, consistent with being purely an SPF/DKIM-verified sending identity with its own
  provider-side records, not a hostname anyone can serve content from.
- Per Vercel's own current docs
  ([Working with domains § Domain ownership and Project assignment](https://vercel.com/docs/domains/working-with-domains)):
  *"If you add that domain... to a project on a different Vercel team, that domain will require a
  **TXT verification step**."* Since the zone's authoritative DNS is Tom's own Vercel account, only Tom
  can create the TXT record a cross-team claim would need. A stranger cannot claim `invite.
  saysomethingin.app` (or any other subdomain) into their own Vercel project through Vercel's normal
  flow, wildcard-resolving-to-Vercel or not.

**Conclusion: the `.saysomethingin.app` wildcard in `isOwnHost()`/`isTrustedHost()` is not a viable
subdomain-takeover vector today.** This is a genuinely different risk shape from B-01/B-02 (which don't
need any DNS control at all — team-slug registration is self-service with no ownership check against
Tom's property) and I want that contrast to be explicit: the wildcard-domain half of the allowlist is
sound; the preview-alias half is not.

### SEC0905-B-06 — coverage and consistency across the 30 wired handlers · **SECURE ASSERTION**, plus one **INFO** completeness gap

Checked every file returned by `grep -rl applyCors api --include=*.ts` (excluding `cors.ts`/`cors.test.ts`
— 30 real call sites):

- **`applyCors` runs before any auth check in all 30/30 files** — no file has a `verifyAuthToken`/
  `verifyAdmin` call at a lower line number than its `applyCors` call. There is no oracle here: an
  unrecognised-origin `OPTIONS` always gets 403 from the CORS layer itself, never leaks whether the route
  is auth-gated by getting a *different* status from a downstream auth check.
- **The declared `methods` option matches the route's actual method handling in all 30/30 files** —
  cross-checked the `methods:` string in the `applyCors` call against every `req.method === /!==`
  comparison in the same file. `api/me/threads.ts` is the one multi-method route (`GET, POST`) and
  declares both. No route serves a method it doesn't declare, and no route declares a method it doesn't
  serve.
- **No endpoint has `applyCors` sitting after a side effect** — in every file the call is the first
  executable statement of the handler (before any DB read/write), which is also what makes the
  before-auth check above possible.

**INFO — a completeness gap, not a vulnerability**: `api/family/create-child.ts`, `create-child`'s
siblings (`family/index.ts`, `family/invite.ts`, `family/leave.ts`, `family/remove.ts`, `family/
signin-link.ts`) and the `teacher/*` endpoints have neither `applyCors` nor an inline
`Access-Control-Allow-Origin`. Most of these are schools/admin-dashboard-only (same-origin web use only,
by design — correctly excluded). But `useFamilyManagement.ts` and `views/onboarding/Onboarding.vue`
reference `/api/family/*` paths, and `Onboarding.vue` is plausibly part of the core learner flow the
WebView shell is meant to carry (not just the schools dashboard). Because these routes emit **no**
`Access-Control-Allow-Origin` header at all, a cross-origin call from the WebView shell would be
correctly **blocked by the browser** (fail-closed — nothing is exposed), but the *feature* — adding a
child, family invites — would silently break the first time the native shell actually ships and a
parent tries to use it there. Not a security finding; flagged because the brief asked about coverage
gaps and this is one that will surface as an availability bug, not a confidentiality one.

### SEC0905-B-07 — `Vary: Origin` and edge caching (`s-maxage`) do not compose into a cross-caller leak · **SECURE ASSERTION**

Checked every `applyCors` call site that also sets `s-maxage`/`CDN-Cache-Control`:
`courses/[code]/round-map.ts`, `sectors.ts`, `cycles.ts`, `bundle.ts`.

The theoretical risk: `applyCors` only sets `Vary: Origin` when an `Origin` header was present on the
request (same-origin browser GETs typically send none at all), so a response cached at the edge from a
same-origin request carries no `Vary: Origin`, and a response cached from a cross-origin request does.
If Vercel's shared cache doesn't actually key on `Vary: Origin` (plausible — it's a CDN-cache-key
decision the app doesn't control), a cached entry could in principle be replayed to a caller with a
different `Origin` than the one that populated it.

Traced what that would actually expose, per file:

- **`round-map.ts`** (`s-maxage=31536000`) and **`sectors.ts`** (`s-maxage=300`) have **no
  `Authorization`/entitlement dependency anywhere in the handler** (`grep` for `authorization|
  verifyAuthToken|entitlement` returns nothing in either file) — the response body is pure
  `course_code`-keyed structural data, byte-identical for every caller regardless of identity or Origin.
  A cross-Origin cache replay here serves nothing that wasn't already public to every caller.
- **`cycles.ts`** is the one file that genuinely differs by caller (preview vs entitled content), and its
  own code (lines 760-790) already gates public/shared caching on **`isAnonymousRequest =
  !req.headers.authorization`** together with `windowIsUniversal` (the emitted window sits wholly inside
  the free-preview ceiling, where anon/unsubscribed/entitled bodies are verified byte-identical, per the
  comment dated 2026-08-30 against `dev`). Both of those gating conditions are **Origin-independent** —
  they depend on the *Authorization header* and the *content window*, never on which Origin the request
  carried. A `Vary: Origin` cache-key mismatch can therefore, at worst, serve a stale `Access-Control-
  Allow-Origin` value alongside content that is already guaranteed identical for every caller in the
  cacheable branch — a possible CORS-level false negative (browser blocks a read it should have allowed)
  for a caller whose Origin doesn't match what got cached, never a leak of the private branch (which is
  always `private, max-age=60` and, per the platform behaviour already verified in SEC0901-D-03/the
  09-01 audit, bypasses the shared cache entirely whenever `Authorization` is present).
- **`bundle.ts`** already carries `private` on its entitlement-sensitive branch — SEC0901-D-03 measured
  that Vercel strips shared-cache tokens whenever `private` is present, live against `dev`. Not
  re-measured here; cited, not re-audited.

No finding. The one thing worth flagging for a future reader: `Vary: Origin` costs a little cache hit
rate for legitimate cross-origin callers (WebView, preview aliases) whenever it fragments a cache key
that would otherwise have been a hit — a performance nit, not a security one, and not measured here since
it needs live cache-hit telemetry this audit's rules don't license me to go generate.

### SEC0905-B-08 — `WEBVIEW_ALLOWED_ORIGINS` malformed values fail safe, including the obvious footgun (`*`) · **SECURE ASSERTION**

```ts
function shellOrigins(): string[] {
  const raw = process.env.WEBVIEW_ALLOWED_ORIGINS
  if (raw === undefined) return DEFAULT_SHELL_ORIGINS
  return raw.split(',').map((s) => s.trim().replace(/\/+$/, '').toLowerCase()).filter(Boolean)
}
```
and its only caller: `if (shellOrigins().includes(lower)) return candidate` — a **literal array-membership
check**, not a wildcard/glob interpreter. Setting `WEBVIEW_ALLOWED_ORIGINS=*` (an ops mistake reaching
for "allow everything") produces `shellOrigins() === ['*']`, and no real browser ever sends
`Origin: *` — so the env value that most looks like "open the door to everyone" is actually **inert**,
verified directly:

```js
shellOrigins() // => ['*']
shellOrigins().includes('https://evil.example') // => false
```

(Precisely: `matchAllowedOrigin('*')` — the literal one-character string — DOES match, since this is a
plain array-membership check, not a glob. That's inert against the real threat model because no browser
ever constructs `Origin: *`; a browser's `Origin` header is always a real scheme+host it derived from the
page's own URL. Recorded so the exact boundary is on record rather than glossed over.)

An empty string switches native-shell CORS off entirely (already asserted by `cors.test.ts`); a comma-only
or whitespace-only value reduces to `[]` (same effect) via the existing `.filter(Boolean)`. The one
genuine footgun worth naming for whoever configures this env var in future: a value that includes the
literal string `null` would be honoured (`shellOrigins().includes('null')` → true), and browsers do send
a literal `Origin: null` from sandboxed iframes/data: contexts — so an operator should never add `null`
to this list. That is an operational caution, not a code defect (nothing in the current default or any
plausible legitimate config sets it), so I'm recording it as guidance rather than a finding.

---

## 2. Summary table

| ID | Severity | Verdict | One line |
|---|---|---|---|
| SEC0905-B-01 | MEDIUM | CONFIRMED | `isOwnHost()`'s Vercel preview-alias check trusts a self-service team slug (`*-zenjin`); blast radius bounded by the app's zero-ambient-credential design |
| SEC0905-B-02 | HIGH | CONFIRMED (adjacent scope) | identical logic in `appOrigin.ts` can poison the `redirectTo`/origin of minted magic-links and invite/join URLs sent to other users — needs routing to whoever owns auth/invites |
| SEC0905-B-03 | INFO | not re-filed | pre-existing wildcard-CORS endpoints (`player-events.ts`, `audio/batch-urls.ts`, `entitlement/offline-lease.ts`) unchanged in this delta |
| SEC0905-B-04 | — | SECURE | no cookie is trusted as identity anywhere in `api/**`; client credentials posture holds including the one unguarded `Request`-object edge case |
| SEC0905-B-05 | — | SECURE | `.saysomethingin.app` wildcard is not a viable subdomain-takeover vector — Vercel's TXT ownership-verification model blocks cross-team claims |
| SEC0905-B-06 | INFO | SECURE + 1 gap | applyCors precedes auth and methods are consistent on 30/30 handlers; `family/*` endpoints reachable from `Onboarding.vue` lack any CORS handling (availability gap, not a security hole) |
| SEC0905-B-07 | — | SECURE | `Vary: Origin` vs `s-maxage` cannot leak across callers — the one caller-differentiated cache (`cycles.ts`) gates on Authorization presence + content-universality, both Origin-independent |
| SEC0905-B-08 | — | SECURE | `WEBVIEW_ALLOWED_ORIGINS=*` is inert (literal match, not a wildcard); empty/whitespace switches off cleanly; `null` is a documented operator caution |

## 3. Gaps (honesty section)

- **SEC0905-B-02's Host-header-reachability precondition was not independently re-verified live.** I
  relied on the prior, already-fixed AUTH-CORE-08 finding as evidence that a mismatched `Host` header
  reaches these functions; testing it myself would have required either an admin bearer token I don't
  have or exercising a real write path (magic-link mint / school join-code mint), both outside this
  audit's read-only, no-outward-contact rule.
- **No live cache-hit telemetry was generated** for the `Vary: Origin` cache-fragmentation performance
  note in B-07 — it's reasoned from the code and the platform behaviour already measured in the 09-01
  audit, not freshly measured.
- **DNS/Vercel checks (B-05) touched only public, already-owned hostnames**, read-only (`dig`, `curl -I`),
  no auth, no state change — consistent with the audit's read-only-contact allowance.

## 4. Test specs

`api/_security/sec0905-b-cors-headers.security.test.ts` — new file, 100% source-reading + pure-function
assertions, no network, no DB. Encodes B-01, B-02 (characterizations — will go RED when someone fixes the
allowlist, by design, per the audit's instructions), and B-06/B-08 (secure-assertions / regression
guards, expected to stay green). Run:

```
npx vitest run -c vitest.api.config.ts api/_security/sec0905-b-cors-headers.security.test.ts
```

**40/40 passing**, verified in this worktree.

**`pnpm run typecheck:api` gap (explicit, not swept under the rug):** the repo-wide `typecheck:api` run
fails in this worktree — but on a pre-existing, unrelated cause: `api/courses/[code]/bundle.ts` (untouched
by this audit) imports `packages/player-vue/src/types/courseBundle.ts`, which imports `@ssi/core`, whose
`dist/` is not built in this fresh worktree (CLAUDE.md itself documents `pnpm --filter @ssi/core build`
as a prerequisite step). I deliberately did **not** run `pnpm install`/`pnpm --filter @ssi/core build` to
fix this: this worktree's root `node_modules` is a **symlink back to the shared checkout**
(`/home/tomcassidy/SSi/ssi-learning-app/node_modules`), and `pnpm install --frozen-lockfile` opened an
interactive prompt offering to **remove and reinstall** that shared directory — exactly the shared-state
risk the environment notes warn about. I aborted rather than risk another live session's install state.
Instead: my new file is **excluded from `tsconfig.api.json`'s scope entirely** (its `exclude` list already
drops `**/*.test.ts`, and `.security.test.ts` matches that glob), and I typechecked it in isolation —
`npx tsc --noEmit --target ES2022 --module ESNext --moduleResolution bundler --esModuleInterop
--skipLibCheck --strict --types node api/_security/sec0905-b-cors-headers.security.test.ts` — clean, no
errors. I did not modify any non-test file under `api/**`, so the pre-existing `typecheck:api` failure is
unrelated to this audit's changes; I'm recording the gap rather than silently skipping the check.

---

**Landing line.** Branch: `cs/553-sec-b-cors-headers`. Merged: **not merged** — this branch has not been
merged into `dev`, `staging`, or `main`. Deployed: **nowhere** — no deploy was triggered and none was
verified live; the only outward contact was read-only DNS lookups against already-public hostnames and
read-only Vercel documentation fetches.
