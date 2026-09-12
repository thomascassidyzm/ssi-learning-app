# Security audit 2026-09-12 (tenth) — Area D: family accounts, try-links, invites, welcome

Findings and tests only. No production behaviour changed, no fix applied, no migration
written, no live database read, no external service called, no email sent. Every claim
below is over repo source at the commit this file lands in.

Test file: `api/_security/sec0912t-d-family-and-links.security.test.ts` — green, pure
(vitest + node:fs + node:path; one behavioural test drives `api/invite/create.ts` against an
in-memory stub). Each finding is a CHARACTERIZATION test that goes red when the defect is
fixed.

## Scope

`api/family/{create-child,index,invite,leave,remove,signin-link}.ts`,
`api/try-link/{create,deactivate,list,validate}.ts`, `api/invite/create.ts`,
`api/welcome/played.ts`, and the helpers they import: `api/_utils/familyAccess.ts`,
`familyMembership.ts`, `familyGrace.ts`, `familyInviteEmail.ts`, `resendMail.ts`,
`sendInviteEmail.ts` (origin only), `codeGen.ts`, `codeGuard.ts`, `codeAttemptThrottle.ts`,
`emailValidation.ts`; `supabase/migrations/20260710_family_members.sql`,
`20260908_family_invite_email_stamp.sql`; `supabase/schema.sql` for `family_members`,
`try_links`, `try_link_visits`. None of this had been security-reviewed before this pass.

## Findings

### SEC0912T-D-01 — MEDIUM — create-child is an unbounded, plan-gate-free identity mint

**Where.** `api/family/create-child.ts:43-130`; `api/_utils/familyMembership.ts` (`liveFamilyRows`,
`countUsedSeats`); `api/family/signin-link.ts:58-75`; `api/family/remove.ts`.

