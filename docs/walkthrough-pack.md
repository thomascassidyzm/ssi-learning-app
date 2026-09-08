# Walkthrough pack — compiled render

**Version `40b0ade697d1` · generated 2026-09-08 by `tools/walkthrough/compile.mjs`. DO NOT EDIT — edit tools/walkthrough/walks/*.json and recompile.**

## add-a-class-to-a-group — Add a class to a group

Personas: admin, leader, school_admin · place: node-home

1. [`verb-add-class` · click] **Add a class** builds a class underneath the group you are standing on, before anybody is teaching it. Tapping it opens the form and creates nothing.
2. [`add-class-name` · next] The class name goes here, and the course beside it is what the class will learn. Both are needed before the button will do anything.
3. [`add-class-submit` · next] **Add** creates it. A class needs no teacher to exist — it sits under the group waiting, and you put a teacher on it from your staff list whenever you are ready.
   - terminal: That's a class set up in advance, teacher to follow. This tour changed nothing; only your own taps do.

## add-a-school-to-your-programme — Add a school to your programme

Personas: leader · place: schools-list

1. [`verb-add-school` · click] **+ Add school** sits at the top right of All schools. Nothing is created until you name the school and confirm.
2. [`verb-add-school` · next] Type the school's name and tap **Create school**. It exists from that moment, already attached to your group, with its admin link and teacher link ready to hand over.
3. [`verb-add-school` · next] Copy the Admin link and send it to whoever will run the school — opening it takes them straight to sign-in as its admin. Copy the Teacher link too if you are setting their staff up as well.
4. [`verb-add-school` · next] Tap **Done** and the new school appears in the list. There is no separate onboarding step to remember: both links live on its row from then on.
   - terminal: That's a school added — named, attached, and its two links already waiting on the row. This tour changed nothing; only your own taps do.

## add-a-school-under-a-group — Add a school under a group

Personas: admin · place: node-home

1. [`verb-add-school` · click] **Add a school** only appears on a plain group, because a school cannot contain another school. Tapping it opens a name field and creates nothing.
2. [`verb-add-school` · next] Type the school's name and tap **Add**. It appears in the list below with its own home page, its own staff and its own learners, still rolling up into whatever sits above it.
   - terminal: That's a school inside a group — its own place, still part of yours. This tour changed nothing; only your own taps do.

## add-a-student-to-a-class — Add a student to a class

Personas: admin, leader, school_admin · place: node-home

1. [`verb-invite-student` · click] On a class's own page the invite verb says **Invite students**, because a link minted here carries this class with it. Tapping it opens a form and creates nothing.
2. [`invite-form-submit` · next] Type the student's name, then either add their email so we send the invite, or leave it blank and the button becomes **Create their link** for you to hand over yourself.
3. [`verb-invite-student` · next] One student at a time is deliberate — the link is theirs alone and puts them straight into learning with no sign-up screens. Come back to this button for the next name.
   - terminal: That's a student in a class — one name, one link, no forms for them. This tour changed nothing; only your own taps do.

## add-students-to-a-class — Add students to a class

Personas: leader, school_admin, teacher · place: class-detail

1. [`class-student-add` · click] **Add students** puts a pupil who is already in your school into this class. Opening it changes nothing on its own.
2. [`class-student-picker` · next] The list holds the pupils in your school who are not in this class yet, with the classes they are in now under each name. Type a few letters to narrow it.
3. [`class-student-picker` · next] Tapping a name adds that pupil straight away, and they bring everything they have already learned with them. Adding does not take them out of any other class.
4. [`class-student-add` · next] The same button reads **Done** while the list is open. For a pupil with no account at all, use the class link in **Invite students** instead.
   - terminal: That's adding students — search, tap, done. This tour changed nothing; only your own taps do.

## change-how-many-seats-you-pay-for — Change how many seats you pay for

Personas: school_admin, leader · place: upgrade

1. [`upgrade-update-seats` · next] Once you are subscribed, the seat count is edited in place. Step it up or down with the stepper above, or type the number straight into the box.
2. [`upgrade-update-seats` · next] This button then reads Update, with the new monthly total on it. Tapping it changes your existing subscription — no second checkout, no new card details.
3. [`upgrade-update-seats` · next] While the count matches what you already pay for, the button simply says current and does nothing, so you cannot double-bill yourself by tapping it twice.
   - terminal: That is seat editing — grow or shrink as staff come and go. This tour changed nothing; only your own taps do.

## change-your-school-details — Change your school's name and details

Personas: school_admin · place: settings

1. [`settings-save-profile` · next] Everything above this button is editable: your school name, its city and region, the contact email, and a short description. Change as many of them as you like before you save.
2. [`settings-save-profile` · next] **Save changes** writes the lot in one go. The button reads Saved when it has gone through, and the new name appears across the dashboard straight away.
3. [`settings-save-profile` · next] Only a school admin sees this button. A teacher opening the same page reads the details but cannot change them, and your school type is set by your group administrator rather than here.
   - terminal: That is the school profile — edit freely, save once. This tour changed nothing; only your own taps do.

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

## choose-what-role-someone-arrives-as — Choose what role someone arrives as

Personas: admin, leader, school_admin · place: node-home

1. [`invite-form-role` · next] Open **Invite a person** and this dropdown is the first thing in the form. The role you pick travels with the link rather than being set afterwards, so it is the role they land in.
2. [`invite-form-role` · next] Teacher sees their own classes. Group leader sees everything below this node. Learner just learns. The place matters as much as the role — a leader invited on a group leads that group and everything under it.
3. [`invite-form-submit` · next] Name them, then submit. The role is fixed into the link at that moment, which is why it is worth picking the node before you pick the role.
   - terminal: That's role and place decided together, at the point of invite. This tour changed nothing; only your own taps do.

## choose-which-courses-a-school-can-use — Choose which courses a school can use

Personas: admin · place: node-home

1. [`verb-courses` · click] **Courses** sets what this school or group is allowed to learn. Tapping it opens the picker and changes nothing until you save.
2. [`verb-courses` · next] Choose the whole catalogue for a school that is paid up, or search out the one or two courses a trial should carry. Everyone below this node inherits whatever you save.
   - terminal: That's a school's reading list set from one place — the server works the trial dates out on save. This tour changed nothing; only your own taps do.

## choose-which-courses-your-school-uses — Choose which courses your school uses

Personas: school_admin · place: setup

1. [`setup-course-picker` · next] Every course your school can teach is tiled here, and they all start ticked. Untick anything you do not plan to use.
2. [`setup-course-picker` · next] This is a filter and nothing more. It does not change what your school has access to and it takes nothing away from anyone — it only shortens the list you pick from on the next step.
3. [`setup-course-picker` · next] A school on a trial sees its one trial course here; a subscribed school sees the whole catalogue. Tap **Continue** when the ticks look right.
   - terminal: That is step three — a short list instead of a long one. This tour changed nothing; only your own taps do.

## claim-another-email-domain — Claim another email domain for your school

Personas: school_admin · place: settings

1. [`settings-identity-add-domain` · next] Your own domain was claimed when you signed up. This field is for the others — a second site, a federation, a domain the office still uses.
2. [`settings-identity-add-domain` · next] Type only the part after the @, such as example.sch.uk, then tap **Add domain**. Anyone arriving on your invite links from that domain is in with one tap.
3. [`settings-identity-add-domain` · next] Public providers such as gmail.com cannot be claimed, because they do not identify a school. For a colleague on one of those, add their address by itself in the field below.
   - terminal: That is a claimed domain — one rule, no list of names to keep. This tour changed nothing; only your own taps do.

## copy-a-class-link — Copy a class link without opening the class

Personas: school_admin, teacher · place: classes

1. [`classes-share-link` · next] **Copy link** in a class's row hands you that class's join link without opening the class at all.
2. [`classes-share-link` · next] The button says it has copied, and the link is then yours to paste into an email or a lesson slide.
3. [`classes-share-link` · next] It is the same link the class page offers, so a student who follows it lands in that class either way.
   - terminal: That's copying a class link — one tap, from the list. This tour changed nothing; only your own taps do.

## copy-a-school-s-joining-links — Copy a school's joining links

Personas: leader · place: schools-list

1. [`schools-list-link-chips` · next] Every school's row carries its two joining links in the Links column. This is how you chase a school that has not got started, or replace a link somebody has lost.
2. [`schools-list-link-chips` · next] **Admin** copies its admin link and **Teacher** copies its teacher link. The chip reads Copied so you know it worked, then you paste it into an email or a message.
3. [`schools-list-link-chips` · next] Tapping a chip never opens the school — the rest of the row does that. A school still flagged as awaiting admin is one whose admin link nobody has opened yet.
   - terminal: That's both links, always on the row, always fetchable again. This tour changed nothing; only your own taps do.

## create-your-first-classes — Create your first classes

Personas: school_admin · place: setup

1. [`setup-add-class-row` · next] A class is a name, a course and the students who join it, and it is the thing every progress figure in your dashboard is eventually counted against. Step four is where the first ones are made.
2. [`setup-class-course` · next] Type a class name in the first row. Its course is already set to the language you signed your school up with, so most rows need nothing done here.
3. [`setup-add-class-row` · next] **+ Add another class** gives you a further row, starting on that same language. The cross at the end of a row removes one you no longer want.
4. [`setup-add-class-row` · next] Tap **Finish setup** and every filled-in row is created, each marked Added as it saves. Classes you made earlier are listed above the rows, so running the wizard twice will not duplicate them.
   - terminal: That is step four — your classes exist, and students join them from each class page. This tour changed nothing; only your own taps do.

## delete-a-class — Delete a class

Personas: leader, school_admin, teacher · place: class-detail

1. [`class-delete` · next] The small bin beside the class name deletes the class. It is here for a class set up by mistake or a group that has finished.
2. [`class-delete` · next] Tapping it does not delete anything on the spot. It first shows you what would go with the class, so you are deciding with the facts in front of you.
3. [`class-delete` · next] A class with real practice behind it asks you to type its name before it will go. That is the app making you say it twice on purpose.
4. [`class-delete` · next] Students keep their own accounts and everything they have learned. What goes is the class itself, its roster and its join link.
   - terminal: That's deleting a class — shown to you first, confirmed by you, then gone. This tour changed nothing; only your own taps do.

## delete-a-school-or-group — Delete a school or group

Personas: admin · place: node-home

1. [`verb-delete` · next] **Delete** sits on its own at the end of the row, in red, because it is the one verb here that takes everything below it with it. This tour points at it and will not tap it.
2. [`verb-delete` · next] Tapping it shows you a summary first: the classes, people and links that go with it, counted for you. Where there is real activity underneath you are asked to type the name back before it will go, which is the signal to stop and check.
   - terminal: That's the one door with a lock on it — an empty shell goes on a single confirm, a live school does not. This tour changed nothing; only your own taps do.

## delete-your-school — Delete your school

Personas: school_admin · place: settings

1. [`settings-delete-school` · next] This is the Danger zone, and it is the one button on the dashboard that cannot be undone. It closes the school itself along with its classes and everybody's enrolment in them.
2. [`settings-delete-school` · next] Tapping it does not delete anything yet. It opens a panel listing what would go — classes, students, teachers and recorded sessions, each counted for you.
3. [`settings-delete-school` · next] If the school has real activity in it, you type its name exactly before the app will act. Confirm and you are signed out to a clean slate, because the account you were using belonged to a school that no longer exists.
   - terminal: That is the danger zone — read the counts, then decide. This tour changed nothing; only your own taps do.

## download-your-school-data — Download your school's data

Personas: school_admin, teacher · place: settings

1. [`settings-export-data` · next] **Download all data** takes your school out of the app as a spreadsheet: every student, the class they are in, how far they have got, how long they have practised and when they were last active.
2. [`settings-export-data` · next] The file lands in your downloads named after your school and today's date. Open it in any spreadsheet app to sort, filter or share it.
3. [`settings-export-data` · next] It is a snapshot of the moment you press the button, not a live link. Download it again whenever you want current figures.
   - terminal: That is the export — your figures, in your hands, in one tap. This tour changed nothing; only your own taps do.

## email-someone-their-invite-again — Email someone their invite again

Personas: admin, leader, school_admin · place: node-home

1. [`ways-in-copy` · next] Every live way in has its own row down here in **Ways in**, with its verbs at the end of it. Find the row for the person who says they never got their invite.
2. [`ways-in-resend` · next] **Email again** sends the same invite a second time. Nothing changes and no new link is made, so the one they may yet dig out of a spam folder still works. Only rows for a named person with an email on file carry this button.
   - terminal: That's the same invite, sent again — and the note above the table names the address it went to. This tour changed nothing; only your own taps do.

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

## finding-your-way-around — Finding your way around the organisation

Personas: admin, leader, school_admin · place: node-home

1. [`node-map-rail` · next] This column is the map, and it never goes away. Read down it for the path from your top level to the one you are standing on.
2. [`node-map-rail` · next] Under your own level sit its neighbours and everything hanging beneath it, so you can always tell how deep into the organisation you have gone.
3. [`node-map-rail` · next] Tap any name to move straight there. The page rebuilds around the new level and the map redraws with it. A leader only ever sees their own part of the organisation — the map is trimmed by the server, not hidden in the page.
   - terminal: That's the map — one column that always answers where you are. This tour changed nothing; only your own taps do.

## give-a-class-its-course — Give a class its course

Personas: school_admin · place: setup

1. [`setup-class-course` · next] A course does not belong to a person, it belongs to a class — so this picker beside the class name is how a course reaches learners at all. It already holds the language you chose when you signed your school up.
2. [`setup-class-course` · click] Leave it alone to teach that language. To teach something else, tap the picker and it opens.
3. [`setup-class-course` · next] Start typing to narrow the list, because the catalogue runs to dozens of courses. Where a language offers more than one version, the versions differ by region or accent — pick the one you want and everybody who joins the class lands in it.
   - terminal: That is the course picker — one choice per class, changeable until you save. This tour changed nothing; only your own taps do.

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

## hand-out-your-staff-links — Hand out your staff links

Personas: school_admin · place: setup

1. [`setup-staff-links` · next] Your school has two standing links, shown here in full with a copy button beside each. The **Teacher invite link** is for anyone who will run classes; the **Admin invite link** is for anyone who needs to manage the school itself.
2. [`setup-staff-links` · next] Whoever opens one is signed in with that role, with no sign-up form to fill in. Send them however you normally reach staff — email, Teams, a message, or written on a board.
3. [`setup-staff-links` · next] Anyone who has already joined is listed underneath, so you can see who is in. A teacher does not need to speak the language: the app does the teaching.
   - terminal: That is step two — copy, send, and watch the list fill. This tour changed nothing; only your own taps do.

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

## how-students-join-a-class — How students join a class

Personas: leader, school_admin, teacher · place: class-detail

1. [`class-join-link` · next] **Invite students** carries the one door into this class. A student who follows this link signs up and lands straight in the class, on the right course, with no code to type.
2. [`class-join-code` · click] **Show code instead** is for a room where a link is awkward. It reveals a short code you can write on a whiteboard.
3. [`class-join-code` · next] Students enter that code at saysomethingin.com/redeem and arrive in the same class.
4. [`class-join-link` · next] The link and the code both stay valid, so the same one works in week one and in week six. If the card says it could not load, hand nothing out until it comes back.
   - terminal: That's how students join — one link, one code, both lasting. This tour changed nothing; only your own taps do.

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

## let-a-named-address-in — Let a named address in through your links

Personas: school_admin · place: settings

1. [`settings-identity-add-address` · next] This is the exception to the domain rule: one named person, let in by their own address. A supply teacher here for a fortnight, or a colleague who only uses a personal email.
2. [`settings-identity-add-address` · next] Type the address exactly as they will use it and tap **Add address**. Then send them your usual teacher link.
3. [`settings-identity-add-address` · next] Without this they can still get in, but they show as **Unverified address** on the Teachers page until they confirm their email. Adding them here first skips that.
   - terminal: That is a named address let through — the smallest door you can open. This tour changed nothing; only your own taps do.

## look-up-one-student — Look up one student

Personas: admin, school_admin, teacher · place: students

1. [`student-view-link` · next] Finding one learner among all of them starts above the list: type part of their name in the search box, or narrow by class, belt or health.
2. [`student-view-link` · next] Their row already carries their belt, their hours this week and when they were last here, so you can often answer the question without opening anything.
3. [`student-view-link` · next] **View** opens what that learner has actually done. Health is worked out from their last visit and how they sit against their own class, so a learner marked as needing attention has gone quiet or fallen behind the people beside them.
   - terminal: That's one learner found and read — search, row, then View. This tour changed nothing; only your own taps do.

## make-a-class — Make a class

Personas: school_admin, teacher · place: classes

1. [`verb-new-class` · next] **+ New class** along the top of **My Classes** is where a class of your own starts. A class holds a roster, its own place on the course, and everything the class practises together.
2. [`verb-new-class` · next] It asks for two things: a name you will recognise on a list, such as Year 7 Welsh, and the language the class is learning.
3. [`verb-new-class` · next] The join link is made for you at the same moment as the class. Nothing else is needed to start teaching.
   - terminal: That's making a class — a name, a language, and a link students join by. This tour changed nothing; only your own taps do.

## make-a-link-anyone-can-use — Make a link anyone can use

Personas: admin, leader, school_admin · place: node-home

1. [`verb-shareable-link` · click] **Get a shareable link** is the one to reach for when you cannot name who is coming — a newsletter, a slide at the front of a hall, a whole staffroom. Tapping it opens a small form and mints nothing yet.
2. [`verb-shareable-link` · next] The dropdown sets the role everyone arriving on that link lands in, and **Create invite link** hands you the link itself. Because it is tied to nobody, new arrivals type their own name before they are in.
   - terminal: That's a link a whole room can use — one role, one link, revocable in **Ways in** whenever it has travelled too far. This tour changed nothing; only your own taps do.

## move-a-teacher-between-classes — Move a teacher to another class

Personas: teacher · place: class-detail

1. [`class-teachers` · next] **Teachers** answers 'who teaches this class?'. A head usually wants the other direction too — 'which classes does this person take?' — and that is the same question read backwards.
2. [`class-teacher-other-classes` · click] **Other classes** on anyone's row asks it that way round. It never moves anybody on its own — it opens a list for you to change.
3. [`assign-classes-list` · next] Every class in the school, with the ones this teacher already takes already ticked. Ticking a second, or a third, is all 'belonging to several classes' means — there is no separate step for it.
4. [`assign-classes-list` · next] A move is just both at once: tick where they are going, untick where they are leaving. You are looking at the truth before you change it, so nothing here is a guess.
5. [`assign-classes-save` · next] Saving applies only the boxes you actually changed. If one of them fails, it says which class failed and why, rather than claiming everything saved.
   - terminal: That's moving a teacher — one untick, one tick, one save. This tour changed nothing; only your own taps do.

## name-your-school — Name your school

Personas: school_admin · place: setup

1. [`setup-school-name` · next] Step one of setup asks for one thing. The name you type here is the one your teachers and students see on every page, on every invite link they open, and at the top of every report.
2. [`setup-school-name` · next] Write it as you would on a letterhead, then tap **Continue** — the name is saved before the next step opens. If you have only just arrived and the box sits empty for a second, give it a moment and press **Continue** again.
3. [`setup-school-name` · next] Typing it here counts as confirming it, so you are not asked again afterwards. To change it later, use School profile in Settings.
   - terminal: That is step one done — one box, and your school has a name. This tour changed nothing; only your own taps do.

## open-a-class — Open a class

Personas: school_admin, teacher · place: classes

1. [`classes-row` · next] A whole row is the way in. Tapping anywhere on it opens that class, and the keyboard works too.
2. [`classes-row` · next] The class page opens on its roster, which is where most of what you want to do with a class lives.
3. [`classes-row` · next] The buttons at the right of the row do their own jobs and do not open the class.
   - terminal: That's opening a class — tap the row, land on the roster. This tour changed nothing; only your own taps do.

## practice-per-student-per-week — Practice per student per week

Personas: admin, leader, school_admin · place: node-home

1. [`class-benchmark` · next] **Practice min/student/week** is the top bar: this class's own minutes of practice per student per week.
2. [`class-benchmark` · next] The bars below it are the school average and the global average for the same course. Compare the lengths, and the numbers at the end give the exact figures.
3. [`class-benchmark` · next] Dividing by students and by weeks is what lets a class of nine and a class of thirty be compared honestly. A class with too little practice recorded shows a plain line saying so rather than a bar built from almost nothing.
   - terminal: That's this class's effort, put on the same footing as everyone else's. This tour changed nothing; only your own taps do.

## prove-your-mailbox — Prove your mailbox reaches you

Personas: school_admin, teacher · place: dashboard

1. [`mailbox-check-send` · next] School mail gateways are ferocious, and a sign-in code that never arrives is usually discovered on the day you need it. **Send me a code** settles that now, while you are here and not locked out.
2. [`mailbox-check-send` · next] If your school address eats our mail, the line underneath sends the code to a different address instead. Whichever you pick, six digits arrive and you type them in.
3. [`mailbox-check-send` · next] **That's the one** confirms the code and the card is done with for good. Close it instead and it stays closed — it never comes back on a timer.
   - terminal: That's your mailbox proved — one code, once, and never asked again. This tour changed nothing; only your own taps do.

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

## remove-a-student-from-a-class — Remove a student from a class

Personas: leader, school_admin, teacher · place: class-detail

1. [`class-student-remove` · next] **Remove** at the end of a student's row takes that pupil off this roster. It is per pupil, so you are always removing the person you are looking at.
2. [`class-student-remove` · next] It asks you to confirm before anything happens, which is your chance to check you are on the right row.
3. [`class-student-remove` · next] The student keeps their account and everything they have learned, and can join another class straight away. Only their place on this roster goes.
   - terminal: That's removing a student — one row, one confirmation, nothing lost. This tour changed nothing; only your own taps do.

## remove-a-teacher-from-your-school — Remove a teacher from your school

Personas: school_admin · place: teachers

1. [`teacher-remove` · next] **Remove** on a teacher's row takes them off your school when they leave. Their own account survives — what goes is their place here and their view of its classes and learners.
2. [`teacher-remove` · next] You are asked for their name back before anything happens, so a mistaken tap costs you nothing. Confirm and the list refreshes without them.
3. [`teacher-remove` · next] An admin's row carries no **Remove** button at all, so a school can never lose its own admin through this list. Change their role first if that is really what you want.
   - terminal: That's a leaver off your staff list, their own account untouched. This tour changed nothing; only your own taps do.

## rename-a-class — Rename a class

Personas: leader, school_admin, teacher · place: class-detail

1. [`class-rename` · next] The small pencil beside the class name is how a class gets renamed. It sits at the top of the class page, next to the name itself.
2. [`class-rename` · next] Tapping it asks you for the new name and does nothing until you give it one. Closing the box leaves the class exactly as it was.
3. [`class-rename` · next] Only the name changes. The roster, the join link, the join code and the class's place on the course all carry on as they were.
   - terminal: That's renaming a class — a new label on the same class. This tour changed nothing; only your own taps do.

## rename-a-school-or-group — Rename a school or group

Personas: admin · place: node-home

1. [`verb-rename` · click] **Rename** changes what this school or group is called everywhere it appears. Tapping it opens a field holding the current name.
2. [`verb-rename` · next] Type the new name and tap **Save**. Nothing else moves — the same people, classes and links carry on underneath it. If the new name matches something sitting beside it you are warned and asked to confirm.
   - terminal: That's a new name and nothing else changed. This tour changed nothing; only your own taps do.

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

## see-what-your-school-pays — See what your school pays

Personas: school_admin · place: settings

1. [`settings-billing-plan` · next] This is the whole of what your school pays, in one line: the plan it is on, how many teacher seats it covers, and whether the subscription is running.
2. [`settings-billing-plan` · next] Underneath it the price per teacher seat is spelled out, so the number on your card statement is never a surprise.
3. [`settings-billing-plan` · next] **Manage subscription & seats** takes you to the one Upgrade page where every payment change happens. **Billing & invoices** opens your invoices, your card and cancellation, and only appears once a subscription is running.
   - terminal: That is your plan, read from the top of the Billing panel. This tour changed nothing; only your own taps do.

## set-up-a-demo-organisation — Set up a demo organisation

Personas: admin · place: node-home

1. [`verb-mint-demo` · click] **Mint a demo org** stands up a whole organisation with plausible people and activity already in it, so a prospect sees the product running rather than empty. Tapping it opens the form and mints nothing.
2. [`verb-mint-demo` · next] Give it a name, and a leader's email if somebody is to be handed it. **Mint** builds it under the node you are standing on and gives you back a leader link to copy.
   - terminal: That's a demo org ready to show — and its own page grows a **Refresh demo activity** button so it never looks abandoned. This tour changed nothing; only your own taps do.

## set-your-language-and-time-zone — Set your language and time zone

Personas: school_admin, teacher · place: settings

1. [`settings-localisation-save` · next] Above this button, **Default interface language** sets the language the dashboard itself speaks to you in, and **Time zone** decides what your activity times are read against.
2. [`settings-localisation-save` · next] **Week starts on** and the flags toggle are here too. Change whichever you want, then tap **Save changes** once.
3. [`settings-localisation-save` · next] This is remembered on the device you set it on. Teachers and students each choose their own, so nothing you pick here changes what anybody else sees.
   - terminal: That is localisation — your dashboard, in your language, on your clock. This tour changed nothing; only your own taps do.

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

## subscribe-as-a-tutor — Subscribe as a tutor

Personas: teacher · place: upgrade

1. [`upgrade-subscribe-tutor` · next] Teaching on your own rather than inside a school means one seat, for you. Choose Monthly or Annual above — annual works out at two months free.
2. [`upgrade-subscribe-tutor` · next] **Subscribe** opens the card panel on this page. Your students pay for their own learning separately, so three paying students cover what your dashboard costs.
3. [`upgrade-subscribe-tutor` · next] Once it is running, this same button becomes **Manage subscription**, which is where invoices and cancellation live.
   - terminal: That is the tutor plan — a single seat, and it is yours. This tour changed nothing; only your own taps do.

## subscribe-your-organisation — Subscribe your organisation

Personas: leader · place: upgrade

1. [`upgrade-subscribe-org` · next] An organisation pays per learner seat, and one subscription covers every seat and every language across the group. Above this button, choose Monthly or Annual — annual works out at two months free per seat.
2. [`upgrade-subscribe-org` · next] The stepper sets how many learner seats you are buying. It opens at the number of people who have already joined, and the running total beside it moves as you step.
3. [`upgrade-subscribe-org` · next] **Subscribe** opens the payment panel on this page rather than sending you elsewhere. A seat belongs to one named learner for the period you have paid for, so plan the count against the people you expect, and add more at any time.
   - terminal: That is the organisation plan — one subscription, every seat, every language. This tour changed nothing; only your own taps do.

## subscribe-your-school — Subscribe your school

Personas: school_admin · place: upgrade

1. [`upgrade-subscribe-school` · next] This is how a trial becomes a paid school. You pay per teacher seat, and one subscription covers every language and every class those teachers run.
2. [`upgrade-subscribe-school` · next] Choose Monthly or Annual above — annual works out at two months free per seat — then set the seat count with the stepper. It opens at the number of teachers who have actually joined.
3. [`upgrade-subscribe-school` · next] **Subscribe** opens the card panel on this page, and you come back to your dashboard with the subscription live. Seats are teacher seats, not student seats: your students do not each need one.
   - terminal: That is the school plan — teacher seats, one subscription, no second checkout. This tour changed nothing; only your own taps do.

## take-a-domain-off-your-list — Take a domain or address off your school's list

Personas: school_admin · place: settings

1. [`settings-identity-remove` · next] **Who your links let in** lists every email domain and named address your school waves straight through. **Remove** sits beside each one.
2. [`settings-identity-remove` · next] Tapping it stops the next arrival from that domain or address being let in with one tap. They can still open your link — they simply show as an unverified address until they confirm their email.
3. [`settings-identity-remove` · next] Nobody already in your school loses anything. Their account, their classes and their progress are untouched; this is only about who arrives next.
   - terminal: That is the un-claim — it changes the door, not the people already inside. This tour changed nothing; only your own taps do.

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

## the-class-roster — The class roster

Personas: leader, school_admin, teacher · place: class-detail

1. [`class-roster` · next] **Roster** is the class as a list of people. Every student in the class has a row here, and the rows are where you read the class one pupil at a time.
2. [`class-roster` · next] Read the mark under each name first. It flags anyone falling behind the class or gone quiet for a while, so the table points before you go hunting.
3. [`class-roster` · next] The search box jumps you to one student in a long roster. A pupil who has never started reads as inactive rather than behind, because nothing has happened yet to judge.
4. [`class-roster` · next] The rail beside the table carries the class average, which is what a single row is worth comparing against. A class nobody has joined yet shows its empty places instead of a table.
   - terminal: That's the roster — the class read pupil by pupil. This tour changed nothing; only your own taps do.

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

## walking-down-to-a-school-a-class-or-a-person — Walking down to a school, a class or a person

Personas: admin, leader, school_admin · place: node-home

1. [`below-tree-name` · next] **Below this** draws everything hanging beneath the level you are on — groups inside groups, the classes in each, the teachers who take them and the staff who teach nothing yet. It is a picture of the shape, not a list to filter.
2. [`below-tree-name` · next] The caret to the left of a name opens and closes what sits under it. The top two levels open themselves and deeper ones wait to be tapped, so a large organisation shows you its shape rather than eighty-five rows.
3. [`below-tree-name` · next] Tapping a name walks you down to it, and the numbers above redraw for that level. A class row already names its teachers and its student count without you opening it; where there are more than eight, a **more** button reveals the rest.
   - terminal: That's the whole tree, one tap per level down. This tour changed nothing; only your own taps do.

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

## when-more-people-join-than-seats — When more people join than you have seats

Personas: school_admin, leader · place: upgrade

1. [`upgrade-seats-actual` · next] This line under the stepper is the honest count: how many people have actually joined, and how many seats you are paying for.
2. [`upgrade-seats-actual` · next] When more have joined than you pay for, the line says so and names the difference. Nothing is blocked, nobody is locked out, and no lesson stops — we would rather show you the gap than shut a class out mid-lesson.
3. [`upgrade-update-seats` · next] Putting it right is the stepper above and this button. Step the seat count up to match what the line says, and the button offers to update to it.
   - terminal: That is the seat gap — a truthful number rather than a locked door. This tour changed nothing; only your own taps do.

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

## work-through-setup-at-your-own-pace — Work through setup at your own pace

Personas: school_admin · place: setup

1. [`setup-save-exit` · next] Setup is four short steps — your school, your staff, your courses, your classes — and it does not have to be done in one sitting. The steps are listed down the left and you can tap any of them to jump forwards or back.
2. [`setup-save-exit` · next] **Continue** saves the step you are on and moves you along. **Save & exit** saves the step you are on and puts you back on your dashboard.
3. [`setup-save-exit` · next] If something cannot be saved, it stays put and tells you why, so you never leave work behind without knowing. Come back through Settings and First-time setup whenever you want to carry on.
   - terminal: That is the wizard — nothing here is a one-shot, and everything it sets up can be changed later. This tour changed nothing; only your own taps do.

## your-class-against-the-average — Your class against the average

Personas: teacher · place: analytics

1. [`teacher-insights-class` · next] **Your classes** picks which class you are reading. It only appears when you teach more than one, and switching it reloads everything below.
2. [`insights-window` · next] Underneath sit the **measure**, the **window** the rate is computed over, and what to **compare to**. The line beneath the pickers says exactly what the current measure counts.
3. [`insights-rate-widget` · next] This is the answer: your class's pace beside the average you chose. A class with too few sessions to compare honestly says so rather than showing a number built from nothing.
   - terminal: That's your class read as a pace rather than a pile of totals. This tour changed nothing; only your own taps do.

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
