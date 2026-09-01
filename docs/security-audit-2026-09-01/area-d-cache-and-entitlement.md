# Area D — the cache, the content delivery path, and entitlement

Tests: `api/courses/edgeCacheKeying.security.test.ts` (7), `api/audio/batchUrlsEntitlementVsAuth.security.test.ts`
(2), `packages/player-vue/src/composables/useCourseBundle.crossIdentity.security.test.ts` (2, client-side).
Method: read every file named in the brief against today's `origin/dev`, then verify the two caching claims
that matter most **live**, against the real deployed `dev` branch
(`https://ssi-learning-app-git-dev-zenjin.vercel.app`) with plain `curl` — this area is specifically about
what a CDN actually does, and reading the source alone cannot answer that. Transcripts are inline below.
Client-cache/sign-out behaviour verified with a behavioural vitest test using `fake-indexeddb`, not just
source-reading.

## Verdict table

| ID | Class | Severity | Verdict | Pinned by |
|---|---|---|---|---|
| **SEC0901-D-02** | Cached full course bundle (IndexedDB, client) survives sign-out and is not learner-scoped — shared-device cross-account paid-content leak | **HIGH** | **LIVE** | `useCourseBundle.crossIdentity.security.test.ts` |
| **SEC0901-D-01** | `batch-urls.ts`'s "verified session" gate is authentication-only, not entitlement — any free/never-paid account can bulk-download premium audio it already knows the ids for | **HIGH** (narrows the accepted 08-25 framing of INPUT-01) | **LIVE** (by design, not yet named this precisely) | `batchUrlsEntitlementVsAuth.security.test.ts` |
| cycles.ts R1 edge-cache argument | Public CDN caching of the free-preview window | — | **HOLDS — verified live** | `edgeCacheKeying.security.test.ts` + live transcript below |
| bundle.ts `private` + `s-maxage` together | Whether Vercel's edge actually caches a personalised response | — | **HOLDS — verified live** (Vercel strips the shared-cache tokens when `private` is present; MISS on every repeat call) | `edgeCacheKeying.security.test.ts` + live transcript below |
| round-map.ts, ungated | Course structure (no text/audio) served unauthenticated, cached 1yr | — | **Already assessed by SEC25-X (08-25 audit) as defensible; unchanged.** Not re-litigated here. | `roundMap.security.test.ts` (pre-existing) |
| `audio/[audioId].ts` fail-open on premium audio | Per-clip proxy has no way to attach entitlement (`<audio src>`) | — | **Already tracked as INPUT-01's residual** (08-25 remediation-notes.md). Not re-litigated here. | pre-existing |
| SEC29-X-04 anon-key fallback | cycles/round-map/bundle/infplay-cycles/audioAccess silently swap to anon key if service key missing | — | **Already tracked by Area A** (SEC0901-A-06, "5 → 3"). No new instances found in this area's files. | Area A |
| `sw-config.ts` disclosure | Unauthenticated endpoint | INFO | **Benign by design** — three kill-switch booleans/a string, no secrets, no course/user data | — |
| `audio/[audioId].ts` disclosure | Unauthenticated endpoint | INFO | **Benign** — streams audio bytes only after its own entitlement gate; error paths keep S3 key/bucket server-side (`console.error` only) | pre-existing |

---

## 1. SEC0901-D-02 (HIGH) — the local course-bundle cache is a shared-device paid-content leak

**File/line:** `packages/player-vue/src/composables/useCourseBundle.ts:266-273` (the `getCourseBundle` cache
read), cross-referenced against `packages/player-vue/src/composables/useAuth.ts:821-855` (`signOut()`).

