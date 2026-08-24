# School email deliverability — investigation + options (2026-07-15)

**Trigger:** angharadjones@chepstowschool.net — invite redemption started, Supabase generated an
OTP twice (auth flow itself worked), neither email arrived. This is not a one-off: it's structural,
and it blocks the entire teacher-onboarding path for any school whose mail gateway is hostile to our
sender (a common Microsoft/Exchange Online default for education tenants).

---

## 1. What's actually sending the mail

**No custom SMTP is configured in this repo.** There is no `supabase/config.toml` `[auth.email.smtp]`
block, no SMTP host/user/pass in `.env` / `.env.local` / `packages/player-vue/.env`, and no
Postmark/SES/SendGrid/Mailgun/Resend reference anywhere in the codebase outside unrelated docs. The
project also has no local Supabase CLI link with management-API access from this environment, so I
can't read the Dashboard's Auth → SMTP Settings screen directly — **that screen is the one
authoritative source and should be checked first** (Project Settings → Authentication → Emails →
SMTP Settings). But every piece of repo evidence points the same way: **this project is very likely
still on Supabase's built-in default email service**, not a custom sender.

Confirmed live by DNS probe (`dig`) against Supabase's own sending infrastructure:

```
mail.app.supabase.io   TXT   "v=spf1 include:amazonses.com ~all"     ← default GoTrue mail = AWS SES, shared pool
app.supabase.io        DMARC "v=DMARC1; p=reject; pct=100; ri=86400;"
supabase.io            DMARC "v=DMARC1; p=reject; pct=100; ri=86400;"
```

What a school's Microsoft/Exchange Online gateway sees when this fires:
- **Sender domain**: `mail.app.supabase.io` — a shared, multi-tenant, third-party domain that
  thousands of unrelated Supabase projects (some spammy, some not) all send through. It has no
  reputation tied specifically to SaySomethingIn.
