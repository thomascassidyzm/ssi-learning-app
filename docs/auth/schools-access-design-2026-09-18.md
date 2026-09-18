# Schools access: the failure catalogue, what class-leading looks like, and the proposed design

2026-09-18, job #188. Design only. Tom's instruction at 10:18: "Let us not be hasty. Let us create a
bullet-proof, class-leading solution for this issue and other issues that might be similar." Nothing
in this document is built unless Tom says so. The code written earlier today sits on branch
`cs/188-schools-setup-signup-proper-fix` and is described in section 6; it was merged to dev and
staging before the change of mode arrived and has been reverted from both.

Evidence used: job #186's two production reads of 18 September (the supersession proof and the
wizard spec), job #189's route census of the same morning, the 2 September write-ups on entry and
return without email, the 5 September pre-hijacking fix, the SEC0905 Area A audit, the OTP domain
census of 2 September, the domain-identity design record of 8 September and the belonging design of
9 September. No production query was run for this document.

---

## 1. The failure catalogue

Every way a teacher on a school network fails to get in, or back in, today. Each entry names the
evidence, what the product does now, and who can rescue the person. "Nobody" appears more often than
it should.

| # | Failure | Evidence | What happens today | Who can rescue |
|---|---|---|---|---|
| F1 | **Eaten mail.** The gateway quarantines our code; nothing bounces. | 81 shells that asked for a code and never got in, one in five of all accounts, 2 Sept. Hwb completion 40-45% against 94% elsewhere. | Teacher waits on an inbox that will never deliver. The account already exists, unconfirmed. | A school admin, if the teacher is already on the Teachers page. Otherwise SSi, by a one-hour link minted while the teacher is at the keyboard. |
| F2 | **Delayed mail.** The code arrives, minutes late. | Resend webhooks since 7 Sept show Hwb delivery in 2 seconds, so the delay is in the tenant, not at Resend. | The teacher assumes it is lost and taps Resend, which is F3. | Nobody needs to; the fix is the copy and the cooldown. |
| F3 | **Resend supersession.** Supabase keeps one pending code; a second request cancels the first, and the refusal reads the same as a timed-out code. | Proved live: code A minted, code B two seconds later, A refused `otp_expired`. Since 1 Sept 109 addresses asked, 33 more than once, 22 re-requests inside two minutes. One head: four sends in nine minutes, five failed verifies, eight days. Chepstow: five sends in ninety seconds. | "Token has expired or is invalid." Resend re-enables in about a second. | Nobody is needed if they stop tapping; nothing tells them to. |
| F4 | **Shells refused by the 5 Sept fix.** An invite link refuses any address that already has an account, confirmed or not. | `shellClaim.ts`, in its own words: the eaten-OTP teacher and the pre-hijacking attacker "are the SAME SHAPE and cannot be told apart from the row". | The teacher who once asked for a code cannot use their school's link either: 409, "sign in instead", which points back at the mail. | A school admin's access code, if the teacher is already a member. For a brand-new school there is no admin yet, so nobody. |
| F5 | **No password set.** Nothing ever asks for one; the prompt is dismissible and only on one page. | #189: the teachers failing this week all got in once by code and never set a password. | Every return visit, new device or cleared browser drops them onto the code path, which is F1 to F3 again. | Themselves, if they find Settings. |
| F6 | **A self-serve school with nobody to rescue anyone.** The `/schools1` door is code-only. | The 2 Sept write-up named this as "the gap I did not close". #186: "the sanctioned rescue is a school admin's access code, which a brand-new self-serve school does not have anybody to issue." | The founding head is the only person who could issue rescues and is the one locked out. | SSi only. |
| F7 | **Duplicate schools.** | Ysgol Gyfun Tredegar exists twice, 4 Sept and 10 Sept, two teachers in both; Rogiet Primary twice, same person, an hour apart on two addresses. | Two rosters, two trials, classes split across them. No merge exists. | Nobody; "merging schools is not something a link can do". |
| F8 | **Duplicate accounts for one person.** | Sarah: four accounts in seven minutes, three on mistyped consortium domains. `hughesr310@hhwbcymru.net` beside `hwbcymru.net`. | Each address is a separate identity; the wrong ones sit as shells for ever. | Nobody; no link between them is recorded. |
| F9 | **Wrong-domain typos.** | `philipwoods@chepstowschool.n`, truncated; `aggletona5@monmouthshireschools.wales`, wrong tenant. | A code is sent to a mailbox that cannot exist. The door accepts any well-formed address. | The person, if they notice. Nothing suggests the correct domain. |
| F10 | **Invite links refuse the legitimate owner.** | #189, door B and C: "if an account already exists for that address, the link stops". | A teacher who is exactly who the link is for is turned away because they once asked for a code. | Admin access code, members only; else SSi. |
| F11 | **Rescue codes are members-only.** | `staff-signin-link.ts` answers "That person is not a member of your school". | The six people in #189's group C belong to no school and no admin can mint for them. | SSi only. |
| F12 | **The SSi rescue is a one-hour magic link.** | #189 §3: "it has to be minted while the person is at their keyboard". | Two taps while SSi is on the phone. Does not scale past one coordinator's patience. | SSi, synchronously. |
| F13 | **Session death on return.** New laptop, cleared storage, phone reset. | The 2 Sept return-route write-up: "there is no way back into the organisation they just built". | Without a password, F1 to F3. | See F5. |
| F14 | **The verdict sentence.** | "Token has expired or is invalid" on every failure class. | True, and useless: it names no cause and no way on. | Copy. |
| F15 | **Provision refusals worded as walls.** | `provision.ts` 409s: "this email has already used its one free school trial". Not what Sarah's teacher saw, per #186, but the same family. | A returning head reads a rejection where "welcome back" was meant. | Copy and idempotence. |

