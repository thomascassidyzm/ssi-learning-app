# The org invite email is ours now — branded, sent by Resend

**Ruling:** Tom, 2026-08-05 — "we use Resend as our email service not Supabase".
**What it closes:** the known limit left open by the previous fix — the mail carried a link, but wore
Supabase's stock copy: *"You have been invited to create a user on https://saysomethingin.app"*,
naming neither the person inviting nor the thing being joined.
**Status:** landed on `dev`, verified live end-to-end on the dev deployment.

## What the invitee gets now

Read from a real disposable inbox, not asserted from the code:

```
From:    SaySomethingin <noreply@contact.saysomethingin.app>
Subject: Deborah invited you to join Pilot Districts Region

Deborah has invited you to join Pilot Districts Region on SaySomethingin.

[ Accept the invitation ]

One tap and you're in — there's no code to type and no password to set.
```

Following the button: `303 → https://saysomethingin.app/redeem/KQM-678#access_token=…` — signed in,
on their own join link, zero code entry.

## How it works

Supabase is asked only for the **link**, never for a mail. `auth.admin.generateLink({ type:
'magiclink', email, options: { redirectTo } })` mints a sign-in URL and sends nothing. We wrap that
URL in our own HTML + plain-text invitation (`api/_utils/inviteEmailTemplate.ts`) and post it to the
Resend API from `noreply@contact.saysomethingin.app` — the same address the invitee already saw, on
a domain that was already verified in Resend. No Supabase template is in the loop at any point,
which is exactly what makes the words ours.

The two names that turn a notification into an invitation are resolved server-side and threaded in:
the inviter from `learners.display_name` of the caller, the org from **the link's grant target** — a
class link says its school, because a class name alone tells the invitee little, and the node the
admin happens to be standing on may not be where the link actually leads.

## The 6-digit fallback is retired

The previous cut had to keep it: `inviteUserByEmail` mails a new or still-unconfirmed account only,
so once the person clicked once, Supabase refused and we sent the code mail instead. Verified live
that `generateLink({type:'magiclink'})` has no such limit — it resolves for **both** a still-
unconfirmed persona and one who has already clicked, signing them in and confirming the account in
the same hop. One link type covers every state, so there is no already-registered branch and nothing
to fall back to: every invitee always gets something clickable, and a genuine failure is reported
loudly instead of being papered over with a code.

`via: 'code'` survives in the response shape for one reason only — see the degradation below.

## Live acceptance

A real invite driven through the deployed dev API as a real org leader, into a real inbox:

```
POST /api/groups/<id>/invites  → 201 {"code":"KQM-678", …,
                                      "emailed":{"sent":true,"to":"…","via":"link"}}
subject: "Deborah invited you to join Pilot Districts Region"
link:    …/auth/v1/verify?token=…&type=magiclink&redirect_to=https://saysomethingin.app/redeem/KQM-678
follow → 303 https://saysomethingin.app/redeem/KQM-678#access_token=…

ACCEPTANCE: link present = true | names inviter + org = true | signs in = true | zero code entry = true
```

Every account, org row and code the test created was deleted afterwards.

## One defect the live test caught

The first live run signed the mail *"ssi-leader-1785970197 invited you to join…"*. Creating an auth
account fires a trigger that seeds `learners.display_name` from the **email's local part** — so a
leader who never set a name carries one that is a fragment of their own address, and signing an
invitation with it would put that fragment in a stranger's inbox.

Fixed by dropping the display name when it is exactly the caller's own email local part. Verified
live in both directions: a named leader gets *"Deborah invited you to join Pilot Districts Region"*;
an unnamed one gets *"You've been invited to join Pilot Districts Region"*. Never a blank, never an
address, never "undefined".

## Things worth knowing

- **The emailed link points at production, by design.** Supabase silently swaps any `redirectTo`
  outside its allow-list for the Site URL, and only `https://saysomethingin.app` is on that list.
  This binds `generateLink` exactly as it bound `inviteUserByEmail` — the constraint lives on
  Supabase's side, not the mailer's (re-verified). dev/staging/prod share one database, so a
  staging-minted code redeems on production unchanged. This is not a bug; please don't re-report it.
  To keep staging invites on staging: add `https://staging.saysomethingin.app/**` to Supabase → Auth
  → URL Configuration, and set `INVITE_EMAIL_ORIGIN` on that deployment.
- **A missing key degrades, never fails.** Without `RESEND_API_KEY` the sender falls back to the
  previous Supabase path (stock copy, but still a real link, and then the code mail) rather than to
  silence — so the secret going missing can never cost an invite.
- **The copyable fallback line is the long Supabase verify URL**, not the pretty `/redeem/XXX` one.
  It has to be: that is the URL that signs them in. The pretty one would ask them to prove who they
  are.

## Wiring

- `RESEND_API_KEY` — a dedicated Resend key named `ssi-learning-app`, scoped to *sending only* on
  `contact.saysomethingin.app`, set on the `ssi-learning-app` Vercel project for **production** and
  **preview**. (Vercel refuses sensitive variables on the `development` target; that only affects
  local `vercel dev`, which falls back to the Supabase path.)
- `INVITE_EMAIL_FROM` — optional override, defaults to
  `SaySomethingin <noreply@contact.saysomethingin.app>`.
