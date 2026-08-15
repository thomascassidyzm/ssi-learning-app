# Security & vulnerability audit — 2026-08-15

**Branch:** `sec/audit-2026-08-15` · **Mode:** AUDIT ONLY — findings and tests, zero production
files changed. Nothing outward-facing: no payment, no webhook traffic, no email, no promotion, no
DB write, no live request to staging or production. Every claim comes from reading code in this
checkout.

This is a **follow-on** audit. A six-area sweep ran on 2026-08-11
(`docs/security-audit-2026-08-11/`) and three of its findings have been fixed since. Re-running the
same sweep would mostly re-derive its results, so this pass took the two things it could not do:

1. **Audit the fixes.** Three hardening passes landed between 11 and 15 August. The prior audit's
   own headline lesson was that this codebase's characteristic failure is *a hardening pass that
   migrates the helpers and misses one caller* — found three separate times. A fix is therefore the
   highest-prior place to look for the next finding, and that is where the serious one is.
2. **Audit what the sweep explicitly excluded** — its own "Gaps" section named routing/rewrite
   config and left the unauthenticated course-content endpoints as "worth confirming against the
   business model" without an owner.

## Verdict

**The 2026-08-11 critical is not closed. It is re-keyed.** The Paddle webhook no longer takes the
target tenant from `customData` — that fix is real and holds. It now resolves the payer from the
email on the Paddle customer record. That email is typed into the checkout by the buyer. The
attack survives with one substitution: the prerequisite changes from *know the victim school's
UUID* to *know the victim school admin's email address*, which is the easier of the two to obtain.
The price is unchanged at one legitimate £15 seat, and so is the payoff — the victim's billing
pointers are overwritten and a later cancellation flips their school dark.

**The audio fix is a speed bump, and reads like a paywall.** `/api/audio/batch-urls` now requires a
verified session for premium past-preview clips. But the gate asks for *authentication*, not
*entitlement* — a free signup clears it — and a denied id is not withheld, it falls back to the
per-clip proxy, which fails open by design and by production config. The paid catalogue is still
retrievable; it is now retrievable one clip at a time by a free account instead of 500 at a time
anonymously. That is worth having. It is not the thing the surrounding comments imply.

**Nothing new was found on the content surface, and that is now enforced rather than asserted.**
All three course-content endpoints that carry learner-facing text consult the shared entitlement
gate; `round-map` carries none. A test now enumerates the directory so a fourth endpoint cannot
ship ungated in silence.