Two things the catalogue rules out, so nobody chases them again: Safe Links, because our mail
carries no link; and case, because the check is case-insensitive, proved live.

One unexplained row remains: a Hwb head's auth row was touched at 09:20:18Z today with no
`send-code` attempt row beside it. This session ran nothing against production before 10:24 and
nothing against that address at all; the touch is either the Supabase fallback in
`sendSignInCode.ts` or another worker's admin mint, and `auth` internals are not readable through
PostgREST to say which.

---

## 2. What class-leading looks like

How the products school staff already use handle first entry, return, rescue and school identity on
locked-down networks. Specifics are from each vendor's own help centre; where a page refused to be
read the search summary is what is quoted.

**Google Classroom.** Identity is the school's Workspace account, never a mailbox we send to. A person
who says "I am a teacher" is put into a pending Classroom Teachers group and a Workspace admin
approves them; until approved they cannot create classes. Pupils join by class code or invite link,
with domain allow-lists controlling who may use a code. Return is the school's own sign-in. Rescue is
the school's IT. The lesson: the school vouches for the teacher, in an admin console, not the email.

**ClassDojo.** A teacher verifies their email, then becomes "school-approved" either by requesting to
join the school and waiting for a Mentor or School Leader to approve them in the app, or by signing
up on the school's registered domain. When the verification or reset mail is blocked, the help centre
tells the teacher to have IT unblock the sender and, failing that, to file a support form "so the
support team can help release any blocks". The lesson: the approval is in-product and done by a named
colleague; the email is a secondary proof with a human fallback.

**Seesaw.** An admin sets the school up, adds trusted email domains, and adds teachers and admins to
the dashboard. Teachers verify an address and attach to a school. Pupils sign in by QR class code or
text class code with no email at all, and pupils on email or SSO join with an 8-digit code that
expires after a week. The lesson: short, typeable, time-boxed codes for joining; admin-managed staff;
and a pupil path that never touches mail.

**Tapestry.** No self-serve at all. A manager creates every staff account and activates it; a staff
member who cannot log in is told to "contact the person who set up your account", and a manager can
reset the password or reactivate the account from inside the product. The lesson: the person who
knows you is the person who lets you back in, and the product gives them the button.

**Arbor.** Staff sign in with a password or with Microsoft or Google single sign-on tied to the
school's tenant, optionally with two-factor. An administrator with the right permission sends a reset
link from the staff profile. The lesson: SSO where the school has it, and an admin-side reset that does
not depend on the staff member's own inbox behaving.

