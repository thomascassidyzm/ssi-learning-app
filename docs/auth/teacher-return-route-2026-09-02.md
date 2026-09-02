# The teacher gets back in, forever

2026-09-02. Branch `feat/teacher-return-route`, merged to `dev`, promoted to `staging`.
Builds on job #66 (`docs/auth/entry-without-email-2026-09-02.md`), which fixed FIRST entry.

---

## What was still broken

#66 got a locked-out teacher **in**. It did not get them **back**.

A school admin could mint their colleague a sign-in link, and that link worked — once,
for about an hour. After it was spent, the teacher was exactly where they started: a
password they had never been asked to set, or a code email their school gateway
quarantines. A new laptop, a cleared browser, a new phone, and they are waiting on Aran
again.

There was a second problem, smaller-looking and just as fatal. The thing the admin had to
hand over was a raw Supabase `action_link` — around two hundred characters of URL. The
whole design assumes it travels **out of band**, because our email is the channel that
does not work: pasted into Teams, read off a screen, printed on a slip, said out loud
across a staffroom. A two-hundred-character URL survives none of those except the paste.

## What was ruled

Tom, thinking it through with Watson, and these are settled:

- The admin creates the access route. It is **single-use** and **short-expiry**.
- It is handed over out of band, so **it must be short enough to type**.
- Redeeming it mints a **durable session** and **immediately asks for a credential**.
  "If the link is one-use and just lets them in once, you've solved nothing."
- **The admin can always reissue.** That is the floor under everything.
- A personal email is collected **later, purely as a recovery route**. Nag gently, never
  gate. And do not call it verification — the admin already did the verifying.
- **Microsoft / Hwb / school SSO is ruled out.** "That's a headache and not one we want to
  subscribe to."

The reframe underneath it, which is the part worth keeping: this changes **who does the
vouching**. Not "we trust this person because they proved control of an inbox" but "we
trust them because their admin, who knows them, made them a code." For a school that is
*more* truthful, not less. The admin genuinely does know who Mrs Hughes is. Microsoft's
spam filter never did.

## What was built

**1. A short, typeable access code** replaces the `action_link`. Eight characters, shown
as `ABCD-EFGH`. The alphabet is Crockford base32 minus its two remaining awkward digits,
so **no character in a printed code can be misread as another one in it** — no `0`/`O`, no
`1`/`I`/`l`. Single use. **48 hours.** Only its sha256 reaches the database, so nobody
reading the table — including us — can lift a live credential out of it. Minting a new one
**kills any earlier live code** for that person, so a stale slip in a shared inbox is worth
nothing.

The admin sees the code set large and monospaced, plus a tappable `/join/ABCD-EFGH` URL, so
whichever channel they actually have will work. #66's containment, rate limiting and
fail-closed audit on the mint are untouched — they were argued for carefully and I built on
top of them rather than through them.

**2. `/join` — redeeming buys a standing seat.** The teacher types the code and gets the
app's normal long-lived session, minted server-side with no email at any point. Single use
is enforced by an **atomic claim UPDATE**, not a read-then-write: two simultaneous
redemptions cannot both win, on an endpoint that mints sessions.

A detail that turned out to matter: this mints from the `token_hash`, never the
`action_link`. An `action_link` carries a `redirect_to` that Supabase only honours for
allow-listed origins — which is why #66 found a minted link on the dev alias landing on
production. A `token_hash` has no origin in it, so this path is immune to that class of
problem entirely, and the join URL points at whatever origin minted it.

**3. The credential screen, at the moment of redemption.** The first thing they see after
getting in, in the org lane's already-approved voice, reusing `ManagerOnboardingGate`
rather than growing a third password UI. Not a card further down a page nobody scrolls to.

**It is compulsory** — Tom's ruling, reversing the skippable version I first shipped. One
screen, once, no skip link, no dismiss, no close glyph.

The reasoning is worth carrying because it is *not* a security argument. A teacher who skips
has a session on **that one device and nothing else**. The first time it dies, or they pick
up another phone, they are locked out again — and by then what is behind that door is their
classes and their **students' records**. The loss is not their own five minutes. Redemption
is also the only moment we are guaranteed their attention with a reason that obviously
matters to them.

So the screen is worded around **getting back to your classes**, never around security:

> You are in. One thing before you go, and then you are away: **set a password**. That code
> worked once and is now spent, and a password is what gets you back to your classes from any
> phone or any laptop, whenever you need them. Your students' progress lives in here — this
> is how you keep reaching it.

That is the true reason as well as the persuasive one. The `allowSkip` prop I had added to
`ManagerOnboardingGate` is **removed rather than left unused** — an unused escape hatch on a
compulsory gate is the wrong thing to leave lying about. The gate is back to its original
rule: the password walk never offers an escape, the install walk always does.

