# SSi Commercial Model (locked 2026-06-17)

The single source of truth for how SSi makes money, who pays whom, identity, and
the free-trial / paywall logic. Decided with Tom; supersedes scattered notes in
WORKLIST and prior pricing docs.

## Identity (locked)
- **Email + OTP for every actor, forever.** Consumer, student, tutor, school
  admin. No SSO — the "which account did I sign in with?" tail is a support
  sinkhole; email is the one durable, universal key.
- **We hold the email and the payment → we are the data controller** for every
  learner, including school/tutor students.
- **Minors: the parent creates & owns the account, the child uses it.** The
  parent is the payer and the consenting party.

## The two products
1. **Platform fee — £15 / teacher / month.**
   - A **tutor** pays it for themselves; a **school** pays it per teacher seat
     (Paddle quantity on one per-seat price).
   - **Mandatory for any tutor/school regardless of course** — even to teach a
     free/community course you must pay for the right to run the platform. Once
     paid, you can teach **any** course (free, premium, community).
   - Platform trial: **tutor = 1 month; school = 1 month premium / 1 year free,
     one language.** Then £15/teacher/mo.
2. **Per-learner subscription (paid to us — we're the controller).** Price is set
   by the **channel** the learner came through:
   - Direct consumer → **£15/mo**
   - Student via a **tutor** class → **£10/mo** (tutor earns **£5 commission**)
   - Student via a **school** class → **£5/mo**
   - Minors: **parent pays**.

## What the per-learner price actually buys (framing — important)
- £5/£10 is **the full premium product** — all languages + offline downloads —
  **plus a teacher**. It is NOT "paying to belong to free content." Frame it as:
  *£5 (school) / £10 (tutor) gets the student the complete premium app AND a
  teacher tracking them — vs £15 direct with no teacher.* More for less.
- **Community courses stay free for a solo learner** (play, no downloads). The
  per-learner sub buys premium features (offline, all langs) + the class
  relationship.
- **Joining a class is optional** — it's a cheaper route to the premium product,
  available because a teacher introduced them.

## Go-to-market: the teacher IS the distribution channel
- In the target markets (China, India, …) there is **near-zero organic direct
  discovery** of SSi. Learners arrive **because a teacher introduced them.**
- Therefore **"cannibalisation" of the £15 tier is a non-issue** — there is no
  organic £15 sale to erode; the teacher-channel sale is one that otherwise never
  happens. The £15 direct tier is for the rare direct-discovery consumer.
- The **£5 commission is customer-acquisition + retention cost**, and it's cheap:
  a trusted local teacher acquires *and teaches/retains* a subscriber in a market
  where paid acquisition barely works.
- **Disintermediation is fine / not a threat.** A teacher can already use the
  free community content + their own Zoom and charge students directly — they can
  do that today. We don't fight it; we *add value on top*: the ability to give
  students a **cheaper route to the premium product**, plus **lesson-by-lesson
  tracking** (the teacher sees exactly where each student has got to and what
  they should be able to say). The tracking + discount are the draw, not a cage.

## What "properly belong" unlocks (BSC decision)
- **Paying £5/£10 = the standard premium learner subscription** (everything a £15
  consumer gets: unlimited past-end-of-yellow play + offline/download), **plus**
  the live teacher relationship (fully-tracked member: progress, homework,
  analytics).
- **Joined-but-not-paid = a free-trial learner linked to that class.** Plays to
  end-of-yellow like anyone, then hits the *same* paywall. Shows on the teacher's
  roster as **"trialing — not yet subscribed,"** so the tutor sees exactly who to
  nudge (feeding the £5-commission incentive).
- **No new entitlement tier.** "Belonging" is a *consequence* of being a paying
  learner who joined via that class — reusing the one play-to-yellow premium
  gate. The only additions are stamping the **channel price** at join and showing
  a **trialing/subscribed flag** on the roster (derivable from existing
  entitlement state).

## Learner free trial (locked)
- **Every learner plays free to end-of-yellow (seed ~19), then subscribes at
  their channel price.** One gate for everyone; the channel just stamps the
  price. (This is the consumer gate already built.)

## Offline / download (locked)
- **Premium only — any course (premium, free, OR community).** The Spotify rule:
  you pay for the *convenience* of offline, whatever the content tier.

## In-class vs at-home (locked)
- **In class:** the teacher runs **"Play as class"** mode. No student logins, no
  phones. One teacher-driven session. **In-class progress is collective** (the
  teacher's session).
- **At home (HW / revision / extension):** the student uses **their own
  email+OTP account**, tied to their class. **Individual progress tracking
  happens here**, via the home account.

## Retention perk
- If a school/tutor closes their account, **their students bubble up to us as
  direct learners and grandfather their £5/£10 price** — a loyalty carrot, not a
  contractual obligation.

## Money flow summary
| Payer | Pays | For | Trial |
|---|---|---|---|
| Consumer | £15/mo | premium learner sub | play to end-of-yellow |
| Tutor | £15/mo | platform (self) | 1 month |
| Tutor's student (parent if minor) | £10/mo | premium sub + class membership; tutor earns £5 | play to end-of-yellow |
| School | £15/teacher/mo | platform (per seat) | 1mo premium / 1yr free, one language |
| School's student (parent if minor) | £5/mo | premium sub + class membership | play to end-of-yellow |

## Required guardrails / mitigations (from adversarial review 2026-06-17)
The model is sound for our GTM, but four real risks need building before scale.
These are plumbing/compliance, NOT model changes:
1. **Commission clawback + payout hold.** We pay tutors £5/student in cash, so a
   student refund/chargeback must reverse the accrued/paid commission. Build a
   clawback ledger on `teacher_commissions` + a **payout hold (~30 days,**
   matching the refund/chargeback window) before commission is paid out. The
   tutor Paddle webhook needs a `transaction.refunded` handler (currently absent
   → it no-ops, so refunds leak).
2. **Affiliate-fraud hygiene.** Block enrolments where the **student's payment
   instrument == the tutor's** (self-enrolment for the kickback) and rely on the
   payout hold to catch stolen-card rings. Commission on genuine distinct payers
   only.
3. **Grandfather must be EARNED, not minted.** The "students keep £5/£10 when a
   school/tutor closes" perk is **void inside the platform trial** and requires
   **≥3 paid months** of student tenure; otherwise open→enrol-in-free-trial→close
   mints permanent discounts for free.
4. **Minor consent + ownership.** Parent creates/owns the account & consents
   (required under India DPDP / China PIPL too). Needs: a parent↔child account
   link, a DOB/age gate, and a stored consent record. Currently **unbuilt** —
   `learners` is 1:1 with `auth.users`, no parent/guardian/DOB/consent fields.

## BSC narrative (why this passes Better × Simpler × Cheaper)
- **Better:** clearest possible learner story ("£5–£10 for the same thing as £15,
  and your teacher follows along"); directly feeds the tutor commission flywheel.
- **Simpler:** one identity (email+OTP), one learner gate (play-to-yellow), one
  platform gate (time-based), no special "membership" feature tier.
- **Cheaper:** reuses gates already built; the only new work is channel-price
  stamping + a roster flag, both derivable from existing state.