**Why.** Any caller holding a Supabase JWT, on any plan or none, can create a confirmed auth user
(`email_confirm: true` on a synthetic address) plus a learners row plus an active membership,
and is handed a magic sign-in link in the JSON body. The handler never reads `subscriptions`,
never asks the `hasFamilyPlan` question that GET `/api/family` computes, and never touches the
repo's throttle. The one ceiling, `FAMILY_SEAT_CAP` (6), counts LIVE rows only: `remove.ts`
frees the seat instantly, and by deliberate ruling (job #376·F D7) a removed child row still
mints a sign-in link. So create → remove → create is unbounded, needs no inbox, and every
account minted stays reachable. Because a child holds a real session, a child can itself call
create-child and be an owner of five more. Nothing is audit-logged.

**Attacker and what they get.** One free sign-up scripts an unlimited number of confirmed
`auth.users` and `learners` rows on the `members.saysomethingin.app` domain, each with a
working sign-in. No entitlement comes with it (see cleared list: a child inherits cover only
while the owner's row is a live Family plan or within its grace), so this is not a free-seat
mint. It is resource and billing abuse (Supabase bills monthly active users; each minted child
that signs in counts), table bloat in `learners`/`family_members`, and an unattributable pool
of throwaway identities that can post player_events, feedback, and support messages.

**Blast radius.** Platform-wide but non-privileged. No cross-tenant reach.

**Fix shape (not applied).** Gate create-child (and invite) on the owner's own row being an
active `SSi Family` plan, using the same predicate `index.ts` already computes. Refuse an owner
who is themself a child account. Count removed child rows toward a lifetime ceiling per owner,
or throttle per owner with `codeAttemptThrottle` semantics. Write an audit row per mint, as the
admin minter does.

### SEC0912T-D-02 — MEDIUM — family/invite emails any address on any signed-in caller's say-so

**Where.** `api/family/invite.ts:54-59, 88-133, 170-182`; `api/_utils/familyInviteEmail.ts`
(`safeInviterName`, `renderFamilyInviteEmail`); `packages/player-vue/src/components/SettingsScreen.vue:609`.

**Why.** The recipient is `req.body.email`, the gate is `verifyAuthToken` alone, there is no plan
check and no throttle, and by design a re-post of a live invite re-sends the mail. The subject
line opens with the caller's `display_name`, which the client writes straight to `learners`
through PostgREST and which `safeInviterName` only drops when it looks address-shaped. A name
like "Urgent action is needed on your account" passes and becomes the first words of the
subject of a mail sent from the verified `contact.saysomethingin.app` domain, with a Reply-To a
human reads. `emailValidation.ts` is not on this path: the handler carries its own regex and no
disposable-domain check.

**Attacker and what they get.** Any free account is a relay for unsolicited mail from a
reputable sender to any address, unlimited per address by re-posting, with a caller-chosen
lead sentence. The consequence is deliverability damage to the one domain the sign-in codes
depend on, and a phishing pretext.

**Blast radius.** Outward-facing. The org invite (`sendInviteEmail.ts`) is role-gated; this one is not.

**Fix shape.** Gate on an active Family plan. Throttle per owner and per recipient (the
`possession_mint_attempts` ledger already exists). Cap re-sends. Consider using a fixed subject
with the inviter's name only in the body, or a stricter name filter.

### SEC0912T-D-03 — MEDIUM — the same handler is an account-existence oracle and attaches without consent

**Where.** `api/family/invite.ts:135-152, 197-203`; `api/_utils/familyMembership.ts`
(`attachPendingInvitesForEmail`, `isInAnyLiveFamily`); `api/family/index.ts:86-93`.

**Why.** The response carries `attachedNow`, true exactly when a learner with that verified
email exists and is not already in a family. Any signed-in user can therefore ask "does this
email have an SSi account?" without limit. And when the answer is yes the victim has already
been flipped to `status: 'active'` in the caller's family in the same request. The caller's GET
`/api/family` then shows the victim's `display_name`, and the one-live-family rule means the
victim's real family cannot attach them until the victim finds and presses Leave, which
nothing tells them to do (the mail says "there is nothing to set up").

**Attacker and what they get.** Email-to-account enumeration; the victim's display name from
their email; and a griefing primitive against real families.

**Fix shape.** Do not return the attach outcome, or return it identically in both cases. Attach
an existing account only on the invitee's own next sign-in (the claim fold-in already exists)
or after an explicit accept; at minimum, do not surface the display name until they act.

### SEC0912T-D-04 — LOW — the parent sign-in minter has no volume bound and no audit row

**Where.** `api/family/signin-link.ts:94-104` versus `api/admin/create-signin-link.ts`.

**Why.** The admin minter rate-limits per admin (15 per 15 minutes, failing closed) and writes a
`player_events` row per mint. The parent minter does neither. Ownership and the child-only
ceiling ARE re-verified server-side against the caller's own family (cleared below), so the
reach is confined to the caller's own children, and each new magic link supersedes the last.
This is a missing bound and a missing record, not a reach. Note `is_child_account` is permanent:
a child that later adds a real email and pays remains parent-mintable for life.

**Fix shape.** Mirror the admin minter: a per-owner window and an audit event.

### SEC0912T-D-05 — LOW — a try-link entitlement cannot be revoked; ABC-123 keyspace

**Where.** `api/try-link/validate.ts:75-79, 176-181`; `api/try-link/deactivate.ts:65-68`;
`api/try-link/create.ts:61`; `api/_utils/codeGen.ts`.

**Why.** The token is `{kind:'try', scope:'all', exp}` signed with HMAC; it names no link, so
`deactivate.ts` (which only flips `is_active`) cannot reach any token already minted. A killed
link's visitors keep all-course access for up to 30 days. The code itself is `ABC-123` from 24
consonants and 3 digits (13,824,000 values, about 23.7 bits) where privileged invite codes use
a 128-bit share code; the per-IP throttle at 120 per 15 minutes (AUTH-CORE-03, verified in
place) is what makes that keyspace impractical to sweep, and it is a per-IP bound only.

**Fix shape.** Put the link id (or a per-link `kid`) in the token and have `audioAccess.ts`
check `is_active`; or accept the 30-day tail explicitly. Mint try codes with `generateShareCode`.

### SEC0912T-D-06 — MEDIUM, already-known class (TENANCY-07 residue) — school_admin codes are never bounded

**Where.** `api/invite/create.ts:87` (`validCodeTypes`) versus `:300-301` (`isPrivileged`).

**Why.** `isPrivileged` tests `code_type === 'school_admin_join'`, a value `validCodeTypes` rejects
at line 88, so that clause is dead. The type actually minted is `school_admin`, which redeems to
`educational_role = 'school_admin'` (`api/code/redeem.ts`), and it is inserted with the caller's
`expires_at` and `max_uses` verbatim — both undefined when omitted, i.e. never-expiring and
unlimited-use. The 2026-08-25 reconciliation recorded TENANCY-07 as STILL LIVE for `govt_admin`
and `school_admin_join`; `govt_admin` has since been added to the set, the `school_admin` half has
not. The behavioural test in the test file drives the handler as an ssi_admin and asserts the
inserted row carries neither bound.

**Blast radius.** Callers are govt_admins (for their own subtree) and ssi_admins, so minting is
trusted; the hole is the SSI-GOD-2026 shape at school scope: a leaked code grants school-admin
authority forever to anyone.

**Fix shape.** Add `'school_admin'` to the `isPrivileged` set (one token). Delete the dead
`school_admin_join` clause or add it to `validCodeTypes` deliberately.

### Already-known classes, recurring here (one line each)

- Raw `error.message` in 500 bodies: `try-link/create.ts:103,110`, `list.ts:101`,
  `deactivate.ts:77`. Callers are admins. Same class as `groupsErrorLeakage.security.test.ts`.
- No `applyCors` on `family/leave.ts`, `try-link/list.ts`, `try-link/deactivate.ts`: the native
  shell's preflight for `Authorization` fails there. Functional, not security.

## Checked and cleared

- **signin-link "for whom"** is re-verified server-side: `member_id` from the body is looked up,
  then `owner_learner_id` must equal the caller's resolved learner id, then `is_child_account`
  must be true. Adults get 400, strangers' members get 404, and the email the link is minted for
  comes from `auth.admin.getUserById`, never from the body. Entropy is Supabase's own magic-link
  token.
- **create-child cannot attach to another family**: the owner is always the caller.
- **Child entitlement**: `resolveEffectiveSubscription` grants a member only when the owner's own
  row is active and unexpired and is `SSi Family`, or within the 30-day grace after a scheduled
  change. A Premium owner's children get nothing. Not a free-seat mint.
- **remove.ts** is owner-filtered in the update itself. **leave.ts** finds the row from the JWT's
  learner id, never a body id; the partial unique index guarantees one live row. Neither
  deletes; no orphaned data.
- **Removal revokes cover**: the resolver requires `status = 'active'` and `removed_at IS NULL`.
- **family_members, try_links, try_link_visits**: RLS on, zero policies, `service_role` the only
  grantee in `schema.sql`; the anon-key-in-the-bundle route reads nothing.
- **try-link create/list/deactivate** are admin-only. Links are platform-wide by design, so
  "any admin may deactivate any link" is not an IDOR. `list.ts` returns admin `created_by` uids
  and hashed visitor IPs only.
- **validate.ts** is unauthenticated by design, throttled through the shared ledger, returns a
  fixed error string, and exposes only the admin-authored label. No learner identity or
  progress is reachable through a try-link.
- **Email header injection**: the invite regex bans whitespace, and Resend is a JSON API taking
  `to: [address]`, so CRLF cannot reach a header. The emailed origin is env-only, not the Host
  header. A `+tag` address is treated as a distinct string: it will not attach to an existing
  account and simply consumes a seat.
- **invite/create.ts** takes no email and sends nothing; its tenancy derivations (group from
  the caller's govt_admins row, school from the class row) hold as previously audited.
- **welcome/played.ts** updates only the caller's own row, idempotently.

## Honest gaps

- The magic link's lifetime and single-use property are Supabase project settings (OTP expiry),
  not in this repo; `supabase/config.toml` is absent. Stated as "Supabase default, about an hour"
  in the admin minter's comment, unverified here.
- No live counts: how many child accounts, invites, or try-link visits exist was not read.
- `RESEND_API_KEY` presence in production was not checked; without it the invite send is a
  logged no-op and D-02 is latent.
- Whether Supabase Auth would let a child account change its own email from the client (which
  bears on D-04's lifetime note) was not tested.
