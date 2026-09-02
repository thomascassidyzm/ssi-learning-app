# A teacher gets in when the email does not arrive

2026-09-02. Branch `feat/entry-without-email`, merged to `dev`.

---

## The problem, measured rather than assumed

Teachers at Welsh schools sit behind Hwb and Microsoft education mail gateways that
quarantine our sign-in code. Nothing bounces, nothing is whitelistable, and the teacher
simply cannot use the product.

I read the live database rather than trusting the story. Three facts:

- **81 accounts exist that asked for a code and never got in** — `last_sign_in_at` null,
  `email_confirmed_at` null. That is one in five of every account we have.
- Among them are three `@hwbcymru.net` addresses. One was created at **07:55 on the
  morning I wrote this**, and the address before it differs by a single letter — someone
  sitting there wondering if they had mistyped their own email.
- The wall is worse than "the code never comes", because **asking for a code creates the
  account**. From that moment the teacher's invite code stops working too: possession
  redemption refused any address that already existed, so their own aborted attempt
  locked the door behind them.

## How sign-in actually worked before this

Supabase Auth. Four surfaces, one primitive: `signInWithOtp` → `verifyOtp`, plus
`signInWithPassword` for anyone who had set a password.

**First entry was already solved** and I did not rebuild it. `api/auth/possession-redeem.ts`
mints a session server-side from possession of a valid invite code, with no email sent at
any point — a teacher clicking a link from their school admin never waits on an inbox.
Personal links do the same with zero screens.

**Return entry was the hole.** A teacher on a new laptop with no session had exactly three
routes: a password, if they had ever set one (nothing ever asked them to); an
`ssi_admin`-minted rescue link, which makes one person at SSi the bottleneck for every
locked-out teacher in Wales; or the code email, which is the thing that does not arrive.

## What is gated on a verified email — the honest answer

I censused every read of `learners.needs_verification`, `user_metadata.onboarded_via`,
`email_confirmed_at` and every `isVerified`-shaped flag across the client and the API.

**Nothing in the product gates on email verification.** Every live consumer is either a
write, a cosmetic badge in the internal admin table, or a nudge in Settings whose own
comment reads *"a background nicety, never a gate: the account already works fully
without this"*. Browsing, lessons, joining a class, teaching, dashboards, analytics,
settings — none of them touch it.

So **I added no gates**, and that is the finding rather than a shortcut. Inventing
permission checks that did not exist would have been worse, more complex and more
expensive on every leg. Two things do genuinely need a live address, and both already
behave honestly:

| Action | Why it needs a real address | Behaviour |
|---|---|---|
| Emailing an invite to a named person (`api/_utils/sendInviteEmail.ts`) | We are posting a link to somebody else's inbox | Already offers "no email on this person — copy the link and send it yourself" |
| Binding a first Paddle payment to a learner (`api/teacher/paddle-webhook.ts`) | An unverified address is one somebody typed, not one anybody proved they hold; trusting it would hand a payment to the wrong account | Refuses and logs for manual binding — correctly strict, and left alone |

One flag for Tom, not fixed here: that payment refusal is silent to the payer. It is the
money path, so it is a call to make deliberately rather than something to change on an
auth branch.

## What I built

**1. Empty-shell adoption** (`api/auth/possession-redeem.ts`). If the address already has
an account but that account is a *shell* — never signed in, never confirmed, no role, no
platform role, no redeemed invite — the invite code adopts it instead of refusing. There
is no account there to take over; the refusal was itself the wall. Anything with a
heartbeat is refused exactly as before, and any doubt (a failed lookup, a read error)
refuses.

**2. A school admin can issue a colleague a sign-in link** (`api/school/staff-signin-link.ts`).
It appears on the staff list, next to the teacher's name. The admin hands the link over in
person, on Teams, on paper — any channel that is not our email. This is the piece that
takes Aran out of the loop.

**3. The schools front door offers two ways in.** `/schools` — the first thing a Welsh
teacher sees — had one button, "Send me a code". For anyone behind Hwb that is not a
route, it is a wall with a button on it. It now offers password sign-in as a peer, says
plainly that school filters block these codes, and after twenty seconds (or immediately on
Resend) names both routes that need no inbox.

**4. Never a dead end.** The redeem page's "an account already exists" screen used to offer
one way out — "Sign in instead" — which sent the teacher straight back at the email that
never arrives. It now names password sign-in and the admin-issued link.