**Bromcom.** Password reset by school ID plus email, or an administrator's "Send Reset Password Link"
button on the user record; SSO is activated per user by an admin. The lesson: the same as Arbor.

**The pattern, stated once.** Every one of these products does five things SSi does not yet do
consistently: the school's own administrator is the authority on who belongs, in the product; a
durable credential exists from the first day, a password or the school's SSO; codes are short,
typeable, time-boxed and single-purpose; approval and rescue are buttons the admin holds; and nothing
a teacher needs on day one waits on an email arriving. Where SSi is different is the reason it cannot
copy any of them wholesale: SSi's schools find it cold, the first person in has no admin above them,
and Tom has ruled out Microsoft and Hwb SSO as "a headache and not one we want to subscribe to". So
the design below takes the pattern and supplies the missing first admin ourselves.

---

## 3. The proposed design

Seven principles, then the surfaces, then what each failure becomes.

**Principles.**
1. A door, not a test. Every screen either lets the person in or offers a route that will, and no
   route is "email support" as a terminal sentence.
2. One durable credential from the first entry. A password is set as the default first step on any
   schools landing, and gated on a leader's first write, exactly as the org lane already does.
3. Mailbox proof is background. It upgrades an account; it never gates one. The reading of "unproven"
   is `onboarded_via` plus `email_confirmed_manually`, which already exists.
4. The school's admin is the authority on belonging, in the dashboard. Adopt the belonging design of
   9 September: membership is the admin's act, named seats let the admin vouch before arrival, and the
   domain match becomes a sort hint.
5. Every unproven mint is revocable by the mailbox owner. This is the rule that lets the door open
   safely, and section 4 is about it.
6. One account per person. The door guards against typos and the tooling can link and merge.
7. Idempotent everything. Provision, verify and redeem can be called twice with the same answer.

**First entry, self-serve school.** Pick a language, type an address, tap once. The server mints the
session with no code, provisions the school, and lands the head in the dashboard. The password form
opens immediately as the first step. A strip at the top takes the six-digit code whenever it lands,
and offers a fresh code, a different address, or Later. The founding admin's domain is claimed only
when the mailbox is proved. A school whose founder never proves a mailbox or sets a password stays
fully usable and is marked "unvouched" to SSi tooling only.

**First entry, invited teacher.** The one-tap link stays. Two changes. Named seats: the admin types
a name and hands over an 8-character code, and the person who spends it arrives vouched, on any
address or none. And an existing-account arrival is never a wall: a shell with no sign-ins and no
password is adopted and stamped revocable; an account with a heartbeat is offered password sign-in, a
code to this address, or an admin code, in that order.

**Return sign-in.** Password first. Underneath: "No password yet? Email me a code instead", then the
admin access code. A failed password names the likely cause. The code step cools Resend for sixty
seconds, states that a new request cancels the code on its way, and on failure says a superseded code
has been replaced rather than calling it invalid. Verify checks for a live session before showing red.

**Rescue routes that need no inbox.** Three, in order of who holds the button. The school admin mints
an access code for a member, as today, and for a named seat that is not yet filled. A regional
coordinator holding a group seat mints codes for the heads of the schools below her, which reuses
`staff-signin-link.ts` with a group scope. SSi mints a 48-hour typeable code rather than a one-hour
link, so it can be sent ahead by any channel instead of minted live on the phone.

**School identity, join and claim.** A second head arriving from a claimed domain is a join request
to that school's admin, shown on the admin's Teachers page and by courtesy mail, with one tap to
approve; the confirm-shared-domain path stays for a genuinely different school. Claims are written on
proof only. The shared-tenant rule stays. Duplicate-school detection at naming: a school being named
the same as one already in the same region asks "join it instead?" before creating a second.

**Admin tooling.** For SSi: a person timeline on `/intel/person` built from the two audit streams that
already exist, `possession_mint_attempts` and `player_events.login_code_failed`, so "it told me my
code was wrong" is one lookup; a merge-schools action with before-state written to `tools/`; a
link-accounts action that records the typo rows as aliases of the real one; and the 48-hour code. For
school leads: the Teachers page gains named seats and join-request approval. For coordinators: the
same Teachers page, scoped to a group.

