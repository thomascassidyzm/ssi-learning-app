# The Library, explaining itself

**A-159 · landed on `dev` · 2026-08-18**

Look at it here — open on your phone, then tap the Library button:
**https://ssi-learning-app-git-dev-zenjin.vercel.app/?screen=library**

---

## Before

The Library showed your belt, your position, the course list and a sign-in nudge, and said
nothing about any of it. The twelve blocks of learner prose we wrote — how this works, why it
works, the thirty hours — lived on `/me`, a page nothing in the app links to. In practice they
were unreachable.

## After

Beneath *Your Progress*, a quiet **How this works** link with a soft-pulsing dot. Closed by
default. Someone who came in to switch course never has to walk past a manual.

Tap it and the **doing comes first** — three walkthroughs, each a "Show me" that runs on the
real page over your own data, exactly the protocol the schools and organisation dashboards use.
The methodology sits underneath, still collapsed, as the layer for the curious: **Using the app**
and **Why this works**, the existing prose, unchanged.

The pulse stops the first time you open it and never comes back. Nothing opens uninvited,
nothing auto-plays, and Esc or Skip ends any walk.

---

## The three walkthroughs

**Where you are in this course** — the progress card, the belt strip, the position track, and
the belt browser. Four steps.

**Choose something else to learn** — the search box, the course grid, and what happens to your
current course when you switch: nothing. Three steps.

**Save your progress** — the guest sign-in banner: an email and a code, and everything you have
already done comes with you. Two steps. Offered **only to guests**, because it points at a
banner that only guests see.

---

## The one piece of new writing — for your taste-pass

Belts were the real gap. The Library shows a learner their belt and how far along it they are,
and nothing in the app had ever said what a belt is. This is now step 2 of *Where you are in
this course*, and it is the only new learner-facing prose in the whole build:

> Those eight coloured dots are **belts**, and the filled one is where you are now. A belt marks
> how far along the course you have come — it is a position, not a grade, and there is nothing
> to pass. You move to the next one simply by carrying on.

Change a word and I will change it — it is one line in one JSON file.

---

## One thing for you to rule on

**Should walks reach through into the player?**

For this first slice every learner walk anchors to something inside the Library overlay. The
Library is drawn *over* the player, so an anchor in the player behind it may be covered or not
even mounted — a walk pointing at something you cannot see is worse than no walk. Where the
doing genuinely lives in the player, the walk says so in its last line instead: *"close this and
press play."*

If you want walks that point at the player itself — what pressing play does, what a go is, the
Easy/Fast choice — that is a real next slice, and it needs the walks to close the Library on
their way through. Say the word.

---

## What it cost

Nothing new was invented. The walkthrough engine, its compiler, its drift gates, the overlay
already mounted app-wide, the pulse-state module and all the prose already existed; this wires
them to a surface they had never been mounted on. Zero runtime tokens, zero new endpoints, zero
new queries.

And the safety property comes free: the walks are compiled against the live source, so if anyone
renames a button in the Library, **the build fails** rather than the explanation quietly starting
to lie.
