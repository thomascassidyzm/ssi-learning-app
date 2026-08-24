# Fix applied — learner identity columns locked (AUTH-CORE-02 + a worse one found underneath)

**Date:** 2026-08-11 · **Applied to:** the live shared Supabase (dev/staging/prod share one DB)
**Migration:** `supabase/migrations/20260811_lock_learner_identity_columns.sql`
**Canary:** `supabase/secfix-toolkit/canary_verified_emails_provenance.cjs` — 19/19 green, committed.

---

## What was actually wrong

Two paths, both **confirmed live** by executing them as a real `authenticated` role against production
inside a rolled-back transaction — not inferred from the checked-in schema dump.

### [1] The named one: `learners.verified_emails` was browser-writable (AUTH-CORE-02)

`authenticated` held `UPDATE(verified_emails)`. `learners_update_own` constrains **which row** you may
write, never the array's **contents**:

```
UPDATE learners SET verified_emails = verified_emails || 'victim@…' WHERE user_id = auth.uid()::text;
→ 1 row, ["canary-a@…", "canary-victim@…"]
```

Downstream, that column is treated as proof of mailbox ownership:

- `api/access/grant-emails.ts:159` resolves allowlist recipients with `.contains('verified_emails', …)`,
  and `api/_utils/entitlementGrant.ts:78-90` writes the grant's `grants_platform_role` verbatim into
  `learners.platform_role` — which `verifyAdmin` (`api/_utils/auth.ts:114`) admits on.
- `api/family/invite.ts:109` attaches family members the same way.

So: plant a staff or partner address in your own row, wait for an admin to run the allowlist for it,
inherit the grant — and, because `applyGrantsForLearner` stamps `redeemed_at`, the real recipient
finds nothing. **Exploitable end-to-end, gated only on an admin later granting to that address.**

### [2] Found while tracing [1], and strictly worse — no admin action needed at all

`authenticated` held **table-level INSERT** on `learners`, i.e. INSERT on `platform_role`. Combined
with `learners_delete_own`, that is a one-round-trip self-promotion to platform admin:

```
DELETE FROM learners WHERE user_id = auth.uid()::text;                      → 1 row
INSERT INTO learners (user_id, display_name, platform_role)
  VALUES (auth.uid()::text, 'x', 'ssi_admin');                              → 1 row
SELECT is_ssi_admin();                                                      → true
```

All three lines ran green as `authenticated` against production. `is_ssi_admin()` gates the
"Admins can read all learners" policy, and `verifyAdmin` reads the same column, so this was a full
admin takeover available to any signed-in learner, unconditionally.

The existing guard test called the UPDATE allowlist "the single most load-bearing grant on the admin
surface" and asserted role columns stayed out of it. It never checked the INSERT side, which was open.

## Why the grant existed

No migration in the repo ever granted it. `20260610_secfix_16_live_learner_tables_b2.sql:117` grants
table-level `INSERT` for the signup path; the column-level `UPDATE` grants are Supabase-era residue
that predates the migration history. This is exactly CLAUDE.md RLS doctrine rule 7 — "every new table
gets an explicit posture at creation, never Supabase's grant-open default" — showing its bill.

## What was applied

**A. Privilege surface narrowed** (a column-level REVOKE cannot restrict a table-level privilege, so
the table grant was dropped and re-issued per column):

- `REVOKE UPDATE(verified_emails)` — no direct client write of the array at all.
- `REVOKE INSERT ON TABLE`, then `GRANT INSERT` on `id, user_id, display_name, preferences,
  verified_emails, needs_verification, welcome_played_at, created_at, updated_at`.
  Excluded deliberately: `platform_role`, `educational_role`, `dashboard_courses`, `is_internal`,
  `is_demo`, `invite_code_id`, `is_class_entity` — every one written only by service-role code.

**B. `enforce_verified_emails_provenance` trigger** — a browser session may only place an address in
`verified_emails` that `auth.users`/`auth.identities` already attests for that account (or that was
already there, i.e. OTP-added via the service role). It raises rather than silently rewriting
(doctrine 8). This is why the INSERT grant could stay: revoking it would have broken every browser
still running a cached PWA bundle at signup, and the trigger closes the content hole without that.

**C. `sync_my_verified_emails()`** (SECURITY DEFINER, granted to `authenticated`) — the compensating
write path for the one thing the revoked UPDATE was doing: `useAuth.ts`'s best-effort back-fill of the
session's own address. It derives the address from `auth.users` instead of trusting the caller, and
skips link-auth placeholders.

Client change: `useAuth.ts` `ensureLearnerExists()` now calls that RPC instead of the direct UPDATE.
Old cached bundles keep working — their UPDATE now fails inside the existing try/catch as a non-fatal
warning, and the address lands on the next load from a fresh bundle.

## Canary result (the acceptance test)

Applied in one transaction, both sides asserted, COMMIT only on green — 19/19:

**Before (holes proven live):** planting a victim address via UPDATE succeeded · self-insert as
`ssi_admin` succeeded · `is_ssi_admin()` returned true.

**After — closed:** `authenticated` UPDATE(verified_emails) → permission denied · INSERT of
`platform_role` → permission denied · INSERT of `educational_role` → permission denied · INSERT
planting a third party's address → `verified_emails: … is not attested for this account` ·
`is_ssi_admin()` false for an ordinary session.

**After — every legitimate path alive:** browser signup insert with own address (`useAuth.ts:346`) ·
minimal insert (`WithTeacher.vue:211`) · `display_name` update (`SettingsScreen.vue`) · `preferences`
update (`App.vue`, `useAuth.ts`) · `sync_my_verified_emails()` back-fills and is idempotent ·
`get_my_verified_emails()` · service-role UPDATE of `verified_emails` (the OTP path,
`api/email/verify.ts:86`) · service-role INSERT with `platform_role` (`api/admin/create-staff.ts`) ·
service-role UPDATE of `needs_verification` · `claim_learner()` still links on an attested address.

Post-commit state re-read on a fresh connection: `authenticated` UPDATE columns are now
`display_name, preferences, updated_at, user_id`; INSERT columns exclude every role/flag column;
trigger and function present; zero canary fixture rows left behind.

## What this does NOT fix — still open

1. **`api/access/grant-emails.ts` still resolves recipients from `verified_emails`.** That array is
   now server-attested, so the hole is closed at the source, but the endpoint would be sounder
   reading `auth.users.email` or the OTP-stamped `learner_emails` rows. Same for
   `api/family/invite.ts:109`. Code change, not DB — left to those areas' owners.
2. **AUTH-CORE-04** — `/api/email/verify` still has no app-level bound on OTP attempts. Unchanged.
3. **`learners.verified_emails` is still SELECT-able by `authenticated`**, despite two code comments
   in `useAuth.ts` claiming the column is "revoked from direct SELECT". Those comments are wrong —
   the grant is live. Reading it is not an escalation (own-row RLS applies), so this was left alone;
   flagged because the comments will mislead the next reader.
4. **`is_internal`, `is_demo`, `dashboard_courses` remain client-SELECT-able and were never
   client-writable after this pass.** No action taken.
