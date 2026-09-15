# Walkthrough pack — compiled render

**Version `6078a8a2b830` · generated 2026-09-15 by `tools/walkthrough/compile.mjs`. DO NOT EDIT — edit tools/walkthrough/walks/*.json and recompile.**

## add-a-class-under-a-group — Add a class to a group

Personas: admin, leader, school_admin · place: node-home

1. [`verb-add-class` · click] **Add a class** creates a class under this group before anyone is teaching it yet — useful for setting a term up in advance.
2. [`add-class-name` · next] Type the class name, then choose the course it will learn. A paid language your group has no cover for is refused when you tap Add, and the message says so.
3. [`add-class-submit` · next] **Add** creates it. No teacher is needed yet — the class sits under the group waiting, and you can put a teacher on it whenever you're ready.
   - terminal: That's adding a class ahead of staffing it. This tour added nobody and nothing; only your own tap does.

## add-a-student-to-a-class — Add a student to a class

Personas: admin, leader, school_admin · place: node-home (class)

1. [`verb-invite-student` · click] On the class's own page, tap **Invite students**.
2. [`invite-form-submit` · next] Type the student's name. Add their email if you want us to send it, or leave it blank and you get a link to hand over yourself — then submit, and repeat for the next student.
   - terminal: One student at a time, on purpose — the link is theirs alone and carries the class with it. The Students page's + Invite students button brings you here for exactly this reason.

## add-students-to-a-class — Add students to a class

Personas: teacher · place: class-detail

1. [`class-student-add` · click] Above the roster, tap **Add students** — for a pupil already in your school who has changed set or landed in the wrong class.
2. [`class-student-picker` · next] Type a few letters of their name to narrow the list, then tap the pupil — they appear on the roster straight away. Add as many as you need, then tap Done.
   - terminal: Adding doesn't take them out of any other class — a pupil can be in more than one, one for each course they're doing. A pupil with no account at all needs the class link in Invite students instead.

## add-teacher-by-name — Add a teacher by name

Personas: school_admin · place: teachers

1. [`teacher-named-seat` · click] Tap **Add by name** when you know exactly who is joining but can't rely on email reaching them.
2. [`teacher-named-seat` · next] Type their name and tap **Create code**. That mints their access code on the spot — read it out, write it down, or paste it wherever you already reach them. They use it once at saysomethingin.app/join.
   - terminal: They appear on your list straight away under Not yet given classes, so you can tick their classes before they've even signed in.

## choose-a-class-course — Choose what a class learns

Personas: school_admin, teacher · place: classes

1. [`create-class-course` · next] Every class carries one course — it decides what the class practises and what students hear the moment they join. You set it here, in the **Create New Class** panel.
2. [`create-class-course` · click] Type into the box to search the catalogue, then pick the language the class is learning.
3. [`create-class-course` · next] A school on a free trial is held to the one language it signed up for until it subscribes — the picker only shows that course.
   - terminal: The course is set when the class is made and stays with it. A class that needs a different language is a new class, which keeps the old one's records intact.

## choose-something-else-to-learn — Choose something else to learn

Personas: learner · place: library

1. [`library-course-search` · next] Everything you can get to lives below, and this box is the quick way in. Type a language and the list narrows as you go.
2. [`library-course-grid` · next] Tap any one of these and you are straight into it — no setting up, no starting over.
3. [`library-course-grid` · next] Your current course is not going anywhere. Each one keeps its own place, so you can have a poke at a second language and come back without losing an inch in the first.
   - terminal: That's the Library. Close it and press play to carry on with the one you are in.

## class-page-play-and-manage — Play as class or manage it, from the class page

Personas: teacher, school_admin · place: node-home

1. [`class-page-play` · next] **Play as class** starts a whole-class lesson on the class's own account, so the minutes and phrases land on the class, not on you. While a platform admin is viewing this page as you, the button is greyed out and does nothing.
2. [`class-page-manage` · next] **Manage class** goes to the class's tools: the roster, the teachers, the join link and code, renaming and deleting. The class's practice, minutes and journey stay here on the class page.
   - terminal: Play from here, manage from there — two different pages, one class. This tour started no lesson and opened no tools.

## copy-a-class-link-without-opening-the-class — Copy a class link without opening the class

Personas: school_admin, teacher · place: classes

1. [`classes-share-link` · click] On **My Classes**, tap **Copy link** in a class's row — no need to open the class first. Paste it into an email or a lesson slide.
   - terminal: It's the same link the class page offers, so a student who follows it lands in that class either way.

## copy-a-schools-joining-links — Copy a school's joining links

Personas: leader · place: schools-list

1. [`schools-list-link-chips` · click] On any school's row, tap **Admin** to copy its admin link or **Teacher** to copy its teacher link — the chip reads Copied so you know it worked. Paste it into an email or message to whoever needs it.
   - terminal: Tapping a link chip never opens the school — the rest of the row does that. A school still flagged Awaiting admin is one whose admin link nobody has opened yet.

## copy-a-teachers-play-onto-their-class — Copy a teacher's own play onto the class

Personas: school_admin, teacher · place: class-detail

1. [`class-copy-play-picker` · next] **Played as themselves by mistake?** — a school leader picks the teacher here. A teacher fixing their own lesson sees no list; the card is about them.
2. [`class-copy-play-preview` · next] **See what would move** reads the sessions, the time in the app, and where the class will end up. Nothing moves yet.
3. [`class-copy-play-preview-result` · next] The teacher keeps their own record either way. Only play on this class's course moves, and the class ends up at the further of the two places.
4. [`class-copy-play-apply` · next] **Copy onto the class** commits it — one line afterwards says what was copied. Running it again copies nothing twice.
   - terminal: Preview first, copy only when you're sure. This tour previewed nothing and copied nothing.

## copy-every-teachers-play — Copy every teacher's own play onto their class

Personas: school_admin · place: node-home

1. [`school-copy-play-sweep` · next] Every teacher in your school who ran lessons signed in as themselves instead of using Play as class, one row per teacher on one class. When there is nothing to copy the card says so in words.
2. [`school-copy-play-sweep-copy` · next] **Copy onto the class** does one row at a time — there is no button that copies everyone at once. The teacher keeps their own record; only play on that class's course moves.
   - terminal: Row by row, teacher by teacher — that's the whole sweep. This tour copied nothing.

## courses-worth-attention — Which courses are worth attention

Personas: admin · place: intel

1. [`question-courses` · next] **Courses**, under What's happening, is one ranking of every course by real people practising it this month, with how many have ever been in it and how many have reached its end.
2. [`answer` · next] The sentence says how many courses are alive this month and which had the most people.
3. [`evidence` · next] The chart is the courses with anybody in them, most first.
4. [`rows` · next] The chips show every course, only the alive ones, or the quiet ones somebody once joined; the chip is written into the page address. Each row carries this month, ever, how many stick and how many finished. Reaching the end means nine tenths of the course, and a course with no recorded length shows a dash. Minutes are left off because the stored counters are not reliable. Open a course row to see which bits of it people stumble on.
   - terminal: One ranking by people this month. Filter with the chips, open a row for its weak points.

## create-your-first-classes — Create your first classes

Personas: school_admin · place: setup

1. [`setup-add-class-row` · next] Step four of first-time setup. The first row's course is already set to the language you signed up with — change it if this class learns something else.
2. [`setup-add-class-row` · next] **+ Add another class** for each further class; every new row starts on that same language. Finishing setup creates every filled-in row, marked Added as it saves. Running the wizard twice will not duplicate classes you've already made.
   - terminal: One row per class, add as many as you need. This tour created no classes.

## email-someone-their-invite-again — Email someone their invite again

Personas: admin, leader, school_admin · place: node-home (org/group/school)

1. [`ways-in-resend` · next] Find the person's row in **Ways in** and tap **Email again**. Nothing changes and no new link is made — the same one they may yet dig out of a spam folder still works.
   - terminal: Only rows for a named person with an email on file carry this button. If a school's mail gateway is eating our messages, read them the link instead of sending a third time.

## funded-org-courses — See what a funded organisation gives its learners

Personas: admin · place: node-home (org)

1. [`verb-courses` · click] Tap **Courses** on the organisation's home page.
2. [`org-enrolment-courses` · next] This is what the organisation hands out through its own sign-up page — given to each learner as they join, not held on the organisation itself.
3. [`org-enrolment-courses` · next] The courses listed here, and the length of the free period beside them, come from the organisation's enrolment policy. Changing that list is a change to the policy, so it isn't editable here — everyone who has already signed up keeps what they were given.
   - terminal: That's it — a read-only summary of what this organisation grants on sign-up.

## go-back-over-something — Go back over something

Personas: learner · place: library

1. [`library-belt-browser` · click] Nothing is ever locked behind you. Tap here to open the whole course up.
2. [`belt-browser-list` · next] Every belt is listed, with a tick on the ones you have already come through. Open one and you can look through everything you met there.
3. [`belt-browser-list` · next] Choosing something in there does not just show it to you — it moves you to that point and starts you off from there. So use it when you genuinely want to go over old ground, not to peek.
   - terminal: If you land somewhere you did not mean to, come straight back in here and pick your way forward again. Nothing is lost by wandering.

## hand-a-teacher-access-code — Hand a teacher their access code

Personas: school_admin · place: teachers

1. [`teacher-signin-link` · next] Tap **Access code** on a teacher's row when email isn't reaching them — school mail gateways quarantine our sign-in codes often enough that this is the rescue, not the exception. It mints a fresh code for them on the spot.
2. [`teacher-signin-link` · next] Read the code out, write it down, or paste the link into whatever you already use. They go to saysomethingin.app/join and type it in, then you tap **Done**.
   - terminal: It works once and lasts two days. Need another? Tap Access code again — the earlier one stops working the moment you do.

## hand-out-a-sign-up-link-for-one-course — Hand out a sign-up link for one course

Personas: admin, leader, school_admin · place: node-home (org/group/school)

1. [`ways-in-copy-course` · click] On your sign-up link's row in **Ways in**, tap the button named after the course you want — it copies a link that puts a learner straight into that course, no choosing screen. Tap Show all first if the ledger is folded.
   - terminal: It's the same link and the same cohort either way — the course name only decides where they land, and everyone gets the whole free year whichever link they came through.

## hand-out-your-staff-links — Hand out your staff links

Personas: school_admin · place: setup

1. [`setup-staff-links` · next] Step two of first-time setup gives you two standing links: copy the **Teacher invite link** for anyone who will run classes, and the **Admin invite link** for anyone who needs to manage the school itself. Send either however you normally reach staff.
   - terminal: Anyone who has already joined is listed underneath, so you can see who's in as you go. A teacher doesn't need to speak the language — the app does the teaching.

## hand-over-the-lead — Hand a class over to another teacher

Personas: teacher, school_admin · place: class-detail

1. [`class-teachers` · next] One teacher on a class is the **lead** — the one the class is listed under, and the one a school admin comes to about it. When you move on from a class, that name should move too.
2. [`class-teacher-make-lead` · next] **Make lead** hands it to a colleague already on the class. It takes effect straight away, so add them first and hand over once you have.
3. [`class-teachers` · next] Nothing else moves. The pupils, their progress and every session stay exactly where they are, and you stay on the class as a teacher — you have passed the lead, not left.
   - terminal: That's handover — the lead is a name, not a wall. Nothing changed while you read this; only your own taps do.

## how-every-question-page-is-laid-out — How every question page is laid out

Personas: admin · place: intel

1. [`question-page` · next] Every one of the ten questions is answered on a page with the same five parts in the same order. Once you can read one, you can read them all.
2. [`scope-rail` · next] The map on the left says who the question is being asked about. **Everyone** asks it of every real person. Tap a course to ask it of that course alone, **Organisations** to pick a group, a school or a class, or **People** to find one person. The choice is written into the page address, so a pasted link asks the same question about the same people.
3. [`verb-bar` · next] Across the top of the main column are the things you can do about the answer. When there is nothing to do, the strip is empty rather than missing.
4. [`answer` · next] The answer: one plain sentence and one number. Beneath it, when the answer was fetched and who is counted.
5. [`evidence` · next] The evidence: one chart, never two side by side.
6. [`rows` · next] The rows are the things behind the number. Every row is a link to the thing it names.
   - terminal: Where you are, the answer, the evidence, the rows, the verbs. No page may add a part or move one.

## install-the-app — Put the app on your device

Personas: leader, school_admin · place: node-home (org/group/school)

1. [`account-card` · next] **Your account** holds the two things that are about you rather than your organisation: your sign-in, and the app on the device you are holding.
2. [`account-install` · next] This row already knows what device you are on. On a computer it offers to install the app in its own window; on a phone it offers to add it to your home screen. Same organisation either way — it just saves you finding the tab.
3. [`account-install` · next] If your browser can do it in one tap, the button does it. If it cannot, the button walks you through your browser's own menu instead — and you can remove the app again any time, like any other app.
   - terminal: Nothing here is one-time — if you said no on your first visit, this row is still waiting whenever you change your mind.

## invite-a-supply-teacher — Invite a teacher who isn't here yet

Personas: teacher, school_admin · place: class-detail

1. [`class-teachers` · next] Use this when the colleague has no account yet — a supply teacher starting on Monday, or someone new to the school. It saves waiting for an admin to add them first.
2. [`class-coteacher-link` · next] **Create a co-teacher link** mints a fresh link the moment you tap it. Whoever opens it lands as a teacher of this class, and of this school — not as its lead, and not over any of your other classes.
3. [`class-join-link` · next] Keep it apart from this one. This is the **student** link — anyone who opens it joins the class as a learner. One link makes a colleague, the other makes a pupil, so send them to the right people.
   - terminal: Short version: the teacher link is minted per colleague and puts them beside you, the student link is the standing one for the class. This tour minted nothing.

## invite-a-teacher-to-your-school — Invite a teacher to your school

Personas: school_admin · place: teachers

1. [`teachers-invite-link` · next] This is one standing link — the same one every time. Tap **Copy invite link** and send it however you reach your staff room: Teams, WhatsApp, printed on a slip. Anyone who opens it signs in once and lands in your list as a teacher.
   - terminal: Standing in front of them instead? Show code instead gives a short code to read out or write on a whiteboard — they type it in at saysomethingin.com/redeem.

## invite-first-person — Bring your first person in

Personas: admin, leader · place: node-home (org/group)

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

## manage-a-class-from-its-page — Rename, delete or remove a student

Personas: teacher · place: class-detail

1. [`class-rename` · next] The pencil beside the class name renames it. Only the name changes — the roster, the join link and the class's place on the course all carry on.
2. [`class-delete` · next] The bin beside the name deletes the class. The app tells you what goes with it first, and asks you to type the class name back if there is real practice behind it. Students keep their own accounts and everything they have learned.
3. [`class-student-remove` · next] **Remove** at the end of a student's row in the roster takes them off this class only. Their account and everything they've learned stays with them, and they can join another class straight away.
   - terminal: Rename, delete, remove a student — all from the class's own tools page. This tour changed nothing; only your own taps do.

## minutes-in-the-app-this-week — Minutes in the app this week

Personas: school_admin · place: dashboard

1. [`dash-minutes-this-week` · next] How much your school practised this week, in minutes, never hours: the time your classes spent in the app with a lesson running, pauses included, plus any teacher or pupil practising on their own account, each counted once. The line beneath is how many of your classes practised at all this week.
   - terminal: A dash means this week's figures have not loaded yet. Pull to refresh. It is never a zero that is not real.

## move-a-teacher-between-classes — Move a teacher to another class

Personas: teacher, school_admin · place: class-detail

1. [`class-teachers` · next] **Teachers** answers 'who teaches this class?'. A head usually wants the other direction too — 'which classes does this person take?' — and that is the same question read backwards.
2. [`class-teacher-other-classes` · click] **Other classes** on anyone's row asks it that way round. It never moves anybody on its own — it opens a list for you to change.
3. [`assign-classes-list` · next] Every class in the school, with the ones this teacher already takes already ticked. Ticking a second, or a third, is all 'belonging to several classes' means — there is no separate step for it.
4. [`assign-classes-list` · next] A move is just both at once: tick where they are going, untick where they are leaving. You are looking at the truth before you change it, so nothing here is a guess.
5. [`assign-classes-save` · next] Saving applies only the boxes you actually changed. If one of them fails, it says which class failed and why, rather than claiming everything saved.
   - terminal: That's moving a teacher — one untick, one tick, one save. This tour changed nothing; only your own taps do.

## one-persons-story — One person's story

Personas: admin · place: intel

1. [`question-person` · next] **One person** is the page for a support call. Open it from a row on Leaving, or find them under People. The sentence gives their standing, their access and their last practice, and the pill beneath says whether they count as a real person. The verbs across the top act on them: give full access, take it back, make a one-off sign-in link, change their role or trial, or correct a wrong flag. Each verb says what it will change and asks first, and the server records it against your name. The cards below hold their access, memberships, course positions and last few events.
   - terminal: Everything about one person, on one page, with every change recorded.

## open-your-inbox — Open your inbox

Personas: teacher, school_admin, leader · place: dashboard

1. [`schools-user-menu-trigger` · click] Tap your name at the top right to open the account menu.
2. [`schools-inbox-menu` · next] **Inbox** sits near the top, just above Support. The number beside it is how many messages you have not opened yet — the dot on your own avatar is the same count.
   - terminal: Tap it and you're reading your messages — that count only drops once you open one.

## org-choose-courses — Choose which courses a school can use

Personas: admin · place: node-home (org/group/school)

1. [`verb-courses` · click] **Courses** sets what a school or group is allowed to learn — the whole catalogue once they're paid up, or a named course or two while they're trialling.
2. [`verb-courses` · next] Choose **Trial** and search for the one or two courses it should carry, or **Paid** for the whole catalogue with no per-course picking.
3. [`verb-courses` · next] Save, and everyone below that node inherits it. A trial runs for thirty days on a paid course and a year on a free or community one — the server works the dates out on save, so what you see before saving is a preview.
   - terminal: That's the whole of it — pick Trial or Paid, choose the courses if it's a trial, and save.

## play-as-class-from-your-dashboard — Play as class from your dashboard

Personas: teacher · place: dashboard

1. [`dash-class-card-play` · next] **Play as class** on a class card starts a lesson straight from your dashboard, on the class's own account — the minutes and phrases land on the class, not on you.
2. [`dash-class-card-play` · next] The player opens on the class's course, at the class's own place in it. While a platform admin is viewing your dashboard as you, this button is greyed out and does nothing.
   - terminal: One tap from your dashboard, no need to open the class first. This tour started no lesson.

## playing-as-yourself — Told when you are playing as yourself

Personas: teacher, school_admin · place: library

1. [`player-playing-as-yourself` · next] A line across the top of the player while a lesson runs on your own sign-in rather than on the class — noticed before the minutes land on you. It goes as soon as you pause or stop.
2. [`player-playing-as-yourself` · next] **Your classes** takes you to start the lesson again with Play as class instead. Minutes already played on your own account aren't moved by this line — the copy tool on the class's tools page does that if you want it.
   - terminal: That's the tell for playing as yourself. This tour moved no minutes.

## practice-on-your-own-account — Practice on your own account

Personas: teacher · place: dashboard

1. [`dash-own-practice` · next] This line appears under your classes only in a week when your own account has practised. Pressing play on a course from your Library counts for you; only **Play as class** counts for the class. It names your own minutes and when you last played, so a lesson that went to the wrong place is found rather than lost. When it is not here, nothing went astray.
   - terminal: To move this week's lesson onto the class, open the class and use **Ran a lesson signed in as yourself?** on its tools page.

## prove-your-mailbox-reaches-you — Prove your mailbox reaches you

Personas: school_admin, teacher · place: dashboard

1. [`mailbox-check-send` · next] This card appears right after you create a class or copy a class join link, for as long as your own address is unproven. Tap **Send me a code**, or nominate a different address if your school one eats our mail.
2. [`mailbox-check-confirm` · next] Type the six digits we send and tap **That's the one**.
   - terminal: Close the card instead and it stays closed — it never comes back on a timer.

## question-not-yet — A question whose page is not built yet

Personas: admin · place: intel (not-yet)

1. [`question-not-yet` · next] This is one of the ten questions the surface exists to answer. It has no page yet, and it wears the same layout as the built ones so the bar always shows all ten.
2. [`answer` · next] The answer says exactly that: the page has not been built yet. No number is shown because nothing is measured.
3. [`evidence` · next] Where a chart would be, a card says nothing is measured for this question yet.
   - terminal: Never a teaser and never a stub with a fake number on it.

## read-your-messages — Read your messages

Personas: teacher, school_admin, leader · place: inbox

1. [`schools-inbox` · next] Everything sent to you lands here: a reply on your Support thread, or a notice about something done on your account — like your own practice being copied onto a class. Tap a message to open it, which is what marks it read.
2. [`schools-inbox` · next] If a message offers **Undo** or **Open Support**, tap that straight from the message. Undo only shows while it can still be done cleanly.
   - terminal: That's your inbox — nothing here is timed out. A message stays unread until you actually open it, however long it has sat on the list.

## reading-a-question-page — Reading a question page

Personas: admin · place: intel

1. [`findings` · next] Every night a job reads the week's practice and writes a few findings in plain words. Each lands here, on the question it is about. The dot on a card is its tone: good, watch, alarm or quiet. The line above says when they were found. If that line is red the job has missed two nights or more and the cards are old. It runs from Tom's Mac, not from here.
2. [`updated-stamp` · next] **Updated** and a time says when the numbers on this page were actually read from the database. It is stamped when the fetch finished, never when the page drew. While it reads **Updating**, nothing on the page is final yet.
3. [`population-chip` · next] This pill says how many real people the numbers are counted from. Demo accounts, SSi staff, class accounts and machine traffic are never people. If a page is deliberately showing demo or staff data the pill says so in red. The count comes from the server, from one shared rule, so two pages can never disagree about who is real.
   - terminal: Findings above, the answer, then when it was fetched and who it counts. Every question page reads the same way.

## reading-insights — Reading your insights

Personas: admin, leader, school_admin · place: node-insights

1. [`insights-measure` · next] The **measure** picks what's being counted — progress, practice, class sessions. The line underneath the pickers says exactly what the current one means.
2. [`insights-window` · next] The **window** is the period the rate is computed over — shorter windows react faster, longer ones smooth the noise.
3. [`insights-compare` · next] **Compare to** puts an average alongside. Everything here is a rate, not a raw total — so groups of different sizes compare fairly.
4. [`insights-rate-widget` · next] This block is the rate itself, beside whatever you are comparing to. It is an amount per learner per week, never a running total — a total only says how big and how old a place is, a rate says how fast it is moving, which is what you can act on.
5. [`insights-org-practising` · next] **Practising** answers whether your classes are doing it: how many practised together this week against last week, the phrases practised each day over four weeks, and which people practised on their own account and for how long.
6. [`insights-org-quiet` · next] **Quiet** is the half you act on: which classes practised before and have stopped, how long ago, and which have never started. Open a class row to see where it stopped.
7. [`insights-org-journey` · next] **Journey** shows where in the course each class has got to, as the last phrase it played in both languages, and the funnel shows the sentence most classes stop before. Class rows run furthest first.
8. [`insights-voice-pause` · next] **Voice and pause** is what the microphone is giving us below this level. Read the uptake figure first — it is how many learners the rest is based on. A learner with no mic data is absent here, never a zero.
9. [`insights-overview` · next] **Overview** and **Insights** are two tabs on the same place. Overview takes you back to its home — insights is a lens on where you already are, not a different page to get lost in.
   - terminal: Rates lead, position is context — and the picker text always says what a measure means.

## reading-minutes — How many in-app minutes are being done

Personas: admin · place: intel (pulse)

1. [`question-pulse` · next] The first question: how many in-app minutes are being done, per course, in total and per person, and how each course stands against the average of all courses. A minute is everything between pressing play and stopping, on every screen.
2. [`insights-window` · next] Pick the **window**: today, the last seven days or the last thirty days. The course picker beside it opens on the busiest course in that window.
3. [`insights-measure` · next] Pick the **measure**: minutes per person, minutes in total, new enrolments, or people with no activity. The line under the pickers says what it counts and what the average of all courses is for it.
4. [`evidence` · next] Two numbers: this course against the average of all courses, and the strip beneath for where the course sits among the rest. The average counts this course too, and a course with two enrolments weighs two people, not a whole course.
5. [`rows` · next] The rows count the real people who practised in the last fourteen days, by course. Open one to see which bits of that course give trouble.
   - terminal: Every minute here is the same minute every school page shows, and a person on the course who did not press play still counts in the denominator.

## reading-the-course-list — Reading the course list

Personas: learner · place: library

1. [`library-course-card` · next] Each card names the language you would be learning, and under it, the language it would be taught in. That second line is the one worth reading — it is what you will hear the prompts in.
2. [`library-course-card` · next] The right-hand side tells you where you stand. A coloured dot and a position means you have already started that one and it is holding your place for you.
3. [`library-course-card` · next] **Premium** with **Try free** next to it means the course is a paid one, and that you can properly get going in it first. You carry on until the app asks — nothing stops you mid-thought and nothing is taken before you have said yes.
4. [`library-course-grid` · next] Some languages offer more than one card — a different region or accent of the same language. Pick whichever you would rather end up sounding like.
   - terminal: Nothing here commits you. Tapping a card takes you into it, and every course you have touched keeps its own place waiting.

## reading-your-class-list — Reading your class list

Personas: school_admin, teacher · place: classes

1. [`classes-table` · next] One row per class. Belt, how far through the course, minutes played as class this week and the shape of those days — all the class account's own, never a pupil's.
2. [`classes-filters` · next] **Course** narrows the list to one language. **Sort by** puts it in the order that answers your question — name, journey, or phrases practised.
3. [`classes-year-groups` · next] Tiles by year, read off the class name — **7B** and **Year 9 French** both count. Tap a tile and the table narrows to that year.
4. [`classes-row` · next] Anywhere on a row opens that class. The buttons at the right end do their own jobs and do not open it.
   - terminal: That's reading the list — the row itself opens a class. This tour opened nothing.

## remove-a-teacher — Remove a teacher from your school

Personas: school_admin · place: teachers

1. [`teacher-remove` · next] **Remove** on a teacher's row takes them off your school when they leave, or clears out a name you don't recognise under Not yet given classes. You'll be asked to confirm their name back before it happens.
   - terminal: Their own account survives — what goes is their place in this school and their view of its classes. An admin's row carries no Remove button at all, so you can never lose your own admin this way.

## report-a-bug-from-settings — Report a bug from Settings

Personas: teacher, school_admin, leader · place: settings

1. [`report-bug` · click] Under **Tools** in Settings sits **Report a bug** — tap it to open the sheet. Nothing is sent until you tap Send on it.
2. [`report-bug-sheet` · next] This sheet is the whole flow — one box, one optional screenshot, one Send. Tap outside it and it closes without sending anything.
3. [`report-bug-text` · next] Write what you saw in your own words here. Your course and device details are added for you, so you only need to describe the problem itself.
4. [`report-bug-send` · next] **Send** stays off until you have written something. Tap it and it reads **Sending…** while your note, and your screenshot if you added one, goes.
5. [`report-bug-thanks` · next] **Got it, thank you** replaces the form the moment it lands — that line is the whole reply. The sheet closes on its own a moment later, or tap the line to close it now.
   - terminal: Nobody replies through the app: your note goes to one place where we read it, whether or not you are signed in.

## report-a-bug-from-the-dashboard — Report a bug from the dashboard

Personas: teacher, school_admin, leader · place: dashboard

1. [`schools-user-menu-trigger` · click] Tap your name at the top right to open the account menu.
2. [`schools-report-bug` · click] **Report a bug** sits in that menu — tap it to open the window without leaving the dashboard. The page you are on, and your school, are attached for you.
3. [`schools-report-bug-happened` · next] Write what you saw, or what you would like to see, in **What happened?**. Add what you expected underneath if that helps — that part is optional.
4. [`schools-report-bug-send` · next] **Send** stays off until you have written something. Tap it and it reads **Sending…** while your note goes, with your screenshot too if you added one.
   - terminal: A **Got it, thank you** toast appears at the top of the page and that is the whole reply — nobody answers through the app. Questions about the dashboard itself go to Support instead.

## run-class-session — Run your first class session

Personas: teacher, school_admin · place: class-detail

1. [`class-join-link` · next] Students join with this link — share it and they sign up straight into this class.
2. [`class-join-code` · next] Prefer a whiteboard? **Show code instead** reveals a standing code — anyone who enters it at saysomethingin.com/redeem joins this class, until the code changes.
3. [`class-play` · next] **Play as class** is the heart of it: one device — yours — leads the whole class through a session, and it counts for every student on the roster.
   - terminal: When you're ready, tap Play as class for real — this tour never starts a session for you.

## save-your-progress — Save your progress

Personas: learner · place: library (guest)

1. [`library-save-progress` · next] Right now everything you have done lives on this device alone. It works perfectly well — but a cleared browser or a new phone takes it with it.
2. [`library-save-progress` · next] Tap this and you give us an email address, nothing more. We send you a code, you type it in, and your position is yours on any device you sign in on.
   - terminal: Everything you have already done comes with you — signing in adds your account to it, it never starts you again.

## school-identity-list — Which addresses look like your school

Personas: school_admin · place: settings

1. [`settings-identity-add-domain` · next] Type the part of your school's email after the @, such as example.sch.uk, and tap **Add domain**. Nobody is let in or kept out by this — it only sorts your Not yet given classes list, so an arrival from a domain you don't recognise rises to the top.
2. [`settings-identity-add-address` · next] For one named person on a personal address — a supply teacher, a colleague without a school email — type their address here and tap **Add address** instead.
3. [`settings-identity-remove` · next] **Remove** beside any entry takes it off the list. Nothing is revoked — the person just stops being sorted to the top as unfamiliar.
   - terminal: That's the whole list — it changes ordering, never access. Giving somebody a class is what actually brings them into your school.

## seeing-how-it-is-going — Seeing how it is going — the numbers and the map on any level

Personas: admin, leader, school_admin · place: node-home (org/group/school)

1. [`node-map-rail` · next] This map stays down the side of every level. Read it top to bottom: the levels above you, the one you are on, its neighbours and what sits under it. Tap any name to move straight there — the page rebuilds around it and the map redraws.
2. [`node-updated` · next] **Updated** and a time says when these figures were last fetched. Reload the page to fetch again and the stamp moves with it. An empty stamp means the numbers have not arrived yet, not that they are old.
3. [`node-stats` · next] The row of numbers counts everything below this level, each person once. **Phrases practised this week** and **Classes practising this week** come from whole-class play over the last seven days. **Minutes in the app this week** is time in the lesson, pauses included, for the classes below and for staff and students on their own accounts. On your own school each card is a link to the list behind it.
4. [`node-year-groups` · next] **By year group** splits the same minutes by year: **Y7**, **Y8** and so on, read off each class name, with the minutes this week beneath and how many of that year's classes practised out of how many there are. **Other** holds classes whose names carry no year. If fewer than half your class names carry a year, the card reads **By class** instead.
5. [`below-tree-name` · next] **Below this** draws everything hanging beneath here — groups inside groups, their classes, the teachers who take them and staff who teach nothing yet. Tap a caret to open or close a branch, tap a name to go to that level. A class row already tells you its teachers, its student count and whether it practised together this week, so you need not open it to find out.
   - terminal: The map tells you where you are, the numbers tell you how it is going below here, and the tree takes you down a level whenever you want the detail.

## set-your-password — Set or change your password

Personas: leader, school_admin · place: node-home (org/group/school)

1. [`account-card` · next] **Your account** is your own corner of this page — not the organisation's, yours. Your sign-in and your device live here, and nothing in it is visible to anyone you have invited.
2. [`account-password` · next] If you arrived through a **link in an email**, that link will not last forever. A password is how you get back into your organisation from a new laptop, a new phone, or after clearing your browser.
3. [`account-password` · next] Tap **Set a password** and the form opens right here. You will sign in with your email address and that password from then on — and you can come back and change it any time.
   - terminal: That is the whole thing — one password, always changeable, always in the same place.

## setup-choose-courses — Choose which courses your school uses

Personas: school_admin · place: setup

1. [`setup-course-picker` · next] Step three of first-time setup, **Choose courses** — everything your school has access to starts ticked here.
2. [`setup-course-picker` · click] Untick anything you don't plan to teach. This is a filter and nothing more — it doesn't change what your school has access to, it just shortens the list you pick from at the next step.
   - terminal: Tap Continue and step four's course picker only offers what you left ticked here.

## setup-give-class-course — Give a class its course

Personas: school_admin · place: setup

1. [`setup-class-course` · next] Step four, **Create classes** — each class row already holds the language you signed your school up with, so most classes need nothing done here.
2. [`setup-class-course` · click] To teach something else, tap the picker and start typing — the catalogue runs to dozens of courses, and this only offers what you left ticked at Choose courses.
3. [`setup-class-course` · next] Pick the one you want. Where a language offers more than one version, the versions differ by region or accent.
   - terminal: Save the class and everyone who joins it lands in that course.

## share-a-class — Share a class with a colleague

Personas: teacher, school_admin · place: class-detail

1. [`class-teachers` · next] A class does not have to be yours alone. **Teachers** lists everyone who teaches it, with the lead marked — a job share, a department colleague, a supply teacher covering for a fortnight.
2. [`class-teacher-add` · click] **Add another teacher** is how you share it. Nobody is added until you pick a name and confirm.
3. [`class-teacher-picker` · next] You can pick anyone already teaching at your school. If the list is empty, your colleague has not joined the school yet — the link underneath brings them straight in.
4. [`class-teachers` · next] What they get is the whole class: the roster, the sessions, the progress, and the right to run a class session. What they do not get is the lead — that stays with you until you hand it over.
   - terminal: That's sharing a class — same class, two teachers, one lead. This tour added nobody; only your own taps do.

## start-or-make-a-class — Start a session or make a class from the list

Personas: school_admin, teacher · place: classes

1. [`classes-row-play` · next] **Play as class** at the end of a row starts a session straight from the list — no need to open the class first. Your device leads, the whole class moves on together.
2. [`verb-new-class` · next] **+ New class** sets up a class of your own: a name, a language, and a join link made for you at the same moment.
3. [`classes-export` · next] **Export CSV** takes the list away as a spreadsheet — belt, journey, minutes, join code, one row per class. What you export is whatever the filters currently show.
   - terminal: Starting a session, making a class, exporting the list — all from the same page. This tour started nothing and made nothing.

## take-a-teacher-off-a-class — Take a teacher off a class, or move them

Personas: leader, school_admin, teacher · place: teachers

1. [`teacher-assign-classes` · click] **Assign to a class** on a teacher's row opens their ticks — the classes they take now, already ticked.
2. [`assign-classes-modal` · next] The ticks start from what is true today, so moving somebody from one class to another is a single change rather than two.
3. [`assign-classes-list` · next] Untick the class they're leaving, tick the one they're joining. A move is one change here, not two.
4. [`assign-classes-save` · next] **Save** counts your changes back to you before it commits. If part of it fails, the panel stays open and names the class it couldn't do — nothing is ever reported saved when it wasn't.
   - terminal: Untick, tick, save — that's moving or removing a teacher. This tour changed nobody's classes.

## ways-in — Ways in — who can get in, and how to change it

Personas: admin, leader, school_admin · place: node-home (org/group/school)

1. [`ways-in-ledger` · next] Every way in, in one ledger: personal sign-in links and shareable join links, for everywhere below here. With more than three links it folds to one row per role — how many, and how often they have been used.
2. [`ways-in-show-all` · click] Tap **Show all** to open the full ledger, every link on its own row with its own verbs. You can filter by role or by place with the chips once it is open.
3. [`ways-in-copy` · next] **Copy** re-shares the same live link — always safe, nothing changes.
4. [`ways-in-remint` · next] **Re-mint** sits on a person's OWN sign-in link, and only there: it makes that person a new link and the old one stops working the moment you tap — if they bookmarked the old one they are locked out until you send them the new one. A shareable link has no Re-mint, because there is nobody to re-bind it to.
5. [`ways-in-revoke` · next] **Revoke** switches a link off. It's undoable — a revoked row grows a **Put back** button. For a shareable link this is how you retire it: revoke the old one, then make a fresh one.
6. [`verb-shareable-link` · next] And this is where a brand-new shareable link comes from — **Get a shareable link** at the top of this page, one per role. **Invite a person** next to it makes a personal link for someone you can name.
   - terminal: The short version: copy is safe, revoke can always be undone, re-mint is for one person's own link — and a new shareable link is made at the top of the page, not in the ledger.

## weak-points — Which bits of a course make people stumble

Personas: admin · place: intel

1. [`question-weak-points` · next] **Weak points**, under What's happening, shows for one course which pieces of it real learners skip, retry or stop on, ranked by how much trouble each piece caused per person who met it. Pick a course under **Courses** in the map on the left first; until you do, the page waits.
2. [`answer` · next] The sentence names the piece that gave people the most trouble. When fewer than five real people have practised the course, the page says **too few to say** instead of a number. That is the truth about the course, not a fault in the page.
3. [`rows` · next] The rows are the bits, worst first, each showing both languages with its skips, retries, failures and the share of people who stopped there. Open a row to see that piece and its phrases.
   - terminal: Pick a course, read the worst piece, open a row to see its phrases.

## what-your-numbers-mean — What your numbers mean

Personas: learner · place: library

1. [`library-activity-stats` · next] These are a record of what you have already done. None of them is a target, and none of them is being compared with anybody.
2. [`library-stat-total-time` · next] Time is the time you have actually spent learning. If it ever shows a **~** in front of it, that is us working it out from how far along you are, because we have not logged the sessions themselves.
3. [`library-stat-phrases-learnt` · next] Phrases learnt is how many separate phrases every one of your courses has introduced you to so far. It is added up across all of them, so it grows whichever language you pick up.
   - terminal: Nothing here changes what you get next. The course follows your position, not these numbers.

## where-and-what — Where in the world people are using us, and on what

Personas: admin · place: intel

1. [`question-where-and-what` · next] **Where and what**, under What's happening, answers two questions at once: which countries real people practised from in the last thirty days, and whether they were on phones, tablets or desktops, in the app or in a browser. Machine traffic is left out by rule.
2. [`answer` · next] The sentence gives you how many real people, from how many countries, and the country and device most of them are on. A person seen on two devices is counted once here and once under each device.
3. [`evidence` · next] The chart is people by country, most first.
4. [`rows` · next] One row per country, each with its phone, tablet and desktop split and its in-the-app or in-a-browser split. Tap a country to narrow the page to it; tap a device chip to count only that device. Both choices are written into the page address, so a pasted link reproduces the view. In the app or in a browser has only been recorded since 10 September 2026, so earlier people read as not recorded rather than being guessed at.
   - terminal: Countries and devices on one page. Tap a country or a device chip to narrow it, and the address carries the choice.

## where-you-are-in-this-course — Where you are in this course

Personas: learner · place: library

1. [`library-progress-card` · next] This card is your whole position in the course in one glance. Nothing here is a score, and nothing here is counting anything against you.
2. [`library-belt-strip` · next] Those eight coloured dots are **belts**, and the filled one is where you are now. A belt marks how far along the course you have come — it is a position, not a grade, and there is nothing to pass. You move to the next one simply by carrying on.
3. [`library-position-track` · next] The bar underneath lays the whole course out end to end, with each belt as its own band of colour. The marker on it is you — so it shows how far you have come rather than how far is left.
4. [`library-belt-browser` · next] Tap the card itself to open the belts up. You can look through everything you have met so far, and start again from any point you fancy revisiting.
   - terminal: That's your position. Close this whenever you like and press play — it always picks up exactly where you left off.

## who-is-about-to-leave — Who is about to leave

Personas: admin · place: intel

1. [`question-leaving` · next] **Leaving**, under What's happening, is the list of who to write to and why: real people who were practising regularly and have stopped, paying people who have gone quiet, and people whose access runs out within a fortnight. This page sends nothing.
2. [`answer` · next] The sentence says how many, and why.
3. [`evidence` · next] The chart is how long they have been gone.
4. [`rows` · next] The rows are ordered by who was seen most recently, then by who was most regular before they stopped. Nobody is ranked by money, because no amount is stored for anyone. Each row carries every reason that applies, how long since they were seen, how regular they were, and when their access ends if it is ending. Open a row to see that person and act on them.
   - terminal: Who has gone quiet and why, most recently seen first. Open a row to write to them.

## working-now — Whether the app is working right now

Personas: admin · place: intel

1. [`question-working` · next] **Working now**, under What's happening, tells you whether audio is failing for real people, on which build and on which kind of device, so you can see whether the last fix reached them. Only real people's plays count, so your own session on staging is not here.
2. [`answer` · next] The sentence gives the failure rate over the last seven days and the build most people are on today.
3. [`evidence` · next] The chart is the failure rate by day.
4. [`rows` · next] One row per build, most people first, with people, plays, how many failed and the rate. The build most people are on today carries a pill. Tap a build to narrow the rows to it; the choice is written into the page address. The line under the rows is the same rate for phones against desktops.
   - terminal: Rate by day, then by build, then by device. If a fix landed, the newest build's row is where you see it.

## your-account-identity — Find out which email you are signed in with

Personas: teacher, school_admin, leader · place: settings

1. [`account-identity` · next] At the top of **Account** in Settings is the address this account uses. Tap it and it copies — useful the moment you sign in on a new device and cannot remember which email you used.
2. [`account-identity` · next] Under it is your account code. Tap that to copy it too, and give it to us if you ever get in touch — it names your account and nothing more, so it is safe to read out or put in a message.
   - terminal: That's the whole card — your address and your code, both a tap away from your clipboard.

## your-classes-at-a-glance — Your classes at a glance

Personas: teacher · place: dashboard

1. [`dash-class-card` · next] Every class you teach is here, one entry each, with its course beside it. Tap the class name to open its class page.
2. [`dash-class-week` · next] This is the class's own week: the minutes it spent in the app with a lesson running, the phrases it practised, and how far it has travelled through the course. Those minutes come from the lessons you ran with **Play as class**. A class that has never played says **Not started** in words.
3. [`dash-class-week-pupils` · next] Kept apart, and never added in, is what the pupils did on their own accounts this week. When there is nothing it says so in words, which is usual for a class taught from the front.
4. [`dash-teacher-stats` · next] Under your classes, one quiet line totals them: how many classes you teach, the minutes they spent in the app this week with a lesson running, pauses included, and the phrases they were prompted with. All of it is the classes' own play from the front.
5. [`dash-teacher-own-accounts` · next] The second line is the minutes your pupils spent on their own accounts this week, kept apart from the first and never added to it.
   - terminal: The join code on each class is what you read out to get a new pupil in.
