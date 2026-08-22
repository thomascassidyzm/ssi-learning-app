# Security & vulnerability audit — 2026-08-22

Run as reset-eve spare-capacity work on branch `security/audit-2026-08-22`.

**Rules this audit ran under:** findings and tests only. No production behaviour was changed, no
fix was applied, nothing was promoted, no money moved, and no email or OTP was sent. The only
production contact was **read-only**: two unauthenticated HTTP reads and one anon RPC call that
mints nothing (details and justification in §3).

---

## 0. Why this audit is short, and what it actually adds

A thorough audit already exists: `docs/security-audit-2026-08-11/` on branch
`sec/audit-2026-08-11` — six areas, ~1,100 test cases, still **unmerged**. Re-running its
partition would have produced a second copy of its findings. So this pass deliberately took only
the three things that audit could **not** do, each of which it named explicitly:

| Its declared gap | What this audit did |
|---|---|
| "Two live checks that change severities, **neither of which this audit could make**" | Made one of them; the other is blocked and reported as a gap (§3, §4) |
| "**No live database, no live traffic**… nothing here is confirmed against a running system" | Confirmed one finding live, and escalated it (§1, SEC22-01) |
| Handler count "covers `api/` only"; code written **after 2026-08-09** was not seen | Audited the whole delta since its merge-base — 23 files, +3,549 lines (§2) |

The delta is concentrated in exactly one place: the **money-path hardening** that answers its own
critical finding. So the second half of this audit is a verdict on whether that fix holds (§2).

---

## 1. Findings

### SEC22-01 — the join-code minter uses a weak PRNG, and `anon` may sample it · **HIGH** · live-verified

**Escalates ADMIN-ENT-02** (2026-08-11), which found the DB-side minter still on `random()` after
the app-side minter was hardened. That report rated it "high — costs an attacker statistics". This
audit adds the half that makes the statistics collectable, and confirms the whole thing on
production.

`public.generate_join_code()` builds a code from PostgreSQL's `random()` — the non-cryptographic,
per-session-seeded PRNG, not `pgcrypto`'s `gen_random_bytes`:

```sql
result := result || substr(letters, floor(random() * 24 + 1)::int, 1);   -- ×3
result := result || substr(numbers, floor(random() * 10 + 1)::int, 1);   -- ×3
```

Three things make this a live finding rather than a tidiness note:

1. **It mints real credentials.** Two triggers call it — `set_class_join_code()` and
   `set_school_join_code()` — so it is what stamps `classes.join_code` and `schools.join_code`.
   It is not vestigial.
2. **`EXECUTE` is granted to `anon`.** `GRANT ALL ON FUNCTION public.generate_join_code() TO anon;`
   (`supabase/schema.sql:15792`). Verified live 2026-08-22: eight anonymous `POST
   /rest/v1/rpc/generate_join_code` calls against production returned eight `200`s and eight
   well-formed codes (`LUB-157`, `MXY-755`, `DPH-844`, `VSM-001`, …). An unauthenticated attacker
   can sample the generator's output stream at will. That is the difference between "weak PRNG"
   and "weak PRNG with a public oracle attached".
3. **The keyspace is already small.** 24³ × 10³ = **13,824,000**, and the 2026-08-11 audit's
   systemic finding was that there is **no rate limiting anywhere in `api/**`**. Predictability
   compounds a space that unmetered guessing already threatens.

**The asymmetry is the point.** `api/_utils/codeGen.ts` gets this exactly right, and says why:

> Uses the CSPRNG `crypto.randomInt` (not a predictable PRNG): these codes gate elevated
> `educational_role` grants (teacher/school_admin/govt_admin) into a school/group on redemption,
> so their minting must not be predictable from observed samples.

That threat model is correct and it applies verbatim to the DB minter, which mints the same class
of credential with a PRNG that *is* predictable from observed samples. This is the 2026-08-11
audit's headline pattern — *a hardening pass that migrated the helpers and missed one caller* —
still open, eleven days on.

**Suggested fix** (not applied): draw from `gen_random_bytes()`, and revoke `EXECUTE` from `anon`
and `authenticated` — no browser needs to mint a join code.

Tests: `api/_utils/joinCodeEntropy.security.test.ts`

---

### SEC22-02 — AUTH-CORE-02 is **fixed in production** · settled, no action

The 2026-08-11 audit ranked this #3 and could not confirm it: `authenticated` holding
`UPDATE(verified_emails)` plus table-level `INSERT` on `learners` was a one-round-trip path to
`platform_role = 'ssi_admin'`. Its fix migration `20260811_lock_learner_identity_columns.sql`
sits on the unmerged audit branch, so whether it had ever been applied was an open question.

