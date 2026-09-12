# Security audit 2026-09-12 (tenth) — Area E: paid course content delivery, audio proxy, edge caching

Branch `cs/445-sec-e-content`, cut from `origin/dev` at `e558b43ee`. One worker, no fan-out.

**Rules this area ran under:** findings and tests only. No production behaviour changed, no fix applied,
no migration written, no live database read, no external service called, no `pnpm audit`, nothing
promoted. Every claim below is derived from repo source on this tree. Test file:
`api/_security/sec0912t-e-content-delivery.security.test.ts` (25 tests, green, pure: `node:fs`,
`node:path`, vitest, and two pure helpers imported from `api/_utils/audioAccess.ts`).

## Scope

| Handler | Auth / entitlement as it stands | Cache-Control on the success body |
|---|---|---|
| `api/courses/[code]/bundle.ts` | `resolveServerCourseAccess` → full course, or sliced to seed ≤ 19 for anonymous/unsubscribed; hard 403 only if no preview is possible | `private, max-age=300, s-maxage=86400, swr=86400` (`s-maxage` is inert under `private` on Vercel — the 09-01 audit verified that live) + `Vary: Authorization` |
| `api/courses/[code]/cycles.ts` | same resolver; 403 when `from` is past the preview ceiling | `public, s-maxage=300` only when anonymous AND window ≤ seed 19, else `private, max-age=60`; `Vary: Authorization` |
| `api/courses/[code]/infplay-cycles.ts` | same resolver; hard 403 for any unentitled caller on a premium course | `private, max-age=0, no-cache` + `Vary: Authorization` |
| `api/courses/[code]/round-map.ts` | none, by design — structural rows only (SEC25-X) | `s-maxage=31536000, swr=86400` |
| `api/courses/[code]/sectors.ts` | **none** (SEC0905-C-01, still open) | `public, max-age=300, s-maxage=300`, no Vary |
| `api/audio/[audioId].ts` | `resolveAudioEntitlement` — token-based, **fail-open** unless `ENTITLEMENT_ENFORCE=strict` (INPUT-01 residual, tracked since 08-25) | `public, max-age=31536000, immutable` to the browser; `CDN-Cache-Control: no-store` and `Vercel-CDN-Cache-Control: no-store` to the edge |
| `api/courses/available.ts` | none, public catalogue | `public, max-age=300, s-maxage=300` |
| `api/sw-config.ts` | none, three booleans/strings | `public, max-age=0, must-revalidate` |

Answer to the brief's question 1 in one line: **every one of the three content endpoints that carries
teachable text checks entitlement to THIS course, not merely sign-in** — all three call
`resolveServerCourseAccess`, which reads `learners` → `resolveEffectiveSubscription` →
`user_entitlements` → `get_cascade_courses` and feeds `checkCourseAccess`. The two that do not check
(`round-map`, `sectors`) are already on the record. No new sign-in-only gate was found.

## Findings

### SEC0912T-E-01 — MEDIUM — full-course work happens before the entitlement decision, anonymously, and the edge never absorbs it

**Where.** `api/courses/[code]/infplay-cycles.ts:201-224` (the `Promise.all`) vs `:253` (the gate);
`api/courses/[code]/bundle.ts:431-554` (nine reads, including `fetchAllBundlePhrases` at `:452` and
`fetchCourseVoicePace` at `:553`) vs `:674` (the gate); `api/_utils/courseVoicePace.ts:69-77` (the
race that does not cancel).

**Why it is a defect.** The order is read-everything-then-decide. On infplay-cycles an anonymous GET on a
premium course fetches every main-loop lego (`limit(5000)`) and every use phrase (`limit(10000)`) and is
then told 403. On bundle an anonymous GET fetches the whole course — the phrase scan is paged to defeat
PostgREST's 1000-row cap precisely because these courses carry 15-17k phrase rows — plus pods, bookends,
seeds and the `course_voice_pace` RPC, and is then sliced to 19 seeds in memory. The RPC is time-boxed
to 2.5s with `Promise.race`, but nothing aborts it (no `abortSignal`), so the derivation — which the
file's own header measures at 8-20s on a cold buffer — keeps running on the database after the
response has already shipped without it. Neither response can be served from Vercel's edge (`private`
on bundle, `no-cache` on infplay), so every anonymous hit is an origin hit, and there is no throttle on
either route.