| ID | Severity | Where | One line |
|---|---|---|---|
| [SEC15-01](#sec15-01) | **high** | `api/teacher/paddle-webhook.ts` (uncommitted working tree) | The webhook resolves "who paid" from an email the buyer typed at checkout — ADMIN-ENT-01 re-keyed from school UUID to admin email |
| [SEC15-02](#sec15-02) | medium | `api/audio/batch-urls.ts`, `api/audio/[audioId].ts` | The bulk gate is authentication not entitlement, and denied ids fall back to the fail-open proxy |
| [SEC15-03](#sec15-03) | low | `api/audio/[audioId].ts:211-215` | A storage failure returns the internal S3 key and the raw provider error to the client |
| [SEC15-04](#sec15-04) | low | `api/teacher/paddle-webhook.ts` | Payer resolution ignores `learner_emails.verified` and picks an arbitrary learner on a multi-match |
| [SEC15-05](#sec15-05) | info *(UNVERIFIED)* | `vercel.json:36-45` | Two header rules set contradictory frame policies for `/_schools-mockups/*` |

**Controls verified to hold** (each locked by a passing test): `customData` really is ignored as an
address now; all text-bearing content endpoints are gated; `round-map` projects three structural
columns and no text; `resolveServerCourseAccess` falls to preview rather than unlock on a bad
token; `get_cascade_courses` is granted to `service_role` only despite being SECURITY DEFINER with
a caller-supplied uid; `learner_emails` has RLS enabled with **zero** policies, so the browser
cannot plant an address there; the publicly-served schools mockups contain no key, no JWT and no
service-role reference.

---

## Findings

### SEC15-01

**The Paddle webhook resolves the payer from a buyer-supplied email**
· severity **high** · confidence high on the code path, and see *the one assumption* below

**Where:** `api/teacher/paddle-webhook.ts`, `resolvePayerAuthUid` / `resolveSchoolTarget` /
`resolveOrgTarget` — currently an **uncommitted working-tree change**, not yet on any branch.
Buyer-side: `packages/player-vue/src/composables/useSchoolCheckout.ts:85`.

**Tests:** `api/teacher/paddle-payer-email-addressing.security.test.ts` — five passing
characterization tests driving the real `handleSubscriptionEvent`, plus the control that keeps the
2026-08-11 fix honest.

**What the fix does.** ADMIN-ENT-01 / TENANCY-03 was that `customData.school_id`, composed in
browser JS, was the sole address of a service-role `UPDATE` on `schools`. The fix removes that
entirely. The target is now derived from, in order:

1. the row already bound to this Paddle subscription id, else
2. "the PAYER's own node" — resolved by asking Paddle for the customer's email, then
   `learner_emails` → `learners.user_id` → `schools.admin_user_id` (or an admin `user_tag`).

Step 1 is sound and step 2's *intent* is right. The problem is what step 2 treats as identity.

**What an attacker does.** Open the schools checkout. Supply the victim school admin's email
address as the Paddle customer email — the app's own client sets it (`customer: { email }`), so it
is a client-controlled field, and Paddle's checkout accepts a hosted-checkout or JS-initiated
customer with whatever address is given. Pay for one seat with your own card.

**What happens.** The webhook fires on the payment. `resolveSchoolTarget` finds no row bound to
this new subscription id — the victim's school is bound to the victim's *own* subscription, which
has a different id — so it falls through to the email. Paddle returns the victim admin's address.
`learner_emails` resolves it to the victim's learner, `learners.user_id` to their auth uid,
`schools.admin_user_id` to their school. The handler then runs the unchanged write:

```ts
// api/teacher/paddle-webhook.ts — handleSchoolPlatformSubscription
.from('schools').update({
  platform_status: status,
  platform_expires_at: periodEnd,
  teacher_seats: seats,
  provider_subscription_id: data.id,      // ← attacker's
  provider_customer_id: data.customerId,  // ← attacker's
}).eq('id', schoolId)                     // ← victim's school
```

The victim's binding is not protection: it is *overwritten*, so every later event on the attacker's
subscription addresses the victim's school. Cancel, and `platform_status: 'cancelled'` lands on the
victim — which the coverage gate turns into a school-wide 403. All three steps are asserted by the
tests.

**The one assumption, stated plainly.** The severity rests on Paddle not proving mailbox ownership
before the subscription-created webhook fires. Nothing in this repo does that check, and the
webhook fires on payment rather than on any later confirmation, so within this codebase the
property is absent. Whether Paddle independently withholds a customer record until a receipt link
is clicked was **not verified against Paddle's live behaviour** — this audit sent no Paddle traffic
by rule. If Paddle does verify, this drops to medium and becomes a defence-in-depth item. That
check is one console visit and it decides the severity.

**The secure shape.** Stop resolving identity after the fact. Bind the Paddle customer to a learner
at *checkout-creation* time, server-side, from the verified session of whoever opened the checkout
— an authenticated endpoint that writes `provider_customer_id` onto the learner/school row before
any money moves — and have the webhook resolve only through that binding, rejecting anything else
for manual remediation exactly as it already does. Short of that, requiring
`learner_emails.verified = true` and rejecting a multi-learner match (SEC15-04) narrows the attack
without closing it.

---

### SEC15-02

**The bulk-audio gate is authentication, not entitlement — and denied ids are not withheld**
· severity **medium** · confidence high

**Where:** `api/audio/batch-urls.ts:145`, `api/_utils/audioAccess.ts:538-543`,
`api/audio/[audioId].ts:95-107`, `packages/player-vue/src/playback/bulkAudioDownload.ts:201-202`.

**Tests:** `api/audio/audioGateResidue.security.test.ts` — four passing characterization tests.

Two parts, both proven against the real handlers.

**(a) Any free account clears the gate.** The check is
`entitlement.gated && !(await hasVerifiedSession())`, where `hasVerifiedSession` is
`verifyAuthToken(req).then(r => r.valid)`. It asks whether the caller holds *a* valid Supabase
session. It never asks whether that session has a subscription or an entitlement — which is exactly
the question `resolveServerCourseAccess` exists to answer, and which every course-content endpoint
does ask. Email-OTP signup is open, so the cost of clearing this gate is one free account. The test
drives a session belonging to `user-with-no-subscription` and gets a presigned S3 URL for premium
seed-300 content.

**(b) A denied id is a slower id, not a withheld one.** The client's own comment states the
assumption:

```ts
// bulkAudioDownload.ts:201
// Denied ids fall back to ensure(), which enforces its own entitlement.
```

It does not enforce it. `ensure()` is the per-clip proxy, and with `ENTITLEMENT_ENFORCE` unset —
which the 2026-08-11 audit recorded as the production state — `resolveAudioEntitlement` returns
`{ allowed: true, gated: true, tag: 'no-token-open' }` and the proxy streams the bytes. The test
takes the exact id the bulk endpoint just refused to an anonymous caller and fetches it
successfully, anonymously, from the proxy. The `X-SSi-Entitlement: no-token-open` header on that
response is the code's own record that it knows it is failing open.

**Net effect.** Pulling the paid catalogue went from *anonymous, 500 clips per request* to *one
free signup, one clip per request*. That is a genuine and worthwhile increase in cost. It is not
the protection the surrounding comments read as. The change that would actually withhold the
catalogue is arming the proxy, and the code documents why that cannot happen yet: no subscriber
entitlement-token mint site exists, so arming it today would deny every paying subscriber. **That
missing mint site is the real open item behind INPUT-01**, and it is the thing to schedule.

---

### SEC15-03

**The audio proxy returns its internal storage key and the raw provider error**
· severity **low** · confidence high

`api/audio/[audioId].ts:211-215` puts `key: sample.s3_key` and
`details: s3Error?.message || s3Error?.Code || s3Error?.name` into the 502 response body. Neither is
actionable by a client — its only recovery is retry or give up — and together they describe the
bucket layout and the failure mode of the storage account to anyone who can trigger a 502. The same
values are already logged server-side one line above, which is where they belong. A correlation id
in the body preserves every bit of the debuggability.

Test: `api/audio/audioGateResidue.security.test.ts`, `SEC15-03`.

---

### SEC15-04

**Payer resolution ignores email verification and resolves a multi-match arbitrarily**
· severity **low** *(compounds SEC15-01)* · confidence high

`resolvePayerAuthUid` selects from `learner_emails` with no `.eq('verified', true)`, though the
column exists (`supabase/schema.sql:7483`), and then takes
`(learners || []).map(l => l.user_id).find(Boolean)` — an arbitrary row — when the address maps to
several learners. CLAUDE.md records that multiple accounts per person are **intentional** ("tester
accounts — do NOT merge learners"), so a multi-match is an expected state rather than an anomaly,
and which account wins is decided by Postgres row order. On the money path, "an arbitrary one of
these" is not a good answer; the right one is to reject and log for manual binding, which the
handler already knows how to do.

Test: `api/teacher/paddle-payer-email-addressing.security.test.ts`, `SEC15-04`.

---

### SEC15-05

**Contradictory frame policies for the public mockup directory** · severity **info** ·
confidence **UNVERIFIED**

`vercel.json` sets `X-Frame-Options: DENY` and `CSP: frame-ancestors 'none'` on `/(.*)`, and
`SAMEORIGIN` / `frame-ancestors 'self'` on `/_schools-mockups/(.*)`. Both rules match a mockup URL.
Which wins is Vercel's header-merge behaviour, and this audit did not verify it against a live
response — no live request was made, by rule.

The stakes are low and were checked rather than assumed: the 13 mockup HTML files served from
`packages/player-vue/public/_schools-mockups/` carry no JWT-shaped literal, no Supabase secret key
and no `service_role` reference — a test asserts all three across the tree. The finding is that the
config reads as if the narrower rule is authoritative when nobody has confirmed it is. If a
framable gallery is the intent, the global rule should exclude the path rather than be layered over.

Test: `api/courses/contentGateEnumeration.security.test.ts`, `SEC15-05`.

---

## The enumeration lock

The prior audit's most valuable output was not a finding, it was a diagnosis: *the security thinking
here is good; what leaks is completeness of sweeps*. Its recommendation — make a hardening pass
enumerate its callers — is now executable for the one surface where a missed caller gives away the
paid product.

`api/courses/contentGateEnumeration.security.test.ts` walks `api/courses/[code]/` and requires every
handler to either call `resolveServerCourseAccess` or appear on an exempt list **with a written
reason**. Today: `bundle.ts`, `cycles.ts` and `infplay-cycles.ts` are gated; `round-map.ts` is
exempt because it projects `round_index, lego_id, seed_number` and no text — separately asserted.
A fourth content endpoint added later goes red on the commit that adds it, with the fix in the
failure message.

## Gaps (explicit)

- **No live verification of anything.** No request to production or staging, no Paddle call, no DB
  query. Where a claim rests on the live environment it says so: SEC15-01's Paddle-side assumption,
  SEC15-02's `ENTITLEMENT_ENFORCE` state (inherited from the 2026-08-11 audit's note, not re-checked),
  SEC15-05's header merge.
- **`learner_emails` deny-all rests on `supabase/schema.sql`**, which CLAUDE.md records as having
  been stale before. The file shows RLS enabled with zero policies and `GRANT ALL TO authenticated`,
  which is deny-all in Postgres — but that is a claim about a committed file, not about the live
  database. A read-only `pg_policies` check would settle it; no anon key was available in this
  checkout to run the equivalent behavioural probe.
- **SEC15-01 describes uncommitted code.** The fix it audits is in the working tree on
  `fix/bundle-excludes-staged-pods-2026-08-14`, not on any pushed branch. If it is revised before
  landing, re-run `api/teacher/paddle-payer-email-addressing.security.test.ts` against the revision.
- **The client (player-vue) was not re-swept**; area 6 of the prior audit stands unrevised except
  for the two files this audit needed (`bulkAudioDownload.ts`, `useSchoolCheckout.ts`).

## Incidental

`api/admin/demo-schools.test.ts:271` fails on today's date and did so before this audit — it pins
`base` to `2026-08-15T00:00:00.000Z` and compares against a value derived from the real clock, so
it passes only during the first instant of that day. Not a security issue; a time bomb in a test,
worth a fixed clock.
