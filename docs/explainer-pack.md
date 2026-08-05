# Explanation pack — compiled render

**Version `ffbbb4a7dade` · generated 2026-08-03 by `tools/explainer/compile.mjs`. DO NOT EDIT — edit the rulings/rules and recompile.**

Truth manifest: 10 verbs (Invite a person · Get a shareable link · Add a group · Add a school · Mint a demo org · Courses · Rename · Refresh demo activity · Delete · See insights) · stat words: Demo · Paid — all courses · Class sessions this week · Class practice · Students · Teachers · Practice hours · Groups · Learners · Classes practising this week · 4 measures · windows: Today / Last 7 days / Last 30 days / All time.

## admin

### org

An organisation is groups all the way down: groups inside groups, each with its own leader, with
learners wherever they belong. Nothing here assumes a school — the numbers are always **everyone
below this**, counted once.

**Invite a person** makes a personal link that IS their login — email it and they're in, no
sign-up, no password. **Get a shareable link** makes an open link for a role — a group leader or
a learner. **Add a group** grows the tree; **Rename** and **Delete** reshape it — delete always
shows you exactly what would go before it goes. **See insights** compares this group's pace with
the levels above it.

If schools ever live below this, the pages inside that part of the tree speak the school
language — teachers, classes — same bones, different dressing.

### group

Every page here is the same page. A **group** can hold groups, schools, teachers, classes and
learners — a school is just a group with billing attached, a programme or region is just a label.
The map on the left is the whole organisation: tap up, down or sideways and the page stays put.

The numbers are always **everyone below this** — this group and everything under it, counted
once. **Class practice** leads because classes practising together is the metric that matters in
a school; individual accounts are the bonus on top.

The buttons along the top act on this group. **Invite a person** makes a personal link that IS
their login — email it and they're in, no sign-up, no password. **Get a shareable link** makes an
open link for a role — anyone who taps it joins here. **Mint a demo org** builds a working demo
school under this group in one gesture. **Courses** is one switch: a trial teaches one course, a
paid group has every course. **See insights** compares this group's pace with the levels above it.
**Add a group** and **Add a school** grow the tree; **Rename** and **Delete** reshape it — delete
always shows you exactly what would go before it goes. **Refresh demo activity** keeps a demo
org's numbers looking freshly practised.

### school

A school is a group with billing attached — same page, same numbers, plus the trial-or-paid badge
in the header. Its people are teachers; a teacher becomes real the moment they have a class.
**Get a shareable link** here is how a school fills itself: one teacher link for the staffroom,
one learner link for the pupils. The links ledger at the bottom shows every way into this school
and lets you switch any of them off.

### class

A class is a learner in its own right: it has its own course position, moved by the teacher
pressing **Play as class**. That shared journey is the headline; each student's own practice is
the layer below. The belt strip shows where the class sits on the course; each student row
carries their own belt, practice hours and last-active — a quiet flag marks anyone drifting.
**See insights** compares this class's pace with its school and everywhere above it.

## leader

### org

This is your organisation, one page per level. It's groups all the way down: a group can hold
more groups — each with its own leader — or learners directly. The map on the left is the whole
tree; tap any name to look closer, and the page stays put.

The numbers are always **everyone below this level**, counted once. **Practice hours** is the one
to watch — it's your organisation actually using the language.

You can grow it from right here. **Invite a person** makes a personal link that IS their login —
email it and they're in, nothing to set up. **Get a shareable link** makes an open link anyone
can use to join this level as a leader or a learner. **Add a group** creates the next level down.
**See insights** shows the pace here against the levels above.

### group

This is your organisation, one page per level. The map on the left runs from your top group down
to every school and class — tap any name to look closer; the page stays put.

The numbers are always **everyone below this level**, counted once. **Class practice** leads:
classes practising together is what a language programme lives on, so that's the number to watch.
Individual student practice sits underneath it as the bonus.

You can bring people in from right here. **Invite a person** makes a personal link that IS their
login — email it to a school leader or teacher and they're in, nothing to set up. **Get a
shareable link** makes an open link anyone can use to join this level in a given role. **See
insights** shows the pace here against the levels above, over the window you choose.

### school

Each school is the same page one level down: its teachers, their classes, and the same numbers
scoped to just that school. A school comes alive through its links — one for teachers, one for
learners. If a school shows no teachers yet, sharing its teacher link is the whole job.

### class

A class page is where the teaching shows. The class travels the course **together** — that shared
position is the headline, moved every time its teacher runs a class session. Each student row
underneath carries their own pace, practice and last-active, with a quiet flag for anyone
drifting. **See insights** compares this class's pace fairly with its school and the levels above.

## school_admin

### school

This is your school. Its life is teachers running classes: a teacher becomes real the moment they
have a class, and a class becomes real the moment it practises together. The teacher link brings
staff in — email it or share it in the staffroom; clicking it is the whole sign-up. The learner
link does the same for pupils.

**Class practice** is the number to watch: it counts your classes practising together, which is
what moves a whole class along the course at once. Individual practice at home is the bonus layer
on top, visible per student inside each class.

### class

Each class page shows the shared journey — how far the class has travelled together — and every
student's own pace underneath. A quiet flag marks students drifting away from the class; that's
an invitation to look, not an alarm.

## teacher

### class

Your class is a learner in its own right: it has its own place on the course, and it moves when
you press **Play as class**. That shared journey is the headline — twenty minutes together moves
the whole class at once.

Each student row shows their own practice: belt, hours, last time they practised. A quiet flag
marks anyone drifting — worth a word, not a worry. Your class link is how students join: share
it once, they tap it, give a name, and they're in your class on your course.

## Noticing rules

- **silent-class** (node, class): "This class practises together, but not this week — worth a look at how the pace is holding?" → insights
- **quiet-subtree** (node, group/school): "None of the {classPractice.classCount} classes below have practised together this week — the class list shows who last played when." → lens:classes
- **school-needs-first-teacher** (node, school): "No teachers here yet — want a 30-second tour of bringing the first one in?" → walk:invite-first-teacher
- **school-no-teachers** (perChild, group): "{name} has no teachers yet — its teacher link gets them started." → child-home
- **org-needs-first-person** (node, org): "Nobody here yet — want a 30-second tour of bringing the first person in?" → walk:invite-first-person
- **org-not-started** (node, org): "{node.rollup.learnerCount} people belong below this group, but none of them has practised yet — the links ledger at the bottom shows who has actually been sent a way in." → insights
- **group-nobody-in-it** (perChild, org): "{name} has nobody in it yet — click on the group to add individual members." → child-home
- **students-quiet-week** (countWhere, class): "{count} of the students haven't practised on their own this week — the rows below show who." → students
