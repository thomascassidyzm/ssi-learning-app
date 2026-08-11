# Security audit 2026-08-11 — Area 1: Auth & identity core

**Slug:** `auth-core` · **Branch:** `sec/audit-2026-08-11` · **Method:** read-only code audit + vitest characterization/regression tests. No production behaviour changed, no live traffic run, no writes to any database.

**Scope audited:** `api/_utils/auth.ts`, `actAsGuard.ts`, `operatorGuard.ts`, `codeGuard.ts`, `auditRole.ts`, `codeGen.ts` (pulled in — it mints the credentials this area gates on), `api/auth/**`, `api/me/**`, `api/account/**`, `api/email/**`, `api/try-link/**`, `api/code/**`, `api/onboarding/**`, `api/welcome/**`, `api/access/**`, `api/admin/view-as.ts`, `api/admin/create-signin-link.ts`.

---

## Headline

`api/_utils/auth.ts` itself is sound — `verifyAuthToken` is a genuine server-side GoTrue verification under the anon key, and `verifyAdmin` fails **closed** on "no row" and **loud** (500) on any other error. Every one of its ~30 call sites uses the correct `if ('error' in result)` check. That part of the brief's hypothesis holds up.

The real exposure is elsewhere, and it is **the same shape twice**: an endpoint that was deliberately throttled has an unthrottled sibling doing the same lookup.

1. **`/api/code/redeem` has no rate limit at all** (AUTH-CORE-01). `/api/code/validate` was given a per-IP throttle precisely because it is "a code-enumeration oracle… a hit yields an elevated-role invite… i.e. school infiltration" — its own comment. `redeem` performs the identical lookup against the identical codes with no throttle, and a hit does not merely *reveal* the code, it **grants the role**. The keyspace is 13,824,000.
2. **`learners.verified_emails` is writable from the browser** (AUTH-CORE-02), and `api/access/grant-emails.ts` treats it as proof of mailbox ownership. Plant a victim's address in your own row and you inherit their email-allowlist grant — including one carrying `grants_platform_role`, which is written verbatim into `learners.platform_role`, which is exactly what `verifyAdmin` admits on.

Neither needs a stolen credential. Both start from a free self-signup account.

---

## Findings

| ID | Severity | Where | One line |
|---|---|---|---|
| AUTH-CORE-01 | **high** | `api/code/redeem.ts:133-202` | No rate limit — unthrottled code oracle that grants the role it finds |
| AUTH-CORE-02 | **high** | `api/access/grant-emails.ts:159-176` | Email-allowlist grants resolve by a browser-writable column |
| AUTH-CORE-03 | medium | `api/try-link/validate.ts:76-128` | Unauthenticated, unthrottled, low-entropy code → 30-day all-courses entitlement |
| AUTH-CORE-04 | medium | `api/email/verify.ts:47-51` | No app-level bound on OTP verification attempts |
| AUTH-CORE-05 | medium *(UNVERIFIED)* | `api/auth/possession-redeem.ts:95-101` +2 | Per-IP budgets keyed on the first element of a client-supplied `X-Forwarded-For` |
| AUTH-CORE-06 | low | `api/email/verify.ts:58-63` | Cross-account collision guard silently passes when 2+ rows match |
| AUTH-CORE-07 | low | `api/admin/create-signin-link.ts:78-79` | The mint quota fails **open** on a query error |
| AUTH-CORE-08 | low *(UNVERIFIED)* | `api/admin/create-signin-link.ts:31-37` | Magic-link `redirectTo` derived from the unvalidated `Host` header |
| AUTH-CORE-09 | low | `api/code/validate.ts:350`, `redeem.ts:762,881`, `try-link/create.ts:101` | Live bearer-grade codes written to server logs in plaintext |
| AUTH-CORE-10 | low | `api/try-link/validate.ts:131` +9 | Raw DB error strings returned to clients |
| AUTH-CORE-11 | info | `api/auth/possession-redeem.ts:252-301` | **Control holds** — personal-link binding is server-derived only |
| AUTH-CORE-12 | info | `api/_utils/auth.ts:88-127` | **Control holds** — fail-closed/fail-loud; but the 403 shape is a caller footgun |

