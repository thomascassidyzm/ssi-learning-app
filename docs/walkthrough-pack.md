# Walkthrough pack — compiled render

**Version `4cfd7d9db934` · generated 2026-09-08 by `tools/walkthrough/compile.mjs`. DO NOT EDIT — edit tools/walkthrough/walks/*.json and recompile.**

## add-students-to-a-class — Add students to a class

Personas: leader, school_admin, teacher · place: class-detail

1. [`class-student-add` · click] **Add students** puts a pupil who is already in your school into this class. Opening it changes nothing on its own.
2. [`class-student-picker` · next] The list holds the pupils in your school who are not in this class yet, with the classes they are in now under each name. Type a few letters to narrow it.
3. [`class-student-picker` · next] Tapping a name adds that pupil straight away, and they bring everything they have already learned with them. Adding does not take them out of any other class.
4. [`class-student-add` · next] The same button reads **Done** while the list is open. For a pupil with no account at all, use the class link in **Invite students** instead.
   - terminal: That's adding students — search, tap, done. This tour changed nothing; only your own taps do.

## choose-something-else-to-learn — Choose something else to learn

Personas: learner · place: library

1. [`library-course-search` · next] Everything you can get to lives below, and this box is the quick way in. Type a language and the list narrows as you go.
2. [`library-course-grid` · next] Tap any one of these and you are straight into it — no setting up, no starting over.
3. [`library-course-grid` · next] Your current course is not going anywhere. Each one keeps its own place, so you can have a poke at a second language and come back without losing an inch in the first.
   - terminal: That's the Library. Close it and press play to carry on with the one you are in.

## choose-what-a-class-learns — Choose what a class learns

Personas: school_admin, teacher · place: classes

1. [`verb-new-class` · click] **+ New class** opens the panel where a class is made. Nothing is created by opening it, so you can look and close it again.
2. [`create-class-course` · next] The **Course** box is the one that matters here. Type a few letters and it searches the whole catalogue rather than making you scroll a list.
3. [`create-class-course` · next] Pick the language the class is learning. That choice decides what the class practises and what students hear when they join.
4. [`create-class-course` · next] The course stays with the class once it is made. A class that needs a different language is a new class, which leaves the old one's records untouched.
   - terminal: That's choosing what a class learns — one box, searched, and set for good. This tour changed nothing; only your own taps do.

## copy-a-class-link — Copy a class link without opening the class

Personas: school_admin, teacher · place: classes

1. [`classes-share-link` · next] **Copy link** in a class's row hands you that class's join link without opening the class at all.
2. [`classes-share-link` · next] The button says it has copied, and the link is then yours to paste into an email or a lesson slide.
3. [`classes-share-link` · next] It is the same link the class page offers, so a student who follows it lands in that class either way.
   - terminal: That's copying a class link — one tap, from the list. This tour changed nothing; only your own taps do.

## delete-a-class — Delete a class

Personas: leader, school_admin, teacher · place: class-detail

1. [`class-delete` · next] The small bin beside the class name deletes the class. It is here for a class set up by mistake or a group that has finished.
2. [`class-delete` · next] Tapping it does not delete anything on the spot. It first shows you what would go with the class, so you are deciding with the facts in front of you.
3. [`class-delete` · next] A class with real practice behind it asks you to type its name before it will go. That is the app making you say it twice on purpose.
4. [`class-delete` · next] Students keep their own accounts and everything they have learned. What goes is the class itself, its roster and its join link.
   - terminal: That's deleting a class — shown to you first, confirmed by you, then gone. This tour changed nothing; only your own taps do.

## export-your-class-list — Export your class list

Personas: school_admin, teacher · place: classes

1. [`classes-export` · next] **Export CSV** takes the class list off the screen and into a spreadsheet, for a report or a register you keep elsewhere.
2. [`classes-export` · next] What you export is what you can see, so filter the table down first if you only want part of it.
3. [`classes-export` · next] The file downloads to your own device with today's date in its name.
   - terminal: That's exporting your class list — what is on screen, in a file. This tour changed nothing; only your own taps do.

## find-a-class-in-a-long-list — Find a class in a long list

Personas: school_admin, teacher · place: classes

1. [`classes-filters` · next] The strip above the table cuts a long list down to the question you are actually asking.
2. [`classes-filters` · next] **Course** shows only the classes learning one language. **Health** pulls out the classes that need attention.
3. [`classes-filters` · next] **Sort** reorders what is left by students, hours this week or progress.
4. [`classes-filters` · next] The totals above the table follow the filter, so the student count and the hours are always the total of what you are looking at.
   - terminal: That's finding a class — three pickers, and the totals keeping up. This tour changed nothing; only your own taps do.

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

## how-students-join-a-class — How students join a class

Personas: leader, school_admin, teacher · place: class-detail

1. [`class-join-link` · next] **Invite students** carries the one door into this class. A student who follows this link signs up and lands straight in the class, on the right course, with no code to type.
2. [`class-join-code` · click] **Show code instead** is for a room where a link is awkward. It reveals a short code you can write on a whiteboard.
3. [`class-join-code` · next] Students enter that code at saysomethingin.com/redeem and arrive in the same class.
4. [`class-join-link` · next] The link and the code both stay valid, so the same one works in week one and in week six. If the card says it could not load, hand nothing out until it comes back.
   - terminal: That's how students join — one link, one code, both lasting. This tour changed nothing; only your own taps do.

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

## make-a-class — Make a class

Personas: school_admin, teacher · place: classes

1. [`verb-new-class` · next] **+ New class** along the top of **My Classes** is where a class of your own starts. A class holds a roster, its own place on the course, and everything the class practises together.
2. [`verb-new-class` · next] It asks for two things: a name you will recognise on a list, such as Year 7 Welsh, and the language the class is learning.
3. [`verb-new-class` · next] The join link is made for you at the same moment as the class. Nothing else is needed to start teaching.
   - terminal: That's making a class — a name, a language, and a link students join by. This tour changed nothing; only your own taps do.

## move-a-teacher-between-classes — Move a teacher to another class

Personas: teacher · place: class-detail

1. [`class-teachers` · next] **Teachers** answers 'who teaches this class?'. A head usually wants the other direction too — 'which classes does this person take?' — and that is the same question read backwards.
2. [`class-teacher-other-classes` · click] **Other classes** on anyone's row asks it that way round. It never moves anybody on its own — it opens a list for you to change.
3. [`assign-classes-list` · next] Every class in the school, with the ones this teacher already takes already ticked. Ticking a second, or a third, is all 'belonging to several classes' means — there is no separate step for it.
4. [`assign-classes-list` · next] A move is just both at once: tick where they are going, untick where they are leaving. You are looking at the truth before you change it, so nothing here is a guess.
5. [`assign-classes-save` · next] Saving applies only the boxes you actually changed. If one of them fails, it says which class failed and why, rather than claiming everything saved.
   - terminal: That's moving a teacher — one untick, one tick, one save. This tour changed nothing; only your own taps do.

## open-a-class — Open a class

Personas: school_admin, teacher · place: classes

1. [`classes-row` · next] A whole row is the way in. Tapping anywhere on it opens that class, and the keyboard works too.
2. [`classes-row` · next] The class page opens on its roster, which is where most of what you want to do with a class lives.
3. [`classes-row` · next] The buttons at the right of the row do their own jobs and do not open the class.
   - terminal: That's opening a class — tap the row, land on the roster. This tour changed nothing; only your own taps do.

## read-your-class-list — Read your class list

Personas: school_admin, teacher · place: classes

1. [`classes-table` · next] The table is every class you teach, one to a row, with the numbers that tell you how each one is going.
2. [`classes-table` · next] Read down the health column first, because that is where the app is pointing you. Health is worked out from how many of the last seven days the class practised on.
3. [`classes-table` · next] The small chart in each row shows whether practice is steady or has stopped. A quiet week reads as needing eyes, which is a prompt for a word rather than a worry.
4. [`classes-table` · next] Hours this week are worth comparing between classes taking the same course, where the same effort should look the same.
   - terminal: That's reading your class list — health first, then the shape of the week. This tour changed nothing; only your own taps do.

## reading-insights — Reading your insights

Personas: admin, leader, school_admin · place: node-insights

1. [`insights-measure` · next] The **measure** picks what's being counted — progress, practice, class sessions. The line underneath the pickers says exactly what the current one means.
2. [`insights-window` · next] The **window** is the period the rate is computed over — shorter windows react faster, longer ones smooth the noise.
3. [`insights-compare` · next] **Compare to** puts an average alongside. Everything here is a rate, not a raw total — so groups of different sizes compare fairly.
4. [`insights-overview` · next] **Overview** takes you back to the same place's home — insights is a lens on where you already are, not a different page to get lost in.
   - terminal: Rates lead, position is context — and the picker text always says what a measure means.

## reading-the-course-list — Reading the course list

Personas: learner · place: library

1. [`library-course-card` · next] Each card names the language you would be learning, and under it, the language it would be taught in. That second line is the one worth reading — it is what you will hear the prompts in.
2. [`library-course-card` · next] The right-hand side tells you where you stand. A coloured dot and a position means you have already started that one and it is holding your place for you.
3. [`library-course-card` · next] **Premium** with **Try free** next to it means the course is a paid one, and that you can properly get going in it first. You carry on until the app asks — nothing stops you mid-thought and nothing is taken before you have said yes.
4. [`library-course-grid` · next] Some languages offer more than one card — a different region or accent of the same language. Pick whichever you would rather end up sounding like.
   - terminal: Nothing here commits you. Tapping a card takes you into it, and every course you have touched keeps its own place waiting.

## remove-a-student-from-a-class — Remove a student from a class

Personas: leader, school_admin, teacher · place: class-detail

1. [`class-student-remove` · next] **Remove** at the end of a student's row takes that pupil off this roster. It is per pupil, so you are always removing the person you are looking at.
2. [`class-student-remove` · next] It asks you to confirm before anything happens, which is your chance to check you are on the right row.
3. [`class-student-remove` · next] The student keeps their account and everything they have learned, and can join another class straight away. Only their place on this roster goes.
   - terminal: That's removing a student — one row, one confirmation, nothing lost. This tour changed nothing; only your own taps do.

## rename-a-class — Rename a class

Personas: leader, school_admin, teacher · place: class-detail

1. [`class-rename` · next] The small pencil beside the class name is how a class gets renamed. It sits at the top of the class page, next to the name itself.
2. [`class-rename` · next] Tapping it asks you for the new name and does nothing until you give it one. Closing the box leaves the class exactly as it was.
3. [`class-rename` · next] Only the name changes. The roster, the join link, the join code and the class's place on the course all carry on as they were.
   - terminal: That's renaming a class — a new label on the same class. This tour changed nothing; only your own taps do.

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

## start-a-class-session-from-the-list — Start a class session from the list

Personas: school_admin, teacher · place: classes

1. [`classes-row-play` · next] **Play as class** at the end of a row starts a shared practice session without opening the class first.
2. [`classes-row-play` · next] Your device leads and the whole class moves together, from wherever the class last got to in its own course.
3. [`classes-row-play` · next] It is the same session the class page starts, so it moves the class on for everyone on the roster. Only school staff see this button, and only on a live account.
   - terminal: That's starting a session from the list — find the class, tap, teach. This tour changed nothing; only your own taps do.

## the-class-roster — The class roster

Personas: leader, school_admin, teacher · place: class-detail

1. [`class-roster` · next] **Roster** is the class as a list of people. Every student in the class has a row here, and the rows are where you read the class one pupil at a time.
2. [`class-roster` · next] Read the mark under each name first. It flags anyone falling behind the class or gone quiet for a while, so the table points before you go hunting.
3. [`class-roster` · next] The search box jumps you to one student in a long roster. A pupil who has never started reads as inactive rather than behind, because nothing has happened yet to judge.
4. [`class-roster` · next] The rail beside the table carries the class average, which is what a single row is worth comparing against. A class nobody has joined yet shows its empty places instead of a table.
   - terminal: That's the roster — the class read pupil by pupil. This tour changed nothing; only your own taps do.

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

## where-the-class-has-got-to — Where the class has got to

Personas: leader, school_admin, teacher · place: class-detail

1. [`class-journey` · next] **Course Journey** is how far the class has travelled through its course. The bar is the share of the course the class has covered together.
2. [`class-journey` · next] The line under it gives the class average and how far it is to the next belt. That average is the honest number for planning a lesson.
3. [`class-journey` · next] The belt spread underneath tells you the other half: whether the class is holding together or pulling apart.
   - terminal: That's where the class has got to — how far, and how tightly. This tour changed nothing; only your own taps do.

## where-you-are-in-this-course — Where you are in this course

Personas: learner · place: library

1. [`library-progress-card` · next] This card is your whole position in the course in one glance. Nothing here is a score, and nothing here is counting anything against you.
2. [`library-belt-strip` · next] Those eight coloured dots are **belts**, and the filled one is where you are now. A belt marks how far along the course you have come — it is a position, not a grade, and there is nothing to pass. You move to the next one simply by carrying on.
3. [`library-position-track` · next] The bar underneath lays the whole course out end to end, with each belt as its own band of colour. The marker on it is you — so it shows how far you have come rather than how far is left.
4. [`library-belt-browser` · next] Tap the card itself to open the belts up. You can look through everything you have met so far, and start again from any point you fancy revisiting.
   - terminal: That's your position. Close this whenever you like and press play — it always picks up exactly where you left off.
