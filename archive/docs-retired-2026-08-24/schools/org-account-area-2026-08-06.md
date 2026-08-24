# Your account — a permanent home for the password and the install

**2026-08-06 · verified live on dev · org lane**

## What was wrong

An org leader could set a password and install the app in exactly one moment of
their life: the first-login flow, before their first add. That flow is good and
it stays. What it could not be is a **home**.

It fires once, and then it is gone. A leader who tapped "not now" on the
install had no second chance. A leader wanting to change a password six months
later had nowhere to go. And because the flow's own fields only exist while its
card is open, neither action could be registered as a walk in How-this-works —
so two things the product genuinely does were invisible in the place that
lists what the product does.

## What is there now

A permanent **Your account** card, last thing on an org leader's own page,
under Ways in. The pairing reads the right way round: *Ways in* is how other
people get in; *Your account* is how **you** get back in.

Two rows, both live all the time:

- **Password** — says "No password yet" and offers *Set a password* before, and
  "Password / Change it" after. The form opens in place, right on the row.
- **Install** — knows what device you are on. A computer is offered a Chrome
  app in its own window; a phone is offered a home-screen icon. If the browser
  can install in one tap it does it; if not it walks you through your browser's
  own menu, and brings you back to your own page afterwards rather than the
  learner home. Already installed, it goes quiet and just says so.

Nothing was rebuilt to do this. The password runs the first-login flow's own
validator and save; the install runs its own device detection and wording. If
one changes, both change — there is no second copy to drift.

## The actual point: they are real features now

Both are registered as proper walks through the real walkthrough engine — the
invitation-only one that never plays uninvited — and both now appear in
**How this works** for a leader, alongside "Ways in" and the rest:

- *Show me — Set or change your password*
- *Show me — Put the app on your device*

Three paced beats each, ending on a line that makes the durability explicit:
"if you said no on your first visit, this row is still waiting whenever you
change your mind."

One small thing worth knowing, because it is the kind of detail that decides
whether a walk works six months from now: the walk anchors sit on the **rows**,
not the buttons. The install row loses its button once the app is installed —
which is exactly the moment a button-mounted anchor would vanish out from under
a walk still pointing at it.

## Verified live

Run against the deployed dev site as a real leader, through their own sign-in
link — **20 of 20 checks pass**:

- the card renders on the leader's node page, with all three walk anchors
- the password form opens in place, and a mismatched confirmation is refused
  before anything is sent
- the install row is desktop-framed on a desktop, and routes to the full guide
  carrying the return path back to the leader's own page
- both walks are offered in How this works, both start through the real engine,
  both scroll the card into view, both end on Escape

**Deliberately not done:** no real password was ever submitted. This ran
against a real leader account on dev, and changing a real person's credentials
is not a probe's business. Everything up to the save call was exercised for
real; the save itself is covered by the unit tests.

## One thing found along the way, not fixed

If you tap *Show me how* on the install row, land on the install guide, and
come **straight back**, the next walk you start shows its card but does not
scroll down to the card it is talking about. The restored page resets its
scroll to the top just after the walk has already scrolled to its anchor.

This is the walkthrough engine's own scroll-restoration timing, shared by all
eleven walks, not anything about this card — a walk started on a normally
loaded page scrolls correctly every time, which is what the checks above
measure. It is small and it is cosmetic, but it is real, and it is written down
here rather than left for someone to rediscover. Worth a scoped fix in the
engine if it ever bites in practice.

## Not touched

The first-login flow is byte-for-byte unchanged. It remains the front door for
a brand-new manager; this is the second, permanent home for the same two
actions afterwards.
