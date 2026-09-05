# Account pre-hijacking (CWE-1188) — fixed 2026-09-05

## What was wrong

Asking for a sign-in code creates the auth user before the code is typed —
`api/auth/send-code.ts` mints through Supabase's OTP path, which is
`shouldCreateUser: true` by design. So for **any address on the internet**,
anybody could leave behind an untouched account shell: never signed in, never
confirmed, no learner role.

`api/auth/possession-redeem.ts` then adopted such a shell on the strength of its
SHAPE alone — "nobody has ever been inside it, so there is nothing to take
over". That reasoning is wrong by exactly one step: the shape says nothing about
**who asked for it**.

The chain:

1. Attacker POSTs `victim@theirschool.uk` to `/api/auth/send-code`. A shell now
   exists for the victim, who knows nothing about it.
2. Attacker calls `/api/auth/possession-redeem` with that address and **any**
   valid invite code — a shared student join code handed to a whole year group
   is enough.
3. The shell passed every rail, so possession-redeem minted a real access +
   refresh token **on the victim's address**.
4. From there the attacker completes the victim's genuine staff invite
   themselves and owns the account from the start.

Same root cause, lower severity, folded into the same fix:
`api/school/staff-signin-link.ts` resolved the **caller's** school through both
spellings of identity (`schools.admin_user_id` OR an active `user_tags` SCHOOL:
row) but asked whether the **target** reached beyond that school through
`user_tags` alone. A person who founded another school holds the pointer and, if
nothing ever tagged them, no tag — so they read as "belongs nowhere else", and a
school admin at school A could mint a live session as the person who runs school
B. This is the Chepstow bug of 2026-08-06 wearing a different hat.

## The rule, stated once

**An invite may only bind an account shell that THIS invite's own flow created.**

Not "a shell that looks untouched" — a shell this exact invite code made, minutes
ago, on this same journey. It lives in `api/_utils/shellClaim.ts`, and any future
endpoint that adopts an existing shell imports it rather than re-deciding what
"untouched" means.

Mechanism: the creating path stamps a timestamped claim into the auth user's
`app_metadata` naming the invite code it was created for; the adoption path
requires that claim to name the invite in hand and to be fresher than one hour.
`app_metadata` and not `user_metadata` deliberately — `user_metadata` is writable
by the account holder through `supabase.auth.updateUser()`, `app_metadata` only
by the service role. A claim the subject can forge is not a claim.

For staff-signin-link the equivalent move is one resolver:
`schoolStaff.schoolMembershipsOf()` answers school membership under both
spellings, and the caller and the target are now both put through it. Two
spellings of one identity recognised in one place and missed in another is this
estate's recurring auth failure; the answer is never a second lookup next to the
first.

## What this deliberately gives up

The old adoption also rescued teachers whose school mail gateway ate their OTP,
leaving a shell behind — 81 such accounts, measured live 2026-09-02. That case
and the attack above are the **same shape** and cannot be told apart from the
row, so they now get the same answer: 409 `already_registered` → "sign in
instead".

Those teachers are rescued instead on the authenticated, authorised path built
for exactly this: their school admin mints them a short access code
(`api/school/staff-signin-link.ts`), which they spend at
`api/auth/access-code-redeem.ts`. A rescue that requires somebody accountable to
vouch for you is the whole difference.

## Was it exploited? No.

Read-only queries against production Supabase, 2026-09-05:

| Check | Result |
|---|---|
| `possession_mint_attempts` where `outcome='adopted_shell'` | **0 rows.** Shell adoption shipped 2026-09-02 (`86e523ed`) and has never once fired. |
| `outcome='already_registered'` (the refusal) | 3 rows, all pre-dating the adoption code (2026-07-22, 2026-07-24, 2026-08-25) — refusals, no session minted. |
| `staff_access_codes` | **0 rows.** No admin-minted access code has ever been redeemed by anyone. |
| `player_events` `school_signin_link_minted` | 44 events, all on 2026-09-02, across 23 distinct schools — **every one of those schools and every actor/target learner row no longer exists.** A torn-down acceptance sweep on the day it shipped, not real usage. |
| `signin_code_sent` by IP | 63 rows; the multi-address clusters are Chepstow School staff onboarding from a handful of school IPs — the expected staffroom pattern, one school, not enumeration. |

No account was pre-hijacked. The window in which it was possible was 2026-09-02
to 2026-09-05, and nobody walked through it.

## Regression tests

`api/auth/possession-redeem.test.ts` → `CWE-1188 account pre-hijacking
regression` reproduces the chain with the shell exactly as send-code leaves it
(no claim). Verified by removing the claim check locally: all four tests fail,
each returning **200 with a minted session** where the fix returns 409.

`api/school/staff-signin-link.test.ts` → `cross-school containment regression`.
Verified the same way by restoring the tags-only target resolution: the
containment test returns **200 and writes an access-code row** where the fix
returns 403.

## Verified live in production

Probed against `https://saysomethingin.app` with disposable
`ssi-sec-probe-<random>@gmail.com` addresses — never a real user's. Each run
manufactured the shell exactly as send-code's OTP mint leaves it (service-role
`createUser`, no mail sent), walked in with the live shared **student** join code
`ZCW-804`, and deleted the probe account afterwards. Zero probe accounts remain.

- **Before the deploy landed (6 runs, 01:51–01:54 UTC):** `200 adopted:true` with
  a real access + refresh token on an address the caller never proved they owned.
  The vulnerability reproduced end to end against live production.
- **After (01:55:13 UTC):** `409 { reason: 'already_registered' }`, no session.

Those seven rows in `possession_mint_attempts` with `ssi-sec-probe-*` emails are
this verification, not exploitation.

Shipped as `33aafce7` straight to `main` (Tom's ruling: confirmed live auth
vulnerability, the admin/auth-class exception to the promotion train), and
back-merged into `staging` and `dev` so the next promotion cannot lose it.