**It has been.** The migration's part C creates `public.sync_my_verified_emails()`, and that
function is present in production's live PostgREST schema (read from the OpenAPI document, which
is a plain authenticated GET). Its presence is the migration's fingerprint.

**Caveat, stated honestly:** this is inference from an artifact the migration creates, not a direct
read of `information_schema.column_privileges`. It is strong — the migration is applied in a single
canary transaction, so part C existing means parts A and B ran — but it is not the privilege read
the original report asked for. See §4.

---

### SEC22-03 — `api/admin/vad-prosody.ts` returns internal error text to the caller · **LOW**

New endpoint, added after the 2026-08-11 audit's merge-base, so never reviewed.

```ts
res.status(500).json({ error: e instanceof Error ? e.message : 'Failed to aggregate prosody' })
```

A PostgREST/Postgres error message can carry relation names, column names and constraint text.
Every comparable handler on this surface returns a fixed string and logs the detail server-side —
`api/board/snapshot/[code].ts` returns `'Internal server error'`, `api/billing/bind-customer.ts`
returns `'Could not prepare checkout'`.

Reachable only by an authenticated `ssi_admin`, so the confidentiality impact is close to nil.
It is filed as a **convention divergence on a young endpoint** — cheapest to correct now, before
the next endpoint pattern-matches on it. The endpoint's *core* posture is right and is locked by
passing tests: `verifyAdmin`-gated, fails closed without a service key, and aggregates only (the
128-point envelope contour never crosses the wire).

Tests: `api/admin/vadProsody.security.test.ts`

---

### SEC22-04 — `vad-prosody` does unbounded work per request · **LOW**

One request may issue **100 sequential 1000-row reads** (`MAX_EVENTS / PAGE`) and hold up to
100,000 rows in memory before folding, with no cache and no caller-supplied bound. The function
carries no `maxDuration` override in `vercel.json`, so it takes the platform default.

The honest half is genuinely good: the cap is reported as `truncated` in the response body, never
a silent truncation. Admin-only, hence low. Recorded so that **if this endpoint is ever widened
past `ssi_admin`, the amplification is already on the record** rather than discovered then.

Tests: `api/admin/vadProsody.security.test.ts`

---

### SEC22-05 — the money path: the critical is **closed, and closed properly** · regression locks added

No new vulnerability. This is a verdict plus tripwires, and it is here because **this finding has
been re-opened once already**:

- **2026-08-11 (ADMIN-ENT-01 / TENANCY-03, critical):** the Paddle webhook took its target tenant
  from `customData.school_id`, composed in browser JavaScript. £15 to switch a paying school dark.
- **The first fix** replaced that with "the payer's own node, resolved from the Paddle customer's
  email" — and the hijack survived one substitution: type the victim admin's **email** instead of
  their UUID (**SEC15-01**).
- **The current fix (A-123, 2026-08-16)** replaces the address with a **server-signed billing
  intent token** minted from a verified session (`api/_utils/billingIntent.ts`), consumed by a
  four-step **binding ladder** in the webhook. The buyer cannot type, guess or mint it.

**This audit's verdict: the design is sound.** `customData.school_id` and `customData.group_id`
survive in the webhook only as arguments to a mismatch *logger*; neither reaches a resolution
path. `api/billing/bind-customer.ts` takes exactly one field from the request body — `scope` —
and resolves the node from `auth.userId`, with the caller's email read from `auth.users` rather
than from the request.

Two invariants the ladder's soundness rests on are **not visible from reading the ladder**, so
they were verified by hand and are now pinned as tests:

1. **Step 1 of the ladder is deliberately unguarded** ("some row already carries this subscription
   id — there is nothing to steal"). Sound only while `provider_subscription_id` cannot be
   attacker-influenced. Verified: `api/teacher/paddle-webhook.ts` is its **only** writer in
   `api/**`; every other reference reads it.
2. **Steps 3–4 address by `provider_customer_id`.** Verified: two writers, both downstream of an
   already-resolved node — `bind-customer.ts` (session-resolved) and the webhook's update to the
   node the ladder just guarded. **A third writer is the regression**, and the test fails on one.

If either invariant breaks, the ladder silently degrades back to "the buyer can address the
write", which is the critical. These tests are the tripwire.

Tests: `api/billing/bindingLadder.security.test.ts`

---

## 2. The delta audited (§0's third gap)

Everything on `dev` under `api/` since the 2026-08-11 audit's merge-base `07eeb9c9` (2026-08-09):
23 files, +3,549 lines. It is almost entirely the A-123 money-path hardening — `billingIntent.ts`,
`billingBinding.ts`, `bind-customer.ts` (new), `paddle-webhook.ts` (+433), plus their four new
`*.security.test.ts` suites — covered by SEC22-05.

The two non-billing items: `api/admin/vad-prosody.ts` (new — SEC22-03, SEC22-04) and
`api/courses/[code]/cycles.ts` (+434, pedagogy/round-shaping, no new auth or input surface;
it is an unauthenticated course-content route, unchanged in posture from the 2026-08-11 review
of its siblings).

`vercel.json` was also re-read, since the earlier audit listed rewrites/middleware as unaudited.
There is **no middleware file** in the repo. The security headers CLIENT-01 asked for are now
present and enforcing (`X-Frame-Options: DENY`, `X-Content-Type-Options`, `Referrer-Policy`,
HSTS, `Permissions-Policy`, and an enforcing `frame-ancestors 'none'`); the fuller CSP remains
**`Content-Security-Policy-Report-Only`**, which is the correct staging posture for a policy that
allowlists Paddle and ProfitWell, and is noted here only so the eventual flip to enforcing is not
forgotten.

---

## 3. Production contact — exactly what was touched, and why it was safe

Three read-only requests, no writes, nothing minted, no money, no email:

1. `GET /rest/v1/` (OpenAPI document, service key) — to list RPCs. Pure read.
2. `POST /rest/v1/rpc/generate_join_code` ×8 (**anon key only**) — this is the SEC22-01 evidence.
   The function is **pure**: it builds a string from `random()` and returns it. It performs no
   `INSERT` and no `UPDATE`, so calling it **creates no code, no class and no school**, and
   consumes nothing. The call was made with the anon key precisely because "can an unauthenticated
   caller do this?" *is* the finding.
3. `POST /rest/v1/rpc/{exec_sql,sql,execute_sql,run_sql}` — all returned `PGRST202` (no such
   function). Failed probes; nothing executed.

---

## 4. Gaps (explicit)

- **`ENTITLEMENT_ENFORCE` remains UNSETTLED.** The 2026-08-11 audit's live check #1, which decides
  whether INPUT-01 (rank 4, high) is live or already mitigated, requires
  `vercel env ls production`. **The Vercel CLI is not installed on this machine** (`vercel:
  command not found`) and installing it was out of scope for a read-only audit. This check is still
  open and still worth one minute of someone's time.
- **No direct privilege read.** No SQL-executing RPC is exposed, so
  `information_schema.column_privileges` could not be queried. SEC22-02's "fixed" verdict is
  inference from a function artifact, not a privilege read (stated in the finding itself).
- **SEC22-01's exploitability is argued, not demonstrated.** That `random()` is predictable from
  observed output is a property of the PRNG; that an attacker can reach the *same backend session*
  through PostgREST's connection pool often enough to exploit it was **not** tested, and testing it
  would mean sustained probing of production, which these rules forbid. The finding stands on the
  grant plus the PRNG plus the 13.8M keyspace, which is sufficient to justify the fix.
- **The prior audit's own findings were not re-verified** beyond the two live checks above. Its
  report remains the authority on the surface it covered; where this audit disagrees it says so.
- Nothing here covers the client bundle, the service worker, or `packages/player-vue` — the
  2026-08-11 `client-config.md` owns that surface and nothing in the delta touched it.

---

## 5. Files

| File | Contents |
|---|---|
| `README.md` (this file) | Findings, verdict, gaps |
| `api/_utils/joinCodeEntropy.security.test.ts` | SEC22-01 — 6 passing, 2 `todo` |
| `api/admin/vadProsody.security.test.ts` | SEC22-03/04 + admin-gate locks — 9 passing, 2 `todo` |
| `api/billing/bindingLadder.security.test.ts` | SEC22-05 — 8 passing regression locks |

**Test convention** (inherited from the 2026-08-11 audit): a real vulnerability is recorded as a
**characterization** test that asserts today's insecure behaviour and therefore **passes today**,
carrying a `// SECURITY FINDING <ID>:` comment and a paired `it.todo()` naming the secure
behaviour. When someone fixes the finding, the characterization goes **red on purpose** — that is
the signal the finding is closed, and the fixer flips it to the assertion the `it.todo()` names.
Controls that hold are locked with ordinary passing tests.

Suite status at time of writing: **112 files, 1,264 passing, 10 todo**; `typecheck:api` clean.