**4. The password is now actually saveable.** The password walk had no username field, so
iCloud Keychain and Google Password Manager either declined to save it or saved it against
the wrong entry — and then it did not autofill on the new laptop, which is the entire
scenario the walk exists for. It carries the account's address with
`autocomplete="username"` now. One readonly input, and it buys most of the convenience a
passkey would have.

**5. The recovery email is re-voiced, not rebuilt.** A suitable nudge already existed in
Settings, so I used it rather than adding a surface. But it said "unverified" and "Verify
now", and Tom's push-back was exactly that: *"it isn't verification — the admin already
verified them. It's just 'give us a way to reach you.'"* It now says what it is —
*somewhere we can reach you if you ever lose this device* — with the badge gone. It gates
nothing, as before.

It also **now reaches the people it is for**. That row keys off the marker every other
inbox-free arrival carries, and an access-code redemption did not set it — so the one
population the nudge exists for was the one population never seeing it. Redemption sets it
now, which is honest: somebody who needed an access code is by definition somebody whose
address we have never seen mail reach.

**6. Reissue, and the dead ends.** The admin's button lives on the node home as well as
`TeachersView` — #66's trap was that school-scoped admins never see `TeachersView`, and
that is still true. Every place that used to tell a stuck teacher to ask for a "Sign-in
link" now names the **Access code** and says their admin can read it out to them. A refused
code says the same, and points at the person who can fix it in seconds.

## Verified in a real browser, phone-sized

`packages/player-vue/e2e/_entry-without-email-verify.mjs` — #66's rig, extended rather than
replaced — against the deployed **staging** build at 390px. **27 of 27 checks pass.**

It walks the return route the way a person does: open `/join`, the code is already in the
box, press one button. Then it asserts the half that actually matters — **the refusals**:

- the code the teacher just spent **cannot be spent again**
- a **superseded** code (killed by a reissue) fails
- an **expired** code fails
- a **mistyped** code carrying a character we never generate is refused rather than guessed at
- unknown, expired and already-used all return the **same message**, so the endpoint is not
  an enumeration oracle
- and #66's containment refusals still refuse: a teacher at another school (404), a group
  leader wearing a teacher tag (403), a live account (409)

It also asserts the compulsory screen is genuinely compulsory — no escape words anywhere on
it, and **zero** `.walk-close` elements — and that it is worded around classes rather than
security.

**Looking at the screen found three real bugs that no unit test would have**, which is the
argument for this rig in one line:

1. My then-skippable screen's only escape was the `×` in the card corner — moot now the
   ruling has removed escape entirely, but it was a real defect at the time.
2. The throttle bug below.
3. **`Your students&rsquo; progress` rendered literally, entity and all.** `WalkCard` escapes
   its copy before rendering — deliberately; it is `v-html` — so an HTML entity in walk text
   arrives on screen as its own source. The rig now fails on any raw entity reaching the
   rendered page.

## The throttle bug the live run caught

Redemption was using `PER_IP_LIMIT` — 10 attempts per 15 minutes. But `codeAttemptThrottle`
already documents a **separate** constant for exactly this shape: *"a teacher onboards a
whole class from one school building, so every student redeems a valid code through a
single NAT'd IP... at PER_IP_LIMIT that cohort is locked out on the eleventh child, holding
a correct code."*

A staffroom of teachers redeeming access codes is the same picture, and locking out the
eleventh one holding a perfectly good code is precisely the wall this work exists to
remove. It now uses `REDEEM_PER_IP_LIMIT`. That still bounds enumeration with enormous room
to spare: the 30^8 keyspace here is around **48,000x** the ABC-123 one that number was
chosen against.

## What an attacker gains

Nothing they did not already have, and the boundary is the same one #66 argued.

An access code is a bearer credential for one account, for 48 hours, once. Whoever holds it
becomes that teacher — which is stated plainly on the admin's screen rather than buried in
a docstring. But the **admin who minted it already holds a strictly larger power**: they can
remove that teacher outright and read every pupil's data in the school. Containment is
unchanged and still enforced from the caller's own server-verified identity: the target must
be active staff at the caller's own school, and is refused if they hold a group-leader or
platform role, or staff membership at a second school.

Guessing is not a route: 30^8 combinations, single use, 48-hour expiry, refusals that do not
distinguish themselves, every attempt logged with a hashed IP, and a per-IP throttle checked
*before* any lookup so a sweeper never gets to spend the database on guesses.

The code is never stored in the clear and never logged in the clear.

## What I did NOT build, and why — passkeys

**No passkey shipped.** This was a judgement call, not an inability, and it is the one thing
in here most worth overruling if you disagree.

The finding that drove it: **Supabase's own WebAuthn support is an MFA factor**
(`auth.mfa_factors.factor_type = 'webauthn'`, and the pinned client agrees). MFA is a
*step-up on an existing session*. It cannot be a primary, passwordless sign-in — you would
still need a password or the OTP email first, which is the exact thing we are routing
around. So a real passkey return route means running **our own credential store and
assertion verification alongside Supabase's identity**: two tables, four endpoints, a new
dependency in the auth path, and RP-ID configuration that differs across dev alias, staging
and production — a classic works-on-staging-dead-on-prod source.

