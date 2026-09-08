# Walkthrough pack — compiled render

**Version `29586777132a` · generated 2026-09-08 by `tools/walkthrough/compile.mjs`. DO NOT EDIT — edit tools/walkthrough/walks/*.json and recompile.**

## add-a-school-to-your-programme — Add a school to your programme

Personas: leader · place: schools-list

1. [`verb-add-school` · click] **+ Add school** sits at the top right of All schools. Nothing is created until you name the school and confirm.
2. [`verb-add-school` · next] Type the school's name and tap **Create school**. It exists from that moment, already attached to your group, with its admin link and teacher link ready to hand over.
3. [`verb-add-school` · next] Copy the Admin link and send it to whoever will run the school — opening it takes them straight to sign-in as its admin. Copy the Teacher link too if you are setting their staff up as well.
4. [`verb-add-school` · next] Tap **Done** and the new school appears in the list. There is no separate onboarding step to remember: both links live on its row from then on.
   - terminal: That's a school added — named, attached, and its two links already waiting on the row. This tour changed nothing; only your own taps do.

## choose-something-else-to-learn — Choose something else to learn

Personas: learner · place: library

1. [`library-course-search` · next] Everything you can get to lives below, and this box is the quick way in. Type a language and the list narrows as you go.
2. [`library-course-grid` · next] Tap any one of these and you are straight into it — no setting up, no starting over.
3. [`library-course-grid` · next] Your current course is not going anywhere. Each one keeps its own place, so you can have a poke at a second language and come back without losing an inch in the first.
   - terminal: That's the Library. Close it and press play to carry on with the one you are in.

## copy-a-school-s-joining-links — Copy a school's joining links

Personas: leader · place: schools-list

1. [`schools-list-link-chips` · next] Every school's row carries its two joining links in the Links column. This is how you chase a school that has not got started, or replace a link somebody has lost.
2. [`schools-list-link-chips` · next] **Admin** copies its admin link and **Teacher** copies its teacher link. The chip reads Copied so you know it worked, then you paste it into an email or a message.
3. [`schools-list-link-chips` · next] Tapping a chip never opens the school — the rest of the row does that. A school still flagged as awaiting admin is one whose admin link nobody has opened yet.
   - terminal: That's both links, always on the row, always fetchable again. This tour changed nothing; only your own taps do.

## give-a-teacher-their-classes — Give a teacher their classes

Personas: school_admin, leader · place: teachers

1. [`teacher-assign-classes` · next] **Assign to a class** sits on every teacher's row. Working from your staff list is how a new arrival gets their whole timetable in one sitting, rather than opening each class in turn.
2. [`teacher-assign-classes` · next] It opens a list of every class in the school. Tick each one they should teach, then **Save** applies the ticks.
3. [`teacher-assign-classes` · next] A class with nobody on it says so in that list, and the teacher you tick will lead it. Tick a class that already has a teacher and yours joins as a co-teacher instead.
   - terminal: That's a teacher staffed — their timetable read and set from their own row. This tour changed nothing; only your own taps do.

## go-back-over-something — Go back over something

Personas: learner · place: library

1. [`library-belt-browser` · click] Nothing is ever locked behind you. Tap here to open the whole course up.
2. [`belt-browser-list` · next] Every belt is listed, with a tick on the ones you have already come through. Open one and you can look through everything you met there.
3. [`belt-browser-list` · next] Choosing something in there does not just show it to you — it moves you to that point and starts you off from there. So use it when you genuinely want to go over old ground, not to peek.
   - terminal: If you land somewhere you did not mean to, come straight back in here and pick your way forward again. Nothing is lost by wandering.

## hand-a-teacher-their-access-code — Hand a teacher their access code

Personas: school_admin · place: teachers

1. [`teacher-signin-link` · next] **Access code** on a teacher's row gets them into their own account when email is not reaching them. School mail gateways quarantine our sign-in codes often enough that this is the rescue, not the exception.
2. [`teacher-signin-link` · next] Read the code out to them, write it down, or paste the link into whatever you already use. They go to saysomethingin.app/join and type it in.
3. [`teacher-signin-link` · next] The code works once and lasts two days, and whoever uses it becomes that teacher — so give it to them directly and never post it anywhere shared. Need another? Tap **Access code** again.
   - terminal: That's a locked-out teacher back in, without waiting on email. This tour changed nothing; only your own taps do.

## hand-over-the-lead — Hand a class over to another teacher

Personas: teacher · place: class-detail

1. [`class-teachers` · next] One teacher on a class is the **lead** — the one the class is listed under, and the one a school admin comes to about it. When you move on from a class, that name should move too.
2. [`class-teacher-make-lead` · next] **Make lead** hands it to a colleague already on the class. It takes effect straight away, so add them first and hand over once you have.
3. [`class-teachers` · next] Nothing else moves. The pupils, their progress and every session stay exactly where they are, and you stay on the class as a teacher — you have passed the lead, not left.
   - terminal: That's handover — the lead is a name, not a wall. Nothing changed while you read this; only your own taps do.

## how-your-class-measures-up — How your class measures up

Personas: teacher · place: dashboard

1. [`dash-class-bench` · next] Three bars on each class, answering the question a total cannot: is this normal. The top bar is **Class** — the cycles your own class has done.
2. [`dash-class-bench` · next] **School** underneath it is the average across the other classes in your school. **Global** is the average across every class doing that course anywhere.
3. [`dash-class-bench` · next] Longer bars mean more, and the number at the end of each bar is the figure itself. A class with too little recorded activity shows a dash rather than an invented bar.
   - terminal: That's the benchmark — your class, your school, everyone. This tour changed nothing; only your own taps do.

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

## invite-a-teacher-to-your-school — Invite a teacher to your school

Personas: school_admin · place: teachers

1. [`teachers-invite-link` · next] The **Invite teachers** card below the list holds one standing link that turns anyone who opens it into a teacher of your school.
2. [`teachers-invite-link` · next] It is the same link every time, so you can hand it to a whole staff room at once. **Copy invite link**, then send it however you reach your staff — Teams, WhatsApp, printed on a slip.
3. [`teachers-invite-link` · next] They open it, sign in once, and appear in your list as a teacher. If you are standing in front of them instead, **Show code instead** gives you a short code to read out, and they type it in at saysomethingin.com/redeem.
   - terminal: That's your staff room in — one link, shared as many times as you like. This tour changed nothing; only your own taps do.

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

## look-up-one-student — Look up one student

Personas: admin, school_admin, teacher · place: students

1. [`student-view-link` · next] Finding one learner among all of them starts above the list: type part of their name in the search box, or narrow by class, belt or health.
2. [`student-view-link` · next] Their row already carries their belt, their hours this week and when they were last here, so you can often answer the question without opening anything.
3. [`student-view-link` · next] **View** opens what that learner has actually done. Health is worked out from their last visit and how they sit against their own class, so a learner marked as needing attention has gone quiet or fallen behind the people beside them.
   - terminal: That's one learner found and read — search, row, then View. This tour changed nothing; only your own taps do.

## move-a-teacher-between-classes — Move a teacher to another class

Personas: teacher · place: class-detail

1. [`class-teachers` · next] **Teachers** answers 'who teaches this class?'. A head usually wants the other direction too — 'which classes does this person take?' — and that is the same question read backwards.
2. [`class-teacher-other-classes` · click] **Other classes** on anyone's row asks it that way round. It never moves anybody on its own — it opens a list for you to change.
3. [`assign-classes-list` · next] Every class in the school, with the ones this teacher already takes already ticked. Ticking a second, or a third, is all 'belonging to several classes' means — there is no separate step for it.
4. [`assign-classes-list` · next] A move is just both at once: tick where they are going, untick where they are leaving. You are looking at the truth before you change it, so nothing here is a guess.
5. [`assign-classes-save` · next] Saving applies only the boxes you actually changed. If one of them fails, it says which class failed and why, rather than claiming everything saved.
   - terminal: That's moving a teacher — one untick, one tick, one save. This tour changed nothing; only your own taps do.

## prove-your-mailbox — Prove your mailbox reaches you

Personas: school_admin, teacher · place: dashboard

1. [`mailbox-check-send` · next] School mail gateways are ferocious, and a sign-in code that never arrives is usually discovered on the day you need it. **Send me a code** settles that now, while you are here and not locked out.
2. [`mailbox-check-send` · next] If your school address eats our mail, the line underneath sends the code to a different address instead. Whichever you pick, six digits arrive and you type them in.
3. [`mailbox-check-send` · next] **That's the one** confirms the code and the card is done with for good. Close it instead and it stays closed — it never comes back on a timer.
   - terminal: That's your mailbox proved — one code, once, and never asked again. This tour changed nothing; only your own taps do.

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

## remove-a-teacher-from-your-school — Remove a teacher from your school

Personas: school_admin · place: teachers

1. [`teacher-remove` · next] **Remove** on a teacher's row takes them off your school when they leave. Their own account survives — what goes is their place here and their view of its classes and learners.
2. [`teacher-remove` · next] You are asked for their name back before anything happens, so a mistaken tap costs you nothing. Confirm and the list refreshes without them.
3. [`teacher-remove` · next] An admin's row carries no **Remove** button at all, so a school can never lose its own admin through this list. Change their role first if that is really what you want.
   - terminal: That's a leaver off your staff list, their own account untouched. This tour changed nothing; only your own taps do.

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

## see-every-school — See every school in your programme

Personas: leader · place: schools-list

1. [`schools-list-table` · next] One table of every school you look after, with its students, teachers, classes and practice hours side by side. A whole programme reads at a glance instead of school by school.
2. [`schools-list-table` · next] The totals above the table are the programme as a whole. The search box and the sort control on the header row narrow it by name, hours or students.
3. [`schools-list-table` · next] Read the Status column for a school nobody is running yet — it is flagged as awaiting admin. Tapping any row opens that school's own dashboard, and **Export** gives you the same table as a spreadsheet file.
4. [`schools-list-table` · next] The list holds still until you refresh it, so a number will not change under you while you are reading it. If a refresh fails you are told plainly rather than shown stale figures as current.
   - terminal: That's the programme in one table — totals above, schools below, nothing moving under you. This tour changed nothing; only your own taps do.

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

## take-a-teacher-off-a-class — Take a teacher off a class, or move them

Personas: leader, school_admin, teacher · place: teachers

1. [`teacher-assign-classes` · click] Taking someone off a class starts on their own row. **Assign to a class** opens the ticks and changes nothing on its own.
2. [`assign-classes-modal` · next] This panel is the whole timetable for one person. The classes they teach now are already ticked, so you are reading the truth before you change it.
3. [`assign-classes-list` · next] Untick the class they are leaving. A move is the same panel twice over — untick where they are going from, tick where they are going to.
4. [`assign-classes-save` · next] **Save** counts your changes back to you before you commit, and applies only the boxes you actually touched. If one class fails it says which one and why, and the ticks reset to what is really true.
   - terminal: That's a teacher moved or taken off — one panel, ticks, one save. This tour changed nothing; only your own taps do.

## take-your-lists-away — Take your lists away as a spreadsheet

Personas: admin, school_admin, teacher · place: students

1. [`students-export` · next] **Export CSV** takes whoever is currently on screen away as a file — for a report, a governors' meeting, or your own sums.
2. [`students-export` · next] The export follows your filters, not the whole school. Filter or search the list down first, or clear the filters if you want everybody.
3. [`students-export` · next] The file downloads with today's date in its name and opens in whatever spreadsheet you use. The **Teachers** page carries the same button along the top.
   - terminal: That's your list out as a file — what you filtered is what you get. This tour changed nothing; only your own taps do.

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

## your-classes-at-a-glance — Your classes at a glance

Personas: teacher · place: dashboard

1. [`dash-class-card` · next] Your classes come first on the dashboard, one entry each. The name carries its course, how many students are in it, and the join code you read out to get a new pupil in.
2. [`dash-class-card` · next] Tapping the name opens that class's own page — the roster, its settings, and everything you would change about it.
3. [`dash-class-card` · next] **Play as class** on any entry starts a session the whole class does together. A brand new account shows a single button to create your first class instead of this list.
   - terminal: That's your teaching day in one screen — classes first, everything else under them. This tour changed nothing; only your own taps do.

## your-own-teaching-numbers — Your own teaching numbers

Personas: teacher · place: dashboard

1. [`dash-teacher-stats` · next] One quiet line under your classes, totalling your whole teaching load. **Students** counts every pupil in every class you teach, each person once.
2. [`dash-teacher-stats` · next] **Practised** is real practice time those pupils have logged between them, and **sessions** is how many class sessions have been run.
3. [`dash-teacher-stats` · next] It is a record of what has happened, never a target. The line only appears once you have a class — there is nothing to total before that.
   - terminal: That's your load in three figures, under the classes where it belongs. This tour changed nothing; only your own taps do.