---

### AUTH-CORE-01 — `/api/code/redeem` is an unthrottled invite-code oracle that grants what it finds

**Severity: high.** `api/code/redeem.ts:133-202`, `api/_utils/codeGen.ts:13-28`.

**What an attacker does.** Sign up for a free account (any email OTP). Then POST guessed codes to `/api/code/redeem` in a loop:

```
POST /api/code/redeem   Authorization: Bearer <own session>
{ "code": "ABC-123", "codeKind": "invite" }
```

**What they get.** The response cleanly discriminates a miss from a hit — `{ success:false, error:'Invalid code' }` vs an expired/exhausted/success body — so it is a perfect oracle. And a hit is not just information: the handler proceeds to grant the code's role to the caller's own account.

Keyspace: `generateCode()` is 3 consonants from a 24-letter alphabet plus 3 digits — **24³ × 10³ = 13,824,000**. That is the *whole* space; expected guesses to a hit is `13.8M / (number of live codes)`. Every school, class, group and staff invite ever minted shares this space, so with a few hundred live codes a hit lands in low tens of thousands of requests.

The prize scales with the code type found:

```ts
// api/code/redeem.ts:340-349
if (codeType === 'ssi_admin' || codeType === 'god') {
  learnerUpdate.platform_role = 'ssi_admin'
} else if (codeType === 'tester') {
  learnerUpdate.platform_role = 'tester'
} else if (codeType === 'school_admin_join') {
  learnerUpdate.educational_role = 'school_admin'
} else {
  learnerUpdate.educational_role = codeType
}
```

`platform_role = 'ssi_admin'` is exactly what `verifyAdmin` (`api/_utils/auth.ts:114`) admits on — full platform admin, on the guesser's own account.

**The evidence that this is a gap and not a decision.** The sibling endpoint documents the threat in its own words:

```ts
// api/code/validate.ts:153-159
// Per-IP rate limit BEFORE any code lookup. This endpoint is
// unauthenticated and returns a discriminated {valid, codeKind, ...} for
// any submitted string, so without a throttle it is a code-enumeration
// oracle: the ~13.8M ABC-123 keyspace is sweepable, and a hit yields an
// elevated-role invite (teacher/school_admin/govt_admin) that the sibling
// possession-redeem path turns into a session — i.e. school infiltration.
// possession-redeem already throttles the same codes; this closes the gap.
```

`redeem.ts` contains no reference to `possession_mint_attempts`, no counter, no 429. Verified by grep and by test (`api/code/redeem.security.test.ts` asserts the table is never touched). `vercel.json` configures no platform-level rate limiting and there is no `middleware.ts`.

**Mitigating factors (honest).** `codeGuard.ts` bounds *privileged* codes to ≤90 days and ≤50 uses, so an `ssi_admin` code is only in the space while a live one exists. `isOperatorAccount` blocks an ssi_admin capturing themselves, which is unrelated. `claimCodeUse` is atomic, which bounds over-redemption but not guessing.

**Recommended fix (described, not applied).** Give `redeem` the same throttle `validate` has, keyed on **both** the client IP and the authenticated account (an account budget is the one an attacker cannot rotate) — reuse `possession_mint_attempts` with a new `outcome: 'redeem_attempt'` so a sweep correlates across all three endpoints. Separately, widen `generateCode()`'s keyspace for non-human-typed codes, or add a per-code lockout after N failed neighbours.

**Tests:** `api/code/redeem.security.test.ts` — 3 characterization tests + 2 `it.todo`.

---

### AUTH-CORE-02 — email-allowlist grants are delivered by a browser-writable column

