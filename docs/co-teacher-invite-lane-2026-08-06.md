# Co-teacher invite links, and the null-tag defect that had already fired

2026-08-06 · A-74 co-teaching · invite/redeem lane

## What a teacher can now do

A teacher of a class can hand out a link that puts a **co-teacher or supply teacher into that
one class** — not into the whole school, and without anyone becoming the class's lead. Before
today an invite could only say "you're a teacher at this school"; there was no way to say "you're
a teacher of *this class*". Thirty-two teacher invite codes exist in the live database and not one
of them is class-scoped, because it wasn't expressible.

Three things had to line up, and all three now do:

- **Minting.** A teacher invite can carry a class. The school it belongs to is looked up from the
  class by the server, never taken from whoever is asking.
- **The capture screen.** The link now names the class, not just the school — a supply teacher can
  see which class they're being asked to join.
- **Redemption.** Clicking the link puts the person on the class *and* in the school, in one go.
  It never touches who the class's lead teacher is. And if they're already in the school — the
  normal case for a colleague down the corridor — they still get the class. That sounds obvious;
  the old check would have told them "already redeemed" and given them nothing.

## The guard that was blocking supply teachers

Minting a **student** join code for a class was gated on being its *lead* teacher. So a co-teacher
could not invite pupils into a class they co-taught — while the class-deletion endpoint already
let that same co-teacher **delete the class outright**. That asymmetry is gone: both now ask the
same question, "are you a teacher of this class?", which is the question the rest of the
co-teaching work is built on.

## A real defect, found in the live data

A scout had flagged a suspected bug: certain invite links could write a membership row pointing at
nothing — a literal `SCHOOL:null` — and marked it "a code-path inference, not a verified bug".

**The route the scout guessed is closed.** That mint refuses to attach a class to anything but a
student link, so it cannot produce the broken row. There's now a regression test pinning that shut.

**But the defect is real, and it has already happened.** Reading the live database directly:

- **12 teacher invite codes exist that grant nothing at all** — no class, no school, no group.
  They were created on 2026-07-16.
- One of them was redeemed on 2026-07-19.
- That redemption wrote **exactly one `SCHOOL:null` membership row**, which is still there.

That person was handed a membership that grants access to nowhere while counting as a membership
in every query that reads memberships. It is the silently-empty-dashboard failure, already served
to somebody once.

Redemption now **refuses** a link that grants nothing, with a message saying so, instead of writing
the garbage row. The same hardening covers the student equivalent (`CLASS:null`), which had been
knowingly left in place with a test documenting it — that test now asserts the refusal instead.
There is one such student code live; it has never been redeemed.

**Two things for the database owner to decide** (I have read-only access and wrote nothing):

1. The 11 unredeemed dead teacher codes — deactivate them? They grant nothing, so anyone who
   clicks one now gets a clear refusal rather than a broken account, but they're still live links.
2. The one `SCHOOL:null` row — remove it? Whoever holds it has no working access either way.

## What I could not verify

The new branches sit behind a real teacher login, and the button that mints a class-scoped
co-teacher link is another worker's piece and isn't built yet. So the code is deployed to dev and
its route answers, but **I have not exercised the new invite end-to-end against a live account** —
the proof so far is the test suite (272 tests green across the invite/redeem/groups lane, 8 of them
new for this behaviour) plus the live-database reading above.
