# The org invite email now carries the link — evidence

**Reported:** Deborah, staging `/orgs`, 2026-08-05 — an org admin invites a learner, the app says
sent, and the email holds only a 6-digit sign-in code with nothing to click.
**Ruling:** the invite email must carry THE LINK; clicking it from the email lands the learner
signed in and enrolled, no code entry.
**Status:** fixed, merged to `dev`, verified live end-to-end on the dev deployment.

## What was actually wrong

Not a template we forgot to write — the wrong Supabase template was being sent.

`sendInviteEmail` sent via `auth.signInWithOtp`, which mails this project's **magic-link**
template. That template has been customised down to a branded "Your sign-in code" card: six
digits, no `href` anywhere. So the invitee got a code with nowhere to type it, and the link stayed
stuck in the org dashboard.

Verified by mailing a real inbox from the live project and reading both bodies:

| Call | Subject | Body |
|---|---|---|
| `signInWithOtp` | "Your SaySomethingin app login code" | `222816` — no link |
| `admin.inviteUserByEmail` | "You have been invited" | "Accept the invite" + a real `<a href>` |

Following that href returns `303 → <joinUrl>#access_token=…&type=invite` — the person lands on
their own join link already signed in.

## The fix

`api/_utils/sendInviteEmail.ts` now sends the **invite** template
(`auth.admin.inviteUserByEmail(email, { redirectTo: joinUrl })`). Same Supabase Auth sender
(`noreply@contact.saysomethingin.app`), same project — just the stock template that carries a link
instead of the one that carries a code. No new email infrastructure.

Two constraints, both verified live and handled:

1. **`inviteUserByEmail` mails a new or still-unconfirmed account only.** A personal-link persona
   is created with `email_confirm: false`, so mint, "Email again" and "Re-mint" all qualify —
   until the person actually clicks, which confirms them. After that Supabase answers "already
   been registered" and we fall back to the code mail so their inbox isn't empty. The response
   carries `via: 'link' | 'code'` and both dashboard surfaces now say plainly which went out.
2. **Supabase silently swaps any `redirectTo` outside its allow-list for the Site URL.** Only
   `https://saysomethingin.app` is allow-listed today — a staging redirect came back as the
   production root. So an emailed link always points at production. dev/staging/prod share one
   database, so a code minted on staging redeems on production unchanged.

## Live acceptance test

A real invite driven through the deployed API as a real org leader, into a disposable inbox — not
a mock:

```
POST /api/groups/<id>/invites  → 201 {"code":"XEE-537", …,
                                      "emailed":{"sent":true,"to":"…","via":"link"}}
email subject: "You have been invited"
link in body:  …/auth/v1/verify?token=…&type=invite&redirect_to=https://saysomethingin.app/redeem/XEE-537
follow →       303 https://saysomethingin.app/redeem/XEE-537#access_token=…&type=invite

ACCEPTANCE: link present = true | signs in = true | lands on the join link = true
```

Run against the stable dev URL `ssi-learning-app-git-dev-zenjin.vercel.app` and against the
per-commit build of the merge. Before the fix, the same harness on the same URL produced
"Your SaySomethingin app login code / 222816 / no link" — the bug reproduced live, then closed.
Every account, org and code the test created was deleted afterwards.

## The two things outside this repo

Neither blocks the fix; both are one-line config if wanted.

1. **Promotion.** The fix is on `dev`. `dev → staging` is a deliberate manual promotion, so
   Deborah's own staging environment does not have it until that promotion runs.
2. **Staging-local links.** After promotion, an invite minted on staging emails a link that works
   but lands the learner on **production**. To keep staging invites on staging: add
   `https://staging.saysomethingin.app/**` to Supabase → Auth → URL Configuration → Redirect URLs,
   and set `INVITE_EMAIL_ORIGIN=https://staging.saysomethingin.app` on the staging deployment. The
   code already reads that variable.

## Known limit, unchanged

The mail's wording is Supabase's stock invite copy — "You have been invited to create a user on
https://saysomethingin.app" — not "Deborah invited you to join X". Making it read like a true
invitation means either editing that template in the Supabase dashboard or a transactional sender,
both outside this repo.