**The attack, concretely.** A paying learner uses a shared device (this product ships to schools —
CLAUDE.md's own words) and plays `spa_for_eng`. `getCourseBundle('spa_for_eng')` fetches the full,
entitled bundle from `GET /api/courses/spa_for_eng/bundle` — real course text, `previewOnly` absent — and
persists it in the background to IndexedDB (`ssi-bundle-cache`, object store keyed by `courseCode` alone,
**not** by learner id: `db.createObjectStore(STORE, { keyPath: 'courseCode' })`). The learner signs out.
`useAuth.ts`'s `signOut()` purges Supabase auth storage, the role cache, the subscription cache and the
entitlement cache — but never calls `clearCachedBundle()`. That function exists, is exported, and (confirmed
by grep across the whole app during this audit) **is imported nowhere** — dead code, not wired to sign-out or
anything else. A second person then opens the app on the same device/browser, signed out or signed in as a
different, unentitled account, and starts the same course. `getCourseBundle` finds the cached entry, sees
`previewOnly` is falsy so the one guard that exists doesn't fire, runs a version head-probe
(`GET /api/courses/:code/bundle?head=1` — itself **not** entitlement-gated; the handler's own comment says
"no entitlement check ... course-level constants, not content"), the versions agree, and returns the cached
bundle **verbatim** — the actual paid course text, every LEGO past the Yellow-belt (seed 19) preview ceiling,
straight from disk, with no server round-trip that could have said no.

**Why this reads as an oversight rather than an accepted trade-off.** The code already has a careful,
explicitly-commented guard for the *opposite* asymmetry — a guest's cached preview bundle must not survive an
upgrade to paid:

```ts
// A cached PREVIEW bundle is only valid for a caller who is still
// unentitled. ... If we now have a token, re-fetch and let the server say.
if (cached?.bundle?.previewOnly && (await hasAuthToken())) {
  // fall through to the network fetch below
}
```

There is no mirror-image check ("a cached FULL bundle is only valid for the caller who was entitled when it
was cached"). Given the amount of care visible in that one guard, and the fact that `clearCachedBundle()` was
built and then never called, this reads as a real gap, not a deliberate call.

**Downstream amplification.** The bundle's `ephemeralAudio`/`audio` blocks carry real audio uuids for that
premium content. `AudioCache` (`ssi-audio-cache-v2`) is the same shape — a single, non-learner-scoped
IndexedDB store, also never cleared on sign-out (confirmed: no `deleteDB`/clear call in `useAuth.signOut()`;
the only `deleteDB(DB_NAME)` call in `AudioCache.ts` is inside its own corrupted-database recovery path).
So a previous learner's already-*downloaded* audio bytes are available to whoever uses the device next,
independent of any server call at all, and even independent of finding #2 below.

**Verified behaviourally**, not just by reading: `useCourseBundle.crossIdentity.security.test.ts`, using
`fake-indexeddb`, simulates "session 1" (signed-in payer, fetches + caches the full bundle) then resets the
module graph and re-opens "session 2" with no auth token. Session 2 receives the cached full bundle's premium
`knownText` verbatim, and the mock proves it happened via cache (the only network call in session 2 is the
version head-probe; a second call to fetch the bundle body would throw). The suite's second test is the
control proving the code's *existing* guard (preview → paid) really does work, so the asymmetry is real and
not a test artefact.

**Fix shape (not applied — findings-only per this audit's rules):** the natural mirror of the existing guard
— re-fetch (or at minimum re-validate entitlement, e.g. via a lightweight authenticated check) whenever a
cached **non-preview** bundle is about to be served to a request that is unauthenticated or authenticated as
a *different* learner than whoever cached it — plus wiring `clearCachedBundle()` (and the equivalent for
`AudioCache`) into `signOut()`.

## 2. SEC0901-D-01 (HIGH) — `batch-urls.ts` checks authentication, not entitlement

**File/line:** `api/audio/batch-urls.ts:145` (`if (entitlement.gated && !(await hasVerifiedSession()))`),
`api/_utils/audioAccess.ts:531-565` (`resolveAudioEntitlement`), `api/_utils/auth.ts:31-60`
(`verifyAuthToken`).

The 2026-08-11 fix for INPUT-01 closed the *anonymous* bulk-extraction path: `batch-urls.ts` now requires
`hasVerifiedSession()` — literally `verifyAuthToken(req).then(r => r.valid)` — before it will hand back a
presigned URL for a premium, past-preview clip that carries no valid entitlement token. `verifyAuthToken`
does exactly one thing: calls `supabase.auth.getUser()` on the bearer and reports whether it resolved to a
real user. **It has no notion of subscription or entitlement at all**, and `batch-urls.ts` never separately
queries `learners`, `user_subscriptions`, or `user_entitlements` for the caller. The 2026-08-25 remediation
notes recorded this fix accurately as closing "anonymous bulk premium-audio extraction" — that framing is
correct, and it is also narrower than the actual protection this endpoint needs: **"has a valid login" and
"has ever paid for anything" are different properties, and the code only checks the first.**

**The attack.** Register a free account (OTP email signup — no payment, no verification beyond a working
inbox, seconds of work). Obtain a Supabase session token. `POST /api/audio/batch-urls` with up to 500 premium
past-preview audio uuids and that bearer: every one resolves to a short-lived (300s) presigned S3 URL, denied
list empty. This is identical to what a genuine subscriber's session produces — the endpoint cannot tell them
apart. The one precondition is that the caller already holds valid audio uuids for the target course (they
are v4-random, not enumerable, and the entitlement-gated content endpoints — `bundle`, `cycles`,
`infplay-cycles` — correctly withhold them from an unentitled caller). In practice that precondition is easy
to satisfy at scale but hard for one attacker alone: **one legitimate subscription's bundle response contains
every audio uuid for that entire course.** If that uuid list is ever shared, leaked, or simply scraped and
redistributed (a forum post, a shared gist, a script bundled with a "companion" tool), *every* free account
that redeems it via `batch-urls.ts` gets the full premium catalogue for that course, indefinitely — no
payment required from any of them, and no re-check beyond "is this login real". This is a materially cheaper
attack than the one the 08-25 note evaluated ("an anonymous caller who already holds premium audio uuids can
fetch them one at a time [via the per-clip proxy]") — it converts one leaked uuid list into unlimited
free bulk downloads, not just slow anonymous per-clip fetches.

**Verified behaviourally, with the production entitlement code path exercised for real** (not just the
mocked auth boundary): `batchUrlsEntitlementVsAuth.security.test.ts` wires a Supabase mock that **throws** if
`batch-urls.ts` or `resolveAudioEntitlement` ever queries a `learners`/`user_subscriptions`/
`user_entitlements` table — it never throws, and a "free-account-zero-subscriptions" bearer still receives
every one of 10 premium uuids' presigned URLs. A second, static test confirms neither file's source text
names any of those tables today.

**What already holds, and is not this finding:** the 500-id cap, the 300s TTL, the per-id (not
per-request-first-id) entitlement check, traversal-shaped id rejection, and the CORS/OPTIONS handling are all
correct and unaffected — see the pre-existing `batchUrlsBulk.security.test.ts`, which this audit read and did
not duplicate.

**Fix shape (not applied):** resolve the caller's actual subscription/entitlement state (the same
`resolveEffectiveSubscription` + `user_entitlements` + cascade lookup `resolveServerCourseAccess` already
does for bundle/cycles/infplay-cycles) before honouring a premium past-preview id here, instead of accepting
any valid login. This is exactly the "SUBSCRIBER mint site" future-proofing note already sitting in
`audioAccess.ts` — that note anticipates the token-based version of this fix; the more direct fix is to reuse
`resolveServerCourseAccess`'s existing DB-backed resolution rather than wait for a token-minting path.

---

## 3. The R1 edge-cache argument — VERIFIED, holds

`api/courses/[code]/cycles.ts` (commit `dcec7992`, "edge-cache the R1 window, which is identical for every
learner"). The two-condition gate — `isAnonymousRequest` (no `Authorization` header) AND
`windowIsUniversal` (`maxEmittedSeed` at or below `PREMIUM_PREVIEW_MAX_SEED`, 19/Yellow) — is exactly what
the code computes right before the final `Cache-Control` decision; pinned structurally by
`edgeCacheKeying.security.test.ts`.

**Live transcript**, `spa_for_eng` against the deployed `dev` branch:

```
# anonymous, from=S0001L01 (inside the universal window) — three calls, no delay
HTTP/2 200   cache-control: public   x-vercel-cache: MISS   age: 0
HTTP/2 200   cache-control: public   x-vercel-cache: HIT    age: 1
HTTP/2 200   cache-control: public   x-vercel-cache: HIT    age: 2

# anonymous, from=S0100L01 (past the preview ceiling) — must 403, must not cache
HTTP/2 403   cache-control: no-store   x-vercel-cache: MISS

# SAME window (from=S0001L01), but with ANY Authorization header (even an invalid bearer)
HTTP/2 200   cache-control: private, max-age=60   x-vercel-cache: BYPASS
```

Three things confirmed live, not just in source:

1. **The public window really is cached at Vercel's edge** (MISS → HIT → HIT), and it really is served to a
   subsequent anonymous caller from that cache — the mechanism works as designed.
2. **A window past the preview ceiling never enters the cache** (403, `no-store`, MISS every time) — no risk
   of an edge cache accidentally holding a paywalled response.
3. **Any request carrying an `Authorization` header — even a garbage one — bypasses the edge cache entirely**
   (`x-vercel-cache: BYPASS`). This is Vercel's own platform behaviour (requests with `Authorization` are
   never served from or written to the shared edge cache), independent of the app's `isAnonymousRequest`
   check — so the protection here is genuinely belt-and-braces: the app never *sets* a public
   `Cache-Control` for an authed request, and even if it did, Vercel would refuse to cache it. There is no
   cookie-based auth path on this API (`verifyAuthToken` reads only `req.headers.authorization`), so there is
   no second identity channel the cache key is blind to.

Also confirmed live: the response's only entitlement-carrying field, `preview_only`, has **zero consumers**
anywhere in `packages/player-vue/src` (grepped) — matching the commit message's claim that the entitled body
differs from the anonymous one by an inert flag only.

**Residual, stated in the commit and unchanged:** neither repo has a cache-purge path, so `s-maxage=300`
(round-map's `s-maxage=31536000` more so) means an edited seed-1-19 phrase can serve stale for up to five
minutes (round-map: up to a year, mitigated by the version-stamp `content_version` bump the client's own head
probe checks — a content edit that does NOT also bump `courses.version`/`content_version` would go unnoticed
longer). This is a freshness/business risk, not an entitlement or cross-learner leak, and is out of scope for
this area's brief.

## 4. `bundle.ts`'s `private` + `s-maxage` together — VERIFIED, does not actually get cached

`bundle.ts` sets `'private, max-age=300, s-maxage=86400, stale-while-revalidate=86400'` on its main
(non-head-probe) response, unconditionally — no anonymous/universal-window carve-out the way `cycles.ts` has.
This looked, on first read, exactly like the mistake `cycles.ts`'s careful two-branch design was written to
avoid: an `s-maxage` sitting on a response whose body **does** vary by entitlement (`previewOnly`,
`scopedLegoRows`/`scopedPhraseRows`, `pods` only for entitled callers — unlike `cycles.ts`'s `preview_only`,
`bundle.ts`'s `previewOnly` **does** have a live consumer client-side, `useCourseBundle.ts`/
`useInstantPlayback.ts`).

**Live transcript**, `spa_for_eng`, anonymous, three repeat calls, both the main response and the head probe:

```
# GET /api/courses/spa_for_eng/bundle — three calls
HTTP/2 200   cache-control: private, max-age=300   x-vercel-cache: MISS   age: 0
HTTP/2 200   cache-control: private, max-age=300   x-vercel-cache: MISS   age: 0
HTTP/2 200   cache-control: private, max-age=300   x-vercel-cache: MISS   age: 0

# GET /api/courses/spa_for_eng/bundle?head=1
HTTP/2 200   cache-control: private, max-age=60   x-vercel-cache: MISS
```

Two things this proves: (a) **the client-visible header Vercel actually sends strips `s-maxage` and
`stale-while-revalidate` entirely** whenever `private` is also present in the source header — the browser
only ever sees `private, max-age=<n>`; (b) **the edge never caches it** — `x-vercel-cache: MISS` on every
repeat call, no `age` growth, unlike the confirmed-cached `round-map`/`cycles` cases above. This is
consistent with (and was cross-checked against) `api/audio/[audioId].ts`'s own comment, which independently
confirms Vercel's edge **does** cache on a bare `public, max-age=...` (no `s-maxage` needed) unless
explicitly told not to via `Vercel-CDN-Cache-Control: no-store` — that file had to add that header
specifically to STOP Vercel caching a `public` audio response, for a Range-request-correctness reason
unrelated to entitlement. Between the two pieces of live evidence, the operative rule this codebase can now
rely on (and which `edgeCacheKeying.security.test.ts` pins going forward) is: **`private` anywhere in a
`Cache-Control` response header suppresses Vercel edge caching outright, regardless of any `s-maxage` also
present.**

**Verdict: not a live vulnerability**, but the header is genuinely confusing to author against (it combines
directives whose interaction depends on platform behaviour, not the HTTP spec alone — RFC 7234 does not
itself say `private` overrides a co-present `s-maxage`) and it wastes the same "5-minute stale-while-revalidate,
same-body-for-everyone" optimisation `cycles.ts` deliberately built for the `previewOnly`+anonymous case —
`bundle.ts` never shares its preview-window response across anonymous callers at all, even though the
argument that would justify it (byte-identical body for every anonymous/unsubscribed caller within the
preview window) is the same argument `cycles.ts` already proved live. Filed as INFO / a missed optimisation,
not a security finding — but flagged because a future person "simplifying" this header by dropping the
now-apparently-redundant `private` token (since it's never actually serving from cache today) would silently
create SEC0901-D-02's server-side twin. `edgeCacheKeying.security.test.ts` pins the `private` token's
continued presence for exactly this reason.

---

## 5. Everything else in the brief, and what was checked

- **`_utils/audioAccess.ts` / `_utils/courseAccess.ts`** — read in full. `PREMIUM_PREVIEW_MAX_SEED` (19,
  Yellow) is manually duplicated between `audioAccess.ts` and `@ssi/core`'s `BELT_MAX_SEEDS.yellow`; confirmed
  in sync today and pinned by `edgeCacheKeying.security.test.ts` (a drift here would silently move both the
  paywall boundary and the edge-cache safety boundary together, since `cycles.ts` imports the constant from
  `audioAccess.ts` rather than re-declaring it).
- **Audio id → course boundary** — `resolveAudioEntitlement` reads `course_code`/`lego_id` off the
  `course_audio`/`shared_audio` row itself (looked up by id), not from anything caller-supplied, so a caller
  cannot claim a different course for an id than the one it actually belongs to. `tokenGrantsCourse` checks
  the verified token's `courses`/`scope` claim against that row-sourced course code. Holds.
- **Presigned URL bounds** — 500 ids/request (`MAX_IDS_PER_REQUEST`), 300s TTL (`TTL_SECONDS`), both enforced
  server-side and unconfigurable by the request. Holds; already pinned by the pre-existing
  `batchUrlsBulk.security.test.ts`.
- **Offline lease** (`api/entitlement/offline-lease.ts`) — read in full. Revocation (`revoked_at`) wins over
  everything and is never slid. A non-payer's trial is recorded server-side on first grant and never
  re-minted on re-report (the upsert-failure-then-fail-closed fix from finding #4 of the 2026-07-13 audit is
  still in place — `if (upErr) throw upErr` inside the stateful path). `MAX_COURSES` (64) + course-code regex
  bound the reported-courses list (ADMIN-ENT-07). `Cache-Control: no-store` unconditionally. Holds — no new
  finding.
- **`sw-config.ts`** — no auth by design; serves exactly three fields (`killSwitch`, `forceUpdate`, `message`,
  all from env vars meant to be broadcast). No course data, no user data, no secrets. Benign.
- **`api/audio/[audioId].ts`** — the other unauthenticated handler. Its entitlement gate
  (`resolveAudioEntitlement`) is shared with `batch-urls.ts` and is fail-open by design for the reason
  documented in the 08-25 remediation notes (the client attaches no Authorization/`?et=` to `<audio src>`
  today) — already tracked as INPUT-01's residual, not re-litigated here. S3 errors keep the bucket/key
  server-side only (`console.error`, caller gets a generic 502). The `Vercel-CDN-Cache-Control: no-store` /
  `CDN-Cache-Control: no-store` pair is a Range-correctness fix (iOS Safari), not a security control, and
  does not weaken anything — audio bytes are non-personal by content-id once the entitlement gate has run.
- **`packages/player-vue/src/cache/AudioCache.ts`, `useOfflineLease.ts`, `useOfflineDownloadStatus.ts`** —
  read in full. `AudioCache`'s IndexedDB store is global/non-learner-scoped (see finding #1's amplification
  note) but that alone is not exploitable without either (a) the bundle-cache gap above supplying stale
  premium ids to request, or (b) the already-tracked fail-open per-clip proxy. `useOfflineLease.ts` client
  side correctly fails open only on a 401 (network blip, not entitlement lapse) and otherwise defers to the
  server's `courses[].revoked`/`leaseExpiresAt` — no client-side trust of anything the server didn't say.
- **`bulkAudioDownload.ts`** — read in full (see brief item 3). Denied ids correctly fall back to `ensure()`
  (the per-clip proxy), which enforces its own (fail-open, already-tracked) posture — no bypass introduced by
  the bulk path beyond finding #1 above. Batch size is capped at the server's `MAX_IDS_PER_REQUEST` (the
  client's `BATCH_URL_CHUNK` constant matches it, 500); presigned URLs are requested just-in-time per chunk,
  never held across chunks, with an expiry-safety-margin re-request rather than blind retries.
- **`vercel.json` CSP diff** — added `https://popty.app` to `connect-src` and two `/gaplab` rewrites. Not a
  caching or entitlement change; out of this area's scope, mentioned for completeness only.

## Gaps — what this audit did not cover, and why

- **`ENTITLEMENT_ENFORCE` production value** — still unsettled after three prior audits (per the 08-25
  remediation notes); this audit did not attempt to settle it either (would require `vercel env ls
  production`, an auth-crossing action outside this audit's read-only rules). It does not change this area's
  verdicts: SEC0901-D-01 is reachable regardless of that flag (it is the `hasVerifiedSession()` check, not
  `ENTITLEMENT_STRICT`, doing the gating on the bulk path), and SEC0901-D-02 is a pure client-cache issue,
  server-flag-independent.
- **Whether a real paying-then-lapsed subscriber's stale local cache is also affected** by SEC0901-D-02 —
  plausible by the same code path (a lapsed subscription's cached full bundle would also survive past
  `resolveServerCourseAccess` now denying it, for as long as the client trusts the entitlement-blind head
  probe) but not separately verified live; the fake-indexeddb test covers the sign-out/different-account
  shape specifically, which is the shared-device case CLAUDE.md names.
- **Whether school/tutor "act as" / impersonation flows interact with the bundle cache** (a different
  learner's session reusing a device an admin/teacher also uses) — plausible extension of SEC0901-D-02, not
  independently traced; `actAsGuard.ts` is a write-side guard and its relevance to this read-side cache issue
  was not established either way.
- **Live verification of `batch-urls.ts` against the real deployed environment** (as was done for the caching
  claims) — not attempted, because it would require minting or holding a real free-account session token
  against production/dev, which is a genuine auth-crossing action this audit's rules exclude; SEC0901-D-01 is
  verified instead by a behavioural test that exercises the actual production code path
  (`resolveAudioEntitlement`, `hasVerifiedSession`) with a mocked identity boundary only.
- **CDN behaviour on courses/environments other than `spa_for_eng` on `dev`** — the live transcripts above are
  from one course on one branch's deployment; the header-setting logic is course-code-independent in source,
  so this is treated as representative rather than re-run per course.