**Attacker and what they get.** No account needed. N cheap GETs across the ~100 premium course codes
(all public via `/api/courses/available`) become N full-course scans plus N concurrent pace
derivations against the single Supabase project that serves every learner, teacher and school. The
`authenticator` role carries `statement_timeout=8s`, so the attack does not need to succeed at anything;
it only needs to keep the buffer cold and the connection pool busy. This is an availability lever on
the shared DB, not a data leak — the slice itself is correct (see "cleared").

**Blast radius.** Every course endpoint and the schools dashboard share the database. The cost is paid
by paying learners' time-to-first-play, which is exactly the number bundle's design was built to
protect.

**Fix shape (not applied).** Resolve access first on both routes: the gate needs only the one
`courses` row already fetched, plus the caller's `learners`/subscription rows — cheap indexed reads.
Then (a) infplay-cycles returns 403 before touching content; (b) bundle applies
`.lte('seed_number', previewMaxSeed)` to the lego, phrase-count/phrase-page, round-index and seed reads
for a preview caller, and skips the pace RPC (or moves it after the gate with an `AbortController`
wired through `.abortSignal()` so a lost race also cancels the statement). **CORRECTED 2026-09-12**
— this originally said `cycles.ts` "is the sibling that already does it right". It is not:
`cycles.ts:402` runs `get_course_cycles_window` and its round-map read before the 403 at `:483`, so
it is a *third* instance of read-before-gate, not the pattern to copy. What `cycles.ts` does do well
is BOUND the work (`from` matched against `^S\d{4}L\d{2}$`, `limit` clamped to 50, window to 52) —
copy the bounding, not the ordering. Refuted by cross-family verification, job #451·G.

**Test.** `SEC0912T-E-01` blocks — characterization; goes red when the gate precedes the reads or the
reads carry a ceiling, and when the pace RPC becomes abortable.

### SEC0912T-E-04 — LOW — an empty-body 502 from S3 ships with a one-year immutable browser cache

