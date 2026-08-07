# Co-teaching for classes — shipped (A-74)

The Welsh teacher can share a class with a colleague or a supply teacher. Built 2026-08-06, on `dev`, deployed and verified live.

---

## What a teacher can now do

Open a class → a **Teachers** block lists everyone who teaches it, with the lead marked. Add a colleague, remove one, hand the lead over. That panel did not exist this morning; the data model behind it has been there since June.

For a supply teacher with no account yet, there is now a **class-scoped teacher invite link** — redeeming it puts them straight onto that one class rather than the whole school.

---

## The bug that actually mattered

A co-teacher added yesterday would have got the class, been able to *rename* it — and then seen a **completely empty dashboard**. No pupils, no sessions, no progress. Nothing broken on screen, just blank.

The cause was one missing clause deep in the database's permission rules. Measured live against a real 26-pupil Welsh class:

| | lead teacher | co-teacher, before | co-teacher, after |
|---|---|---|---|
| class roster | 27 | **1** (themselves) | 27 |
| pupils | 26 | **0** | 26 |
| sessions | 411 | **0** | 411 |
| progress rows | 326 | **0** | 326 |

Fixed, and checked in both directions: the lead teacher and the school admin can see **exactly** what they could before, and an unrelated stranger still sees zero on every table.

### The scouts disagreed, and both were wrong

One scout read the checked-in database dump and said "already fixed, no work needed". The other probed production and said the opposite. I read the live database.

The dump was **not** stale — it matched production byte for byte. The permission rule mentions the co-teacher check in **two** places, and only one of them was the one that gates children. A grep hit is not a branch. Worth knowing, because the standing advice "the dump has drifted" would have sent the next person looking in the wrong place.

### A mistake I made and caught

My first version of the fix accidentally widened the rules from "logged-in users" to "everyone". **Nobody was exposed** — a second, independent layer of permissions still shut anonymous visitors out completely, which is exactly what that layer is for. But it was real drift, so I corrected it and added an automatic check so it can't happen again quietly.

---

## The repair underneath

The teacher↔class link was only half-written for most of the estate: **47 of 62 classes** had a teacher recorded the old way and no proper relationship record. Since all the new co-teaching permissions read the *relationship*, those 47 classes would have treated their own teacher as a stranger.

- 47 relationships created
- 11 stale records pointing at deleted classes retired
- result: 13 → **60** teacher-class relationships, reconciled exactly

Class creation now writes both halves, so it can't rot again.

---

## Things that were quietly broken and now aren't

- **Removing a teacher from a school didn't remove them from its classes.** They kept seeing pupil data. This was the security-relevant one. Now revoked properly, and the lead is handed on so the old record can't let them back in.
- **A co-teacher's own class list was empty** — both places that build it only ever matched the single "lead teacher" field.
- **A co-teacher couldn't create a student join code** for their own class — while already being allowed to *delete* the class entirely. That absurdity is gone.
- **One person's teacher invite silently did nothing.** A defect could mint a link that pointed at no school; redeeming it wrote a meaningless record. It had already fired once, on 19 July. That account has no activity and never got access; I've retired the junk record and closed the hole.
- **And 12 dead invite codes were still live.** All minted in a single 24-minute test session on 16 July, all granting nothing at all, all still redeemable — one of them is the redemption above. Redemption now refuses them outright, and I've deactivated all 12 so nobody is handed a code that leads nowhere. 19 teacher codes remain live, every one properly scoped.
- **The endpoint the whole feature rests on had no tests.** It has 26 now.

---

## What needs you

**One question, and it isn't urgent: does a second teacher on a class use a paid seat?** Nothing in the system enforces teacher seats today, so nothing changed either way — I have deliberately not made co-teachers free *or* paid by implication. It's a commercial call, not a technical one, and it doesn't block anything.

## What I couldn't prove

Everything is proven by tests and by direct measurement against the live database. What nobody did was **click through the finished panel as a real signed-in co-teacher** — that needs a test teacher account we don't have. The panel is confirmed present in the deployed dev build and the permissions are confirmed correct at the database level, but a human should do one pass before this goes to staging.

---

## Checks

Core build, both typechecks, **1,087 API tests**, **1,617 player tests**, lint at zero errors — all green, re-run on the final commit after every worker had landed.

Two workers reported broken tests in their own write-ups. Those were transient: four agents were editing one working tree at once, so each briefly saw another's half-finished edit. Re-verified on the final commit — nothing is broken.