- **SPF**: passes (aligned to `amazonses.com`'s SES infra) — technically valid, but alignment to a
  shared sender doesn't buy sender-specific trust.
- **DMARC**: the org-level `supabase.io`/`app.supabase.io` policy is `p=reject`, so technically
  compliant mail *can* pass DMARC — but Microsoft's EOP (Exchange Online Protection) layers its own
  reputation/heuristic scoring on top of pure auth-pass/fail, and a **shared, third-party, high
  fan-out sending domain is exactly the profile EOP quarantines by default for education tenants**,
  regardless of clean SPF/DMARC. This matches Supabase's own guidance that the built-in email service
  is meant for development, not production, precisely because of shared-pool reputation.
- **No sender-specific domain reputation exists at all** — nothing under `saysomethingin.com` or
  `saysomethingin.app` is in the sending path, so we get zero benefit from our own domain's standing.

**Bottom line:** the deliverability problem is not a bug in our code — every OTP call succeeds
against Supabase's Auth API exactly as designed. It's that the *transport* is a low-trust shared pool
with no way for us (or the teacher) to fix it downstream. A teacher literally cannot whitelist
"Supabase" — the sending domain isn't ours and isn't stable/nameable to an IT admin.

---

## 2. Auth flows that require email receipt (code map)

**Every entry surface in the app funnels through the same one root dependency** — Supabase's
`signInWithOtp` / `verifyOtp` pair. There are four call sites, not four independent problems:

| Surface | File | What it does |
|---|---|---|
| Invite/join-code redemption | `packages/player-vue/src/views/RedeemCode.vue` (`handleSendOtp`/`handleVerifyOtp`) | Teacher clicks an invite link → validates the code → **must** OTP-verify an email before `POST /api/code/redeem` will accept the redemption (that endpoint requires an authenticated bearer token via `verifyAuthToken`) |
| General sign-in modal | `packages/player-vue/src/components/auth/SignInModal.vue` (`handleSendCode`/`handleVerify`) | Same primitive, used for the header sign-in / entitlement-code modal |
| Self-serve onboarding | `packages/player-vue/src/views/onboarding/Onboarding.vue` (`sendCode`/`verify`) | Same primitive, gates `POST /api/onboarding/provision` |
| Add a second email (Settings) | `packages/player-vue/src/components/SettingsScreen.vue` | Same primitive, lower priority — user is already signed in, this just links another address |

**The actual blocking point is identical in all four: `client.auth.signInWithOtp({ email })` sends
the mail; nothing downstream (`api/code/redeem.ts`, `api/onboarding/provision`) ever runs until
`verifyOtp` succeeds.** `api/code/redeem.ts` itself has zero email dependency of its own — it only
requires a valid bearer token, which never exists until the OTP step above it completes. So this is
**one root cause with three downstream symptoms**, not three flows to fix separately.

---

## 3. Options

### Option A — Possession-based invites (defer email verification) — *owner-favoured*

A teacher who clicks a school-admin-issued invite link has already proven possession of that link as
strongly as an emailed code proves possession of an inbox. Design: establish the session **from the
invite redemption itself**, record the typed email unverified, confirm it in the background later
(non-blocking).

**Supabase mechanics (precise):**
1. New pre-auth endpoint, service-role only (redemption today happens *after* login — this is the
   structural change): validate the invite code (as today), then
2. `supabase.auth.admin.createUser({ email, email_confirm: true })` — creates the account with no
   email sent. Reuse the existing user if that email already has an account (idempotent lookup).
3. `supabase.auth.admin.generateLink({ type: 'magiclink', email })` → returns `hashed_token`.
4. An anon-key client calls `supabase.auth.verifyOtp({ email, token_hash, type: 'magiclink' })`
   **server-side** — this mints a real session (access + refresh token) without ever emailing anyone;
   the token is validated by GoTrue regardless of which client presents it.
5. Return those tokens to the browser; it calls `supabase.auth.setSession(...)`, then proceeds to
   `POST /api/code/redeem` exactly as today.

Net effect: teacher never waits on an inbox. Total added build: one new server endpoint wrapping
three already-blessed Supabase Admin API calls — no custom JWT signing, no bypass of GoTrue's session
model.

**Security delta — be precise:** the invite code is *already* the real authorization boundary today.
`signInWithOtp` on an arbitrary typed email proves "I control this inbox," not "I am the intended
recipient" — nothing today checks the typed email against who the invite was meant for. So an
attacker with a leaked invite link can *already* redeem it under any email address they choose; OTP
adds only (a) a floor of "this is a receive-capable address" and (b) Supabase's built-in per-email
rate limiting. Removing the email gate at redemption time doesn't meaningfully weaken authorization —
it just stops requiring an already-weak proof through a channel that doesn't work for this population.
What's genuinely lost: the recorded email isn't confirmed-live at grant time. Mitigated by a
best-effort background confirmation email (fire-and-forget, never blocks anything) — which, note,
will hit the *exact same* gateway wall for a hostile-school-domain teacher, meaning this population
can structurally never rely on a Supabase email for anything, ever, until Option C is also in place.
That's an argument for making "redeem a fresh admin-issued link" the *standing* re-entry mechanism for
these accounts too, not just a first-run bypass.

**Effort:** ~1-2 days (one new endpoint, fully server-side, no design/legal review needed — invite
codes are already the trust boundary).
**Risk:** low. No new PII category, no change to who can end up with a role, just when the email gets
confirmed.

### Option B — Personal-email-first, school email attached later

Sign up with any working address (existing OTP flow, unchanged) → full account + role via redemption
→ inside Settings, add a **separate, our-own-table** `school_email` field (not the Supabase auth
email), verified via a background, non-blocking confirmation link whenever convenient.

**Why our own table, not Supabase's `updateUser({ email })`:** Supabase's identity-email-change flow
is built to *change the login identity* (with Secure Email Change confirming both old and new
addresses) — wrong shape here, since we explicitly don't want login tied to the address that can't
receive mail. What we actually need is "prove affiliation with this school" for entitlement purposes
— that's squarely inside the existing `entitlement_grants` / `invite_codes.grants_school_id` model
already in this schema, not a new concept. A plain `learners.school_email` (+ `verified_at`) column,
checked by domain-suffix match against the school's registered domain, is simpler and carries zero
risk of ever locking someone out of their own login.

**UX copy sketch** (for the invite page, offered when the code isn't arriving): "Trouble getting a
code at your school email? Sign up with a personal address instead — you can add your school email
afterwards from Settings." This is a genuine product-flow change (a new branch/step in
`RedeemCode.vue`), not a zero-risk copy tweak, so it needs your sign-off before it ships as a built
flow — I've only shipped the *messaging* pointing at "try a personal email," not the dedicated UI step.

**Effort:** moderate (new column + migration, Settings UI, verification banner, invite-page copy
branch). **Risk:** low.

### Option C — Deliverability engineering (custom SMTP + SPF/DKIM/DMARC) — necessary, never sufficient alone

Necessary hygiene regardless of A/B, and it's the only option that also fixes every *other* Supabase
email in the app (password resets, any future transactional mail) for personal-address teachers whose
own provider (Gmail, Outlook.com) is simply penalising the shared pool's reputation, not running a
hostile allow-list policy.

**Exact setup:**
1. **Provider: Postmark**, not raw AWS SES — separates transactional from broadcast reputation
   out of the box, no SES-sandbox/warm-up support ticket, same-day approval, and is one of
   Supabase's own documented custom-SMTP examples. (~$15/mo covers far more volume than schools
   onboarding needs.)
2. **Dedicated subdomain**, e.g. `mail.saysomethingin.app` — never the apex domain, so a reputation
   problem can never touch billing/marketing mail:
   - SPF: `TXT mail.saysomethingin.app "v=spf1 include:spf.mtasv.net ~all"` (Postmark's include;
     move to `-all` once confident).
   - DKIM: the CNAME(s) Postmark's "Sending Domains" setup screen issues — copied verbatim.
   - DMARC: `TXT _dmarc.mail.saysomethingin.app "v=DMARC1; p=quarantine; rua=mailto:admin@saysomethingin.com; pct=100; adkim=s; aspf=s"`
     — start at `quarantine` for 2-4 weeks to catch alignment mistakes via the aggregate reports,
     then move to `reject`. Strict alignment matters more than usual here because EOP weighs it
     heavily for unfamiliar senders.
