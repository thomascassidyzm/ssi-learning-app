# The org invite email is ours now — branded, sent by Resend

**Ruling:** Tom, 2026-08-05 — "we use Resend as our email service not Supabase".
**What it closes:** the known limit left open by the previous fix — the mail carried a link, but wore
Supabase's stock copy: *"You have been invited to create a user on https://saysomethingin.app"*,
naming neither the person inviting nor the thing being joined.
**Status:** live in **production**, with the copy ruled down to one fixed sentence from no-one. Tom ruled 2026-08-05 that this goes straight to main — admin
tooling, not player code — so it was carried there as a scoped cherry-pick and is now on all three
branches. Verified end to end on each.

## What the invitee gets now

Read from a real disposable inbox, not asserted from the code:

```
From:    SaySomethingin <noreply@contact.saysomethingin.app>
Subject: You've been invited to try SaySomethingin

You've been invited to try SaySomethingin — please click to activate your account.

[ Activate your account ]

One tap and you're in — there's no code to type and no password to set.
```

Following the button: `303 → https://saysomethingin.app/redeem/UKP-610#access_token=…` — signed in,
on their own join link, zero code entry.

## The copy comes from no-one, deliberately

Tom's ruling: *"it shouldn't come from Deborah, it should come from whoever is the person inviting
them - from their own org - whoever's logged in at the time OR just no-one … as simple as
possible."*

It was never hardcoded to Deborah — she was the test case, and the first cut already named whoever
was logged in, with their own org. But that branch turned out to be exactly the hassle the ruling
anticipated: the caller's `learners` row, a second admin lookup for their email, and a guard against
the auth trigger that seeds `display_name` from the email's local part — two lookups per send and a
leak to police, for a name the invitee may not even recognise.

So the second branch won on his own terms, and the change **deletes** rather than adds:
`renderInviteEmail` takes the URL and nothing else, `sendInviteEmail` takes no inviter/org context,
and `invites.ts` resolves no names at all. Nothing personal is left that could be blank, stale,
wrong, or quietly lifted from somebody's address. The sentence is his, verbatim.

## How it works

Supabase is asked only for the **link**, never for a mail. `auth.admin.generateLink({ type:
'magiclink', email, options: { redirectTo } })` mints a sign-in URL and sends nothing. We wrap that
URL in our own HTML + plain-text invitation (`api/_utils/inviteEmailTemplate.ts`) and post it to the
Resend API from `noreply@contact.saysomethingin.app` — the same address the invitee already saw, on
a domain that was already verified in Resend. No Supabase template is in the loop at any point,
which is exactly what makes the words ours.

Nothing else is looked up. The mail takes the minted URL and nothing more.

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

A real invite driven through the deployed API as a real org leader, into a real disposable inbox —
run separately against **dev, production and staging**, all four checks true on each:

```
POST /api/groups/<id>/invites  → 201 {"code":"UKP-610", …,
                                      "emailed":{"sent":true,"to":"…","via":"link"}}
subject: "You've been invited to try SaySomethingin"
link:    …/auth/v1/verify?token=…&type=magiclink&redirect_to=https://saysomethingin.app/redeem/UKP-610
follow → 303 https://saysomethingin.app/redeem/UKP-610#access_token=…

ACCEPTANCE: link present = true | signs in = true | zero code entry = true | names nobody = true
```

Every account, org row and code each test created was deleted afterwards. No real learner or org
contact was mailed at any point.

### Why it went to main as a cherry-pick, not a merge

`dev` was 118 commits ahead of `main`, carrying player, course-boundary and telemetry work. Merging
the branch would have put all of that into production on a ruling whose whole premise was "admin
tooling, not player code". So the invite chain alone was cherry-picked — ten files, none of them
player code — and the same chain was back-merged to `staging`, which is where the bug was reported
and which would otherwise be the one environment still running the broken send.

## One defect the live test caught — and why it settled the copy

The first live run signed the mail *"ssi-leader-1785970197 invited you to join…"*. Creating an auth
account fires a trigger that seeds `learners.display_name` from the **email's local part** — so a
leader who never set a name carries one that is a fragment of their own address, and signing an
invitation with it put that fragment in a test inbox.

It was fixed with a guard, and then the guard was deleted along with the rest of the name plumbing
when the copy went to one fixed sentence. That is the honest argument for the simpler copy: the
name was never free, and this is the class of thing it kept costing.

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