**Raised by cross-family verification** (GPT-6 Astra, job #451·G), confirmed here against source.

**Where.** `api/audio/[audioId].ts:164` sets `Cache-Control: public, max-age=31536000, immutable` on
the success path; the body is only checked at `:201`, which returns 502 with those headers already
on the response.

**Why it is a defect.** The CDN is spared — `Vercel-CDN-Cache-Control` and `CDN-Cache-Control` are
both `no-store` — but the learner's own browser is told to keep that failure for a year. The clip is
then dead for that person until they clear site storage, and the app's own retry cannot get past it.
Availability, not disclosure.

**What this area originally cleared, and why it was too broad.** The assertion was *"every non-200
path that PRECEDES the bytes is no-store"* — which is true and still passes. The write-up
generalised it to "every error path is no-store". It is not: this one, the S3-exception path and the
invalid-method path all sit after or outside that set.

**Fix shape (not applied).** Reset `Cache-Control` to `no-store` on the 502 and the S3-exception
path, or move the success headers below the body check.

### SEC0912T-E-02 — LOW — bundle.ts's 503 body hands an anonymous caller the operator remedy

**Where.** `api/courses/[code]/bundle.ts:661-663`:
```
error: `Course ${code} has no round-index entries (run materialised-view refresh)`
```
Reachable before the entitlement decision (`:674`).

**Why.** This is the SEC25-X-01 shape that was fixed on `round-map.ts` on 2026-08-25 (body now a fixed
`'Course temporarily unavailable'`, remedy in `console.error`). bundle.ts replaced round-map as the
version/critical-path route and carried the old shape with it. Cosmetic disclosure of internal
maintenance vocabulary; no data. LOW, and filed only because it is a fixed finding recurring on the
successor file.

**Fix shape.** Copy round-map's two lines. **Test.** `SEC0912T-E-02`; goes red on the fix.

### SEC0912T-E-03 — LOW (latent) — sectors.ts is publicly edge-cached, which is only safe because it is ungated

**Where.** `api/courses/[code]/sectors.ts:289, :329` — `public, max-age=300, s-maxage=300`, no
`Vary: Authorization`, no `setEntitlementVary` import.

**Why.** Today the body is the same for every caller because there is no gate at all (SEC0905-C-01,
open since 09-05). The natural fix for C-01 is to add `resolveServerCourseAccess` the way the three
siblings did. If that lands with the header untouched, the first entitled caller's resolved anchor text
is cached at the edge for five minutes and served to every anonymous caller — job #676 re-created on a
new file, and worse, because #676 was browser-cache only and this is the shared edge. This is a
finding about the *fix that has not happened yet*, filed so it cannot happen wrong.

**Fix shape.** When C-01 is fixed: `private` (or the cycles.ts anonymous-only public carve-out) plus
`setEntitlementVary(res)` at the top of the handler, in the same edit. **Test.** `SEC0912T-E-03` is a
tripwire: it characterises today's state and asserts the invariant `gated ⇒ not public ∧ Vary`, which
is vacuous now and goes red on the wrong fix.

## Already-known classes recurring here (one line each, not re-filed)

- Anon-key fallback on a missing service key in `cycles.ts:380`, `bundle.ts:389`,
  `infplay-cycles.ts:193` — SEC0901-A-06, unchanged.
- `error.message` in a 500 body: `available.ts:44`, `sectors.ts:281,333` — SEC0901-C-03 / SEC0905-C-02.
- `?include=draft` on sectors.ts is public — noted as the secondary observation under SEC0905-C-01.
- `audio/[audioId].ts` fail-open past preview — INPUT-01 residual; the client still attaches no
  Authorization or `?et=` to `/api/audio/<id>` (`useInstantPlayback.ts:574,623,673`,
  `useLayer1Scheduler.ts:923`), so arming strict mode today would still deny paying learners. Unchanged.

## Checked and cleared

- **Entitlement vs authentication.** All three content routes resolve entitlement to the specific
  course code (`courseAccess.ts:45-123`); `checkCourseAccess` honours entitlement expiry, course-scoped
  grants, cascade grants, and the active-subscription period end. No sign-in-only gate anywhere in scope.
- **The `tester` shortcut.** `checkCourseAccess` grants full paid content on
  `platform_role === 'tester'`, and `courseAccess.ts` passes the column straight through — so the
  question was whether a learner can write it. They cannot: since migration
  `20260811_lock_learner_identity_columns.sql`, `authenticated` holds `SELECT,DELETE,MAINTAIN` at table
  level and column-scoped `INSERT`/`UPDATE` that never name `platform_role` or `educational_role`
  (`schema.sql:22707-22771`). Pinned in the test.
- **Edge cache keying on the newer endpoints.** bundle.ts is unconditionally `private` + Vary;
  infplay-cycles is `no-cache` + Vary; the two `public` bodies (`round-map`, `available`) do not vary by
  caller. sectors.ts is the one to watch (E-03). No repeat of the pre-#676 defect.
- **bundle.ts preview slice** covers legos, phrases, round map, seeds (derived from the scoped round
  rows), `mainLoopCount`, and pods (empty for preview callers). `voicePace` is course-wide by design.
  The `?head=1` probe reads two version integers and nothing gated.
- **audio/[audioId].ts.** `audioId` is anchored-regex validated (uuid or `uuid.vN`, revision 1-99999)
  before any lookup; traversal and quote shapes are refused (tested against the imported helper). The
  S3 key is `sample.s3_key` from the DB row, never caller input; the lookups are bound `.eq('id', …)`
  calls. Every 4xx/5xx before the bytes is `no-store`. **The CLAUDE.md claim** "streams from S3 with
  1-year cache headers" is half right: the 1-year `immutable` header is browser-only, both CDN headers
  are `no-store` (deliberate — Vercel mis-slices Range hits), and the body is buffered whole via
  `transformToByteArray` then `res.send`, not streamed. A ~25KB clip per request, so not a finding.
- **Param handling.** `[code]` is `^[a-z0-9_]+$`-gated on bundle/cycles/infplay/round-map. sectors.ts
  does not regex it but only reaches bound `.eq()` parameters — consistency gap, not injection.
  cycles.ts: `from` is `^S\d{4}L\d{2}$`, `limit` clamps to 50, the RPC window to 52, and the single
  `.or()` filter string interpolates only `parseInt` output of that regex. infplay: `limit` clamps to
  15; `from_round` is unbounded above but only indexes an in-memory array. No caller-settable range or
  limit reaches a query unbounded.
- **sw-config.ts.** Reads exactly `SW_KILL_SWITCH`, `SW_FORCE_UPDATE`, `SW_MESSAGE`; emits exactly
  `{ killSwitch, forceUpdate, message }`. No key, hostname or endpoint.
- **courseBoundary.ts / entitlementVary.ts.** Pure; the former is a static map, the latter is
  idempotent and case-insensitive (pinned by the #676 suite).

## Honest gap

- **No live verification.** Whether `ENTITLEMENT_ENFORCE` is `strict` in production is still unread
  (four audits running). Whether the pace RPC actually continues after the race is inferred from the
  absence of an abort, not observed in `pg_stat_activity`. Whether Vercel's edge ignores `s-maxage`
  under `private` on bundle.ts is taken from the 09-01 audit's live probe, not re-probed here.
- **Not measured.** The cost of one anonymous bundle/infplay request in DB time. E-01's severity rests
  on the file's own 8-20s cold measurement and the 15-17k-row phrase count the code comments state; if
  either is stale the finding drops to LOW.
- **Out of scope, not cleared.** `api/audio/batch-urls.ts` and round-map (prior coverage), the client
  caches (`ssi-script-cache`, `AudioCache`), and CORS (09-05 Area B).


---

## Addendum — what the cross-family verification settled (job #451·G, 2026-09-12)

GPT-6 Astra was given this area's claim and its published evidence, never the brief or the
reasoning. It returned 8 verified, 4 refuted, 2 unknown. All four refutations hold on a house
re-check and are folded in above and into the test file. Two of them produced real corrections
(`cycles.ts` is not the pattern to copy; E-04), two narrowed prose (the E-03 tripwire cannot
distinguish a correct fix from a broken one, and "every caller param is bounded" means *bound as a
query parameter*, not *length-limited* — the course-code regexes carry no length ceiling and
`sectors.ts:78` accepts any non-empty code).

**It also closed this area's stated honest gap, by probing production.** This audit read no live
state by rule; the verifier did. A credential-free `GET /api/audio/<uuid>` with a one-byte Range
returned **206 with `X-SSi-Entitlement: no-token-open`** on a premium Spanish clip at seed 20 —
past the preview ceiling.

**That is not a missed finding, and it should not be reported as one.** It is the documented
posture: `api/_utils/audioAccess.ts:425-429` says so in terms — *"Strict mode (opt-in via env) FAILS
CLOSED on premium-past-preview when no valid entitlement is presented. DEFAULT is fail-OPEN so this
code can NOT lock out a single live payer before the client begins attaching entitlement tokens."*
The probe establishes the one fact the audit could not read: **`ENTITLEMENT_ENFORCE` is not
`strict` in production**, so the single-clip gate is inert and premium audio past seed 19 is served
to anyone holding the clip uuid.

What follows from that is a **decision, not a repair**, and it is above this audit's altitude:
whether to arm strict mode. The code names its own precondition — the `S####` prefix of `lego_id`
must be the seed ordinal on the same scale as `PREMIUM_PREVIEW_MAX_SEED`, *"until confirmed, the
gate is fail-OPEN and inert"* — and a subscriber-side mint site must exist and resolve through
`resolveEffectiveSubscription` first, or arming it fails a family member closed. Both are stated in
the source; neither was verified live here.