> **FIXED 2026-08-11.** Confirmed live against production (the GAP below is now closed: the grant WAS
> still in place), then closed by `supabase/migrations/20260811_lock_learner_identity_columns.sql` —
> `UPDATE(verified_emails)` revoked, contents policed by the `enforce_verified_emails_provenance`
> trigger, back-fill moved to `sync_my_verified_emails()`. The same trace turned up a **worse**
> unflagged hole on the same table: table-level `INSERT` gave `authenticated` `platform_role`, so
> delete-then-insert was a one-step self-promotion to `ssi_admin` with no admin action required —
> also closed. Full record: `docs/security-fix-learner-identity-columns-2026-08-11.md`.

**Severity: high.** `api/access/grant-emails.ts:159-176`, `api/_utils/entitlementGrant.ts:74-90`, `supabase/schema.sql:16570`.

**The chain, link by link.**

1. The `authenticated` role holds a column-level UPDATE grant on the array:

```sql
-- supabase/schema.sql:16563-16570
GRANT UPDATE(preferences) ON TABLE public.learners TO authenticated;
GRANT UPDATE(verified_emails) ON TABLE public.learners TO authenticated;
```

The `learners_update_own` RLS policy (`supabase/secfix-toolkit/2026-06-09/20260610_secfix_16_live_learner_tables_b2.sql:129-132`) constrains **which row** you may write — your own — and says nothing about the array's **contents**.

2. That grant is live, not vestigial: the browser exercises it on every load.

```ts
// packages/player-vue/src/composables/useAuth.ts:255-261
if (email && !isPlaceholderEmail(email) && !emails.includes(email)) {
  emails = [...emails, email]
  await supabase.value.from('learners').update({ verified_emails: emails }).eq('id', existingLearner.id)
}
```

So any authenticated user can `update({ verified_emails: ['victim@ssi.example'] })` on their own row, from the browser, with the anon key. No OTP is involved.

3. The admin allowlist endpoint resolves recipients by exactly that array:

```ts
// api/access/grant-emails.ts:159-169
const { data: learners } = await supabase
  .from('learners')
  .select('id, verified_emails')
  .contains('verified_emails', [normalizedEmail])
for (const learner of learners || []) { … applyGrantsForLearner(…) }
```

4. And the grant's payload is written verbatim into the role column:

```ts
// api/_utils/entitlementGrant.ts:78-90
const learnerUpdate: Record<string, unknown> = { platform_role: spec.grants_platform_role }
…
await supabase.from('learners').update(learnerUpdate).eq('id', learnerId)
```

`api/access/grant-emails.ts:137` passes `grants_platform_role` straight from the admin's request body, so a staff/tester/admin comp is grantable this way.