**The door's typo guard.** Before sending anything, an address whose domain is within one edit of a
tenant we already serve, derived from live data as the shared-tenant rule already is, gets "did you
mean hwbcymru.net?" A truncated domain with no dot after the at-sign is refused with the same
question. This is the cheapest fix in the document and closes F9 outright.

**Hosted config, flagged not assumed.** The GoTrue code lifetime should be raised to 24 hours, which
removes the "expired" half of F3 for a queued mail server. It is dashboard configuration this repo
cannot read or set, so it is a task for whoever holds the dashboard, not a code increment.

**What each failure becomes.**

| # | Under the design |
|---|---|
| F1 | Nobody waits on mail to get in: self-serve mints without it, invited teachers arrive on the link or a named code. The eaten mail costs a background banner, nothing else. |
| F2 | The code lands when it lands; the banner takes it. With the 24-hour lifetime, a queued server no longer expires it. |
| F3 | Resend is cooled and says the consequence; a superseded code is named as superseded. |
| F4 | A no-sign-in shell is adopted and stamped revocable; the legitimate owner is never told to go and read mail. |
| F5 | The password is the default first step and the gate on a leader's first write. |
| F6 | The founding head is in on the first tap and has a password before she leaves; if she loses the session anyway, the coordinator or SSi mints a 48-hour code. |
| F7 | Detected at naming; merged by SSi tooling with provenance when it still happens. |
| F8 | Typo guard at the door; alias linking in tooling for the rows that already exist. |
| F9 | Typo guard. |
| F10 | Existing-account arrival offers three ways in, never one wall. |
| F11 | Named seats and coordinator scope let an admin mint for a person who is not yet a member. |
| F12 | The SSi code is typeable and lasts 48 hours. |
| F13 | A password exists, so a new device is a password sign-in. |
| F14 | Retired. Every failure sentence names a cause and a way on. |
| F15 | Provision stays idempotent and the door reads `existing:true` as "welcome back". |

---

## 4. The security argument, addressed to the 5 September fix

The 5 September rule is: an invite may only bind an account shell that this invite's own flow created,
because an untouched shell and a pre-hijacking attacker's shell are the same shape. That rule was
right for the world it was written in, where a session on a shell was a durable, unrevokable
credential and the only signal available was the row's shape. The design changes both facts, and the
argument is that it closes the CWE-1188 chain more completely than refusal does, while reopening the
rescue refusal took away.

**The chain, step by step, under the design.**
1. Attacker asks for a code, or walks up to the self-serve door, with a victim's school address. A
   shell exists, or a session is minted. Either way the mint is stamped `unclaimed_mint` in
   `app_metadata`, service-role-only, naming the minting path and the session id, and the account is
   read as unproven everywhere.
2. What the attacker holds is a session that grants nothing a link did not grant. A shared student
   join code grants a pupil role. The self-serve door grants a school called "My school" with no
   pupils, no domain claim and no vouch. Neither reaches any child's data.
3. The victim arrives by any route that proves the mailbox or carries the admin's vouch: a code
   received at the address, a named-seat code, an admin access code. That arrival is from a different
   session, so `claimShape` answers `ask`; the victim is shown one card, says "not me", and every
   session, refresh token and password on the account dies. The attacker's foothold is gone before
   the victim has seen the dashboard. Nothing the attacker can do from inside the account clears the
   marker, because `user_metadata` cannot write `app_metadata`.
4. The attacker cannot get in first by proving the mailbox, because they do not hold it; cannot plant
   a password that survives, because the sweep destroys it; cannot claim the domain, because claims
   are written on proof only; and cannot be vouched, because the vouch is the admin's act on a named
   seat or class assignment, in the dashboard.

**Why refusal was weaker.** Refusing the shell left the attacker's alternative open: mint a fresh
account on any address that had never asked, which possession-redeem permits today for any typed
address. The shell rule protected only addresses that had already been touched, and it did so by
locking out the real owner. Revocability protects every address, touched or not, by making the mint
worthless the moment the owner appears.

