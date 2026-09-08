# Walkthrough pack — compiled render

**Version `cac089f93656` · generated 2026-09-08 by `tools/walkthrough/compile.mjs`. DO NOT EDIT — edit tools/walkthrough/walks/*.json and recompile.**

## choose-something-else-to-learn — Choose something else to learn

Personas: learner · place: library

1. [`library-course-search` · next] Everything you can get to lives below, and this box is the quick way in. Type a language and the list narrows as you go.
2. [`library-course-grid` · next] Tap any one of these and you are straight into it — no setting up, no starting over.
3. [`library-course-grid` · next] Your current course is not going anywhere. Each one keeps its own place, so you can have a poke at a second language and come back without losing an inch in the first.
   - terminal: That's the Library. Close it and press play to carry on with the one you are in.

## finding-your-way-around — Finding your way around the organisation

Personas: admin, leader, school_admin · place: node-home

1. [`node-map-rail` · next] This column is the map, and it never goes away. Read down it for the path from your top level to the one you are standing on.
2. [`node-map-rail` · next] Under your own level sit its neighbours and everything hanging beneath it, so you can always tell how deep into the organisation you have gone.
3. [`node-map-rail` · next] Tap any name to move straight there. The page rebuilds around the new level and the map redraws with it. A leader only ever sees their own part of the organisation — the map is trimmed by the server, not hidden in the page.
   - terminal: That's the map — one column that always answers where you are. This tour changed nothing; only your own taps do.

## go-back-over-something — Go back over something

Personas: learner · place: library

1. [`library-belt-browser` · click] Nothing is ever locked behind you. Tap here to open the whole course up.
2. [`belt-browser-list` · next] Every belt is listed, with a tick on the ones you have already come through. Open one and you can look through everything you met there.
3. [`belt-browser-list` · next] Choosing something in there does not just show it to you — it moves you to that point and starts you off from there. So use it when you genuinely want to go over old ground, not to peek.
   - terminal: If you land somewhere you did not mean to, come straight back in here and pick your way forward again. Nothing is lost by wandering.

## hand-over-the-lead — Hand a class over to another teacher

Personas: teacher · place: class-detail

1. [`class-teachers` · next] One teacher on a class is the **lead** — the one the class is listed under, and the one a school admin comes to about it. When you move on from a class, that name should move too.
2. [`class-teacher-make-lead` · next] **Make lead** hands it to a colleague already on the class. It takes effect straight away, so add them first and hand over once you have.
3. [`class-teachers` · next] Nothing else moves. The pupils, their progress and every session stay exactly where they are, and you stay on the class as a teacher — you have passed the lead, not left.
   - terminal: That's handover — the lead is a name, not a wall. Nothing changed while you read this; only your own taps do.

## how-far-a-class-has-travelled — How far a class has travelled

Personas: admin, leader, school_admin · place: node-home

1. [`class-journey` · next] **Course journey** is where the class has got to, measured in LEGOs — the individual pieces of language the course teaches. The bar is how much of the course it has covered together.
2. [`class-journey` · next] The line underneath gives both figures: the class's own shared position, and the average its students have reached learning alone. It then names the next belt and how many LEGOs are left to reach it.
3. [`class-journey` · next] A class that has never played together has no shared position at all, so the bar falls back to the students' average and says as much.
   - terminal: That's the distance travelled, class first and students alongside. This tour changed nothing; only your own taps do.

## how-fresh-these-numbers-are — How fresh these numbers are

Personas: admin, leader, school_admin · place: node-home

1. [`node-updated` · next] **Updated** and a time — that is when the figures below were last fetched, so you always know whether you are reading this morning or this minute.
2. [`node-updated` · next] Pull the page down or reload it and the numbers are fetched again; the stamp moves with them. Nothing is shown until a load has genuinely succeeded, so an empty stamp means the numbers have not arrived rather than that they are old.
   - terminal: That's the freshness of everything under it, in one line. This tour changed nothing; only your own taps do.

## install-the-app — Put the app on your device

Personas: leader · place: node-home (org/group/school)

1. [`account-card` · next] **Your account** holds the two things that are about you rather than your organisation: your sign-in, and the app on the device you are holding.
2. [`account-install` · next] This row already knows what device you are on. On a computer it offers to install the app in its own window; on a phone it offers to add it to your home screen. Same organisation either way — it just saves you finding the tab.
3. [`account-install` · next] If your browser can do it in one tap, the button does it. If it cannot, the button walks you through your browser's own menu instead — and you can remove the app again any time, like any other app.
   - terminal: Nothing here is one-time — if you said no on your first visit, this row is still waiting whenever you change your mind.

## invite-a-supply-teacher — Invite a teacher who isn't here yet

Personas: teacher · place: class-detail

1. [`class-teachers` · next] Use this when the colleague has no account yet — a supply teacher starting on Monday, or someone new to the school. It saves waiting for an admin to add them first.
2. [`class-coteacher-link` · next] **Create a co-teacher link** mints a fresh link the moment you tap it. Whoever opens it lands as a teacher of this class, and of this school — not as its lead, and not over any of your other classes.
3. [`class-join-link` · next] Keep it apart from this one. This is the **student** link — anyone who opens it joins the class as a learner. One link makes a colleague, the other makes a pupil, so send them to the right people.
   - terminal: Short version: the teacher link is minted per colleague and puts them beside you, the student link is the standing one for the class. This tour minted nothing.

## invite-first-person — Bring your first person in

Personas: admin, leader · place: node-home (org)

1. [`verb-invite-person` · click] People join through here — tap **Invite a person**. Nothing is created until you submit the form.
2. [`invite-form-role` · next] Pick **Group leader** for someone who will run a group of their own, or **Learner** for someone who is here to learn. The link carries the role with it, so they arrive already belonging to this group.
3. [`invite-form-submit` · next] With their name filled in, this mints their own sign-in link — the account exists the moment you tap, and the link IS their login. No sign-up, no password. Send it any way you like.
4. [`ways-in-ledger` · next] Every link you mint lands here in **Ways in** — you can revoke it or re-mint it any time. Re-minting kills the old link on the spot.
   - terminal: That's the whole flow — the link is their login. This tour minted nothing; only your own taps do.

## invite-first-teacher — Bring your first teacher in

Personas: admin, leader, school_admin · place: node-home (school)

1. [`verb-invite-person` · click] People join through here — tap **Invite a person**. Nothing is created until you submit the form.
2. [`invite-form-role` · next] Pick **Teacher** — the link carries the role with it, so whoever clicks it arrives as a teacher of this school.
3. [`invite-form-submit` · next] With their name filled in, this mints their own sign-in link — the account exists the moment you tap, and the link IS their login. Send it any way you like.
4. [`ways-in-ledger` · next] Every link you mint lands here in **Ways in** — you can revoke it or re-mint it any time. Re-minting kills the old link on the spot.
   - terminal: That's the whole flow — the link is their login. This tour minted nothing; only your own taps do.

## invites-desk — The invites desk

Personas: admin · place: admin-invites

1. [`invites-mode-strip` · next] Three ways to mint access, one form: **Into an organisation** (role links into the tree), **Direct access** (codes and magic links), **New demo org** (a full practice tree).
2. [`invites-org-who` · next] **Who** silently changes what the submit button does: some options mint a FRESH link, others surface the STANDING link that already exists. Watch the button label switch as you change this.
3. [`invites-org-submit` · next] Every submit on this desk mints REAL access the moment you tap — a leaked leader link makes a stranger a group leader. This tour never taps it for you.
4. [`invites-active-toggle` · next] This pill is not just a badge — tapping it is a live kill-switch. It disables or re-enables the link across all four underlying access mechanisms at once.
   - terminal: Rule of the desk: look before you mint — everything here is live the moment it exists.

## move-a-teacher-between-classes — Move a teacher to another class

Personas: teacher · place: class-detail

1. [`class-teachers` · next] **Teachers** answers 'who teaches this class?'. A head usually wants the other direction too — 'which classes does this person take?' — and that is the same question read backwards.
2. [`class-teacher-other-classes` · click] **Other classes** on anyone's row asks it that way round. It never moves anybody on its own — it opens a list for you to change.
3. [`assign-classes-list` · next] Every class in the school, with the ones this teacher already takes already ticked. Ticking a second, or a third, is all 'belonging to several classes' means — there is no separate step for it.
4. [`assign-classes-list` · next] A move is just both at once: tick where they are going, untick where they are leaving. You are looking at the truth before you change it, so nothing here is a guess.
5. [`assign-classes-save` · next] Saving applies only the boxes you actually changed. If one of them fails, it says which class failed and why, rather than claiming everything saved.
   - terminal: That's moving a teacher — one untick, one tick, one save. This tour changed nothing; only your own taps do.

## practice-per-student-per-week — Practice per student per week

Personas: admin, leader, school_admin · place: node-home

1. [`class-benchmark` · next] **Practice min/student/week** is the top bar: this class's own minutes of practice per student per week.
2. [`class-benchmark` · next] The bars below it are the school average and the global average for the same course. Compare the lengths, and the numbers at the end give the exact figures.
3. [`class-benchmark` · next] Dividing by students and by weeks is what lets a class of nine and a class of thirty be compared honestly. A class with too little practice recorded shows a plain line saying so rather than a bar built from almost nothing.
   - terminal: That's this class's effort, put on the same footing as everyone else's. This tour changed nothing; only your own taps do.

## reading-insights — Reading your insights

Personas: admin, leader, school_admin · place: node-insights

1. [`insights-measure` · next] The **measure** picks what's being counted — progress, practice, class sessions. The line underneath the pickers says exactly what the current one means.
2. [`insights-window` · next] The **window** is the period the rate is computed over — shorter windows react faster, longer ones smooth the noise.
3. [`insights-compare` · next] **Compare to** puts an average alongside. Everything here is a rate, not a raw total — so groups of different sizes compare fairly.
4. [`insights-overview` · next] **Overview** takes you back to the same place's home — insights is a lens on where you already are, not a different page to get lost in.
   - terminal: Rates lead, position is context — and the picker text always says what a measure means.

## reading-one-students-progress — Reading one student's progress

Personas: admin, leader, school_admin · place: node-home

1. [`class-students` · next] **Students** is every student in the class, one to a row. The bar on each row is that person's own position in the course, in LEGOs.
2. [`class-students` · next] The small chart beside it is their practice over the past week, with the minutes named, and the dot and word at the start of the row say whether they are excellent, good, needing attention or inactive.
3. [`class-students` · next] Needing attention means either nothing for a fortnight or less than half the class average, so it is a prompt to look rather than a verdict. Tap a row to open that person.
   - terminal: That's the whole class read one learner at a time. This tour changed nothing; only your own taps do.

## reading-the-belts — Reading the belts

Personas: admin, leader, school_admin · place: node-home

1. [`class-belts` · next] **Belt distribution** is the shape of the class across the eight belts. A wide band of one colour means everyone is together; a long tail means they have spread out.
2. [`class-belts` · next] The list underneath names each belt and how many students hold it.
3. [`class-belts` · next] The ladder runs white, yellow, orange, green, blue, purple, brown, black, reached at 8, 20, 40, 80, 150, 280 and 400 completed sentences. Every screen in the product uses that one ladder, so a student never shows a different belt in two places.
   - terminal: A belt is distance travelled, never a grade and nothing to pass. This tour changed nothing; only your own taps do.

## reading-the-course-list — Reading the course list

Personas: learner · place: library

1. [`library-course-card` · next] Each card names the language you would be learning, and under it, the language it would be taught in. That second line is the one worth reading — it is what you will hear the prompts in.
2. [`library-course-card` · next] The right-hand side tells you where you stand. A coloured dot and a position means you have already started that one and it is holding your place for you.
3. [`library-course-card` · next] **Premium** with **Try free** next to it means the course is a paid one, and that you can properly get going in it first. You carry on until the app asks — nothing stops you mid-thought and nothing is taken before you have said yes.
4. [`library-course-grid` · next] Some languages offer more than one card — a different region or accent of the same language. Pick whichever you would rather end up sounding like.
   - terminal: Nothing here commits you. Tapping a card takes you into it, and every course you have touched keeps its own place waiting.

## run-class-session — Run your first class session

Personas: teacher · place: class-detail

1. [`class-join-link` · next] Students join with this link — share it and they sign up straight into this class.
2. [`class-join-code` · next] Prefer a whiteboard? **Show code instead** reveals a standing code — anyone who enters it at saysomethingin.com/redeem joins this class, until the code changes.
3. [`class-play` · next] **Play as class** is the heart of it: one device — yours — leads the whole class through a session, and it counts for every student on the roster.
   - terminal: When you're ready, tap Play as class for real — this tour never starts a session for you.

## save-your-progress — Save your progress

Personas: learner · place: library (guest)

1. [`library-save-progress` · next] Right now everything you have done lives on this device alone. It works perfectly well — but a cleared browser or a new phone takes it with it.
2. [`library-save-progress` · next] Tap this and you give us an email address, nothing more. We send you a code, you type it in, and your position is yours on any device you sign in on.
   - terminal: Everything you have already done comes with you — signing in adds your account to it, it never starts you again.

## set-your-password — Set or change your password

Personas: leader · place: node-home (org/group/school)

1. [`account-card` · next] **Your account** is your own corner of this page — not the organisation's, yours. Your sign-in and your device live here, and nothing in it is visible to anyone you have invited.
2. [`account-password` · next] If you arrived through a **link in an email**, that link will not last forever. A password is how you get back into your organisation from a new laptop, a new phone, or after clearing your browser.
3. [`account-password` · next] Tap **Set a password** and the form opens right here. You will sign in with your email address and that password from then on — and you can come back and change it any time.
   - terminal: That is the whole thing — one password, always changeable, always in the same place.

## share-a-class — Share a class with a colleague

Personas: teacher · place: class-detail

1. [`class-teachers` · next] A class does not have to be yours alone. **Teachers** lists everyone who teaches it, with the lead marked — a job share, a department colleague, a supply teacher covering for a fortnight.
2. [`class-teacher-add` · click] **Add another teacher** is how you share it. Nobody is added until you pick a name and confirm.
3. [`class-teacher-picker` · next] You can pick anyone already teaching at your school. If the list is empty, your colleague has not joined the school yet — the link underneath brings them straight in.
4. [`class-teachers` · next] What they get is the whole class: the roster, the sessions, the progress, and the right to run a class session. What they do not get is the lead — that stays with you until you hand it over.
   - terminal: That's sharing a class — same class, two teachers, one lead. This tour added nobody; only your own taps do.

## the-numbers-on-any-level — The numbers on any level

Personas: admin, leader, school_admin · place: node-home

1. [`node-stats` · next] This row always counts everything below the level you are on, each person once. A group's figures already include every school, class and learner underneath it.
2. [`node-stats` · next] **Class practice** is the hours classes have practised together beneath here, and **Classes practising this week** is how many of them have run a session in the last seven days.
3. [`node-stats` · next] **Teachers** and **Learners** count the people below this level, each once however many classes they are in. Stand on a class and the same row switches to that class's own sessions this week, its practice hours, its students and its teachers.
   - terminal: One row, the same grammar at every level. This tour changed nothing; only your own taps do.

## voice-and-pause — Voice and pause

Personas: admin, leader, school_admin · place: node-insights

1. [`insights-voice-pause` · next] **Voice and pause** sits at the bottom of the insights page and says what the microphone is actually giving us below this level.
2. [`insights-voice-pause` · next] Read the uptake figure first — it is how many learners have any mic-derived data at all, and everything beneath rests on it.
3. [`insights-voice-pause` · next] Then comes how the pause the app leaves learners to speak in is settling, and how they sound when they speak. Open a class or a learner within it to read the same thing at a smaller scope.
   - terminal: A learner with no microphone data is absent from these figures rather than counted as a zero, so the denominator is always stated. This tour changed nothing; only your own taps do.

## ways-in — Ways in — who can get in, and how to change it

Personas: admin, leader, school_admin · place: node-home (org/group/school)

1. [`ways-in-ledger` · next] Every way in, in one ledger: personal sign-in links and shareable join links, for everywhere below here. Filter by role or by place with the chips.
2. [`ways-in-copy` · next] **Copy** re-shares the same live link — always safe, nothing changes.
3. [`ways-in-remint` · next] **Re-mint** sits on a person's OWN sign-in link, and only there: it makes that person a new link and the old one stops working the moment you tap — if they bookmarked the old one they are locked out until you send them the new one. A shareable link has no Re-mint, because there is nobody to re-bind it to.
4. [`ways-in-revoke` · next] **Revoke** switches a link off. It's undoable — a revoked row grows a **Put back** button. For a shareable link this is how you retire it: revoke the old one, then make a fresh one.
5. [`verb-shareable-link` · next] And this is where a brand-new shareable link comes from — **Get a shareable link** at the top of this page, one per role. **Invite a person** next to it makes a personal link for someone you can name.
   - terminal: The short version: copy is safe, revoke can always be undone, re-mint is for one person's own link — and a new shareable link is made at the top of the page, not in the ledger.

## what-your-numbers-mean — What your numbers mean

Personas: learner · place: library

1. [`library-activity-stats` · next] These are a record of what you have already done. None of them is a target, and none of them is being compared with anybody.
2. [`library-stat-total-time` · next] Time is the time you have actually spent learning. If it ever shows a **~** in front of it, that is us working it out from how far along you are, because we have not logged the sessions themselves.
3. [`library-stat-phrases-learnt` · next] Phrases learnt is how many separate phrases every one of your courses has introduced you to so far. It is added up across all of them, so it grows whichever language you pick up.
   - terminal: Nothing here changes what you get next. The course follows your position, not these numbers.

## where-you-are-in-this-course — Where you are in this course

Personas: learner · place: library

1. [`library-progress-card` · next] This card is your whole position in the course in one glance. Nothing here is a score, and nothing here is counting anything against you.
2. [`library-belt-strip` · next] Those eight coloured dots are **belts**, and the filled one is where you are now. A belt marks how far along the course you have come — it is a position, not a grade, and there is nothing to pass. You move to the next one simply by carrying on.
3. [`library-position-track` · next] The bar underneath lays the whole course out end to end, with each belt as its own band of colour. The marker on it is you — so it shows how far you have come rather than how far is left.
4. [`library-belt-browser` · next] Tap the card itself to open the belts up. You can look through everything you have met so far, and start again from any point you fancy revisiting.
   - terminal: That's your position. Close this whenever you like and press play — it always picks up exactly where you left off.

## whether-a-class-is-practising — Whether a class is practising together

Personas: admin, leader, school_admin · place: node-home

1. [`class-practice` · next] **Class practice** leads the class page because practising together is what a language programme lives on. The big figure is sessions run this week.
2. [`class-practice` · next] The line under it gives how long ago the last session was, and the running total of hours and sessions the class has practised together.
3. [`class-practice` · next] A class that has never played together says so plainly, and names the teacher's **Play as class** button as the thing that starts the first one.
   - terminal: That's the class's own pulse, ahead of anything students do alone. This tour changed nothing; only your own taps do.

## why-a-rate-not-a-total — Why the insights show a rate, not a total

Personas: admin, leader, school_admin · place: node-insights

1. [`insights-rate-widget` · next] This block is the whole argument of the page. It holds an amount per learner per week — a rate — and never a running total.
2. [`insights-rate-widget` · next] A total only ever says how big and how old something is, so a large school beats a small one before anybody has done a thing. A rate says how fast it is moving, which is the part you can act on.
3. [`insights-rate-widget` · next] Your level's rate sits beside whatever you are comparing it to, and the line above says in words what the current measure counts. Change the **window** and the same rate is computed over a shorter or a longer period.
   - terminal: A pace matters more than a position — a class three sentences behind but climbing fast is healthier than one parked far ahead. This tour changed nothing; only your own taps do.

## your-class-against-the-average — Your class against the average

Personas: teacher · place: analytics

1. [`teacher-insights-class` · next] **Your classes** picks which class you are reading. It only appears when you teach more than one, and switching it reloads everything below.
2. [`insights-window` · next] Underneath sit the **measure**, the **window** the rate is computed over, and what to **compare to**. The line beneath the pickers says exactly what the current measure counts.
3. [`insights-rate-widget` · next] This is the answer: your class's pace beside the average you chose. A class with too few sessions to compare honestly says so rather than showing a number built from nothing.
   - terminal: That's your class read as a pace rather than a pile of totals. This tour changed nothing; only your own taps do.