**What an attacker does.** Pre-plant plausible target addresses (SSi staff, a school's known admin address, a partner org) in their own `verified_emails`. When an admin later runs the allowlist for one of them, the immediate-apply loop finds the attacker's row.

**What they get.** The entitlement, plus `learners.platform_role` set to whatever the grant carried — up to `ssi_admin`. And it is theft *plus denial*: `applyGrantsForLearner` stamps `redeemed_at` (`api/access/claim.ts:183-187`), and the legitimate recipient's own `/api/access/claim` filters `.is('redeemed_at', null)`, so they find nothing.

**Not affected.** `/api/access/claim` itself is sound — it derives the email from the *verified token*, never the body (`api/access/claim.ts:53-60`). The vulnerable resolution is only the `grant-emails` immediate-apply path. `claim_learner` (the auth-identity bridge) is also defended: it gates on *the caller's JWT email* being in the *target* learner's array, which own-row RLS prevents an attacker from planting.

**Also downstream of the same column** (other areas, flagged for their owners, not tested here): `api/family/invite.ts:109-119` attaches family members by `.contains('verified_emails', …)`.

**Recommended fix (described, not applied).** Revoke `UPDATE(verified_emails)` from `authenticated` — `api/email/verify.ts` is already the intended OTP-gated writer, and `useAuth.ts`'s back-fill should move behind a server endpoint or a SECURITY DEFINER function that only accepts the session's *own* `auth.users.email`. Independently, `grant-emails` should resolve recipients from a server-attested source (`auth.users.email`, or an OTP-stamped `learner_emails` row) rather than the self-writable array. Both changes need the canary process in CLAUDE.md's RLS doctrine.

**Tests:** `api/access/grant-emails.security.test.ts` — 2 characterization + 2 control + 2 `it.todo`.

---

### AUTH-CORE-03 — `/api/try-link/validate`: unauthenticated, unthrottled, low-entropy → free catalogue

**Severity: medium.** `api/try-link/validate.ts:76-128`, `api/try-link/create.ts:57`.

Try-link codes are minted by the same `generateCode()` (13.8M space, `api/try-link/create.ts:57`). The validate endpoint takes no auth and consults no rate-limit ledger — verified by test: the only table it touches is `try_links`. A miss is a cheap 404; a hit returns:

```ts
// api/try-link/validate.ts:41-45, 114-128
function mintEntitlementToken(expMs: number): string {
  const payload = b64url(Buffer.from(JSON.stringify({ kind: 'try', scope: 'all', exp: expMs })))
  …
}
const expMs = … Date.now() + TRY_TOKEN_TTL_MS   // 30 days
```

an HMAC-signed, 30-day, `scope: 'all'` entitlement token that `api/_utils/audioAccess.ts` accepts server-side for premium-past-preview audio. So a successful guess is free access to the entire paid catalogue for a month, with no account.

The token design itself is good (server-signed, time-boxed, fails closed in prod without the secret). The gap is purely that the code guarding it is 13.8M and the door is unmetered.

**Recommended fix.** Add the same per-IP throttle `code/validate` uses (the ledger and helpers already exist and are shared), and/or mint try-link codes with `generateShareCode()` (128-bit, already in `codeGen.ts:35-41`) rather than the human-typed `ABC-123` format — a try link arrives as a URL, so it does not need to be typeable.

**Tests:** `api/try-link/validate.security.test.ts` — 4 characterization + 2 `it.todo`.

---

### AUTH-CORE-04 — no app-level bound on OTP verification in `/api/email/verify`

**Severity: medium.** `api/email/verify.ts:47-51`.

```ts
const { error: verifyError } = await admin.auth.verifyOtp({ email: normalizedEmail, token, type: 'email' })
if (verifyError) return res.status(400).json({ error: verifyError.message || 'Invalid code' })
```

Any authenticated caller may submit `{ email: <anyone's address>, token: <guess> }` unboundedly; the handler relays every attempt. Confirmed by test: 50 guesses, 50 relays, no 429, no local short-circuit.

A success binds the address into the caller's `verified_emails` — which is the AUTH-CORE-02 key, so the same prizes apply (allowlist grants, family attachment, identity linking).

**Honest uncertainty.** GoTrue applies its own `/verify` rate limits, so this is not wide open. But those limits are keyed on the *caller's* IP — and the caller here is the Vercel function, not the attacker, so an attacker's guesses share a budget with all legitimate traffic rather than being isolated to them. The live GoTrue rate-limit configuration is off-repo and I did not query it (see GAPS). Severity assumes GoTrue's default is doing *some* work.

**Recommended fix.** A per-account and per-target-email attempt budget in the handler (the `possession_mint_attempts` pattern), returning 429; and — separately worth considering — refuse `email` values that already appear on another account *before* spending an OTP attempt.

**Tests:** `api/email/verify.security.test.ts` (AUTH-CORE-04 block) — 1 characterization + 1 control + 1 `it.todo`.

---

### AUTH-CORE-05 — per-IP budgets keyed on a client-supplied header

**Severity: medium. Marked UNVERIFIED** — see below.

Three endpoints derive the client IP identically, taking the **first** element of `X-Forwarded-For`:

```ts
// api/auth/possession-redeem.ts:95-101 (identical in api/code/validate.ts:92-98
// and api/try-link/validate.ts:102-104)
function getClientIp(req: VercelRequest): string {
  return (req.headers['x-forwarded-for'] as string)?.split(',')[0]?.trim()
    || (req.headers['x-real-ip'] as string) || 'unknown'
}
```

`x-forwarded-for` is a client-settable header. On a proxy that **appends** the real hop rather than replacing the header, `split(',')[0]` is entirely attacker-chosen — so rotating it resets the guess budget every request, collapsing possession-redeem's and code/validate's protection to the per-code limit alone, and making the stored `ip_hash` audit trail attacker-authored.

**Why UNVERIFIED.** Whether Vercel's edge replaces or appends a caller-supplied `X-Forwarded-For` is platform behaviour I could not test without sending live traffic, which this audit forbids. If Vercel replaces, this finding is inert. The code is written the risky way regardless, and the safe form costs nothing.

The tests here characterise the *code's* behaviour (the bucket key is the caller's value) and lock the *control* that the limiter does bite for a stable IP — both true either way.

