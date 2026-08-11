# Security audit — Area 4: admin, entitlement & money-adjacent surfaces

**Slug:** `admin-entitlement` · **Date:** 2026-08-11 · **Branch:** `sec/audit-2026-08-11`
**Mode:** AUDIT ONLY — no production behaviour was changed. Findings + tests only.
**Nothing outward-facing was touched:** no Paddle or Wise call, no entitlement created or revoked,
no webhook traffic, no staging/prod access, no DB writes. Every claim below comes from reading
code in this checkout plus `supabase/schema.sql`.

---

## Summary

| ID | Severity | One line |
|---|---|---|
| [ADMIN-ENT-01](#admin-ent-01) | **critical** | Paddle webhook binds a paid subscription to a **client-named** school / group / learner with no check that the payer owns it — £15 buys the ability to clobber or cancel any school's platform subscription |
| [ADMIN-ENT-02](#admin-ent-02) | **high** | School teacher/admin join codes are minted by a Postgres trigger using non-cryptographic `random()`, while the app-side minter was deliberately hardened to a CSPRNG |
| [ADMIN-ENT-03](#admin-ent-03) | **medium** | The whole invite/entitlement code keyspace is ~23.7 bits (13.8M); the only brake is a 10-per-15-min per-IP throttle |
| [ADMIN-ENT-04](#admin-ent-04) | **medium** | Both webhook idempotency ledgers fail **open** on any error other than a duplicate key — replay protection silently disappears when the ledger is unavailable |
| [ADMIN-ENT-05](#admin-ent-05) | **medium** | `schools.teacher_seats` is never enforced server-side — a school paying for one seat can onboard unlimited teachers |
| [ADMIN-ENT-06](#admin-ent-06) | **medium** | Code-validation rate limiting keys on the first `x-forwarded-for` entry, which is attacker-prependable unless Vercel overwrites it (UNVERIFIED) |
| [ADMIN-ENT-07](#admin-ent-07) | **low** | `/api/entitlement/offline-lease` accepts an unbounded, unvalidated `courses[]` and upserts one row per entry |
| [ADMIN-ENT-08](#admin-ent-08) | **low** | The one-trial-per-email burn keys on the raw lowercased address — `user+1@` sub-addressing mints a fresh trial |
| [ADMIN-ENT-09](#admin-ent-09) | **low** | `/api/invite/create` persists `grants_group_id` / `grants_class_id` / `grants_region` that the caller was never authorised for (inert today, latent) |
| [ADMIN-ENT-10](#admin-ent-10) | **low** | `max_uses` is structurally unenforceable on personal invite links (documented as intentional) |
| [ADMIN-ENT-11](#admin-ent-11) | **info** | Offline leases are unsigned — enforcement is entirely client-side |
| [ADMIN-ENT-12](#admin-ent-12) | **info** | Grant/revoke-entitlement hand-roll an admin check that omits the `god` role that `verifyAdmin` accepts |

**Controls verified to hold** (regression-locked by tests, see [§ Controls that hold](#controls-that-hold)):
every `api/admin/*` handler is gated; `learners.platform_role` cannot be self-escalated because of
column-level UPDATE grants; code redemption is race-free via an atomic single-statement RPC;
privileged codes are force-bounded; the Wise RSA verifier fails closed; Paddle *tier* really is
derived server-side; `update-user-role` has a self-promotion guard and a role allowlist; the family
seat cap is enforced server-side.

---

## Admin authorization table

Every handler file under `api/admin/` (excluding `*.test.ts`, and excluding `view-as.ts` /
`create-signin-link.ts`, which Area 1 owns). "Gate acted on?" means the guard's result is branched
on with an early `return` before any privileged work.

| File | Admin gate | Line | Gate acted on? | Verdict |
|---|---|---|---|---|
| `attention.ts` | `verifyAdmin` | 62 | yes (63–66) | **GUARDED** |
| `board-metrics.ts` | `verifyAdmin` | 26 | yes (27–30) | **GUARDED** |
| `board-snapshot.ts` | `verifyAdmin` | 43 | yes (44–47), before the GET/POST split | **GUARDED** |
| `codes.ts` | `verifyAuthToken` 42 + own-role read 51–57 | 42 | yes (43–46) for authn; role only *scopes* | **PARTIAL — by design** |
| `create-govt-admin.ts` | `verifyAdmin` | 47 | yes (48–51) | **GUARDED** |
| `create-school.ts` | `verifyAdmin` | 53 | yes | **GUARDED** |
| `create-staff.ts` | `verifyAdmin` | 54 | yes (55–58) | **GUARDED** |
| `demo-leaf.ts` | `verifyAdmin` | 34 | yes (35–38), before the GET/POST split | **GUARDED** |
| `demo-schools.ts` | `verifyAdmin` | 61 | yes (62–65), before the GET/POST split | **GUARDED** |
| `grant-entitlement.ts` | `verifyAuthToken` 24 + hand-rolled `platform_role === 'ssi_admin'` 33–42 | 24 / 39 | yes (403 at 40) | **GUARDED** (divergent — see ADMIN-ENT-12) |
| `invites.ts` | `verifyAuthToken` 440 + own-role read 449–455 | 440 | yes (441–444) for authn; role only *scopes* | **PARTIAL — by design** |
| `onboarding-messages.ts` | `verifyAdmin` | 36 | yes (37–40), before the GET/POST split | **GUARDED** |
| `revoke-entitlement.ts` | `verifyAuthToken` 24 + hand-rolled `platform_role === 'ssi_admin'` 33–42 | 24 / 39 | yes (403 at 40) | **GUARDED** (divergent — see ADMIN-ENT-12) |
| `set-trial.ts` | `verifyAdmin` | 34 | yes (35–38) | **GUARDED** |
| `update-school.ts` | `verifyAdmin` 83 (GET/DELETE, with an owner fallback) and 143 (PATCH) | 83 / 143 | yes | **GUARDED** |
| `update-user-role.ts` | `verifyAdmin` | 43 | yes (44–47) | **GUARDED** |
| `users.ts` | `verifyAdmin` | 251 | yes (252–255) | **GUARDED** |

**No unguarded admin handler was found.** The two `PARTIAL` rows are deliberate: `codes.ts` and
`invites.ts` are *scoped* endpoints — an `ssi_admin`/`god` caller sees everything, and any other
authenticated caller is filtered to `created_by = <their own uid>`, which for an ordinary learner
returns an empty set:

```ts
// api/admin/codes.ts:65
if (!isSsiAdmin) query = query.eq('created_by', userId)
```

The `update-school.ts` GET/DELETE fallback is also sound — it does **not** accept a client claim of
ownership, it re-derives it:

```ts
// api/admin/update-school.ts:88-98
const authResult = await verifyAuthToken(req)
...
const ownSchoolId = await schoolIdForAdmin(supabase, authResult.userId)
if (!ownSchoolId || ownSchoolId !== schoolId) {
  res.status(403).json({ error: 'Not your school' })
```

### What `verifyAdmin` actually verifies

`api/_utils/auth.ts:88-127`. It verifies a real Supabase JWT server-side (`supabase.auth.getUser()`
with the **anon** key and the caller's bearer token — a signature check by GoTrue, not a local
decode), then reads that user's own `learners` row under RLS and requires
`platform_role === 'ssi_admin' || educational_role === 'god'`. Two properties worth recording:

- It **fails closed on ambiguity but not on error**: a `PGRST116` (no row) falls through to 403,
  while any other error returns 500 rather than being read as "not an admin". That's deliberate
  (comment at 107–109) and correct.
- The identity comes only from the `Authorization` header. No header, body field or env var can
  substitute for it, and there is no secret comparison, so constant-time comparison is not in play.

---

## Findings

### ADMIN-ENT-01

**Paddle webhook binds a paid subscription to a client-named target with no ownership check**
· severity **critical** · confidence **high (code-confirmed end to end; not exploited)**

**Where:** `api/teacher/paddle-webhook.ts:467`, `:526`, `:578`, `:726`
(and the client side that proves the field is attacker-controlled:
`packages/player-vue/src/composables/useSchoolCheckout.ts:86`,
`packages/player-vue/src/composables/useOrgCheckout.ts:80`)

**What I read.** The webhook takes real care that the *tier* cannot be faked. That guard is real
and it works:

```ts
// api/teacher/paddle-webhook.ts:414-429
} else if (kind === 'school_platform' || kind === 'tutor_platform' || kind === 'org_platform') {
    // customData.kind comes from CLIENT JS, but the entitlement it claims
    // (the paid dashboard) must be backed by the PLATFORM price actually
    // billed. ... The billed price id can't be faked ...
    const billedPriceId = planIdOf(data)
    const meta = billedPriceId ? PRICE_CATALOG[billedPriceId] : undefined
    if (meta?.tier !== 'premium') { ...reject... }
```

But the *target* is never checked at all. The very next function takes the school id straight out of
the same client-supplied `customData` and writes to that row:

```ts
// api/teacher/paddle-webhook.ts:462-495
async function handleSchoolPlatformSubscription(supabase, data, customData) {
  const schoolId = customData.school_id as string | undefined
  if (!schoolId) { ...return... }
  ...
  const { error } = await supabase
    .from('schools')
    .update({
      platform_status: status,
      platform_expires_at: periodEnd,
      teacher_seats: seats,
      provider_subscription_id: data.id,
      provider_customer_id: data.customerId,
    })
    .eq('id', schoolId)
```

`customData` is composed entirely in the browser and handed to `Paddle.Checkout.open()`:

```ts
// packages/player-vue/src/composables/useSchoolCheckout.ts:86-92
customData: {
  kind: 'school_platform',
  school_id: opts.schoolId,
  supabase_user_id: userId,
  billing,
},
```

Nothing server-side pre-registers the checkout, so `school_id` is whatever the buyer's browser (or
`curl` against Paddle's checkout API with their own token) says it is. The signature check proves
the event came from Paddle; it proves nothing about who the payer is entitled to affect.

The identical shape appears three more times: `handleOrgPlatformSubscription` takes
`customData.group_id` (`:526`), `handleTutorPlatformSubscription` takes `customData.teacher_id`
(`:578`), and `handlePremiumSubscription` takes `customData.teacher_id` / `supabase_user_id`
(`:726-753`) and upserts `subscriptions` on `onConflict: 'learner_id'`.

The file already knows this class of problem exists and consciously declined to close it for the
*learner* case — a parent paying for a child is legitimate:

```ts
// api/teacher/paddle-webhook.ts:238-241
`[paddle-webhook] EMAIL MISMATCH (${context}): payer ${payerEmail} not among learner ${learnerId}
 emails [...] — proceeding (third-party payment allowed), flagged for audit`
```

That reasoning does not transfer to `school_platform` / `org_platform`, where there is no
third-party-payer story and no check of any kind.

**What an attacker does.** Any person who can learn a school's UUID — every teacher and student in
it can, and it appears in `/admin/schools/:id` style paths and group rollups — buys one legitimate
£15/month seat, but sets `customData = { kind: 'school_platform', school_id: '<victim school>' }`.
The tier guard passes, because they genuinely paid the premium-tier price.

**What they get.** On the victim's `schools` row, all in one UPDATE:

1. **Seat clobbering.** `teacher_seats` is overwritten with the attacker's `quantity` (1). A school
   billed for 40 seats now reads as 1 everywhere `teacher_seats` is surfaced
   (`api/school/subscription.ts:127`, `api/_utils/groupRollups.ts:133`, `SettingsView.vue:106`,
   `UpgradeView.vue:210`).
2. **Billing-linkage hijack.** `provider_customer_id` and `provider_subscription_id` now point at
   the attacker. `api/school/portal.ts:53-66` mints a Paddle customer-portal session from exactly
   that column, so the victim school's admin pressing "Manage subscription" is handed a portal for
   the **attacker's** Paddle customer. `api/school/update-seats.ts:119-167` likewise then operates
   on the attacker's subscription.
3. **Cancellation as a denial of service.** Paddle persists `customData` on the subscription, so
   every later lifecycle event for the attacker's subscription carries the victim's `school_id`. The
   attacker cancels their own £15 subscription; the `subscription.canceled` event arrives, and
   `PLATFORM_STATUS_MAP` flips the **victim's** `platform_status` to cancelled. One month of one
   seat buys the ability to switch off a paying school's dashboard.

The `handlePremiumSubscription` variant is the same trick against an individual: pay for premium
with `supabase_user_id = <victim>`, the upsert clobbers the victim's `subscriptions` row (the
`wouldDowngradePlan` guard at `:399` only blocks a *lower*-ranked plan, so same-rank
`SSi Premium` → `SSi Premium` proceeds), then cancel.

**Recommended fix (described, not applied).** Bind the target to the payer server-side. Two
options, both ordinary:

- *Preferred:* create the transaction server-side. Add an endpoint that resolves the caller's own
  school/group/teacher from their JWT (the pattern `api/school/portal.ts:44-47` already uses —
  `schools.admin_user_id = auth uid`), creates the Paddle transaction with that id in `customData`,
  and returns the transaction id for `Paddle.Checkout.open({ transactionId })`. The browser then
  never names the target.
- *Minimum:* in each handler, before writing, verify the relationship implied by `customData`
  against `customData.supabase_user_id` **and** verify that `supabase_user_id` matches the Paddle
  customer's email (`paddle.customers.get`) — i.e. re-run `logEmailMismatch`'s lookup as a *gate*
  for the platform kinds instead of a log line. Reject rather than write when the payer does not
  administer the named node.

Also worth doing regardless: never overwrite `provider_customer_id` / `provider_subscription_id` on
a row that already holds a *different* non-null value without an explicit migration path — silent
re-pointing of a billing linkage should be impossible.

---

### ADMIN-ENT-02

**School join codes are minted with Postgres `random()`, not a CSPRNG**
· severity **high** · confidence **high**

**Where:** `supabase/schema.sql:2500-2522` (`generate_join_code()`), used by
`set_school_join_code()` (`:4289`) and `set_class_join_code()` (`:4259`)

**What I read.** The application's code minter was deliberately hardened, and says so:

```ts
// api/_utils/codeGen.ts:13-21
export function generateCode(): string {
  // Uses the CSPRNG crypto.randomInt (not a predictable PRNG): these codes gate
  // elevated educational_role grants (teacher/school_admin/govt_admin) into a
  // school/group on redemption, so their minting must not be predictable from
  // observed samples. ...
  letters += CODE_CONSONANTS[randomInt(CODE_CONSONANTS.length)]
```

The database trigger that mints the *same class of credential* was not:

```sql
-- supabase/schema.sql:2500-2522
CREATE FUNCTION public.generate_join_code() RETURNS text ...
  FOR i IN 1..3 LOOP
    result := result || substr(letters, floor(random() * 24 + 1)::int, 1);
  END LOOP;
```

`random()` is Postgres's non-cryptographic PRNG, seeded per session and steerable with `setseed()`.
These are not throwaway values: `schools.teacher_join_code` and `schools.admin_join_code` are
registered into `invite_codes` by `api/_utils/schoolJoinCodes.ts:24-33` as `code_type` `'teacher'`
and `'school_admin_join'`, and redeeming one writes a staff tag into that school
(`api/code/redeem.ts:596-610`).

**What an attacker does.** Observes a handful of join codes minted close together (any teacher at
any school sees their own school's two codes; demo schools expose more), and uses them to
reconstruct the generator's state / narrow the search for codes minted in the same session — a
capability that simply does not exist against `crypto.randomInt`.

**What they get.** Teacher or school-admin membership of a school they have no relationship with.

**Confidence note.** That per-session state recovery is *practical* against Postgres's `random()` is
asserted from the general property of a non-cryptographic PRNG, not demonstrated here — I did no
live sampling. The finding does not depend on it: minting a bearer credential for an elevated role
from a non-CSPRNG is the defect, and the codebase's own comment at `codeGen.ts:14` is the standard
it fails.

**Recommended fix.** Replace `random()` in `generate_join_code()` with
`gen_random_bytes()` from pgcrypto (already available — `gen_random_uuid()` is in use throughout the
schema), mapping bytes to the same alphabet with rejection sampling to stay uniform. Format stays
`ABC-123`, so nothing downstream changes. Consider rotating existing school join codes in the same
migration.

---

### ADMIN-ENT-03

**~23.7 bits of code entropy behind a 10-per-15-min per-IP throttle**
· severity **medium** · confidence **high on the arithmetic, medium on exploitability**

**Where:** `api/_utils/codeGen.ts:11-27`, `supabase/schema.sql:2500`, throttle at
`api/code/validate.ts:82-109`

**What I read.** The alphabet is 24 consonants × 3, then 10 digits × 3:

```ts
// api/_utils/codeGen.ts:11
const CODE_CONSONANTS = 'ABCDEFGHJKLMNPQRSTUVWXYZ'   // 24 symbols
```

24³ × 10³ = **13,824,000** possible codes ≈ 2^23.7. The throttle is the only brake, and it is
honest about why it exists:

```ts
// api/code/validate.ts:153-160
// Per-IP rate limit BEFORE any code lookup. ... the ~13.8M ABC-123 keyspace is
// sweepable, and a hit yields an elevated-role invite (teacher/school_admin/
// govt_admin) that the sibling possession-redeem path turns into a session
const RATE_WINDOW_MS = 15 * 60 * 1000
const PER_IP_LIMIT = 10
```

**What an attacker does.** Sweeps `/api/code/validate` from many source IPs. The maths that matters
is not the full keyspace but the *live* one: with N active codes, the expected number of guesses to
land one is ≈ 13.8M/N. At a few hundred live codes that is tens of thousands of guesses — 960
attempts/day/IP, so a few hundred IPs finds a hit within hours.

**What they get.** A valid invite code, which `api/code/redeem.ts` converts into whatever the code
grants — up to `school_admin` or `govt_admin`. Note the privileged *entitlement/admin* code types
are additionally bounded by `boundPrivilegedCodeLimits`, but `teacher`, `student`, `school_admin`
and `govt_admin` invite codes are not.

**Recommended fix.** The throttle is doing its job but is the wrong layer to lean on for a
23.7-bit secret. Widen the code: keeping the human-friendly `XXX-999` shape for *student* codes is
reasonable, but staff-granting code types (`teacher`, `school_admin`, `school_admin_join`,
`govt_admin`, `ssi_admin`) should mint at 128 bits — `generateShareCode()` in the same file
(`codeGen.ts:35-41`) already does exactly this and is the in-repo precedent. Failing that, give
staff code types a short mandatory expiry the way `codeGuard.ts` already does for privileged ones.

---

### ADMIN-ENT-04

**Webhook idempotency fails open**
· severity **medium** · confidence **high**

**Where:** `api/teacher/paddle-webhook.ts:290-306`, `api/teacher/wise-webhook.ts:136-150`

**What I read.** The ledger insert is correctly placed *before* any side effect, and a duplicate key
correctly short-circuits. But every other error path continues:

```ts
// api/teacher/paddle-webhook.ts:295-305
if (dedupErr) {
  if (dedupErr.code === '23505') { res.status(200).json({ received: true, deduped: true }); return }
  console.warn('[paddle-webhook] Event dedup unavailable (proceeding):', dedupErr.code, dedupErr.message)
}
} catch (e: any) {
  console.warn('[paddle-webhook] Event dedup threw (proceeding):', e?.message)
}
```

The schema comment records this as intentional:

```sql
-- supabase/schema.sql:8400
COMMENT ON TABLE public.processed_webhook_events IS '... Degrades: if absent, handlers fail open.';
```

The table does exist (`schema.sql:8387`) so the pre-migration rationale has expired; what remains is
that any transient PostgREST/network error, RLS change, or grant regression on that one table
silently disables replay protection for the whole money spine.

**What an attacker does.** Nothing directly — this is not independently exploitable, because
Paddle's signature still gates entry. The realistic failure is Paddle's own at-least-once
redelivery (or an operator replaying a delivery from the dashboard) landing twice during a ledger
outage.

**What they get.** Double-processing of `transaction.paid`, i.e. double commission accrual to a
teacher (`handleTransactionPaidEvent`), and duplicated adjustment/refund handling. Money-affecting,
low likelihood.

**Recommended fix.** Now that the table is deployed, fail **closed**: on any dedup error other than
`23505`, return 500 so the provider retries, rather than proceeding. Both handlers already
demonstrate the retry-friendly pattern — `wise-webhook.ts:249-257` deletes the ledger row on
handler failure precisely so the retry reprocesses.

---

### ADMIN-ENT-05

**`teacher_seats` is enforced nowhere on the server**
· severity **medium** · confidence **high**

**Where:** absence — `api/code/redeem.ts` (teacher branch, 611–664), `api/_utils/schoolStaff.ts`,
`api/_utils/schoolTeachers.ts`, `api/teacher/class-teachers.ts`

**What I read.** `teacher_seats` is written by the webhook (`paddle-webhook.ts:489`) and by
`api/school/update-seats.ts:167`, and read for *display* in `api/school/subscription.ts:127`,
`api/_utils/groupRollups.ts:133`, `SettingsView.vue:106`, `UpgradeView.vue:210`. A grep for `seat`
across `api/` finds no comparison of a teacher count against `teacher_seats` on any join path. The
teacher-code redemption branch writes the staff tag unconditionally:

```ts
// api/code/redeem.ts:648-663
for (const tag of teacherTags) {
  const { error: tagError } = await supabase.from('user_tags').insert(tag)
```

Contrast the family plan, which *does* enforce its cap server-side — so the pattern exists in the
codebase and was simply not applied here:

```ts
// api/family/invite.ts:77
res.status(400).json({ error: `Family is full (${FAMILY_SEAT_CAP} seats including you)` })
```

**What an attacker does.** A school admin buys one £15 seat and then shares the school's teacher
join code with forty teachers.

**What they get.** Forty working dashboard seats for the price of one. Pure revenue leakage rather
than a data breach, but it is the money path and the limit is presented to users as real.

**Recommended fix.** Gate the teacher-tagging paths on the current staff count vs `teacher_seats`
(the count helper already exists — `api/_utils/schoolTeachers.ts:91`), returning a "seats full,
add a seat" refusal. Mirror `api/family/invite.ts`. Decide deliberately whether a trial school with
`platform_status='trial'` is capped or uncapped, and encode that in the same place.

---

### ADMIN-ENT-06

**Rate-limit IP is taken from the first `x-forwarded-for` entry** · severity **medium**
· confidence **low — UNVERIFIED**

**Where:** `api/code/validate.ts:93-99` (same pattern in `api/auth/possession-redeem.ts:97-98` and
`api/try-link/validate.ts:102-103`, both other areas' files)

```ts
function getClientIp(req: VercelRequest): string {
  return (
    (req.headers['x-forwarded-for'] as string)?.split(',')[0]?.trim() ||
    (req.headers['x-real-ip'] as string) ||
    'unknown'
  )
}
```

`split(',')[0]` takes the **left-most** entry, which in the standard XFF convention is the value the
*client* supplied. Whether that is attacker-controlled here depends entirely on whether Vercel
overwrites `x-forwarded-for` or appends to it — and I could not verify that from this checkout, and
was not permitted to test it live.

**If** Vercel appends, an attacker sets `X-Forwarded-For: <random>` per request and the per-IP
throttle in ADMIN-ENT-03 becomes a no-op, taking the code-enumeration cost from "hundreds of IPs" to
"one machine".

**Recommended fix.** Regardless of how Vercel behaves, key the limiter on a header the platform
controls and the client cannot influence: `x-vercel-forwarded-for`, or the right-most XFF entry.
Nothing in `api/` reads `x-vercel-forwarded-for` today. This is cheap insurance on a limiter that
three endpoints already depend on.

---

### ADMIN-ENT-07

**Unbounded `courses[]` on the offline-lease endpoint** · severity **low** · confidence **high**

**Where:** `api/entitlement/offline-lease.ts:59-70`, `:206`, `:265-277`

```ts
function readCourses(req: VercelRequest): string[] {
  const out = new Set<string>()
  ...
  if (body && Array.isArray(body.courses)) body.courses.forEach(add)
  return [...out]
}
```

There is no length cap and no check that a submitted string is a real `course_code`. Every entry
becomes a loop iteration and then a row in a single `upsert` (`:265-268`).

**What an attacker does.** Any authenticated learner POSTs `{ courses: [...200000 unique strings] }`.

**What they get.** 200k rows inserted into `offline_leases` per request, keyed on their own
`learner_id` — storage growth and a slow query for every subsequent lease validation of theirs.
Self-inflicted and per-learner, hence low, but it is an authenticated write amplification with no
brake.

**Recommended fix.** Cap `reported` (a few dozen is beyond any real device's downloaded-course
count) and intersect the submitted codes against `courses` where `new_app_status in ('live','beta')`
before upserting — the same validation `api/entitlement/grant.ts:85-94` already performs.

---

### ADMIN-ENT-08

**One-trial-per-email is defeated by sub-addressing** · severity **low** · confidence **high**

**Where:** `api/_utils/schoolPlatformTrial.ts:53-82`, key defined at `supabase/schema.sql:10371`

The ledger is keyed on the literal address, `PRIMARY KEY (email, track)`:

```ts
const { error } = await supabase.from('trial_burns').insert({ email, track, school_id: schoolId })
```

Callers do normalise case and whitespace (`api/onboarding/provision.ts:130`,
`api/code/redeem.ts:590` both `.trim().toLowerCase()`) and disposable domains are blocked
(`isDisposableEmailDomain`, `provision.ts:142`) — both good. But `alice+1@gmail.com` and
`alice+2@gmail.com` are distinct keys and deliver to the same inbox.

**What an attacker does.** Signs up repeatedly with `+n` aliases (or Gmail dot variants), each time
creating a Supabase account and claiming a fresh 30-day or 365-day platform trial.

**What they get.** Indefinite free platform access, one signup at a time. Bounded by the friction of
a new account and school per cycle, hence low.

Two adjacent fail-open behaviours in the same helper are worth recording as part of the same
picture: `burnTrial` returns `{ burned: false, schemaUnavailable: true }` when the email is empty
(`:59-62`) and on **any** unexpected DB error (`:78-81`), and `provisionSchoolPlatformTrial:189-192`
reads that as "skip the burn, grant nothing" — so a burn-ledger outage does not itself hand out
trials. That is the right direction; only the key shape is weak.

**Recommended fix.** Canonicalise before burning: strip `+tag` sub-addresses, and strip dots in the
local part for known dot-insensitive providers. Store the canonical form in `trial_burns.email` and
keep the raw address elsewhere if it is needed for support.

---

### ADMIN-ENT-09

**`/api/invite/create` stores grant fields the caller was not authorised for** · severity **low**
· confidence **high (that they are stored); high (that they are inert today)**

**Where:** `api/invite/create.ts:254-268`

The per-`code_type` authorization block (`:100-224`) is careful and, where it matters, derives
server-side — `derivedGrantsGroupId` from the caller's own `govt_admins` row, `derivedGrantsSchoolId`
from the class row, with explicit comments that the payload is not trusted. But the insert then
copies three fields straight from the body for code types whose branch never validated them:

```ts
if (grants_region !== undefined) insertData.grants_region = grants_region
...
} else if (grants_group_id !== undefined) {
  insertData.grants_group_id = grants_group_id
}
...
if (grants_class_id !== undefined) insertData.grants_class_id = grants_class_id
```

**Why it is inert today.** I traced every path. A `teacher` code must carry either
`grants_class_id` (authorised via `canManageClassTeachers`) or `grants_school_id` (authorised
against `schools.admin_user_id`) or it 400s at `:197`. Redemption only honours a group grant when
*neither* school nor class is set:

```ts
// api/code/redeem.ts:611-615
} else if (codeType === 'teacher') {
  if (inviteRow.grants_group_id && !inviteRow.grants_school_id && !inviteRow.grants_class_id) {
    ... affiliateToGroupNode(..., 'teacher')
```

So a smuggled `grants_group_id` can never be the one that fires. The same holds for `student`
(`redeem.ts:666-669`), and a `school_admin` code's `grants_school_id` is ignored at redemption
because that branch *creates* a new school rather than attaching to a named one
(`redeem.ts:486-495`).

**What an attacker does.** Nothing, today. This is a latent hazard: the stored row asserts a grant
that was never authorised, and it becomes live the moment any reader stops requiring the
"and no school and no class" precondition.

**Recommended fix.** Only persist the grant columns the branch actually authorised — assemble
`insertData`'s grant fields inside each `code_type` branch rather than after it, and drop anything
unrecognised. The `derivedGrantsGroupId` / `derivedGrantsSchoolId` pattern already in the file is
the model.

---

### ADMIN-ENT-10

**`max_uses` cannot be enforced on personal invite links** · severity **low**
· confidence **high; documented as intentional**

**Where:** `api/_utils/personalLinkUses.ts:1-39`

The module exists to explain the behaviour and states the design decision plainly:

```
 *   invite_codes.use_count is incremented in exactly one place —
 *   api/code/redeem.ts. A PERSONAL link (species 1, metadata.personal_
 *   auth_user_id) never reaches it. ... so use_count for a personal link is
 *   STRUCTURALLY frozen at 0 forever.
 *
 * WHAT WE DELIBERATELY DO NOT DO: make possession-redeem increment use_count.
 * A personal link is repeatable-until-revoked by design, and max_uses is
 * enforced against use_count — incrementing would let a leader's max_uses
 * lock the recipient out of their own account on the second click.
```

**What an attacker does.** Obtains a leaked personal link (forwarded email, shared screenshot,
browser history on a shared machine). It mints a session for the bound account every time, forever,
regardless of any `max_uses` the minting leader set.

**What they get.** Indefinite account takeover of the bound user until someone notices and revokes.

**Recorded, not disputed.** The reasoning is sound and the alternative is worse. The gap is that
`max_uses` is *displayed* on these rows (`usesForLink` returns `max: row.max_uses` even for personal
links, `:108`) while being unenforceable, so an operator can believe they have set a limit that does
not exist. The redemption path itself is Area 1's (`api/auth/possession-redeem.ts`) — flagging for
their attention.

**Recommended fix.** Either suppress `max` in the payload for `kind: 'signin'` so the UI cannot
imply a cap, or enforce a genuine bound for personal links using the existing
`possession_mint_attempts` tally rather than `use_count` (that count is already computed here).

---

### ADMIN-ENT-11

**Offline leases are unsigned** · severity **info** · confidence **high**

`api/entitlement/offline-lease.ts:297-306` returns `leaseExpiresAt`, `revoked` and `isTrial` as
plain JSON. There is no signature or MAC over the response, so the client's persisted copy is
whatever the device says it is — a determined user edits IndexedDB and keeps a lapsed lease alive.

This is inherent to any offline model and the blast radius is small: it only extends playback of
audio already downloaded to that device, and every *new* entitlement decision still goes through the
server. The server side is genuinely well built — it is stateful, revocation-capable, records the
one free taste so a cache wipe cannot re-mint it, and the upsert now fails **closed**
(`:265-277`, with the comment recording exactly why that changed). Recording it so nobody assumes
the lease is tamper-evident.

**If it ever needs to be:** sign the per-course lease with an HMAC over
`(learner_id, course_code, expiresAt)` and verify it client-side before honouring a stored lease —
which raises the cost from "edit a number" to "extract a key", without changing the protocol shape.

---

### ADMIN-ENT-12

**Two admin checks disagree about who is an admin** · severity **info** · confidence **high**

`api/_utils/auth.ts:114` accepts `platform_role === 'ssi_admin' || educational_role === 'god'`.
`api/admin/grant-entitlement.ts:39` and `api/admin/revoke-entitlement.ts:39` hand-roll a narrower
check:

```ts
if (!caller || caller.platform_role !== 'ssi_admin') {
  res.status(403).json({ error: 'Only SSi admins can grant entitlements' })
```

Not a hole — it is *stricter*, and `api/admin/update-user-role.ts:26-30` notes that no learner row
has ever held `god`. But it is a second definition of "admin" that can drift from the first. One
difference does matter operationally: these two read the caller's role with the **service key**,
bypassing RLS, whereas `verifyAdmin` reads it under RLS with the caller's own token. Both are sound
given the grants in [Controls that hold](#controls-that-hold), but they are not the same check.

**Recommended fix.** Replace both with `verifyAdmin`, and if the narrower rule is deliberate, encode
it as an explicit option on the shared helper rather than a copy.

---

## Controls that hold

Verified by reading, and locked by the regression tests listed below. These are findings too — they
are the reason several obvious attacks do not work.

1. **`learners.platform_role` cannot be self-escalated.** The RLS policy alone would allow it —
   `learners_update_own` (`schema.sql:14618`) permits an authenticated user to UPDATE their own row
   with no column restriction, and the CHECK constraint happily accepts `'ssi_admin'`
   (`schema.sql:5187`). What closes it is the **column-level grant**:

   ```sql
   -- supabase/schema.sql:16534, 16542-16570
   GRANT SELECT,INSERT,DELETE,MAINTAIN ON TABLE public.learners TO authenticated;
   GRANT UPDATE(user_id)         ON TABLE public.learners TO authenticated;
   GRANT UPDATE(display_name)    ON TABLE public.learners TO authenticated;
   GRANT UPDATE(updated_at)      ON TABLE public.learners TO authenticated;
   GRANT UPDATE(preferences)     ON TABLE public.learners TO authenticated;
   GRANT UPDATE(verified_emails) ON TABLE public.learners TO authenticated;
   ```

   No table-level UPDATE, and neither `platform_role` nor `educational_role` is in the list. Since
   `verifyAdmin` trusts that column, **this grant list is load-bearing for the entire admin
   surface** — if a future migration ever re-grants table-level UPDATE on `learners`, every admin
   endpoint falls at once. Worth a comment on the migration and a standing check.

2. **Code redemption is race-free.** `claimCodeUse` (`api/code/redeem.ts:35-69`) calls an RPC that
   does the guard and the increment in one statement, so two concurrent redemptions of a
   single-use code cannot both win:

   ```sql
   -- supabase/schema.sql:2239-2250
   CREATE FUNCTION public.claim_invite_code_use(p_id uuid) RETURNS uuid
     LANGUAGE sql SECURITY DEFINER SET search_path TO 'public', 'pg_temp' AS $$
     UPDATE invite_codes SET use_count = use_count + 1
      WHERE id = p_id AND is_active
        AND (max_uses IS NULL OR use_count < max_uses)
        AND (expires_at IS NULL OR expires_at > now())
     RETURNING id; $$;
   ```

   Both functions are `REVOKE ALL ... FROM PUBLIC` and granted only to `service_role`
   (`schema.sql:15691-15700`), and `search_path` is pinned. The legacy read-then-write fallback at
   `redeem.ts:53-68` is race-accepting, but only fires when the RPC is genuinely absent.

3. **Privileged codes are force-bounded.** `boundPrivilegedCodeLimits`
   (`api/_utils/codeGuard.ts:21-42`) clamps any role-granting code to ≤50 uses and ≤90 days,
   defaulting to 1 use / 7 days, and both minters apply it before insert
   (`api/entitlement/create.ts:148-153`, `api/invite/create.ts:274-278`). The
   never-expiring-unlimited-use admin code class is closed.

4. **Paddle tier really is server-derived.** `PRICE_CATALOG` (`paddle-webhook.ts:94-119`) plus the
   guards at `:384-394`, `:396-411` and `:414-429` reject a `learner_premium`, `family_plan` or
   platform claim that was not actually billed on a matching-tier price. (The *target* is the
   problem — ADMIN-ENT-01 — not the tier.)

5. **Wise signature verification fails closed.** `verifyWiseWebhook`
   (`api/_utils/wise.ts:96-118`) returns `false` on a missing signature *and* on a missing public
   key, uses RSA-SHA256 over the raw body, and the handler reads the raw body with the body parser
   disabled (`wise-webhook.ts:30-44`, `:97-101`). Paddle likewise verifies via the SDK's
   `unmarshal` over the raw body with `bodyParser: false`
   (`paddle-webhook.ts:44-46`, `:257-278`). Both correctly verify **before** parsing.

6. **`update-user-role` has a self-promotion guard and a role allowlist.**
   `api/admin/update-user-role.ts:31-32` allowlists the assignable values, and `:106-117` refuses to
   let an admin change their own `platform_role` or grant themselves `god`. Worth noting the
   layering, which I got wrong on first reading and the tests corrected: `god` is **not** in
   `ALLOWED_EDUCATIONAL_ROLES`, so the value check (400) fires before the self-grant guard (403) is
   ever reached — `god` cannot be assigned to *anyone*, self or not. The `:114` guard is therefore
   currently unreachable defence-in-depth rather than the operative control. That is the stronger
   posture, not a weaker one; it just means the guard is protecting against a future widening of
   the allowlist. Both layers are pinned by tests.

7. **Entitlement grant durations are server-derived.** `api/entitlement/grant.ts:72-112` takes only
   `state` ('trial' | 'paid') and a `course_code` from the client, validates the course is
   `live`/`beta`, and computes the expiry from `trialDaysForCourse` — the client cannot name a
   duration. `api/_utils/trialPolicy.ts` is a single source for trial lengths.

8. **Family seat cap is enforced server-side** (`api/family/invite.ts:77`,
   `api/family/create-child.ts:60`) — the counter-example that makes ADMIN-ENT-05 an omission
   rather than a design stance.

9. **Own-subscription endpoints derive the target from the token.**
   `api/subscription/cancel.ts:41-56`, `api/subscription/portal.ts:41-56` and
   `api/entitlement/user.ts:40-55` all resolve `learners.id` from the verified uid and never accept
   a learner id from the client.

---

## Tests added

All new files are prefixed `admin-entitlement.` so they cannot collide with another area's work in
this shared checkout.

| File | Passing | `todo` | What it does |
|---|---|---|---|
| `api/admin/admin-entitlement.authz.security.test.ts` | 18 | 1 | Regression-locks the admin gate on grant/revoke-entitlement (405 / 401 / 403, nothing written), the `codes.ts` `created_by` scoping, and `update-user-role`'s allowlist + self-promotion guard; characterizes ADMIN-ENT-12 |
| `api/admin/admin-entitlement.limits.security.test.ts` | 23 | 5 | Characterizes ADMIN-ENT-05, -06, -09, -10, -11; locks the family seat cap, the throttle's existence and IP hashing, invite/create's server-derived grant fields, and the offline-lease fail-closed upsert |
| `api/entitlement/admin-entitlement.entitlement.security.test.ts` | 14 | 1 | Locks `boundPrivilegedCodeLimits`, the server-derived grant duration and course list, own-token learner resolution, trial-not-sliding and revocation; characterizes ADMIN-ENT-07 |
| `api/teacher/admin-entitlement.paddle-webhook.security.test.ts` | 9 | 4 | **Characterizes ADMIN-ENT-01** — proves a school / group / learner named purely by `customData` is written, including the attacker's `provider_customer_id`, and that a stranger's cancellation cancels the named school — plus ADMIN-ENT-04; locks the tier guard and the signature gate |
| `api/_utils/admin-entitlement.codes.security.test.ts` | 16 | 3 | Characterizes ADMIN-ENT-02, -03, -08; locks the CSPRNG minter, `generateShareCode` (the 128-bit precedent the fixes should follow), the race-free claim RPCs, and the `learners` column-grant control |
| **Total** | **80** | **14** | |

Every genuine vulnerability is a **characterization** test asserting today's behaviour with a
`// SECURITY FINDING <ID>:` comment and an `it.todo(...)` naming the fix, so CI stays green while
the finding is executably documented.

Several tests in `admin-entitlement.limits.security.test.ts` (and the two schema-fact tests in
`admin-entitlement.codes.security.test.ts`) assert against the **shipped source text** rather than
by driving a handler. That is deliberate and is called out in the file header: those findings *are*
absences — "no join path consults `teacher_seats`", "no endpoint reads
`x-vercel-forwarded-for`" — and an absence is what a source scan can honestly demonstrate. They
will fail the moment the absence is fixed, which is the intended signal.

**Gate status at time of writing:** `npx vitest run -c vitest.api.config.ts` →
128 files, 1420 passed, 62 todo, 0 failed. `npx tsc -p tsconfig.api.json --noEmit` → clean.
(The suite total exceeds the stated 1154 baseline because other audit areas are adding tests to the
same branch concurrently; before my files it stood at 1211 passing.)

---

## Gaps — what I could not check

Reported honestly rather than papered over.

1. **No live database access.** Every schema claim comes from `supabase/schema.sql` in this
   checkout. I did not confirm against the live DB that the grants at `schema.sql:16534-16570` are
   still what is deployed, nor that `processed_webhook_events` exists in production. Given
   CLAUDE.md records that this file has been stale before, **the column-grant control in
   [Controls that hold](#controls-that-hold) §1 should be re-verified live** — it is the single
   thing holding up the whole admin surface.
2. **No live traffic, by instruction.** ADMIN-ENT-01 is proven by reading the handler and the
   client that composes `customData`; it was **not** exploited. No Paddle or Wise call was made, no
   test checkout was opened, no entitlement was created or revoked.
3. **ADMIN-ENT-06 is unresolved.** Whether Vercel overwrites or appends `x-forwarded-for` decides
   whether the rate limiter is bypassable, and that needs one live probe against a deployed
   endpoint, which is out of scope here. Treated as UNVERIFIED throughout.
4. **Postgres `random()` predictability not demonstrated** (ADMIN-ENT-02) — asserted from the
   general property, not measured. The finding stands on the wrong-primitive argument.
5. **Real code counts unknown.** ADMIN-ENT-03's exploitability estimate needs the live count of
   active `invite_codes` rows, which I could not query. The 23.7-bit keyspace figure is exact; the
   time-to-first-hit is an estimate.
6. **Scope overlap declared.** `api/teacher/paddle-webhook.ts`, `api/teacher/wise-webhook.ts`,
   `api/code/redeem.ts`, `api/code/validate.ts` and `api/school/portal.ts` are not in my listed
   directories, but the hunt list explicitly names webhook signature verification, code-redemption
   races and code entropy. I audited them and flagged them here; whoever owns those directories may
   report overlapping findings. `api/auth/possession-redeem.ts` (ADMIN-ENT-10's redemption path) is
   Area 1's and I only read it — no finding is filed against it here.
7. **Not audited in depth.** Within my own scope I read every file, but the following got a
   correctness skim rather than a full adversarial read because they are admin-gated and carry no
   money or identity decision: `api/admin/attention.ts`, `board-metrics.ts`, `board-snapshot.ts`,
   `demo-schools.ts`, `demo-leaf.ts`, `onboarding-messages.ts`, `create-school.ts`,
   `create-staff.ts`, `create-govt-admin.ts`. Their gates are in the table above and are correct;
   their internal logic is not exhaustively reviewed.