Against that, the win is narrower than it first looks. On the brief's actual failure case —
*a new laptop* — a platform passkey only travels if the teacher's passkey manager syncs it,
which we cannot guarantee on a school-managed Windows machine. The password is the credential
that genuinely satisfies the purpose. The passkey is a convenience win on the everyday case.

So: real but partial Better, clearly worse Simpler, clearly worse Cheaper. Multiplicatively
that fails, and it is the same class of thing as the Microsoft SSO you already ruled out — a
headache to subscribe to. I built and then **removed** the scaffolding rather than leave it
half-standing: the two tables were created, then dropped; the dependencies added, then
removed. There is no passkey stub anywhere in the tree.

Most of the convenience is recovered by item 4 above — making the password properly saveable,
so the device's own manager autofills it on the next laptop.

**One word from you reverses this if you want it.**

## Explicit gaps

- **`supabase/schema.sql` is not refreshed.** The repo's workflow is "apply to live, then run
  `./supabase/snapshot-schema.sh`". That script needs `pg_dump`, which is **not installed on
  watson-1**, so I could not run it. The table is live and correct (verified directly); the
  committed snapshot simply does not yet show it. Anyone with `pg_dump` should run the script.
  The exact DDL applied is at the end of this document.

- **Repeat runs of the rig throttle themselves.** #66's "already-registered dead end" check
  fails if the rig is run twice inside fifteen minutes, and the cause is measured rather than
  guessed: the rig's own attempts fill the **shared** per-IP throttle bucket, and
  `possession-redeem` still uses the *mint* limit of 10. Every clean-bucket run passes 27/27.
  Not a fault in the return route — but see the question below, because the same mechanism
  can bite a real school.

## For you — flags and one question

Taste-safe defaults I took. Any of these is a one-word overrule — and you have already
overruled one, which is reflected below.

| | I chose | |
|---|---|---|
| Code length | **8 characters**, `ABCD-EFGH` | shorter is easier to read out, weaker to guess |
| Alphabet | Crockford base32 **minus `0` and `1`** | nothing in a printed code can be misread |
| Expiry | **48 hours** | your ruling was "a day or two" |
| Credential screen | ~~skippable~~ → **compulsory**, worded around classes | **you ruled this** — no longer a default of mine |
| Landing after redeem | `/schools` | everyone holding one of these is school staff by construction |
| Button label | "Access code" (was "Sign-in link") | it is no longer a link |

**The one question.** `possession-redeem` — #66's endpoint, which a teacher hits when they
click an invite link — throttles at **10 per IP per 15 minutes**, and it shares one bucket
with every other code endpoint including this new one. A whole school building is one IP. A
handful of mistyped access codes in a staffroom can therefore lock out a teacher redeeming a
perfectly good invite link. It is a redemption endpoint behind a school NAT, exactly like
this one, and I think it should use `REDEEM_PER_IP_LIMIT` too. **Loosening a security control
on someone else's endpoint is your call, not mine** — say the word and it is a two-line change.

**One honest limit on the word "compulsory".** There is no skip in the product, but a teacher
who closes the tab mid-screen keeps the session they were already given — we cannot take that
back, and taking it back would put them straight back outside. They are caught afterwards by
the existing dismissible prompt on the schools landing, so there is a second ask, just a
softer one. If you want that second ask hardened too, that is the #66 question below rather
than a gap in this ruling.

Also still open from #66, unchanged and not mine to decide: whether a school leader's first
**write** should require a password, as the org lane already does.

---

## The DDL applied to the live database

Applied 2026-09-02, verified live: RLS on, zero policies, no `anon`/`authenticated` grants —
service-role only, per CLAUDE.md rule 7.

```sql
create table if not exists public.staff_access_codes (
  id uuid primary key default gen_random_uuid(),
  code_hash text not null unique,
  target_user_id uuid not null,
  school_id uuid,
  created_by uuid not null,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  redeemed_at timestamptz,
  redeemed_ip_hash text
);

create index if not exists staff_access_codes_target_idx
  on public.staff_access_codes (target_user_id);
create index if not exists staff_access_codes_live_idx
  on public.staff_access_codes (expires_at) where redeemed_at is null;

alter table public.staff_access_codes enable row level security;
revoke all on public.staff_access_codes from anon, authenticated;
notify pgrst, 'reload schema';
```

## Tests

52 new: 14 on the code primitives (the alphabet assertion is not a style preference — a `0`
in a generated code is a teacher failing to get in), 18 on redemption, 20 on the mint
(rewritten for the code, including reissue killing the old one and the gate refusing to hand
back a code it could not store). `test:api` 1697 passed, `player-vue` 2923 passed, both
typechecks clean, lint 0 errors.