**5. A password prompt on the two schools landings.** A password is the only credential
that needs no inbox, and nobody was ever asked for one. The org lane already blocks
managers on this (Tom's ruling, 2026-08-06) and deliberately left the schools lane alone —
so this reuses that component verbatim as a dismissible **prompt**, not a gate. Turning it
into a wall for every teacher in Wales is a product call, not a detail. **Recommendation:
make it a gate on a school leader's first write, exactly as the org lane does.** The
argument that won it there — "a manager who arrived by magic link has no way back into the
organisation they just built" — is word for word the Welsh teacher's situation.

## What an attacker gains, and why it is acceptable

Two new capabilities, and neither opens a class of attack that was not already open.

**Shell adoption** hands a session to whoever holds a valid invite code, for an address
with nothing behind it. But an invite code *already* mints an account under any address
its holder types — nothing has ever checked the typed address against who the invite was
meant for, and that was the accepted, documented design of the possession path. The only
new thing is that the address may have an abandoned auth row attached. The takeover
boundary is exact and enforced on five independent conditions: one completed sign-in, a
confirmed email, an educational role, a platform role, or a redeemed invite — any one of
them refuses, as does any read error. An attacker cannot reach a live account, cannot
receive anyone's data and cannot act for a school. Every attempt is audit-logged with a
hashed IP and rate-limited per code and per IP.

**Admin-issued sign-in links** let a school admin become one of their own staff. That
relationship is server-verified from the caller's own identity, never the request body,
and it already carries a strictly larger power: the same admin can remove that teacher
outright and can read every pupil's data in the school. Containment is enforced rather
than assumed — the target must be active staff at the caller's own school, and is refused
if they hold a group-leader or platform-admin role, or staff membership at any second
school. Without that check a school admin could mint their way upward or sideways; with it
they cannot leave their own scope. Ten links per fifteen minutes, every mint written to
`player_events` with actor, target and school, and the rate limiter fails **closed** — if
the audit table cannot be read, nothing is minted.

Net: an attacker who steals an invite link gains what they already gained. An attacker who
compromises a school admin account gains a lateral move inside a school they had already
fully compromised. Neither can climb out of a school, and both leave a trail.

## Verified in a real browser, phone-sized

`packages/player-vue/e2e/_entry-without-email-verify.mjs`, against the deployed dev build,
on a synthetic school torn down afterwards. **11 of 11 checks pass**, including the ones
that must fail: a live account is still refused (409), a teacher at another school is
refused (404), and a group leader wearing a teacher tag is refused (403).

The browser found three things no unit test would have:

- The `/schools` front door had one button. That is item 3 above, and I only saw it
  because I looked at the screen a teacher looks at.
- `TeachersView` is retired for school-scoped admins — they land on the node home with the
  teachers lens — so my first Sign-in link button sat on a page most of them never see. It
  moved to the node home.
- Two row verbs side by side squeezed the teacher's name down to its first letter at
  390px, and the panel opened below the fold, so tapping the button appeared to do
  nothing. Both fixed and re-shot.

Known duplication, deliberately left: on the node home the existing "Your account" card
already says "No password yet". Mine says the same at the TOP of the page, which is the
entire point — the passive card below the fold is why nobody has ever set one. Both
disappear the moment a password exists.

One environment note: a minted link carries `redirect_to` for the origin it was minted
from, and Supabase only honours allow-listed origins. On the dev alias the link lands on
production instead; on production and staging it lands where it should. Worth a glance
during the staging soak.

## Tests

29 new: 17 on the sign-in link endpoint (every containment branch, plus the rate limiter
failing closed), 12 on shell adoption (every refusal asserts no session comes back).
`test:api` 1662 passed, `player-vue` 2923 passed, typecheck and lint clean.

## The gap I did not close

**Self-serve signup** (`/schools1`, `/tutors`, `/orgs`) is still OTP-only. A Welsh school
that finds us cold, with no invite from anyone, has no route in if their gateway eats the
mail. That is not an oversight I can quietly patch: with no invite and no vouching human,
the email is the only evidence of anything at all, and a bypass there would let anyone mint
an organisation under any address. It needs a deliberate answer — a human vouch at signup,
or a callback — and that is Tom's call, not mine.