**Recommended fix.** Read `x-vercel-forwarded-for` (platform-set, not client-forgeable), or take the **last** element of `x-forwarded-for`, in one shared helper all three endpoints import.

**Tests:** `api/auth/possession-redeem.security.test.ts` (AUTH-CORE-05 block) — 1 control + 2 characterization + 1 `it.todo`.

---

### AUTH-CORE-06 — the cross-account email collision guard fails open on multiple matches

**Severity: low.** `api/email/verify.ts:57-68`.

```ts
const { data: existingLearner } = await admin
  .from('learners').select('id, user_id')
  .contains('verified_emails', [normalizedEmail])
  .single()

if (existingLearner && existingLearner.user_id !== userId) {
  return res.status(409).json({ error: 'This email is already linked to another account' })
}
```

The error is destructured away. PostgREST's `.single()` errors when the filter matches **zero or more than one** row — so the moment two learners already carry the address (readily reachable via AUTH-CORE-02, or via any historical duplicate), `existingLearner` is `null`, the guard falls through, and a third account binds it. Confirmed by test.

**Recommended fix.** `.limit(1).maybeSingle()`, and check the error explicitly — fail **closed** (409/500) when the probe cannot be read, rather than treating an unreadable answer as "nobody else has it".

**Tests:** `api/email/verify.security.test.ts` (AUTH-CORE-06 block) — 1 control + 1 characterization + 1 `it.todo`.

---

### AUTH-CORE-07 — the sign-in-link mint quota fails open

**Severity: low.** `api/admin/create-signin-link.ts:71-83`.

```ts
if (rateErr) {
  console.warn('[CreateSigninLink] rate-limit check failed (failing open):', rateErr.message)
} else if ((recentCount ?? 0) >= PER_ADMIN_LIMIT) { … 429 … }
```

This endpoint mints a magic link that turns whoever holds it into an arbitrary learner. `verifyAdmin` is the real gate and it holds — but the quota is the only bound on *volume*, and an unreadable `player_events` (permission change, RLS tighten, outage) silently removes it. Everything else in the file is fail-closed; this is the odd one out, on the file where it matters most.

**Recommended fix.** Fail closed (503) when the quota cannot be evaluated, with the warning retained.

**Tests:** `api/admin/create-signin-link.security.test.ts` (AUTH-CORE-07 block) — 2 control + 1 characterization + 1 `it.todo`.

---

### AUTH-CORE-08 — magic-link `redirectTo` from the raw `Host` header

**Severity: low. Marked UNVERIFIED.** `api/admin/create-signin-link.ts:31-37`.

