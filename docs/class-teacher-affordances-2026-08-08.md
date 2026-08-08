# Moving teachers around — what was wrong, and what to click now

**8 August 2026.** Answering your 00:50 note: *"I couldn't see anything about a class
having a second teacher added to it, and moving teachers around to different classes,
and adding an existing teacher to a different class."*

You were right about all three. They had **two different causes**, which is why none of
them was obvious.

---

## What was actually wrong

### (a) Add a second teacher to a class — it was there, and you couldn't have found it

This one was built and deployed to staging and production the whole time. It was the
**fourth card down a right-hand rail**, and on a narrow screen the page collapses to one
column, which drops that whole rail **below the entire student roster**.

So the order you were scrolling through was: class title → the whole roster → Course
Journey → Belt distribution → Practice min/student/week → **Teachers**.

I reproduced it on staging as a school leader before changing anything. The screenshot
shows the Teachers card sitting fourth, with a working *Add a co-teacher* button and two
teachers listed. Nothing was broken and nothing was gated wrongly — your account had full
permission the whole time. It was simply last in the reading order, and a verb nobody can
find is, to the person looking for it, a verb that is not there.

**Cause: discoverability. Not permissions, not a missing feature.**

### (b) Move a teacher between classes, and (c) put one teacher on several classes

These were **genuinely not there**. The work exists — it has sat on the `dev` branch since
7 August and was never promoted. You mentioned believing it had shipped; on the evidence
it had not reached staging or production.

**Cause: unpromoted work.**

---

## What I changed

**The Teachers card moved to the top.** Out of the rail, full width, directly under the
class title and above the roster, on every screen size. It is the same one card read
earlier — nothing is duplicated. Its position is now pinned by a test, so a future layout
change cannot quietly bury it again.

**The wording is yours.** *Add a co-teacher* is now **Add another teacher**, and a line
underneath states the rule outright rather than making you infer it: a class can have as
many teachers as you like, and a teacher can take as many classes as you like.

**"Other classes" on every teacher's row.** Opens the school's classes as a tick list with
that teacher's current ones already ticked. A move is one untick and one tick. Belonging to
several classes is just several ticks. It is the same control for both, which is why
there is no separate "move" button to find.

**The unpromoted work came across as-is**, rather than being rewritten — two
implementations of "assign a teacher to classes" would have been the worst outcome.

**A walkthrough now teaches it.** *Show me — Move a teacher to another class* appears on
the class page. The house rule here is that a new capability ships with its walkthrough or
it isn't shipped, and this one had none — which is the same failure as the buried card,
one layer up.

---

## What to click — all three verified live on staging, signed in as a school leader

I clicked every one of these on staging as `zz.school.leader` and read back what the
screen actually said. Screenshots are in the repo alongside this note.

Your leader account lands on the **org/school node home**. The teacher list you want for
the people-first route is on that page, not on `/schools/teachers` — that URL redirects
there anyway.

### (a) Add a second teacher to a class

1. **Classes** in the top nav
2. tap the class
3. the **Teachers** card is now near the top, just under the class name
4. **Add another teacher**
5. pick a name from the list
6. **Add**

Verified: the Teachers card renders at 345px down on desktop and 703px on a phone, with
the Roster below it at 621px and 1032px. **Above the fold on both** — where it used to be
roughly 2,000px down a phone page, under the whole roster.

If the picker is empty, that colleague has not joined the school yet — use *Create a
co-teacher link* in the same card to bring them straight in.

### (b) Move a teacher to a different class

1. **Classes** → the class they are on now
2. the **Teachers** card at the top
3. **Other classes** on that teacher's row
4. **tick** the class they are moving to, **untick** the one they are leaving
5. **Save**

### (c) Put one teacher on several classes

Same control, you just don't untick anything:

1. **Classes** → any class they are on → **Teachers** card → **Other classes**
2. tick every class they should take
3. **Save**

Or start from the people side instead, which is the way a head usually thinks:

1. **Dashboard** (your landing page)
2. the **All teachers** filter in the *Below this* list
3. **Assign to a class** on their row
4. tick the classes → **Save**

Verified: *Other classes* appears on every teacher row, and the modal opens saying
*"Tick every class … should teach. Unticking a class they teach now takes them off it — so
a move is one change here, not two."* with their current class **already ticked**. On the
Dashboard route, *Assign to a class* appears on all three teacher rows.

If one of several changes fails, it names the class that failed and shows the reason,
rather than saying everything saved.

---

## Where it is

Live on **staging** and on **production** — I confirmed both are serving the new code.
Also on `dev`. The database side of this was already in place; nothing there needed
changing.

## Two things worth knowing, neither of them broken

**The teacher list on the class page can take 10–45 seconds to appear** on the test
school. While it does, the card says *"Loading the teacher list…"* — and, correctly, never
*"no teachers"*. That slow read is a pre-existing database timeout on class pages, not
something this change introduced, but it is why *Other classes* may not be there the
instant the page opens. If you land on a class and the teacher list is still loading, give
it a moment.

**The Classes tab now takes about 3–4 seconds longer** for a leader, because it also asks
"which classes does this person teach themselves?" — needed so a head who also teaches
sees both halves of their world rather than whichever was checked first. It lands
correctly; I compared it against the previous build to be sure it was slower, not broken.

## One thing for you

The teacher-side entry (*Assign to a class* on the Dashboard teacher list) has no
walkthrough of its own — only the class-page route does. **Worth adding one?** One word is
enough.

---

### Notes on judgement calls I made without asking

- **Landed on `main` first**, per your standing rule that org/teacher/admin-class work
  lives and is tested there, then put the same change on `staging` and `dev`. I moved it
  across as scoped cherry-picks rather than merging all of `main` into `staging`, because
  a full merge collided with the Easy-mode and listening work currently in flight — those
  are someone else's files and not mine to resolve. Nothing learner-facing rides along
  with this.
- **If a move leaves a class with no lead teacher**, the move still goes through and the
  state is visible rather than refused. Joining a class that already has a teacher never
  takes the lead — a supply teacher must not displace anybody. Handing the lead over is
  still *Make lead*, where it always was.
- **No bulk "move all teachers" tool** — nothing you said asked for one.
