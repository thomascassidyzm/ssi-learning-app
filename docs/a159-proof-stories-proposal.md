# The proof stories: where they should live in the app

*A-159 · proposal for taste-check, 2026-08-18. Nothing applied. The URL verification behind this is a
separate pass — see "What is actually verified" below.*

---

## Starting from your own hedge

> "I know that once people have come to the app, they will have probably already seen these, but I
> think they're still fairly useful to have."

That hedge should drive the whole design, and it argues against almost everything you could build
here. A gallery of celebrity videos inside a learning app is a shrine to a thing the learner has
already walked past on the way in. It would be the most expensive possible answer to "fairly useful
to have."

So the proposal is deliberately small: **no new surface at all.**

---

## The proposal — one line, in the block that already makes the claim

Why-this-works already ends with the block that stakes the evidence claim:

> **Where all this comes from.** "None of it is a hunch. SSi has been running this as action research
> since 2009 — real learners, real conversations, and the method changed whenever the evidence said
> it should. Most recently Aran worked through Croatian an hour a day, which gave the clearest picture
> yet of what happens and when."

That block asserts proof and then offers none. It is the only honest place in the app for a proof
story, and it needs exactly one line — a quiet text link at the end of it, in the same idiom as the
How-this-works link itself.

| | |
|---|---|
| **Now** | Block ends: "Which means you do not have to take a view on the method, or work out how to study, or build a plan. You just press play." |
| **Proposed** | *unchanged*, **plus one quiet link beneath it:** "If you want to see it happening to other people — the ten-day experiments, the learners, the folk we have taught on telly — it is all on our website." |

Tapping it opens `saysomethingin.com` **inside the app**, in the overlay that shipped today. It frames
cleanly — that is verified live. The learner reads it and closes it; they never leave the app and
never lose their place. This is the composition the brief anticipated, and it is the reason the two
parts belong in one job: Part 1 is what makes Part 4 cost nothing.

**Why not deep-link each story separately.** Three named links would date the moment a page moves,
would need per-story copy that asserts facts, and would put a maintenance burden on a surface whose
own author says people have already seen it. One link to the site, and the site does its job.

---

## Better × Simpler × Cheaper

- **Better:** the one block in the app that claims evidence stops asserting and starts showing, one
  tap away, without hijacking anyone's session.
- **Simpler:** it *deletes* the alternative — no gallery, no video player, no story list, no new
  route, no images to ship. One sentence and one existing component.
- **Cheaper:** three lines of code, zero new infrastructure, zero content to keep in sync, and it
  reuses the overlay that landed this morning rather than adding anything beside it.

---

## What is actually verified, and what is not

This matters more than the design, because the copy above deliberately names **no person, no date and
no claim** — and that is not shyness. It is that half the stories could not be verified.

**Verified live, framing cleanly:**

- **Japanuary** — *Can You Really Learn Japanese in 10 Days?*, published 29 Jan 2025, describing the
  10-day challenge begun 13 Jan 2025 in Eryri. Matches your account exactly.
- **Celebrity videos** — two live index pages, *Iaith ar Daith Celebrity Testimonials* and *Celebrity
  Coaching*, carrying around twenty named people across four series.
- **The three learner stories** already cited in onboarding — Nigel, Mike Kent, Jeremy — all still live.

**Explicit gaps — nothing was invented to fill these:**

1. **The Irish experiment write-up.** Not on the site. The full post history for Jul 2025 – Jan 2026
   contains three posts, none of them about a ten-day Irish experiment.
2. **The Irish radio interview.** Not found anywhere — not on the site, not on the forum, not via
   search. **This is the one thing I need from you: which station or programme was it?** With a name
   it can be found in minutes; without one, guessing would put a false claim about real people on
   screen.
3. **The Croatian write-up.** Not on the site at all. The only Croatia-adjacent material is a forum
   thread titled *75 days of Croatian — livestreaming*, which is not confirmed to be the same story
   and is not a citable page. Note this also means your correction — Aran alone, an hour a day — could
   not be checked against any source, because there is no source. Nothing contradicts you; nothing
   confirms you either. The app copy has been corrected to match your account, which is the right call
   since you were there.
4. **A Japanuary video.** Only the written write-up exists.

The proposed sentence survives all four gaps intact, because it points at the site rather than making
a claim. That is not a coincidence — it is why it is written that way.

---

## Recommendation — answerable in one word

**My recommendation: LINK.** One sentence at the end of "Where all this comes from", opening the site
in the in-app overlay. It is the cheapest thing that answers "fairly useful to have" honestly, and it
is the only version that cannot go stale or say something untrue.

Pick one:

- **LINK** — build it as above: one quiet line, opens the site in the app.
- **NAMED** — you want the specific stories named in the copy (Japanuary, the celebrity coaching). I
  can do that today for the two that are verified, and it stays wrong-proof — but it dates faster.
- **NOTHING** — your hedge wins; they have seen it already, leave the block as prose. A completely
  legitimate answer and it costs nothing.

Separately, and regardless of which you pick: **which radio station or programme was the Irish
interview?** That is the only blocked item.