3. **Supabase side:** Project Settings → Auth → SMTP Settings → host `smtp.postmarkapp.com`, port
   587, user/pass = the Postmark Server API Token (same value for both). Also raise Supabase's
   default per-email rate limits once off the shared service — the built-in limits are deliberately
   tight *because* it's a low-trust pool.
4. **Warm-up:** current volume (a handful of teachers/day) is low enough that no deliberate ramp is
   needed; just watch Postmark's bounce/spam-complaint dashboard weekly for the first month.
5. **Elapsed time:** DNS propagates in minutes-hours; Postmark approval is typically same-day. Total:
   same-day to ~2 business days. **This is dashboard/DNS/Postmark-account config, not app code** — I
   can't ship it from this repo; it needs whoever holds the domain registrar + Postmark account
   access (you, most likely) to execute steps 1-3.

**Why "necessary, never sufficient alone":** some school IT departments (a well-known pattern on
Microsoft 365 education tenants) run **allow-list-based** external-mail policies, not
reputation-based ones — no amount of SPF/DKIM/DMARC alignment gets a first-contact external sender
through an allow-list. C fixes the reputation-based failures (most personal-email teachers, many
lenient school tenants); it structurally cannot guarantee a fix for the hardest-locked-down tenants.
That's exactly why A is the one that has to exist regardless of how well C is executed.

### Option D — Admin-visible one-time teacher codes

Literally asked: can a school admin see a teacher's one-time OTP code the way they can already see/
regenerate the reusable `teacher_join_code`/`admin_join_code`? **No** — Supabase's OTP token is a
one-way secret GoTrue only ever delivers via the configured channel; there's no admin API to read
back a code it generated (by design — exposing it would be a straight auth bypass). But the
capability we're actually reaching for already exists in a different, better form: **the admin-visible
join code IS a possession-based, one-time-per-teacher credential today** — it just currently still
needs a working OTP loop stacked on top of it. Once Option A ships, the join code *becomes* the
complete teacher credential, no separate OTP required. **D isn't a fourth build — it's what A looks
like from the school admin's side of the counter.**

**Considered and dropped:** SMS OTP. Same "prove you control channel X" property as email, at real
recurring cost, and requires collecting/storing a new PII category (phone numbers) with its own
consent/GDPR surface — dominated by Option A on all three legs of BSC (worse, more complex, and not
cheaper), so not carried forward as a real option.

---

## 4. Ranking + recommended sequence

1. **C first, in parallel with everything else** — pure config (DNS + Postmark + Supabase dashboard),
   zero app-code risk, fixes the majority of non-hostile-gateway cases immediately, and is necessary
   regardless of which other option leads. Needs Tom/whoever holds domain+Postmark access to execute;
   flagging here as the top actionable item outside this repo.
2. **A second** — the actual structural fix for the hostile-gateway population, and the *only* one
   that also answers "how does this teacher ever get back into their own account" (answer: a fresh
   admin-issued link works every time — this becomes the standing re-entry mechanism for this
   population, not a one-time bypass). Small, fully server-side, testable, no legal/design review
   needed since the invite code was already the trust boundary. ~1-2 days.
3. **B third** — genuinely useful as the long-term "verified school affiliation" data point for
   entitlement/reporting, and the right shape for it (our own table, not Supabase's identity-change
   flow) — but optional once A ships, since A already gets teachers in without ever depending on the
   school email working. Do this once A is live and you want the affiliation signal for reporting.
4. **D** — not a separate build; falls out of A.

---

## 5. Shipped now (copy only, no flow change, tests+typecheck green)

Added a fallback disclosure on every OTP-verify screen — reveals ~20s after the code is sent, or
immediately on "Resend" (that click already is the signal something's wrong):

> Still nothing? School email filters often block these codes outright. Try entering a personal
> email address instead — you can add your school email later — or ask whoever sent your invite to
> re-share the link. Still stuck? Email admin@saysomethingin.com.

Applied identically in:
- `packages/player-vue/src/views/RedeemCode.vue` (invite/join-code redemption)
- `packages/player-vue/src/components/auth/SignInModal.vue` (general sign-in modal)
- `packages/player-vue/src/views/onboarding/Onboarding.vue` (self-serve onboarding)

Kept honest to what exists today only: points at using a personal email (works right now, no new
code) and re-sharing the invite link (school admins can already do this), plus the real, already
-published support address (`admin@saysomethingin.com`, used identically on `/terms`, `/privacy`,
`/refunds`) — nothing here promises Option A/B/C flows that aren't built yet.

`SettingsScreen.vue`'s add-a-second-email OTP step was left untouched — that's a signed-in user
linking an extra address, not a first-run onboarding blocker, so it's lower priority and out of scope
for this pass.