```ts
function getAppOrigin(req: VercelRequest): string {
  const host = ((req.headers['host'] as string) || '').toLowerCase().replace(/:\d+$/, '')
  if (host === 'saysomethingin.app' || host === 'www.saysomethingin.app') return 'https://saysomethingin.app'
  if (host === 'staging.saysomethingin.app') return 'https://staging.saysomethingin.app'
  if (host) return `https://${host}`          // ← anything else, echoed
  return 'https://saysomethingin.app'
}
```

The function's own docstring says "never trust a client-supplied value here" — the two canonical hosts are pinned, but the fallthrough echoes whatever arrived. That value becomes the magic link's `redirectTo` and the audit row's `env` label. A link that redirects to an attacker origin carries the token in the URL.

**Why UNVERIFIED / why low.** Two backstops sit outside this repo: Vercel only routes hosts attached to the deployment, and Supabase applies its own redirect-URL allowlist (a `redirectTo` outside it falls back to the Site URL). I could not inspect either. The endpoint is also admin-only. But neither backstop is expressed in this repo, so neither is protected by a test.

**Recommended fix.** Allowlist the known app origins explicitly and fall back to production; never interpolate `host`.

**Tests:** `api/admin/create-signin-link.security.test.ts` (AUTH-CORE-08 block) — 1 control + 1 characterization + 1 `it.todo`.

---

### AUTH-CORE-09 — bearer-grade codes written to logs in plaintext

**Severity: low.** `api/code/validate.ts:350`, `api/code/redeem.ts:762` and `:881`, `api/try-link/create.ts:101`.

```ts
console.log('[CodeRedeem] Redeemed invite code:', inviteRow.code, 'for user:', userId, 'role:', codeType)
console.log('[CodeValidate] Valid invite code:', inviteRow.code, codeType, …)
console.log('[TryLinkCreate] Created:', newCode, 'label:', label, 'by:', authResult.userId)
```

An invite code *is* a credential — `possession-redeem` turns one into a session with no other proof. Anyone with Vercel log access or a log drain can read live, unspent codes for schools and groups. (Session tokens themselves are **not** logged anywhere in this area — checked.)

**Recommended fix.** Log the code's `id`, never its value; or a truncated hash.

*Not separately tested* — a `console.log` assertion is brittle and the finding is a one-line grep. It is visible in the redeem test's stdout.

---

### AUTH-CORE-10 — raw DB error strings returned to clients

**Severity: low.** `api/try-link/validate.ts:131` (unauthenticated), `api/try-link/list.ts:102`, `deactivate.ts:64`, `create.ts:97,105`, `api/account/delete.ts:74,95`, `api/account/reset-progress.ts:69,86`, `api/me/teaching-context.ts:88`, `api/me/subscription.ts:57`, `api/onboarding/profile.ts:112`.

`res.status(500).json({ error: error?.message })` leaks Postgres constraint names, relation names and RLS messages. `api/onboarding/provision.ts:543-549` deliberately does the opposite and explains why (a 2026-07-16 finding where a constraint name reached the signup page) — the rest of the area has not caught up. The unauthenticated one (`try-link/validate`) is the one that matters.

**Recommended fix.** Generic client message, full detail to `console.error`, as provision.ts does.

**Tests:** covered in `api/try-link/validate.security.test.ts` — 1 characterization + 1 `it.todo`.

---

### AUTH-CORE-11 — controls that HOLD on `possession-redeem` (regression locks)

**Severity: info.** `api/auth/possession-redeem.ts`.

This is the only endpoint in the area that mints a real session with no bearer token, so I tried hard to break it. The rails hold:

- **Personal-link binding is server-derived.** `metadata.personal_auth_user_id` — the field that decides *which account* gets signed in — is only ever written by `api/groups/[id]/invites.ts:562-572`, from a persona the server just provisioned (`personaUserId`), with the comment "never client-supplied". Nothing in `possession-redeem`'s request body can reach it. Locked by test: a body carrying `personal_auth_user_id: 'attacker-uid'` still signs in as the stored persona.
- **Privileged code types are excluded** from the never-emailed-anyone path (`POSSESSION_ELIGIBLE_CODE_TYPES`, line 60-66) — an `ssi_admin` code cannot mint a session here.
- **The account-takeover rail holds**: an already-registered email gets 409 with no session (line 356-362).
- **Link-auth is pupils-only** (`LINK_AUTH_ELIGIBLE_CODE_TYPES`) — a teacher invite cannot mint a `link-<uuid>` ghost.
- The placeholder email is generated **after** the code is known-valid, so a guessed code never mints an account.

**Tests:** `api/auth/possession-redeem.security.test.ts` (AUTH-CORE-11 block) — 4 control tests.

---

### AUTH-CORE-12 — `api/_utils/auth.ts` controls hold; one caller footgun

**Severity: info.** `api/_utils/auth.ts:32-127`.

**Answering the brief's specific questions:**

- *Is `getUser()` actually server-verified?* **Yes.** `verifyAuthToken` builds a client with the **anon** key and forwards the caller's bearer as `global.headers.Authorization`, then believes only GoTrue's `getUser()` answer. Nothing parses or trusts the JWT locally, and no service-role client is constructed on the verification path. Locked by test.
- *Is the anon-key path sound?* Yes. A missing header, a non-Bearer scheme, or an empty token all short-circuit before any client is built (verified by test — zero clients constructed). Missing env config returns `valid: false` rather than throwing.
- *`verifyAdmin` fail-open or fail-closed?* **Fail-closed on "not an admin", fail-loud on everything else** — `PGRST116` (no row) falls through to 403; any other error returns 500 rather than being read as "not an admin". The role is re-read under the **caller's own token** on every call, so RLS applies and a de-platformed admin 403s on their next request with the same token. Already covered by `api/_utils/auth.test.ts`; I added the client-construction assertions it lacked.
- *Callers who check `valid` but not the 403 path?* **None found.** All ~30 `verifyAdmin` call sites use `if ('error' in adminResult)`. The three dual-door callers (`api/groups/[id]/rate-compare.ts:252-267`, `api/school/group-summary.ts:71`, `api/govt/school-links.ts:62`) deliberately reuse the uid the 403 carries, and each still refuses the admin-only branch. Correct.
- *Endpoints trusting a client-supplied `user_id`/`learner_id`?* **None in this area.** `account/delete.ts`, `account/reset-progress.ts`, `welcome/played.ts`, `me/*`, `onboarding/*` all resolve the learner from the verified auth uid and say so. `api/auth/cascade-user-id.ts` accepts an `old_user_id` from the body but refuses unless it is **orphaned** (no learners row holds it), which is the right guard.

**The one footgun.** `verifyAdmin`'s 403 branch returns `{ error, status: 403, userId }` — deliberately, so dual-door callers can reuse the verified uid. That means a caller writing `if (result.userId) { /* admin */ }` would admit a rejected non-admin. No live call site does this. Made executable in `api/_utils/auth.security.test.ts` so a future one sees the trap in a test.

**`actAsGuard` / view-as.** `rejectIfViewAs` is header-based by design (the client always sends `X-Ssi-View-As: 1` while acting-as; a real staff session never does), so it is a *belt* on top of the fact that act-as never re-authenticates — every request still carries the admin's own token, and write endpoints authorize on the caller's own scope. That reasoning is sound: an admin browsing as a persona cannot write as them, because they have no scope of their own. `api/admin/view-as.ts` is an audit-log writer only, correctly `verifyAdmin`-gated, and its `end` action is scoped to the admin's own row. No escalation found.

**`operatorGuard` / `codeGuard` / `auditRole` / `codeGen`.** All sound for what they claim. `codeGen` correctly uses `crypto.randomInt` (a CSPRNG) — the weakness in AUTH-CORE-01/03 is the **keyspace size**, not the randomness. `codeGuard` bounds privileged codes properly. `auditRole` swallows errors by design (a logging failure must not undo a grant) — acceptable, though it means a suppressed audit trail is invisible.

---

## Endpoints in scope with NO auth check — and whether that is correct

| Endpoint | Auth | Verdict |
|---|---|---|
| `POST /api/code/validate` | none | **Correct** — must answer before sign-in. Throttled, service-role reads a locked-down view. |
| `POST /api/auth/possession-redeem` | none | **Correct by design** — possession of the invite IS the credential (`docs/schools/email-deliverability-plan.md` Option A). Rails audited under AUTH-CORE-11 and hold. Throttled. |
| `POST /api/try-link/validate` | none | **Correct to be public, WRONG to be unmetered** — see AUTH-CORE-03. |
| `GET /api/me/profile` | optional | **Correct** — an unauthenticated caller gets only clearly-labelled `source: 'mock'` sample data (`api/me/profile.ts:323-329`); no real learner data is reachable without a verified token. |

Every other endpoint in scope requires a verified bearer: `api/auth/cascade-user-id`, `api/me/{engaged-time,subscription,teaching-context}`, `api/account/{delete,reset-progress}`, `api/email/verify`, `api/try-link/{create,list,deactivate}` (+ inline admin check), `api/code/redeem`, `api/onboarding/{provision,profile}`, `api/welcome/played`, `api/access/claim` (verified-token email derivation), `api/access/{grant-emails,list-grants}` (`verifyAdmin`), `api/admin/{view-as,create-signin-link}` (`verifyAdmin`).

---

## GAPS — what I could not check

Reported honestly rather than papered over.

1. **No live database access used.** AUTH-CORE-02 rests on `supabase/schema.sql:16570` (a checked-in dump) plus the client code that exercises the grant. I did **not** query `information_schema.column_privileges` on the live DB to confirm `UPDATE(verified_emails)` is still granted to `authenticated` today. If the dump is stale and the grant has since been revoked, AUTH-CORE-02 is inert — **this is the single highest-value thing to check first**, and it is one read-only query.
2. **The migrations directory is partial** (73 files). `20260521180000_block_anon_role_escalation`, referenced throughout CLAUDE.md and the code comments, is not in the repo — so I could not confirm which `learners` columns are write-locked beyond what `schema.sql` shows. Same for any policy landed outside `supabase/migrations/`.
3. **No live traffic.** AUTH-CORE-05 (does Vercel replace or append `X-Forwarded-For`?) and AUTH-CORE-08 (Supabase's redirect allowlist; Vercel's host routing) both turn on off-repo platform behaviour I could only reason about, not test. Both are marked UNVERIFIED for exactly this reason.
4. **GoTrue's live rate-limit configuration** (`RATE_LIMIT_VERIFY`, OTP length, OTP expiry) is a Supabase dashboard setting, not in the repo. AUTH-CORE-04's severity depends on it.
5. **Exploitability of AUTH-CORE-01/03 is argued, not demonstrated.** Running a code sweep against staging or production was out of bounds. The keyspace arithmetic and the absence of a throttle are both verified from code and by test; the hit rate depends on how many codes are live, which is a DB question I did not ask.
6. **Client-side surfaces** (`packages/player-vue`) were read only where they explained a server contract (`useAuth.ts`). A full client audit was not in scope.
7. **Cross-area observations not tested here.** `api/family/invite.ts:109-119` consumes `verified_emails` the same way `grant-emails` does, so it inherits AUTH-CORE-02. Flagged for the family/entitlement area's owner; I did not touch their files.

---

## Tests added

All in the repo's existing style (mocked Supabase, no network), all green.

| File | Tests | Covers |
|---|---|---|
| `api/code/redeem.security.test.ts` | 3 + 2 todo | AUTH-CORE-01 |
| `api/access/grant-emails.security.test.ts` | 4 + 2 todo | AUTH-CORE-02 |
| `api/try-link/validate.security.test.ts` | 4 + 2 todo | AUTH-CORE-03, -10 |
| `api/email/verify.security.test.ts` | 4 + 2 todo | AUTH-CORE-04, -06 |
| `api/auth/possession-redeem.security.test.ts` | 7 + 1 todo | AUTH-CORE-05, -11 |
| `api/admin/create-signin-link.security.test.ts` | 5 + 2 todo | AUTH-CORE-07, -08 |
| `api/_utils/auth.security.test.ts` | 7 + 1 todo | AUTH-CORE-12 |
| **Total** | **34 passing + 12 todo** | |

Every real vulnerability is a **characterization** test asserting today's behaviour (so CI stays green) with a `// SECURITY FINDING <ID>:` comment naming what should happen instead, plus an `it.todo` naming the fix. Controls that hold are ordinary passing regression locks.

**Gates at time of writing:** `npx vitest run -c vitest.api.config.ts` → 113 files, 1268 passed, 26 todo, 0 failed. `npx tsc -p tsconfig.api.json --noEmit` → clean.