**What is kept from SEC0905 Area A.** A-04's entropy and throttling on access codes, A-05's
platform-attested IP source and A-06's atomic single-use claim are reused unchanged by named seats and
the 48-hour code; the new code is the same `staff_access_codes` shape. A-01's containment resolver,
`schoolMembershipsOf`, is the one place scope is answered for coordinator minting too. A-03, the
missing migration for `staff_access_codes`, is added in the first increment that touches the table.
The staged PostgREST session guard from the 8 September record is what makes a revoked token stop
reading rows before its `exp`; it remains Tom's call and the design does not depend on it for the
argument above, only for how fast the eviction takes effect.

**What the design does not do.** It does not adopt an account that has ever signed in or set a
password without the mailbox owner's or the admin's act. It does not write a domain claim, a vouch or
a `verified_emails` entry at any door. It does not make a session on a typed address into membership
of anything. And it does not require SSO.

---

## 5. The build plan, in increments

Each increment ships on its own and is named by the failures it closes.

**Increment 1, the smallest that would have saved Sarah's schools this week.** Resend cooldown and
supersession copy on every code screen, F3 and F14. Password first on `/schools` return sign-in and the
password form as the default first step on entry, F5 and F13. The self-serve door minting without a
code, with the mailbox banner and claims deferred to proof, F1, F2 and F6 at the door. This is exactly
what is on the branch today, tests seen red before and green after, and walked live on staging before
it was reverted. It does not touch invite links or the shell rule.

**Increment 2, rescue without an inbox.** Named seats on the Teachers page; coordinator scope for a
group seat; the 48-hour typeable SSi code replacing the one-hour link. F4 in practice, F6 in full, F10,
F11, F12. Adds the `staff_access_codes` migration, closing SEC0905-A-03.

**Increment 3, belonging and identity.** Membership is the admin's assignment; join request replaces
the domain wall; the domain match becomes a sort hint; shell adoption on the invite path becomes
revocable-mint adoption under section 4. F4 in full, F7 at the door, F10 in full. Retires the arrival
attestation in `user_metadata`.

**Increment 4, the door's guards.** Typo guard against known tenants; duplicate-school prompt at naming.
F7, F8, F9 for every future arrival.

**Increment 5, SSi tooling.** Person timeline from the two audit streams; merge schools with recorded
before-state; link alias accounts. F7 and F8 for the rows that already exist, and the "which code did
it refuse" question answered in one lookup.

**Outside the repo.** Raise the hosted OTP lifetime to 24 hours, F2's tail.

Increments 2 to 5 are independent of each other once 1 has landed; 3 is the one that changes the
5 September rule and should be reviewed against section 4 as a security change in its own right.

---

## 6. What is already written, on the branch and nowhere else

Branch `cs/188-schools-setup-signup-proper-fix`, five commits, not on dev, not on staging, not on
main. Merges to dev and staging made before the 10:18 change of mode were reverted; dev's `api` and
`src` trees are byte-identical to the pre-#188 head.

- `api/auth/setup-mint.ts` and its test: the self-serve mint, shell adoption, confirmed-account refusal,
  unclaimed-mint stamp with provenance `setup_door`, throttles.
- `api/_utils/mailboxProof.ts`; `provision.ts` deferring the domain claim; `api/email/verify.ts` writing
  it on proof; `unclaimedMint.ts` naming `setup_door` contestable; a test that goes red on the pre-fix
  provision.
- `Onboarding.vue`: the school door mints then provisions; `existing:true` reads as welcome back.
- `components/schools/MailboxBanner.vue` in the shell, with its Handbook entry and coverage line.
- `auth/codeSupersession.ts` and `composables/useResendCooldown.ts`, wired into the schools sign-in,
  the door, the sign-in modal and the banner; `SchoolsContainer` leading with the password;
  `SchoolsPasswordPrompt` opening itself on first entry, moved into the shell.
- The e2e proof rewritten for the no-code door; the APML principle; the decision-journal entry.

Proved live on staging before the revert, with two probe accounts since deleted: mint 200, provision
200, landing on the school with no code screen, banner shown, verify 200 flipping the flags, and a
confirmed address refused with `existing:true`.
