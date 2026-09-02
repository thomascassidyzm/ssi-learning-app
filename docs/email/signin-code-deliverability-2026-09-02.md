# The sign-in code email — rewritten so filters stop eating it

**Date:** 2026-09-02 · **Branch:** `email/signin-code-deliverability` · **Status:** on `dev`, wording awaiting Tom

## Where the template actually lived

Not in this repo. Every sign-in screen called `supabase.auth.signInWithOtp()` straight from the
browser, which mails **Supabase Auth's magic-link template** — configured in the hosted Supabase
dashboard (Authentication → Emails), delivered through Resend as Supabase's custom SMTP. This
estate had customised it down to a branded "Your sign-in code" card: a subject line, six digits,
no link, no plain-text part, no reply path. Confirmed by the 2026-08-05 invite-email work, which
hit the same template from the other side (`docs/orgs/invite-email-link-2026-08-05.md`).

**Who it affects: everyone, one template for all of them.** Seven call sites across six screens —
`SignInModal`, `SchoolsContainer`, `TeachContainer`, `WithTeacher`, `Onboarding`, `RedeemCode`
(send + resend), plus "add an email" in `SettingsScreen` — all hit the same Supabase template, so
learners, teachers, school admins and govt admins were all getting the same six bare digits. There
was no account type with a better email and none with a worse one.

**Two things the dashboard template can never do**, both of which the fix needs: a `text/plain`
alternative, and a `Reply-To`. GoTrue's mailer offers neither as template-level config. That is
what decided the shape of the fix.

## What changed

The mail is ours now, exactly the way invite mail already is (`api/_utils/sendInviteEmail.ts`,
Tom's 2026-08-05 ruling "we use Resend as our email service not Supabase"). Supabase is asked only
for the code:

```
POST /api/auth/send-code
  → supabase.auth.admin.generateLink({ type: 'magiclink', email })   // mints, does NOT send
  → properties.email_otp                                             // the same six digits
  → our own subject/html/text, posted to Resend with a Reply-To
```

The verify side is untouched — `verifyOtp({ type: 'email' })` as before.

Three new files, seven call sites swapped to one helper:

| File | What it is |
|---|---|
| `api/_utils/signInCodeEmail.ts` | the words, HTML and text |
| `api/auth/send-code.ts` | mint + send + throttle |
| `packages/player-vue/src/auth/sendSignInCode.ts` | the client helper, with the fallback |

**It fails soft, always.** Any non-200 from the route — missing `RESEND_API_KEY`, Resend outage,
route not deployed yet — drops straight back to `signInWithOtp`. Worst case is today's uglier
email, never a teacher who cannot sign in. The one refusal honoured rather than retried is a 429,
because laundering a real rate limit into a second send would defeat the limiter.

**The route carries its own throttle** because going around `signInWithOtp` also goes around
GoTrue's own per-address email throttle — without one this would be an open mail faucet pointed at
any address on the internet. Five per address and sixty per network per fifteen minutes, on the
house limiter shape, keyed on the platform-attested IP (`getClientIp`, SEC0901-A-04), in a
`signincode:` hash namespace so its rows can never be counted by the mint or redemption limiters.

## What is deliberately NOT in the mail

- **No magic link.** Microsoft Defender's Safe Links *prefetches* URLs in scanned mail, and a
  prefetched single-use sign-in link is a spent one. A code survives a scanner; a link does not.
  The action link is minted server-side and never leaves the server.
- **No tracking pixel, no shortener, no redirect wrapper.** Each costs deliverability, which is
  the thing being fixed. If open-rate tracking is ever asked for on this mail, the answer is no.
- **No digits in the subject.** A subject that is a bare six-digit string is one of the loudest
  OTP-blast tells. Phone autofill reads the code from the body anyway.

## Language: English, and why not Welsh

The audience skews Welsh schools, and the send path genuinely cannot tell. An Hwb address says the
school is **in Wales**; it does not say the school is **Welsh-medium** — English-medium Welsh
schools sit on the same domains. There is no clean signal to branch on, so per the brief this stays
in English rather than guessing. If a Welsh version is wanted, it is Tom and Aran's copy to write,
and `renderSignInCodeEmail` takes one more argument to carry it.

## What was verified, and what was not

**Verified live against the production Supabase project (2026-09-02):**

- `generateLink({ type: 'magiclink' })` returns `properties.email_otp`, and that code verifies
  through the unchanged client call `verifyOtp({ email, token, type: 'email' })` → real session.
- Minting for an address with **no account creates the account**, so this matches
  `signInWithOtp`'s default `shouldCreateUser: true`. No sign-up path regresses.
- Every probe account created was deleted afterwards.

**Verified locally:** both parts present and equivalent (unit tests assert the code, the recipient
address, the purpose/expiry/not-you/reply lines, exactly one unwrapped link, and the absence of
`<img>`, shorteners and `/auth/v1/verify`); rendering at 390 × 844 on a phone-width viewport.
Gates green: `typecheck:api`, `test:api` (1636), `player-vue typecheck`, `player-vue test` (2923),
`player-vue lint` (0 errors).

**NOT verified — an explicit gap.** There is **no `RESEND_API_KEY` for the SaySomethingin account
on this box**, so no real send from `contact.saysomethingin.app` was possible and there is **no
Authentication-Results line in this report**. (A Resend key found in the estate belongs to a
different project's account and is refused for this domain — checked, 403.) The verification that
still has to happen, by someone holding the key or on the staging deployment:

```bash
curl -sX POST https://staging.saysomethingin.app/api/auth/send-code \
  -H 'Content-Type: application/json' -d '{"email":"<a disposable inbox>"}'
# then in the received message, check:
#   Authentication-Results: … spf=pass … dkim=pass … dmarc=pass
#   Content-Type: multipart/alternative   (both parts present)
#   Reply-To: admin@saysomethingin.com
```

## Still worth worrying about

1. **`admin@saysomethingin.com` needs confirming as a monitored mailbox.** It is the only human
   address evidenced in the repo and the domain has an MX record, but "a person reads them" is a
   promise in the copy. `SIGNIN_EMAIL_REPLY_TO` overrides it without a deploy.
2. **The From address moved off `noreply@`** to `hello@contact.saysomethingin.app` — same
   authenticated domain, so SPF/DKIM are unaffected, but it is a change worth knowing about.
   `SIGNIN_EMAIL_FROM` overrides it.
3. **`RESEND_API_KEY` must exist on the staging and production deployments** or every send silently
   falls back to the old Supabase mail. It is already there for the invite path; worth confirming
   per-environment.
4. **The old Supabase template stays as the fallback.** It should not be deleted — but it also
   should not be edited on the assumption that it is what learners see, because after this it
   mostly is not.
5. **DMARC.** SPF and DKIM pass. Whether `saysomethingin.app` publishes a DMARC record with a
   policy — and alignment on the `contact.` subdomain — is worth a check; Microsoft weighs it.
6. **Content scoring is a hypothesis, well-supported but not proven.** The proof is the Hwb
   completion rate after this ships. Worth re-running the census a fortnight after promotion.
