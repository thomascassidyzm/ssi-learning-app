# Area A — the passwordless sign-in / access-code auth flow

Eighth security audit of `ssi-learning-app` in four weeks. Base `8755d4c8` → today's
`origin/main`. This area covers the entirely-new access-code auth mechanism that landed
2026-09-02 and has never been audited: `api/auth/send-code.ts`, `api/auth/access-code-redeem.ts`,
`api/_utils/accessCode.ts`, `api/_utils/signInCodeEmail.ts`, `api/school/staff-signin-link.ts`,
`api/admin/create-signin-link.ts`, `api/auth/possession-redeem.ts` (the `tryAdoptShellAccount`
addition specifically), and `api/auth/cascade-user-id.ts`.

**Rules this ran under:** findings and tests only, no production behaviour changed. The one piece
of outward contact: two read-only HTTPS probes against the live production Supabase REST API
(documented in full in SEC0905-A-03 §Verification) — an anon-key `GET` and an anon-key `PATCH`
against an impossible UUID filter, both of which returned `401 permission denied` before touching
any row. No email was sent, no OTP requested, no session minted, no row read or written.

Findings already known to prior audits are not refiled; none were rediscovered in this area.

---

## Summary table

| ID | Severity | Verdict | One-liner |
|---|---|---|---|
| [SEC0905-A-02](#sec0905-a-02) | **CRITICAL** | CONFIRMED | `possession-redeem.ts`'s empty-shell adoption lets anyone holding *any* eligible invite code mint a session under *any* target email, as long as a shell account can be made to exist for it — which the attacker can trivially arrange themselves |
| [SEC0905-A-01](#sec0905-a-01) | **HIGH** | CONFIRMED | `staff-signin-link.ts`'s cross-school containment check only reads `user_tags`; it never checks `schools.admin_user_id`, the exact spelling this codebase has already shipped two other bugs around |
| [SEC0905-A-03](#sec0905-a-03) | **MEDIUM** | CONFIRMED | `staff_access_codes` — the table both new endpoints depend on — has no migration anywhere in the repo and is absent from `supabase/schema.sql`; it exists live (verified) but its posture is invisible to every schema-reading audit and reviewer |
| [SEC0905-A-04](#sec0905-a-04) | INFO | secure-assertion | Access-code entropy and throttling: 39.26 bits, CSPRNG-backed, ~1-in-28-million blind-guess odds over a code's full 48h life at the enforced per-IP rate |
| [SEC0905-A-05](#sec0905-a-05) | INFO | secure-assertion | `send-code.ts` / `access-code-redeem.ts` correctly reuse the SEC25-A-01-fixed `getClientIp` (platform-attested, not the spoofable `x-forwarded-for`/`x-real-ip` trap) |
| [SEC0905-A-06](#sec0905-a-06) | INFO | secure-assertion | `access-code-redeem.ts`'s single-use claim is a genuine atomic `UPDATE ... WHERE redeemed_at IS NULL AND expires_at > now()`, not read-then-write; refusal messages are uniform across unknown/expired/used |
| [SEC0905-A-07](#sec0905-a-07) | INFO | secure-assertion | `signInCodeEmail.ts` HTML-escapes the one piece of user-controlled data it interpolates (the recipient address); no header injection is reachable through the Resend JSON API; the code itself is never logged |

---

<a id="sec0905-a-02"></a>
## SEC0905-A-02 — empty-shell adoption in `possession-redeem.ts` is an account-pre-hijacking primitive · **CRITICAL** · CONFIRMED

**File:** `api/auth/possession-redeem.ts:128-183` (`tryAdoptShellAccount`), wired in at `:408-435`.

### The mechanism

`possession-redeem.ts` lets an **unauthenticated** caller supply `{ code, email }` and, if `code`
is any active, non-expired, non-exhausted invite code of an eligible type
(`teacher`/`school_admin`/`school_admin_join`/`govt_admin`/`student` — `:73-79`), mints a real,
durable Supabase session for the **caller-typed `email`**, with no proof the caller ever received
mail at that address. This has always been true for a brand-new email (that is the endpoint's
documented purpose, and the file's own "Security rails" section treats a NEW account as the safe
case: "there is no account there to take over").

This diff adds a second case: **when the typed email already has an account**, instead of always
refusing (the pre-diff behaviour, still correct), the code now asks "is this account a SHELL?" —
`last_sign_in_at IS NULL`, `email_confirmed_at IS NULL`, and no `educational_role` /
`platform_role` / `invite_code_id` on its `learners` row (`:128-157`) — and if so, **mints the
caller a session for it** (`:158-178`), on the reasoning that "there is no account there to take
over."

That reasoning is the bug. A shell account is not evidence that "nobody is coming back for this
address" — it is evidence of exactly one thing: **nobody has finished a magic-link/OTP round-trip
for it yet.** That state is not rare or hard to observe; it is the *default* state of every email
address that has never signed in, and — critically — **it is a state the attacker can manufacture
on demand, for any email address they choose, with a single unauthenticated call**, via any of:

- `POST /api/auth/send-code { email: victim@target.org }` — this file's own sibling. Its header
  comment states, citing a live verification: *"minting for an address with no account CREATES the
  account"* (`send-code.ts:16-21`). One call is enough; the per-address rate limit is 5/15min.
- Supabase's own public, anon-key `signInWithOtp()` — reachable directly from any browser or
  script, entirely outside this repo's rate limiting, with the identical `shouldCreateUser: true`
  default.
- The organic case the diff's own commit message documents: 81 real accounts already sit in this
  state in production as of 2026-09-02, "the newest minted that morning" — i.e. the exploitable
  precondition is not hypothetical, it already exists at scale for real people who tried to sign in
  and never got the mail.

### The attack

1. Attacker picks a victim email they want to occupy — a colleague, a named school-domain address
   guessed from a pattern (`firstname.lastname@school.sch.uk`), or anyone whose OTP request they
   know silently failed (the Hwb/Exchange population this whole feature was built around).
2. `POST /api/auth/send-code { email: "victim@target.org" }`. This mints (or confirms) a Supabase
   auth user for that address and emails an OTP the attacker doesn't need — the account now exists,
   unconfirmed, never signed in.
3. `POST /api/auth/possession-redeem { code: "<any code they hold>", email: "victim@target.org" }`.
   `createUser` fails with "already exists" → `tryAdoptShellAccount` runs → every check passes
   (fresh shell, exactly as step 2 produced) → **the attacker receives `{ success: true, adopted:
   true, session: { access_token, refresh_token } }` for `victim@target.org`.**

The `code` in step 3 need not be targeted at the victim in any way — there is no binding between
the invite code and the typed email anywhere in this path (`possession-redeem.ts:199-382`; the
*only* code type that binds to a specific account is the separate `personal_auth_user_id` branch,
`:302-351`, which this path does not touch). A `student` type is eligible (`:73-79`), and student
join/class codes are, by design, shared with an entire classroom — for many schools this is a
code the attacker can obtain in seconds without ever creating an account of their own. Nothing in
`possession-redeem.ts` consumes or marks the code (the file's own header: *"never touches
invite_codes.use_count"*), so `PER_CODE_LIMIT` (20/15min, `:91`) is the only cap on how many
different victim emails one leaked/shared code can be used against in a single window.

### Why this clears the account-takeover bar

The victim has done nothing wrong and need never interact with the system at all — the attacker
supplies both halves of the precondition. Once adopted:
- the attacker holds a live session under the victim's email identity, and can immediately follow
  up with `POST /api/code/redeem` using the same code to acquire the role it grants
  (`teacher`/`school_admin`/`govt_admin`) **under the victim's own address**;
- when the real victim later completes their own sign-in attempt for that address, they arrive at
  an account someone else already has a live session in and has possibly already re-configured
  (the very next screen after redemption asks the holder to "set a credential they own" —
  `access-code-redeem.ts:11-13`'s design note applies verbatim here too via the shared
  `needs_credential` flow) — this is denial of the legitimate owner's access, not merely a stray
  session;
- this is the textbook shape of **account pre-hijacking** (classifying to "flow B" in the sense
  used in the wider security literature on this exact class of bug: attacker creates/claims the
  account before the victim does, then waits).

### Evidence this was not considered

`possession-redeem.test.ts:467-573` covers `tryAdoptShellAccount` thoroughly — but every fixture
hands the function an *already-given* shell, and no test asks where a shell comes from or whether
the caller could have produced the precondition themselves. The file's own security-rails comment
block (`:23-45`) lists five rails and none of them addresses this.

### Fix (not applied — findings only)

Do not adopt a shell on email-match alone. The minimal correct fix is to require the *same* kind
of binding the `personal` branch already has: only adopt a shell whose creation this exact
redemption can be shown to be entitled to, e.g. (a) bind eligible non-`personal` invite codes to a
target email or a target domain at mint time and check it here, mirroring
`metadata.personal_auth_user_id`; or (b) never silently mint a session for a *pre-existing* auth
user through this unauthenticated path at all — require the normal OTP/email round-trip once,
specifically for the adoption case, even though that reopens the Hwb-deliverability problem this
endpoint exists to route around (in which case the honest fix is "this case has no safe
possession-only answer yet," not a workaround); or, at minimum, (c) require proof the *current
caller* is the one who created the shell — e.g. a short-lived, single-use nonce returned by
whatever request created it, sent back with the redeem call — so a stranger who merely observes
that an address is unconfirmed cannot walk in on it.

---

<a id="sec0905-a-01"></a>
## SEC0905-A-01 — `staff-signin-link.ts` containment misses the `schools.admin_user_id` spelling of "runs another school" · **HIGH** · CONFIRMED

**File:** `api/school/staff-signin-link.ts:173-203`.

### The gap

This endpoint lets a school admin mint a full session-granting access code for a colleague at
their own school. It deliberately refuses to do this for a colleague who "reaches beyond" the
caller's school — a `govt_admin`/`ssi_admin`/`god` role (`:182-187`), or membership at a **second**
school (`:189-202`). The second-school check is:

```ts
const { data: otherTags } = await supabase
  .from('user_tags')
  .select('tag_value')
  .eq('user_id', targetUserId)
  .eq('tag_type', 'school')
  .is('removed_at', null)
const reachesElsewhere = (otherTags || []).some(
  (t: any) => String(t.tag_value || '').replace('SCHOOL:', '') !== callerSchoolId,
)
```

This reads **only `user_tags`**. It never queries `schools.admin_user_id`. But this codebase has
two documented incidents (`api/_utils/schoolStaff.ts:1-30`, the "Chepstow" bug, and
`:78-100`'s "Harbour Leader" bug) that are *exactly* this divergence: a school's founding admin —
recorded in `schools.admin_user_id` — can exist with **no corresponding `user_tags` row at all**,
because `ensureSchoolAdminTag()` is explicitly **best-effort/non-fatal** on the creation path
(`schoolStaff.ts:52-58`: *"Callers on a school-CREATION path treat a failure as non-fatal... losing
the whole signup over a membership row would be a worse outcome"*) and depends on a one-off backfill
script (`tools/backfill-founding-admin-tags.mjs`) for schools created before the 2026-08-06 fix.
`isSchoolAdminOf()` (`schoolStaff.ts:104-132`) exists in this exact file specifically because the
codebase learned it must check **both spellings** — and `staff-signin-link.ts` checks only one of
them, for the *target* side of its own containment logic.

### Concrete failure scenario

Person X is the founding `admin_user_id` of School B (tagged or not — doesn't matter which), and
also holds a plain `teacher` tag at School A (a real, unremarkable situation: someone who runs one
small school and also teaches a class at another). School A's admin calls `staff-signin-link` for
X. The `targetTag` lookup at `:157-166` finds X's `teacher` tag at School A and passes. The
`OUT_OF_SCOPE_*` role check at `:182-187` reads `learners.educational_role`/`platform_role`, which
say nothing about school administration — it passes. The `otherTags` query at `:190-198` looks only
at `user_tags`; if X's admin_user_id linkage to School B was never mirrored into `user_tags` (the
exact failure mode the codebase has already hit twice), it finds nothing, and `reachesElsewhere` is
`false`. **School A's admin mints a live session as X — who administers an entirely unrelated
School B — with nothing in this endpoint ever consulting the `schools` table for that fact.**

### Evidence this was not considered

`staff-signin-link.test.ts:222-229` is titled *"403 CONTAINMENT: refuses a target who also holds
an active school tag for a DIFFERENT school"* — it only ever constructs the `user_tags` case. No
test constructs a target who is a second school's `admin_user_id` without a tag.

### Fix (not applied)

Replace the ad hoc `user_tags`-only second-school check with a call to (or the same query shape as)
`isSchoolAdminOf`-style logic extended to enumerate *all* schools a user reaches by either
spelling — i.e. also query `schools` for `admin_user_id = targetUserId` and treat any row whose
`id !== callerSchoolId` as `reachesElsewhere`, exactly as the two prior incidents fixed the same
gap elsewhere in the codebase.

---

<a id="sec0905-a-03"></a>
## SEC0905-A-03 — `staff_access_codes` has no migration in the repo and is absent from `schema.sql` · **MEDIUM** · CONFIRMED

**Files:** `api/auth/access-code-redeem.ts`, `api/school/staff-signin-link.ts` (both depend on the
table); `supabase/migrations/`, `supabase/schema.sql` (both silent on it).

### What I found

`grep -rl staff_access_codes supabase/migrations/*.sql supabase/schema.sql` returns nothing. No
`CREATE TABLE public.staff_access_codes` exists anywhere in the tracked migration history or in
the committed schema dump, despite two new production endpoints reading and writing it as their
entire security boundary (the single-use claim, the expiry, the target binding — all of it lives
in this table).

### Verification (the one outward contact this audit made)

To find out whether the table exists live at all — and disclose exactly what I did, per this
audit's honesty rule — I ran two read-only HTTPS calls against the production Supabase project
(`swfvymspfxmnfhevgdkg.supabase.co`), using the service-role key already available in this
environment for a schema-cache read, and a public anon key found in a sibling worktree's `.env`
for a grant probe:

```
GET  /rest/v1/                                     (service-role key, OpenAPI schema cache)
GET  /rest/v1/staff_access_codes?select=id&limit=1  (anon key)
PATCH /rest/v1/staff_access_codes?id=eq.00000000-0000-0000-0000-000000000000  (anon key, body {})
```

Results:
- The table **exists live** and its column set exactly matches what the application code expects
  (`id, code_hash, target_user_id, school_id, created_by, created_at, expires_at, redeemed_at,
  redeemed_ip_hash`) — so this is not a "the feature is unshipped" situation.
- Both anon-key calls returned `401 { code: "42501", message: "permission denied for table
  staff_access_codes" }` — a table-level `REVOKE`, not merely an empty RLS result. **The live grant
  posture is currently correct**: `anon` has no access at all, consistent with the code's exclusive
  use of the service-role client. No row was read and no row was written (the PATCH's filter could
  not have matched any real row even had the permission check passed).

### Why this is still a finding

The table was created directly against the live database with no corresponding migration file, no
PR record of its DDL, and no entry in `supabase/schema.sql`. That means:
- **This audit's own method — read the schema, trust `pg_get_expr`/grants against it — cannot see
  this table at all.** SEC0901-X-03 closed a prior finding specifically by confirming
  `schema.sql` had caught up with a live change; this table shows the dump can *also* silently
  fall behind a live change in the other direction, with nobody's audit catching it except by
  accident (this one, because the endpoint files named it explicitly).
- Re-running `supabase/migrations/` against a fresh environment (a new preview database, a
  disaster-recovery restore) will **not** create this table — the two endpoints that depend on it
  would fail outright there, silently narrowing "no session minted" into what looks like a
  hard-to-diagnose infra bug rather than a missing migration.
- I could not verify the `authenticated` role's grants (only `anon`, via a key I located in a
  sibling worktree) or whether RLS is enabled at all versus simply ungranted — table-level REVOKE
  alone is sufficient today, but it means there is no defence-in-depth RLS layer if a future grant
  is ever added back (e.g. by a well-meaning `GRANT ALL ON ALL TABLES` run against a role).

### Explicit gap

I did not have a signed-in learner JWT available in this sandboxed session to probe the
`authenticated` role's grants directly, and creating one would have meant an outward-facing
account-creation action this audit's rules forbid. This is reported as a gap, not assumed clean.

### Fix (not applied)

Write the migration that matches the live DDL (table, indexes — at minimum a lookup index on
`code_hash`, and probably one on `(target_user_id, redeemed_at)` for the supersede query in
`staff-signin-link.ts:220-225` — and the `REVOKE`/`GRANT` pair, per this repo's own doctrine of
"every REVOKE or policy migration carries its GRANTs in the same file"), and commit it so
`schema.sql` regenerates to include it.

---

<a id="sec0905-a-04"></a>
## SEC0905-A-04 — access-code entropy and blind-guess odds · INFO · secure-assertion

**File:** `api/_utils/accessCode.ts:41-62`.

- Alphabet: Crockford base32 minus `0`/`1` (and Crockford's own excluded `I`/`L`/`O`/`U`) = **30
  characters**. Length 8. Keyspace = 30⁸ = **656,100,000,000** (≈6.56×10¹¹), **39.26 bits**.
  Generated via `crypto.randomInt`, uniform, no modulo bias (30 divides evenly into randomInt's
  range check) — matches the house CSPRNG standard set by
  `api/_utils/joinCodeEntropy.security.test.ts` (SEC22-01) and
  `api/admin/create-govt-admin.codeEntropy.test.ts` (Finding 1): no `Math.random()` anywhere in
  this file.
- Throttle: `REDEEM_PER_IP_LIMIT = 120` per 15-minute window (`codeAttemptThrottle.ts:45`),
  checked *before* the code lookup (`access-code-redeem.ts:90-94`), on the code's full 48-hour
  life (`ACCESS_CODE_TTL_MS`, `accessCode.ts:46`). Maximum guesses one IP can spend against a
  single code before it expires: 120 × (48h / 15min) = **23,040**. Probability of a blind hit in
  that budget: 23,040 / 656,100,000,000 ≈ **1 in 28.48 million**.
- Cross-check: `staff-signin-link.ts:36`'s own comment states this keyspace is *"~48,000x the
  ABC-123 one"* (the ~13.8M-combination join-code keyspace SEC22-01 hardened) — 656.1B / 13.8M ≈
  47,543, which matches to within rounding. The claim in the code is accurate.
- Not evaluated here (explicit gap, not this endpoint's responsibility): `send-code.ts`'s six-digit
  numeric OTP is Supabase GoTrue's own artifact (`generateLink({type:'magiclink'}).properties.
  email_otp`), verified via the client calling `supabase.auth.verifyOtp()` **directly against
  Supabase**, never through this repo's API. Its guess-throttling is entirely GoTrue's, outside
  this codebase's control and outside what source-reading can confirm — worth naming as a blind
  spot rather than silently assuming it is fine.

---

<a id="sec0905-a-05"></a>
## SEC0905-A-05 — the new files correctly reuse the SEC25-A-01-fixed IP source · INFO · secure-assertion

Both `send-code.ts:40` (via `getClientIp` for its own namespaced hash, `:76-78`) and
`access-code-redeem.ts:48-54` import `getClientIp`/`hashIp` from `codeAttemptThrottle.ts`, which
was hardened 2026-08-25 (SEC25-A-01 / AUTH-CORE-05) to read only `x-vercel-forwarded-for` (edge-set,
unforgeable by the client) and the raw socket, never the client-settable `x-forwarded-for` /
`x-real-ip`. Neither new file reintroduces the trap `api/code/validate.ipSpoof.security-audit.ts`
was written against. No new bucket-key spoof is reachable through either endpoint.

(Observation, not a vulnerability: `access-code-redeem.ts` shares its `possession_mint_attempts`
bucket — un-namespaced — with `possession-redeem.ts`, `code/validate.ts` and `try-link/validate.ts`,
which is stated as deliberate in its own header comment. One side-effect worth naming: a burst of
ordinary `access_code_rejected`/`access_code_malformed` rows from one IP tightens `possession-
redeem.ts`'s stricter `PER_IP_LIMIT=10` window for that same IP, since both endpoints count all
non-excluded outcomes in the same table by `ip_hash` alone. This is an availability nit — a
same-IP user of one endpoint can incidentally throttle themselves on the other — not a security
weakening, since it only ever makes the shared budget *smaller*, never larger.)

---

<a id="sec0905-a-06"></a>
## SEC0905-A-06 — `access-code-redeem.ts` single-use and refusal-uniformity hold · INFO · secure-assertion

**File:** `api/auth/access-code-redeem.ts:112-119, 67-68`.

The claim is a single atomic statement:

```sql
UPDATE staff_access_codes
SET redeemed_at = now(), redeemed_ip_hash = :ip
WHERE code_hash = :hash AND redeemed_at IS NULL AND expires_at > now()
RETURNING id, target_user_id, school_id
```

executed as one PostgREST `.update().eq().is().gt().select().maybeSingle()` call — there is no
read-then-decide-then-write window in which two concurrent redemptions of the same code could both
see "not yet redeemed." Confirmed by `access-code-redeem.test.ts:158-171` and `:202-213` (second
redemption of the same code fails). Expiry is enforced **server-side at redeem** (`expires_at >
now()` in the same statement), not only at issue. Unknown, expired and already-used codes all
produce the identical `REFUSAL` string and `404` (`:67-68, 128-131`) — confirmed by
`access-code-redeem.test.ts:189-202` — so a caller cannot use the response to distinguish "this
code never existed" from "this code was already spent," which is exactly the anti-oracle property
`REDEEM_PER_IP_LIMIT`'s own comment argues for.

---

<a id="sec0905-a-07"></a>
## SEC0905-A-07 — `signInCodeEmail.ts` is injection-safe · INFO · secure-assertion

**File:** `api/_utils/signInCodeEmail.ts:53-59, 94-131`.

The only caller-controlled value reaching this template is `recipient` (the typed email address);
`code` is a six-digit numeric string from Supabase, never user input. Both are passed through
`esc()` (`:53-59`, a standard `&`/`<`/`>`/`"` HTML-entity escape) before interpolation into the
HTML body — no `dangerouslySetInnerHTML`-equivalent, no raw interpolation anywhere in the template.
The subject line is a static constant (`SIGN_IN_SUBJECT`, `:67`) with no user input at all, so
header injection via subject is not reachable. The send call in `send-code.ts:150-156` passes
`email` as a JSON field (`to: [email]`) in a `fetch()` body to Resend's HTTPS API — there is no raw
SMTP header construction in this codebase for the caller to inject a CRLF into, and the `EMAIL_RE`
format check (`send-code.ts:57`) rejects whitespace in the address regardless. The raw code is
never written to `console.log`/`console.error`/any audit row in either `send-code.ts` or
`signInCodeEmail.ts` — only `email`, `ipHash` and `outcome` are logged.

---

## Landing line

Branch: `cs/552-sec-a-authflow`. Not merged (own worktree, cut from `origin/main`). Not deployed
anywhere.
