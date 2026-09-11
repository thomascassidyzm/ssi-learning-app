# Handbook — compiled render

**Version `8ff5a6e3a950` · generated 2026-09-11 by `tools/walkthrough/compile.mjs`. DO NOT EDIT — each description lives in a HANDBOOK comment directly above the element it describes, in the .vue file named under its title. Edit it there, in the same change that alters the capability, then recompile.**

## A question whose page is not built yet

Section: seeing-progress · roles: admin · anchor: `question-not-yet` · in `packages/player-vue/src/views/intel/NotYetBuiltView.vue`

**What it's for.** Holding the place of a question that is in the frame but has no page yet, in the same layout as the built ones, so the bar always shows all ten and nothing pretends to measure what it does not.

**Where it is.** Any question in the bar shown in the quieter grey.

1. Tap the question in the bar.
2. Read the card saying nothing is measured for it yet.

**Worth knowing.** This is never a teaser and never a stub with a fake number on it.

## Add a class to a group

Section: running-classes · roles: admin, leader, school_admin · anchor: `verb-add-class` · in `packages/player-vue/src/components/admin/NodeActionBar.vue`

**What it's for.** Creating a class underneath a group you lead, before anyone is teaching it. Useful when you are setting a term up in advance and will put a teacher on each class later.

**Where it is.** The group's own page, the **Add a class** button in the row of actions at the top.

1. Open the group the class belongs under.
2. Tap **Add a class**.
3. Type the class name.
4. Choose the course the class will learn.
5. Tap **Add**.

**Worth knowing.** A class needs no teacher to exist. It sits under the group waiting, and you put a teacher on it whenever you are ready. The course must be one your group has cover for. A paid language you have not subscribed to and are not trialling is refused when you tap **Add**, and the message says so.

## Add a school to your programme

Section: your-school · roles: leader · anchor: `verb-add-school` · in `packages/player-vue/src/views/schools/SchoolsView.vue`

**What it's for.** Creating a new school inside your programme. The school exists the moment you name it, already attached to your group, with its admin link and teacher link ready to hand over.

**Where it is.** All schools, the **+ Add school** button at the top right.

1. Tap **+ Add school**.
2. Type the school's name and tap **Create school**.
3. Copy the Admin link and send it to whoever will run the school — opening it takes them straight to sign-in as its admin.
4. Copy the Teacher link too if you are setting their staff up as well.
5. Tap **Done**. The new school appears in the list.

**Worth knowing.** There is no separate onboarding step to remember. Both links live on the school's row from then on, so you can fetch them again any time.

## Add a school under a group

Section: your-school · roles: admin · anchor: `verb-add-school` · in `packages/player-vue/src/components/admin/NodeActionBar.vue`

**What it's for.** Creating a school inside a group, so it has its own home page, its own staff and its own learners while still rolling up into whatever sits above it.

**Where it is.** The group's home page, **Add a school** along the top.

1. Open the home page of the group the school belongs under.
2. Tap **Add a school**.
3. Type the school's name.
4. Tap **Add**, and the school appears in the list below.

**Worth knowing.** The verb only shows on a plain group. A school cannot contain another school, and an organisation using the neutral wording has groups rather than schools all the way down.

## Add a student to a class

Section: getting-people-in · roles: admin, leader, school_admin · anchor: `verb-invite-student` · in `packages/player-vue/src/components/admin/NodeActionBar.vue`

**What it's for.** Making one learner their own way into one class. The link puts them straight into that class with no forms and no sign-up, so a child can be learning within a minute of opening it.

**Where it is.** The class's own page, **Invite students** along the top.

1. Open the class.
2. Tap **Invite students**.
3. Type the student's name.
4. Add their email if you want us to send it, or leave it blank and you get a link to hand over yourself.
5. Submit, and repeat for the next student.

**Worth knowing.** One student at a time, on purpose — the link is theirs alone and carries the class with it. The **Students** page's **+ Invite students** button brings you here for exactly this reason.

## Add a teacher by name

Section: getting-people-in · roles: school_admin · anchor: `teacher-named-seat` · in `packages/player-vue/src/views/schools/TeachersView.vue`

**What it's for.** Adding a specific teacher to your school when you know who they are but cannot rely on email reaching them. You type their name and get a code to hand over yourself.

**Where it is.** The **Teachers** page, the **Add by name** button at the top.

1. Tap **Add by name**.
2. Type the teacher's name.
3. Tap **Create code**.
4. Read the code out, write it down, or paste it into whatever you already use to reach them.
5. They go to saysomethingin.app/join and type it in.

**Worth knowing.** They appear on your list straight away under **Not yet given classes**, so you can tick their classes before they have even signed in. The code works once and lasts two days, and whoever uses it becomes that person — so hand it over directly. Made a mistake? Remove them from the list.

## Add students to a class

Section: getting-people-in · roles: leader, school_admin, teacher · anchor: `class-student-add` · in `packages/player-vue/src/views/schools/ClassDetail.vue`

**What it's for.** Putting a pupil who is already in your school into this class, for a pupil who has changed set or landed in the wrong class.

**Where it is.** The class page, the **Add students** button at the top of the roster.

1. Open the class from **My Classes**.
2. Tap **Add students** above the roster.
3. Type a few letters of the name to narrow the list.
4. Tap the pupil. They appear on the roster straight away.
5. Add as many as you need, then tap **Done**.

**Worth knowing.** The list holds the pupils in your school who are not in this class yet, and under each name are the classes they are in now, or **In no class**. Adding does not take them out of those classes — a pupil can be in more than one, one for each course they are doing. If you meant to move them, the message that confirms the add names the class they are still in and takes you to it, where their row has a **Remove** button. A pupil brings everything they have already learned with them. For a pupil with no account at all, use the class link in **Invite students** instead.

## Bring your first person in

Section: getting-people-in · roles: admin, leader, school_admin · anchor: `verb-invite-person` · in `packages/player-vue/src/components/admin/NodeActionBar.vue` · has a walk

**What it's for.** Bringing anyone into this part of the tree — a leader, a teacher or a learner — with a personal link that is their login.

**Where it is.** The node's home page, the buttons along the top, **Invite a person**.

1. Open the group, school or organisation you want them to belong to.
2. Tap **Invite a person**.
3. Pick the role they arrive as.
4. Type their name and submit.
5. Copy the minted link and send it.

**Worth knowing.** Nothing is created until you submit. Every link you mint lands in **Ways in**.

## Change how many seats you pay for

Section: your-school · roles: school_admin, leader · anchor: `upgrade-update-seats` · in `packages/player-vue/src/views/schools/UpgradeView.vue`

**What it's for.** Growing or shrinking a live subscription as staff or learners come and go, without going through checkout a second time.

**Where it is.** The Upgrade page, once you are already subscribed. The stepper sits beside the running total.

1. Open the Upgrade page.
2. Step the seat count up or down, or type the number straight in.
3. The button changes to read Update, with the new monthly total on it.
4. Tap it. The change is made against your existing subscription — no second charge and no new card details.

**Worth knowing.** While the count matches what you already pay for, the button simply says current and does nothing, so you cannot double-bill yourself by tapping it twice.

## Change your school's name and details

Section: your-school · roles: school_admin · anchor: `settings-save-profile` · in `packages/player-vue/src/views/schools/SettingsView.vue`

**What it's for.** Correcting or updating what the app knows about your school — its name, its town, its contact email and a short description. The name is the one that shows on every page your staff and students see.

**Where it is.** Settings, then School profile.

1. Open Settings and stay on School profile.
2. Edit any of the fields — school name, city, region, contact email, about.
3. Tap **Save changes**. The button reads Saved when it has gone through.
4. The new name appears across the dashboard straight away.

**Worth knowing.** Only a school admin can edit this. A teacher opening the same page sees the details but cannot change them. Your school's type is set by your group administrator, not here.

## Choose what a class learns

Section: courses-and-content · roles: school_admin, teacher · anchor: `create-class-course` · in `packages/player-vue/src/components/schools/CreateClassModal.vue`

**What it's for.** Setting the language a class learns. Every class carries one course, and it decides what the class practises, what students hear when they join, and where the class's shared position sits.

**Where it is.** The **Create New Class** panel, the **Course / Language** picker.

1. Tap **+ New class** on **My Classes**.
2. Type into the course box to search the catalogue.
3. Pick the language the class is learning.
4. Finish creating the class.

**Worth knowing.** The course is set when the class is made and stays with it. A class that needs a different language is a new class, which keeps the old one's records intact. A school on a free trial is held to the one language it signed up for until it subscribes.

## Choose what role someone arrives as

Section: getting-people-in · roles: admin, leader, school_admin · anchor: `invite-form-role` · in `packages/player-vue/src/components/admin/NodeActionBar.vue`

**What it's for.** The role you pick on an invite is the role the person lands in, and it travels with the link rather than being set afterwards. Teacher sees their own classes, group leader sees everything below their node, learner just learns.

**Where it is.** Any node's home page, **Invite a person**, the role dropdown on the left of the form.

1. Tap **Invite a person** on the node you want them to belong to.
2. Open the role dropdown.
3. Pick the role they should hold in this place.
4. Fill in their name and submit.

**Worth knowing.** The place matters as much as the role — a group leader invited on a group leads that group and everything under it, so invite people on the node whose shape you actually mean.

## Choose which courses a school can use

Section: courses-and-content · roles: admin · anchor: `verb-courses` · in `packages/player-vue/src/components/admin/NodeActionBar.vue`

**What it's for.** Setting what a school or group is allowed to learn: the whole catalogue when they are paid up, or a named course or two while they are trialling.

**Where it is.** The node's home page, **Courses** along the top.

1. Open the home page of the school or group.
2. Tap **Courses**.
3. Choose the whole catalogue, or search for the courses the trial should carry.
4. Save, and everyone below that node inherits it.

**Worth knowing.** A trial runs for thirty days on a paid course and a year on a free or community one, and the server works the dates out on save — what you see before saving is a preview.

## Choose which courses your school uses

Section: courses-and-content · roles: school_admin · anchor: `setup-course-picker` · in `packages/player-vue/src/views/schools/SetupView.vue`

**What it's for.** Narrowing the full list of courses your school can teach down to the handful you actually intend to use, so that choosing a course for a class is a short list rather than a long one.

**Where it is.** Step three of first-time setup, the grid of tickable course tiles under **Choose courses**.

1. Open step three of first-time setup.
2. Everything available to your school starts ticked.
3. Untick anything you do not plan to teach.
4. Tap **Continue** — the next step only offers the courses you left ticked.

**Worth knowing.** This is a filter and nothing more. It does not change what your school has access to, and it takes nothing away from anyone. A school on a trial sees its one trial course here; a subscribed school sees the whole catalogue.

## Choosing who a question is asked about

Section: seeing-progress · roles: admin · anchor: `scope-rail` · in `packages/player-vue/src/intel/ScopeRail.vue`

**What it's for.** Asking the same question of a smaller group: everyone, one course, one organisation or one person. The question does not change; who it is about does.

**Where it is.** The map on the left of every question page, the same map the organisation dashboard draws. On a phone it is the first block.

1. Tap **Everyone** to ask the question of every real person.
2. Tap a course to ask it of that course alone. The other courses stay one tap away as the rows at this level.
3. Tap **Organisations** to go to the organisation tree and pick a group, a school or a class.
4. Tap **People** to find one person by name or email.

**Worth knowing.** The choice is written into the page address, so a pasted link opens the same question about the same people.

## Claim another email domain for your school

Section: getting-people-in · roles: school_admin · anchor: `settings-identity-add-domain` · in `packages/player-vue/src/views/schools/SettingsView.vue`

**What it's for.** Telling the app which email domains belong to your school, so an arrival using one of them is not pushed to the top of your **Not yet given classes** list as somebody unfamiliar. Your own domain was recorded when you signed up; add the others if your school uses more than one.

**Where it is.** Settings, the **Which addresses look like your school** card, the **Add domain** field.

1. Open Settings and find **Which addresses look like your school**.
2. Type the part of the address after the @, such as example.sch.uk.
3. Tap **Add domain**.

**Worth knowing.** This grants nothing. Somebody at your domain still sees no learner until you give them a class, and somebody who is not still gets in with one tap. Public providers such as gmail.com or outlook.com cannot be added, because they do not identify a school. Schools in the same trust share each other's domains automatically.

## Copy a class link without opening the class

Section: getting-people-in · roles: school_admin, teacher · anchor: `classes-share-link` · in `packages/player-vue/src/views/schools/TeacherDashboard.vue`

**What it's for.** Grabbing a class's join link straight from the class list, for when you are sending links to several classes in one sitting.

**Where it is.** **My Classes**, the **Copy link** button in each row.

1. Open **My Classes**.
2. Find the class's row.
3. Tap **Copy link**.
4. Paste it into your email or your lesson slide.

**Worth knowing.** It is the same link the class page offers, so a student who follows it lands in that class either way.

## Copy a school's joining links

Section: getting-people-in · roles: leader · anchor: `schools-list-link-chips` · in `packages/player-vue/src/views/schools/SchoolsView.vue`

**What it's for.** Fetching the admin link or the teacher link for any school in your programme, so you can chase a school that has not got started or replace a link somebody has lost.

**Where it is.** All schools, the Links column on each school's row.

1. Find the school's row in the list.
2. Tap **Admin** to copy its admin link, or **Teacher** to copy its teacher link.
3. The chip reads Copied so you know it worked.
4. Paste it into an email or a message to whoever needs it.

**Worth knowing.** Tapping a link chip does not open the school — the rest of the row does that. A school still flagged as awaiting admin is one whose admin link nobody has opened yet.

## Create your first classes

Section: running-classes · roles: school_admin · anchor: `setup-add-class-row` · in `packages/player-vue/src/views/schools/SetupView.vue`

**What it's for.** Setting up the classes your school will actually teach. A class is a name, a course and the students who join it, and it is the thing every progress figure in the dashboard is eventually counted against.

**Where it is.** Step four of first-time setup, under **Create classes**. **+ Add another class** sits below the rows.

1. Open step four of first-time setup.
2. Type a class name in the first row. Its course is already set to the language you signed your school up with — change it if this class is learning something else.
3. Tap **+ Add another class** for each further class; every new row starts on that same language, and fills in the same way.
4. Remove a row you no longer want with the cross at its end.
5. Tap **Finish setup** — every filled-in row is created, and each one is marked Added as it saves.

**Worth knowing.** Classes you have already made are listed above the rows, so running the wizard twice will not duplicate them. Students are added from each class's own page whenever you are ready.

## Delete a class

Section: running-classes · roles: leader, school_admin, teacher · anchor: `class-delete` · in `packages/player-vue/src/views/schools/ClassDetail.vue`

**What it's for.** Removing a class you no longer want, usually one set up by mistake or a group that has finished. Before anything is deleted the app tells you what goes with it.

**Where it is.** The class page, the small bin beside the class name.

1. Open the class from **My Classes**.
2. Tap the bin next to the name at the top.
3. Read the list of what will go with the class.
4. If the class has real practice behind it, type the class name to confirm you mean it.
5. Confirm the deletion.

**Worth knowing.** Students keep their own accounts and everything they have learned. What goes is the class itself, its roster and its join link.

## Delete a school or group

Section: your-school · roles: admin · anchor: `verb-delete` · in `packages/player-vue/src/components/admin/NodeActionBar.vue`

**What it's for.** Removing a school or group that should never have existed, or has been wound up. It is the one verb here that takes everything below it with it.

**Where it is.** The node's home page, **Delete** at the end of the row of buttons.

1. Open the home page of the school or group.
2. Tap **Delete**.
3. Read the summary of what goes with it — classes, people and links are counted for you.
4. Type the name back when asked, and confirm.

**Worth knowing.** You are only asked to type the name when there is real activity underneath, which is the signal to stop and check. An empty shell deletes on a single confirm.

## Delete your school

Section: your-school · roles: school_admin · anchor: `settings-delete-school` · in `packages/player-vue/src/views/schools/SettingsView.vue`

**What it's for.** Closing your school down for good. It removes the school itself along with its classes and everybody's enrolment in them, and it cannot be undone.

**Where it is.** Settings, then Data & privacy, at the bottom under Danger zone.

1. Open Settings and choose Data & privacy.
2. Scroll to Danger zone and tap **Delete school**.
3. Read what the app lists as going with it — classes, students, teachers and recorded sessions are each counted for you.
4. If the school has real activity in it, type the school's name exactly to confirm you mean it.
5. Confirm. You are signed out to a clean slate, because the account you were using belonged to a school that no longer exists.

**Worth knowing.** Only your own school can be deleted this way, and only by its admin. A school with nothing in it deletes without the typed confirmation; one with students and sessions always asks for it.

## Download your school's data

Section: seeing-progress · roles: school_admin, teacher · anchor: `settings-export-data` · in `packages/player-vue/src/views/schools/SettingsView.vue`

**What it's for.** Taking your school's progress figures out of the app as a spreadsheet file — every student, the class they are in, how far they have got, how long they have practised and when they were last active.

**Where it is.** Settings, then Data & privacy, the button reading **Download all data**.

1. Open Settings and choose Data & privacy.
2. Tap **Download all data**.
3. The file lands in your downloads, named after your school and today's date.
4. Open it in any spreadsheet app to sort, filter or share it.

**Worth knowing.** It is a snapshot of the moment you press the button, not a live link. Download it again whenever you need current figures.

## Email someone their invite again

Section: getting-people-in · roles: admin, leader, school_admin · anchor: `ways-in-resend` · in `packages/player-vue/src/components/admin/WaysInLedger.vue`

**What it's for.** Sending the same invite email a second time to somebody who never found the first one. Nothing changes and no new link is made, so the one they may yet dig out of a spam folder still works.

**Where it is.** The node's home page, the **Ways in** section, **Email again** on their row.

1. Scroll to **Ways in** on the node's home page.
2. Find the person's row.
3. Tap **Email again**.
4. The note above the table names the address it went to.

**Worth knowing.** Only rows for a named person with an email on file carry this button. If our mail is being eaten by their school's gateway, read them the link instead of sending it a third time.

## Export your class list

Section: running-classes · roles: school_admin, teacher · anchor: `classes-export` · in `packages/player-vue/src/views/schools/TeacherDashboard.vue`

**What it's for.** Taking the class list away as a spreadsheet, with the name, language, student count, belt, hours in the app this week, sessions, health and join code for every class.

**Where it is.** **My Classes**, the **Export CSV** button along the top.

1. Open **My Classes**.
2. Filter the list down first if you only want part of it.
3. Tap **Export CSV**.
4. The file downloads with today's date in its name.

**Worth knowing.** What you export is what you can see, so a filter applied to the table applies to the file as well.

## Find a class in a long list

Section: running-classes · roles: school_admin, teacher · anchor: `classes-filters` · in `packages/player-vue/src/views/schools/TeacherDashboard.vue`

**What it's for.** Narrowing a long list down to the classes you care about right now, by language or by how they are doing, and putting them in the order that answers your question.

**Where it is.** **My Classes**, the strip of pickers above the table.

1. Open **My Classes**.
2. Pick a language under **Course** to see only the classes learning it.
3. Pick a state under **Health** to pull out the classes that need attention.
4. Change **Sort by** to order by students, time in app this week or average seeds. On a phone it is the first control, and the number you sorted by shows beside each class name.

**Worth knowing.** The totals above the table follow the filter, so the student count and the hours are always the total of what you are actually looking at.

## Find out which email you are signed in with

Section: your-own-account · roles: teacher, school_admin, leader · anchor: `account-identity` · in `packages/player-vue/src/components/SettingsScreen.vue`

**What it's for.** Telling you which email address this account uses, so you never have to guess when you sign in on another device or ask us for help.

**Where it is.** **Settings**, at the top of **Account**.

1. Open **Settings**.
2. Read the address under **You are signed in as**. Tap it to copy it.
3. Under it is your account code. Tap to copy that too, and give it to us if you ever get in touch.

**Worth knowing.** The account code names your account and nothing more. It does not let anybody in, so it is safe to read out or put in a message.

## Finding your way around the organisation

Section: seeing-progress · roles: admin, leader, school_admin · anchor: `node-map-rail` · in `packages/player-vue/src/views/admin/NodeHomeView.vue`

**What it's for.** A standing map down the side of every level, showing where you are: the levels above you, the level you are on, its neighbours and what sits under it. It never disappears, so you can always tell how deep into the organisation you have gone.

**Where it is.** The column on the left of any group, school or class page.

1. Open any level of your organisation.
2. Read down the map to see the path from your top level to here.
3. Tap any name in it to move straight there.
4. The page rebuilds around the new level and the map redraws with it.

**Worth knowing.** A leader only ever sees their own part of the organisation — the map is trimmed by the server, not hidden in the page.

## Give a class its course

Section: courses-and-content · roles: school_admin · anchor: `setup-class-course` · in `packages/player-vue/src/views/schools/SetupView.vue`

**What it's for.** Picking the language a class is learning. This is how a course reaches learners at all — a course does not belong to a person, it belongs to a class, and everybody in that class practises it.

**Where it is.** On each class row, the course picker beside the class name. It already holds the language you chose when you signed your school up, so most classes need nothing done here.

1. Leave it as it is to teach the language you signed up with.
2. To teach something else, tap the picker on the class row.
3. Start typing a language to narrow the list — the catalogue runs to dozens of courses.
4. Pick the one you want. Where a language offers more than one version, the versions differ by region or accent.
5. Save the class, and everyone who joins it lands in that course.

**Worth knowing.** The list here is whatever you left ticked at the Choose courses step. If a course you expect is missing, go back a step and tick it.

## Give a teacher their classes

Section: getting-people-in · roles: school_admin, leader · anchor: `teacher-assign-classes` · in `packages/player-vue/src/views/schools/TeachersView.vue`

**What it's for.** Putting a teacher onto the classes they will teach, working from your staff list rather than opening each class in turn. This is how a new arrival gets their timetable in one sitting.

**Where it is.** The **Teachers** page, the **Assign to a class** button on that teacher's row.

1. Find the teacher in the list.
2. Tap **Assign to a class**.
3. Tick every class they should teach.
4. Tap **Save** to apply the ticks.

**Worth knowing.** This is also how somebody becomes part of your school. Anyone who used your invite link arrives under **Not yet given classes** and can see no learner at all until you tick a class for them, so a stranger who found the link sits there in plain sight and you can remove them. A class with nobody on it says so in the list, and the teacher you tick will lead it. Tick a class that already has a teacher and yours joins as a co-teacher instead.

## Hand a class over to another teacher

Section: running-classes · roles: leader, school_admin, teacher · anchor: `class-teacher-make-lead` · in `packages/player-vue/src/views/schools/ClassDetail.vue` · has a walk

**What it's for.** Passing the lead of a class to another teacher who already teaches it — for a maternity cover, a term swap, or a permanent handover.

**Where it is.** The class page, the **Teachers** section.

1. Open the class from My Classes.
2. Scroll to **Teachers**.
3. Find the colleague who should lead it.
4. Tap **Make lead** on their row.

**Worth knowing.** You stay on the class as a teacher. Only the lead changes.

## Hand a teacher their access code

Section: getting-people-in · roles: school_admin · anchor: `teacher-signin-link` · in `packages/player-vue/src/views/schools/TeachersView.vue`

**What it's for.** A way to get a teacher into their own account when email is not reaching them. School mail gateways quarantine our sign-in codes often enough that this is the rescue, not the exception.

**Where it is.** The **Teachers** page, the **Access code** button on that teacher's row.

1. Find the teacher in the list.
2. Tap **Access code** on their row.
3. Read the code out to them, write it down, or paste the link into whatever you already use.
4. They go to saysomethingin.app/join and type the code in.
5. Tap **Done** when they are through.

**Worth knowing.** The code works once and lasts two days, and whoever uses it becomes that teacher — so give it to them directly and never post it anywhere shared. Need another? Tap **Access code** again, and the earlier one stops working. This is also how you reissue a code for somebody you added by name who never used the first one.

## Hand out a sign-up link for one course

Section: getting-people-in · roles: admin, leader, school_admin · anchor: `ways-in-copy-course` · in `packages/player-vue/src/components/admin/WaysInLedger.vue`

**What it's for.** Giving one group of learners a sign-up link that puts them straight into a named course, when your funded year covers more than one. A North Wales tutor hands out the North Welsh link and nobody in that room is asked which Welsh they meant.

**Where it is.** The node's home page, the **Ways in** section, the course-named buttons on your sign-up link's row.

1. Scroll to **Ways in** on the node's home page.
2. Find the row for your sign-up link.
3. Tap the button named after the course you want, and it is copied.
4. Send that link to the learners who want that course.

**Worth knowing.** It is the same link and the same cohort either way — the course name only decides where a learner lands. **Copy** still gives you the link that asks them to choose, and everyone gets the whole free year whichever link they came through.

## Hand out your staff links

Section: getting-people-in · roles: school_admin · anchor: `setup-staff-links` · in `packages/player-vue/src/views/schools/SetupView.vue`

**What it's for.** Getting your colleagues in. Your school has a standing teacher link and a standing admin link — send either one and whoever opens it is signed in with that role, with no sign-up form to fill in.

**Where it is.** Step two of first-time setup, under **Add your teachers**. The full links are shown as text with a copy button beside each.

1. Open step two of first-time setup.
2. Copy the **Teacher invite link** for anyone who will run classes.
3. Copy the **Admin invite link** for anyone who needs to manage the school itself.
4. Send them however you normally reach staff — email, Teams, a message, or written down.
5. Anyone who has already joined is listed underneath, so you can see who is in.

**Worth knowing.** A teacher does not need to speak the language. The app does the teaching, so anyone on your staff can run a class.

## How every question page is laid out

Section: seeing-progress · roles: admin · anchor: `question-page` · in `packages/player-vue/src/intel/QuestionPage.vue`

**What it's for.** Every one of the ten questions is answered on a page with the same five parts in the same order, so once you can read one you can read them all: where you are, the answer, the evidence, the rows, and the verbs.

**Where it is.** Any page under What's happening.

1. Read the map on the left to see who the question is being asked about.
2. Read the answer: one plain sentence and one number, with when it was fetched and who is counted directly beneath.
3. Read the evidence: one chart, never two side by side.
4. Open any row beneath it. Every row is a link to the thing it names.
5. The buttons across the top of the main column are the things you can do about the answer. When there is nothing to do, the strip is empty rather than missing.

**Worth knowing.** No page may add a part or move one. A page that tried to would fail the build.

## How far a class has travelled

Section: seeing-progress · roles: admin, leader, school_admin · anchor: `class-journey` · in `packages/player-vue/src/views/admin/NodeHomeView.vue`

**What it's for.** A bar showing where a class has got to in its course, measured in LEGOs — the individual pieces of language the course teaches. The class's own shared position leads, and the average its students have reached on their own sits alongside it.

**Where it is.** The **Course journey** card on a class page.

1. Open a class.
2. Read the bar for how much of the course the class has covered together.
3. The line underneath gives both figures: the class's shared position, and the average students have reached learning alone.
4. It also names the next belt and how many LEGOs are left to reach it.

**Worth knowing.** A class that has never played together has no shared position, so the bar falls back to the students' own average and says so.

## How fresh these numbers are

Section: seeing-progress · roles: admin, leader, school_admin · anchor: `node-updated` · in `packages/player-vue/src/views/admin/NodeHomeView.vue`

**What it's for.** A small time stamp saying when the figures on the page were last loaded, so you always know whether you are looking at this morning or this minute.

**Where it is.** Just above the row of numbers, reading **Updated** and a time.

1. Open any level of your organisation.
2. Read the stamp above the numbers for the time they were fetched.
3. Pull the page down or reload it to fetch again — the stamp moves with it.

**Worth knowing.** Nothing is shown until the first load has genuinely succeeded, so an empty stamp means the numbers have not arrived rather than that they are old.

## How many real people practised this week

Section: seeing-progress · roles: admin · anchor: `question-pulse` · in `packages/player-vue/src/views/intel/PulseView.vue`

**What it's for.** The first question on a Monday: how many real people practised in the last seven days, and whether that is more or fewer than the seven days before.

**Where it is.** **Pulse**, the first question in the bar under What's happening.

1. Read the number and the sentence for this week against last week.
2. Read the line beneath the chart for how many of those people are paying, gifted or on free access. Gifted people are real people and are counted.
3. Read the chart for where in the world this week's people are.
4. Open any course row to see which bits of that course give people trouble.

**Worth knowing.** A person who practised nine times this week counts once.

## How students join a class

Section: getting-people-in · roles: leader, school_admin, teacher · anchor: `class-join-link` · in `packages/player-vue/src/views/schools/ClassDetail.vue`

**What it's for.** The one door into a class. A student who follows the class link signs up and lands straight in the class, on the right course, with no code to type. The same class also has a short code for a room where a link is awkward.

**Where it is.** The class page, the **Invite students** card.

1. Open the class from **My Classes**.
2. Copy the link from the **Invite students** card and send it to your students.
3. For a room with a whiteboard, tap **Show code instead** and write the code up.
4. Students enter that code at saysomethingin.com/redeem.

**Worth knowing.** The link and the code both stay valid, so the same one works for a student who joins in week one and a student who arrives in week six. If the card says it could not load, do not hand anything out until it comes back.

## How your class measures up

Section: seeing-progress · roles: teacher · anchor: `dash-class-bench` · in `packages/player-vue/src/views/schools/DashboardView.vue`

**What it's for.** A three-bar benchmark on each class, showing the cycles that class has done against the average for your school and the average across everyone learning that course anywhere. It answers the question a total cannot: is this normal.

**Where it is.** On each class on the schools dashboard, under the heading naming class, school and global.

1. Open the schools dashboard and find the class you want to read.
2. The top bar is **Class** — your own class's figure.
3. **School** underneath it is the average across the other classes in your school.
4. **Global** is the average across every class doing that course.
5. Longer bars mean more; the number at the end of each bar is the figure itself.

**Worth knowing.** A class with too little recorded activity shows a dash rather than an invented bar.

## Invite a teacher to your school

Section: getting-people-in · roles: school_admin · anchor: `teachers-invite-link` · in `packages/player-vue/src/views/schools/TeachersView.vue`

**What it's for.** One standing link that turns anyone who opens it into a teacher of your school. It is the same link every time, so you can hand it to a whole staff room at once.

**Where it is.** The **Teachers** page, the **Invite teachers** card below the list.

1. Open **Teachers**.
2. Scroll to the **Invite teachers** card.
3. Tap **Copy invite link**.
4. Send it however you reach your staff — Teams, WhatsApp, printed on a slip.
5. They open it, sign in once, and appear in your list as a teacher.

**Worth knowing.** If you are standing in front of them rather than sending anything, **Show code instead** gives you a short code to read out or write on a whiteboard, and they type it in at saysomethingin.com/redeem.

## Invite a teacher who isn't here yet

Section: running-classes · roles: leader, school_admin, teacher · anchor: `class-coteacher-link` · in `packages/player-vue/src/views/schools/ClassDetail.vue` · has a walk

**What it's for.** Getting a teacher who has no account yet into one class of yours, without going through the school admin.

**Where it is.** The class page, the **Teachers** section.

1. Open the class from My Classes.
2. Scroll to **Teachers**.
3. Take the co-teacher link.
4. Send it to them — opening it puts them on this class as a teacher.

**Worth knowing.** The link is scoped to this one class, so a cover teacher never lands in the rest of the school.

## Let a named address in through your links

Section: getting-people-in · roles: school_admin · anchor: `settings-identity-add-address` · in `packages/player-vue/src/views/schools/SettingsView.vue`

**What it's for.** Marking one named person as expected when their email is not at your school's domain: a supply teacher here for a fortnight, or a colleague who only uses a personal address. It stops them being sorted to the top of **Not yet given classes** as somebody you might not know.

**Where it is.** Settings, the **Which addresses look like your school** card, the **Add address** field.

1. Open Settings and find **Which addresses look like your school**.
2. Type their email address exactly as they will use it.
3. Tap **Add address**, then send them your usual teacher link.

**Worth knowing.** They get in with one tap either way, with or without this. What actually puts somebody in your school is giving them a class. If you know who they are before they arrive, **Add by name** on the Teachers page is the shorter route.

## Look up one student

Section: seeing-progress · roles: admin, school_admin, teacher · anchor: `student-view-link` · in `packages/player-vue/src/views/schools/StudentsView.vue`

**What it's for.** Finding one learner among all of them and opening what they have actually done. The list carries their belt, their hours this week, and when they were last here, so you can often answer the question without opening anything.

**Where it is.** The **Students** page, the search box and filters above the list, then **View** on their row.

1. Open **Students**.
2. Type part of their name in the search box, or narrow the list by class, belt or health.
3. Read their row for belt, hours and last active.
4. Tap **View** to open their own progress.

**Worth knowing.** Health is worked out from their last visit and how they sit against their own class, so a learner marked as needing attention is one who has gone quiet or fallen behind the people beside them.

## Make a class

Section: running-classes · roles: school_admin, teacher · anchor: `verb-new-class` · in `packages/player-vue/src/views/schools/TeacherDashboard.vue`

**What it's for.** Setting up a class of your own: a name, a language, and a link students use to join it. A class holds a roster, its own place on the course, and everything the class practises together.

**Where it is.** **My Classes**, the **+ New class** button along the top of the page.

1. Open **My Classes**.
2. Tap **+ New class**.
3. Give the class a name you will recognise on a list, such as Year 7 Welsh.
4. Choose the language the class is learning.
5. Tap **Create Class**.

**Worth knowing.** The join link is made for you at the same moment. Nothing else is needed to start teaching.

## Make a link anyone can use

Section: getting-people-in · roles: admin, leader, school_admin · anchor: `verb-shareable-link` · in `packages/player-vue/src/components/admin/NodeActionBar.vue`

**What it's for.** One link, by role, that you can put in a newsletter or on a slide and let a whole room use. Unlike a personal invite it is not tied to anybody, so new arrivals type their own name before they are in.

**Where it is.** The node's home page, **Get a shareable link** along the top.

1. Open the home page of the group, school or organisation they should join.
2. Tap **Get a shareable link**.
3. Pick the role everyone using it will arrive as.
4. Tap **Create invite link** and copy what comes back.

**Worth knowing.** It is open to anyone holding it, so when a link has travelled further than you meant, revoke it in **Ways in** and make a fresh one. Use **Invite a person** instead when you can name who is coming.

## Minutes in the app this week

Section: seeing-progress · roles: school_admin · anchor: `dash-minutes-this-week` · in `packages/player-vue/src/views/schools/DashboardView.vue`

**What it's for.** How much your school practised this week, in minutes: the time your classes spent in the app with a lesson running, pauses included, plus any teacher or pupil practising on their own account, each counted once. Under it, how many of your classes practised at all this week.

**Where it is.** The stat strip at the top of the schools dashboard.

1. Read the number. It is minutes, never hours, and it is this week only.
2. Read the line beneath it for how many classes practised.

**Worth knowing.** A dash means this week's figures have not loaded — pull to refresh. It is never shown as a zero that is not real.

## Move a teacher to another class

Section: running-classes · roles: leader, school_admin, teacher · anchor: `class-teacher-other-classes` · in `packages/player-vue/src/views/schools/ClassDetail.vue` · has a walk

**What it's for.** Changing which classes a teacher is on, in one pass, without visiting each class in turn.

**Where it is.** The class page, the **Teachers** section, a teacher's other classes.

1. Open a class the teacher is on.
2. Scroll to **Teachers** and open their other classes.
3. Tick the classes they should be on and untick the ones they should not.
4. Save.

**Worth knowing.** Untick and save is how you take a teacher off a class — there is no separate remove.

## Name your school

Section: your-school · roles: school_admin · anchor: `setup-school-name` · in `packages/player-vue/src/views/schools/SetupView.vue`

**What it's for.** Telling the app what your school is actually called. The name you type here is the one your teachers and students see on every page, on every invite link they open, and at the top of every report.

**Where it is.** Step one of first-time setup, the box marked **School name**.

1. Open first-time setup and stay on step one.
2. Type your school's name as you would write it on a letterhead.
3. Tap **Continue** — the name is saved before the next step opens.
4. If you have just arrived and the box is empty for a second, give it a moment and press **Continue** again.

**Worth knowing.** Typing it here counts as confirming it, so you will not be asked to confirm your school's name again afterwards. To change it later, use School profile in Settings.

## One person's story

Section: seeing-progress · roles: admin · anchor: `question-person` · in `packages/player-vue/src/views/intel/PersonView.vue`

**What it's for.** Everything that answers a support call about one person: who they are, their support id, whether they count as a real person, what they can play and through which door, where they are in each course, what they did last and on what.

**Where it is.** **One person**, under What's happening. Open a row on Leaving, or find them under People.

1. Read the sentence for their standing, their access and their last practice, and the pill beneath it for whether they count.
2. Use the verbs across the top to act: give full access, take it back, make a one-off sign-in link, change their role, change their trial, or correct a wrong flag. Every verb says what it will change and asks before it does.
3. Read the cards for their access, their memberships, their course positions and their last few events.

**Worth knowing.** Every verb is recorded against your own name by the server. A comped person stays a real person; only staff and test are left out of the numbers.

## Open a class

Section: running-classes · roles: school_admin, teacher · anchor: `classes-row` · in `packages/player-vue/src/views/schools/TeacherDashboard.vue`

**What it's for.** Going from the summary row into the class itself, where the roster, the teachers, the join link and the class's progress all live.

**Where it is.** **My Classes**, anywhere on the class's row.

1. Open **My Classes**.
2. Tap the row for the class you want.
3. The class page opens on its roster.

**Worth knowing.** The row is a button in its own right, so a keyboard works too. The buttons at the right of the row do their own jobs and do not open the class.

## Practice per student per week

Section: seeing-progress · roles: admin, leader, school_admin · anchor: `class-benchmark` · in `packages/player-vue/src/views/admin/NodeHomeView.vue`

**What it's for.** Minutes of practice per student per week for this class, set against the same figure for its school and for everyone doing the course. Dividing by students and by weeks is what lets a class of nine and a class of thirty be compared honestly.

**Where it is.** The **Practice min/student/week** card on a class page.

1. Open a class.
2. Read the top bar for this class's own minutes per student per week.
3. The bars below it are the school average and the global average for the course.
4. Compare the lengths — the numbers at the end give the exact figures.

**Worth knowing.** A class with too little practice recorded shows a plain line saying so rather than a bar built from almost nothing.

## Prove your mailbox reaches you

Section: getting-people-in · roles: school_admin, teacher · anchor: `mailbox-check-send` · in `packages/player-vue/src/components/schools/MailboxCheckPrompt.vue`

**What it's for.** School mail gateways are ferocious, and a code that never arrives is only discovered on the day you need it. This asks once, at the moment you have just made something worth keeping, and settles it.

**Where it is.** A card that appears right after you create a class or copy a class join link, for as long as your address is unproven.

1. Tap **Send me a code**, or nominate a different address if your school one eats our mail.
2. Type the six digits we send, and tap **That's the one**.

**Worth knowing.** Close it and it stays closed. It never comes back on a timer.

## Put the app on your device

Section: your-own-account · roles: leader, school_admin · anchor: `account-install` · in `packages/player-vue/src/components/admin/YourAccount.vue` · has a walk

**What it's for.** Putting SSi on your phone or tablet as an app, so it opens from the home screen and works without a browser tab.

**Where it is.** Your node's home page, **Your account**.

1. Open your home page on the device you want it on.
2. Scroll to **Your account**.
3. Tap the install row and follow the prompt your device gives you.

**Worth knowing.** Install it on the device you actually teach from — the install belongs to the device, not to your account.

## Read your class list

Section: running-classes · roles: school_admin, teacher · anchor: `classes-table` · in `packages/player-vue/src/views/schools/TeacherDashboard.vue`

**What it's for.** One row per class, showing at a glance how each one is doing: how many students, what belt the class has reached, minutes in the app this week, the shape of the last seven days, and a health mark for classes worth a look. Time in app is the time the class, and any students on their own accounts, spent in the app with the lesson running, pauses included — so it is the time they were in the lesson.

**Where it is.** **My Classes**, the table filling most of the page. On a phone each class is a card instead, with the number you sorted by beside its name and the rest underneath.

1. Open **My Classes**.
2. Read down the health column first, because that is where the app is pointing you.
3. Use the small chart in each row to see whether practice is steady or has stopped.
4. Compare time in the app this week between classes taking the same course.

**Worth knowing.** Health is worked out from how many of the last seven days the class practised on. A quiet week reads as needing eyes, which is a prompt for a word rather than a worry.

## Reading one student's progress

Section: seeing-progress · roles: admin, leader, school_admin · anchor: `class-students` · in `packages/player-vue/src/views/admin/NodeHomeView.vue`

**What it's for.** Every student in a class, one to a row, each carrying their own position in the course, their belt, their practice over the last week and how recently they were active. A quiet coloured dot flags anyone who has gone quiet or fallen well behind the class.

**Where it is.** The **Students** list at the bottom of a class page.

1. Open a class.
2. Read down the rows — the bar on each is that student's own position in the course, in LEGOs.
3. The small chart beside it is their practice over the past week, with the minutes named.
4. The dot and word at the start of a row say whether they are excellent, good, needing attention or inactive.
5. Tap a row to open that person.

**Worth knowing.** Needing attention means either nothing for a fortnight or less than half the class average, so it is a prompt to look rather than a verdict.

## Reading the belts

Section: seeing-progress · roles: admin, leader, school_admin · anchor: `class-belts` · in `packages/player-vue/src/views/admin/NodeHomeView.vue`

**What it's for.** How a class is spread across the eight belts, from white to black. A belt is earned by completing whole sentences of the course, so it is a coarse, honest badge of distance travelled rather than a score or a grade.

**Where it is.** The **Belt distribution** card on a class page.

1. Open a class.
2. Read the coloured strip for the shape of the class — a wide band of one colour means everyone is together.
3. The list underneath names each belt and how many students hold it.
4. The ladder runs white, yellow, orange, green, blue, purple, brown, black, reached at 8, 20, 40, 80, 150, 280 and 400 completed sentences.

**Worth knowing.** Every screen in the product uses that one ladder, so a student never shows a different belt in two places.

## Reading your insights

Section: seeing-progress · roles: admin, leader, school_admin · anchor: `insights-measure` · in `packages/player-vue/src/insight/NodeRateEngine.vue` · has a walk

**What it's for.** Reading the pace of learning at this level — what is being counted, over what period, and against what.

**Where it is.** The node's home page, **See insights**.

1. Open the node's home page and tap **See insights**.
2. Pick the **measure** — progress, practice, or class sessions. The line underneath says exactly what it means.
3. Pick the **window** — the period the rate is computed over. Shorter reacts faster, longer smooths the noise.
4. Use **Compare to** to put an average alongside.
5. **Overview** takes you back to the same place's home page.

**Worth knowing.** Everything here is a rate, not a raw total, so groups of very different sizes still compare fairly. A class that practises from the front is counted through its own class account, so whole-class lessons show here the same as any other practice.

## Remove a student from a class

Section: running-classes · roles: leader, school_admin, teacher · anchor: `class-student-remove` · in `packages/player-vue/src/views/schools/ClassDetail.vue`

**What it's for.** Taking a student off a class roster, for a pupil who has changed set or joined the wrong class from a shared link.

**Where it is.** The class page, the **Remove** button at the end of the student's row in the roster.

1. Open the class from **My Classes**.
2. Find the student in the roster.
3. Tap **Remove** at the end of their row.
4. Confirm when asked.

**Worth knowing.** The student keeps their account and everything they have learned, and they can join another class straight away. Only their place on this roster goes.

## Remove a teacher from your school

Section: getting-people-in · roles: school_admin · anchor: `teacher-remove` · in `packages/player-vue/src/views/schools/TeachersView.vue`

**What it's for.** Taking a teacher off your school when they leave. Their own account survives — what goes is their place in this school and their view of its classes and learners. It is also how you deal with somebody under **Not yet given classes** you do not recognise, or a name you typed by mistake.

**Where it is.** The **Teachers** page, the **Remove** button on that teacher's row.

1. Find the teacher in the list.
2. Tap **Remove** on their row.
3. Confirm when asked for their name back.
4. The list refreshes without them.

**Worth knowing.** An admin's row carries no **Remove** button, so a school can never lose its own admin through this list. Change their role first if that is really what you want.

## Rename a class

Section: running-classes · roles: leader, school_admin, teacher · anchor: `class-rename` · in `packages/player-vue/src/views/schools/ClassDetail.vue`

**What it's for.** Changing what a class is called, for a name typed in a hurry or a group that has moved up a year.

**Where it is.** The class page, the small pencil beside the class name.

1. Open the class from **My Classes**.
2. Tap the pencil next to the name at the top.
3. Type the new name.
4. Confirm it.

**Worth knowing.** Only the name changes. The roster, the join link, the join code and the class's place on the course all carry on exactly as they were.

## Rename a school or group

Section: your-school · roles: admin · anchor: `verb-rename` · in `packages/player-vue/src/components/admin/NodeActionBar.vue`

**What it's for.** Changing what a school or group is called everywhere it appears. Nothing else moves — the same people, classes and links carry on under the new name.

**Where it is.** The node's home page, **Rename** along the top.

1. Open the home page of the school or group.
2. Tap **Rename**.
3. Type the new name.
4. Tap **Save**.

**Worth knowing.** If the new name matches something else already sitting beside it you are warned and asked to confirm, because two identical names in one list is usually a mistake rather than a plan.

## Run your first class session

Section: running-classes · roles: school_admin, teacher · anchor: `class-play` · in `packages/player-vue/src/views/schools/ClassDetail.vue` · has a walk

**What it's for.** Running a live practice session with a class in the room, everyone hearing the same thing at the same time.

**Where it is.** The class page, the join link and the play button.

1. Open the class from My Classes.
2. Put the join link or the join code on the screen for the room.
3. Wait for the students to arrive on their own devices.
4. Tap play to start the session.

**Worth knowing.** The join code is the same code all lesson, so a student arriving late still gets in.

## See and download your funder numbers

Section: seeing-progress · roles: leader, admin · anchor: `funder-numbers` · in `packages/player-vue/src/components/admin/OrgFunderNumbers.vue`

**What it's for.** The monthly return your funder asks for, on your own page, so you can read it or send it without asking us to pull it.

**Where it is.** Your organisation's home page, the **Funder report** section.

1. Open your organisation's home page.
2. The month shown is the last complete one. Change it to report on another.
3. Read the three blocks: the month, everything since people enrolled, and the funding year so far.
4. Tap **Download spreadsheet** to get the same figures as a CSV.

**Worth knowing.** Minutes here are minutes the app was actually speaking to a learner, never time a screen sat open. Somebody who has studied both Welsh dialects is counted once, at their higher dialect, never the two added up. There are no names in this report and there never will be — the age question is a tick precisely so nobody has to hold a birth date.

## See every school in your programme

Section: seeing-progress · roles: leader · anchor: `schools-list-table` · in `packages/player-vue/src/views/schools/SchoolsView.vue`

**What it's for.** One table of every school you look after, with its students, teachers, classes and practice hours side by side, so a whole programme reads at a glance instead of school by school.

**Where it is.** All schools. The totals sit above the table and the search and sort controls sit on its header row.

1. Open All schools.
2. Read the totals across the top for the programme as a whole.
3. Search by name to find one school, or sort by name, hours or students.
4. Read the Status column — a school with nobody running it yet is flagged as awaiting admin.
5. Tap any row to open that school's own dashboard.
6. Tap **Export** for the same table as a spreadsheet file.

**Worth knowing.** The list holds still until you refresh it, so a number on screen will not change under you while you are reading. If a refresh fails you are told plainly rather than being shown stale figures as if they were current.

## See what a funded organisation gives its learners

Section: courses-and-content · roles: admin · anchor: `org-enrolment-courses` · in `packages/player-vue/src/components/schools/NodeEntitlementControl.vue`

**What it's for.** Showing the courses an organisation hands out through its own sign-up page, which are given to each learner as they join rather than held on the organisation itself.

**Where it is.** The organisation's home page, **Courses** along the top, at the head of the panel.

1. Open the organisation's home page.
2. Tap **Courses**.
3. Read the courses listed under the organisation's name, and the length of the free period beside them.

**Worth knowing.** Changing that list is a change to the organisation's enrolment policy, so it is not editable here — everyone who has already signed up keeps what they were given.

## See what your school pays

Section: your-school · roles: school_admin · anchor: `settings-billing-plan` · in `packages/player-vue/src/views/schools/SchoolBillingPanel.vue`

**What it's for.** The plain statement of your school's plan — its name, how many teacher seats it is paying for, and whether the subscription is live.

**Where it is.** Settings, then Billing.

1. Open Settings and choose Billing.
2. Read the current plan line: your school, its seat count, and active if the subscription is running.
3. Tap **Manage subscription & seats** to change how many seats you pay for.
4. Tap **Billing & invoices** to reach invoices, change the card, or cancel.

**Worth knowing.** Every payment change happens on the one Upgrade page, so there is a single place to go and no second checkout to get confused with. The invoices button appears once a subscription is running.

## Set or change your password

Section: your-own-account · roles: leader, school_admin · anchor: `account-password` · in `packages/player-vue/src/components/admin/YourAccount.vue` · has a walk

**What it's for.** Giving yourself a password so you can sign back in without waiting for a link in your email.

**Where it is.** Your node's home page, **Your account**.

1. Open your home page and scroll to **Your account**.
2. Tap the password row.
3. Type the password you want and save.

**Worth knowing.** Your original invite link keeps working. A password is a second door, not a replacement.

## Set up a demo organisation

Section: your-school · roles: admin · anchor: `verb-mint-demo` · in `packages/player-vue/src/components/admin/NodeActionBar.vue`

**What it's for.** Standing up a whole organisation with plausible people and activity already in it, for showing somebody what the product looks like once it is running rather than what it looks like empty.

**Where it is.** The home page of the node it should sit under, **Mint a demo org** along the top.

1. Open the home page of the node the demo belongs under.
2. Tap **Mint a demo org**.
3. Type a name for it, and a leader's email if somebody is to be handed it.
4. Tap **Mint**, and copy the leader link that comes back.

**Worth knowing.** A demo org's own page grows a **Refresh demo activity** button, which moves its learners on so a demo you minted weeks ago does not look abandoned when you next open it.

## Set your language and time zone

Section: your-school · roles: school_admin, teacher · anchor: `settings-localisation-save` · in `packages/player-vue/src/views/schools/SettingsView.vue`

**What it's for.** Choosing the language the dashboard itself speaks to you in, and the time zone your dates and times are read against.

**Where it is.** Settings, then Localisation.

1. Open Settings and choose Localisation.
2. Pick a **Default interface language**.
3. Pick a **Time zone** so activity times read correctly for where you are.
4. Tap **Save changes**.

**Worth knowing.** This is remembered on the device you set it on. Teachers and students each choose their own, so setting it here does not change what anybody else sees.

## Share a class with a colleague

Section: running-classes · roles: leader, school_admin, teacher · anchor: `class-teacher-add` · in `packages/player-vue/src/views/schools/ClassDetail.vue` · has a walk

**What it's for.** Adding another teacher to a class you already run, so you both see the same roster and the same progress.

**Where it is.** The class page, the **Teachers** section.

1. Open the class from My Classes.
2. Scroll to **Teachers**.
3. Tap **Add a teacher**.
4. Pick your colleague from the list.

**Worth knowing.** Both of you are teachers of the class. One of you is the lead, and the lead is the one the school's lists show first.

## Start a class session from the list

Section: running-classes · roles: school_admin, teacher · anchor: `classes-row-play` · in `packages/player-vue/src/views/schools/TeacherDashboard.vue`

**What it's for.** Starting a shared practice session for a class without opening the class first. Your device leads and the whole class moves together from where the class last got to.

**Where it is.** **My Classes**, the **Play as class** button at the end of the class's row.

1. Open **My Classes**.
2. Find the class you are about to teach.
3. Tap **Play as class** at the end of its row.
4. The player opens on that class's course, at the class's own place in it.

**Worth knowing.** It is the same session the class page starts, so it moves the class on for everyone on the roster. Only school staff see this button, and only on a live account rather than a read-only view.

## Subscribe as a tutor

Section: your-school · roles: teacher · anchor: `upgrade-subscribe-tutor` · in `packages/player-vue/src/views/schools/UpgradeView.vue`

**What it's for.** Paying for your own tutoring dashboard when you teach on your own rather than inside a school. It is one seat, for you.

**Where it is.** The **Upgrade** button on your tutoring dashboard.

1. Open the Upgrade page.
2. Choose Monthly or Annual — annual works out at two months free.
3. Tap **Subscribe** and fill in the card details on the payment panel that opens on the page.
4. Once it is running, the same button becomes **Manage subscription** for invoices and cancellation.

**Worth knowing.** Your students pay for their own learning separately, so three paying students cover what your dashboard costs.

## Subscribe your organisation

Section: your-school · roles: leader · anchor: `upgrade-subscribe-org` · in `packages/player-vue/src/views/schools/UpgradeView.vue`

**What it's for.** Putting your whole organisation on a paid plan. You pay per learner seat, and one subscription covers every seat and every language across the group.

**Where it is.** The **Upgrade** button on your organisation's dashboard.

1. Open the Upgrade page.
2. Choose Monthly or Annual — annual works out at two months free per seat.
3. Set the number of learner seats with the stepper. It opens at the number of people already joined.
4. Tap **Subscribe** and fill in the card details on the payment panel that opens on the page.

**Worth knowing.** A seat belongs to one named learner for the whole period you have paid for, so plan the count against the people you expect rather than swapping seats between them mid-term. You can add more seats at any time.

## Subscribe your school

Section: your-school · roles: school_admin · anchor: `upgrade-subscribe-school` · in `packages/player-vue/src/views/schools/UpgradeView.vue`

**What it's for.** Turning a trial into a paid school. You pay per teacher seat, and one subscription covers every language and every class those teachers run.

**Where it is.** The **Upgrade** button on your dashboard, or Settings then Billing then **Subscribe / choose seats**.

1. Open the Upgrade page.
2. Choose Monthly or Annual — annual works out at two months free per seat.
3. Set the number of teacher seats with the stepper. It opens at the number of teachers who have actually joined.
4. Tap **Subscribe** and fill in the card details on the payment panel that opens on the page.
5. You come back to the dashboard with the subscription live.

**Worth knowing.** Seats are teacher seats, not student seats. Your students do not each need one.

## Take a domain or address off your school's list

Section: getting-people-in · roles: school_admin · anchor: `settings-identity-remove` · in `packages/player-vue/src/views/schools/SettingsView.vue`

**What it's for.** Taking a domain or a named address off the list your Teachers page sorts by.

**Where it is.** Settings, the **Which addresses look like your school** card, the **Remove** button beside the entry.

1. Open Settings and find **Which addresses look like your school**.
2. Tap **Remove** beside the domain or address.

**Worth knowing.** Nobody loses anything and nobody is kept out. Arrivals from that address simply stop being sorted to the bottom of **Not yet given classes**.

## Take a teacher off a class, or move them

Section: running-classes · roles: leader, school_admin, teacher · anchor: `assign-classes-modal` · in `packages/player-vue/src/components/schools/AssignClassesModal.vue`

**What it's for.** Changing which classes a teacher takes without removing them from the school. The ticks start from what is true today, so moving somebody from one class to another is a single change rather than two.

**Where it is.** The **Teachers** page, **Assign to a class** on that teacher's row, then the ticks.

1. Open **Assign to a class** on the teacher's row.
2. Untick the class they are leaving.
3. Tick the class they are joining, if there is one.
4. Tap **Save** — the button counts your changes back to you before you commit.

**Worth knowing.** If part of a change fails the panel stays open and names the class it could not do, and the ticks reset to what is actually true. Nothing is ever reported as saved when it was not.

## Take your lists away as a spreadsheet

Section: seeing-progress · roles: admin, school_admin, teacher · anchor: `students-export` · in `packages/player-vue/src/views/schools/StudentsView.vue`

**What it's for.** A CSV of whoever is currently on screen, for a report, a governors' meeting, or your own sums in a spreadsheet.

**Where it is.** The **Students** page and the **Teachers** page, **Export CSV** along the top.

1. Filter or search the list down to whoever you want.
2. Tap **Export CSV**.
3. The file downloads with today's date in its name.
4. Open it in whatever spreadsheet you use.

**Worth knowing.** The export follows your filters, not the whole school — so a filtered list gives you a filtered file. Clear the filters first if you want everybody.

## The class roster

Section: seeing-progress · roles: leader, school_admin, teacher · anchor: `class-roster` · in `packages/player-vue/src/views/schools/ClassDetail.vue`

**What it's for.** Everyone in the class, one row each, with their belt, how much they have learned, how much they have practised and when they were last at it. This is the answer to who is quietly drifting.

**Where it is.** The class page, the **Roster** table.

1. Open the class from **My Classes**.
2. Read down the mark under each name, which flags anyone behind the class or long gone quiet.
3. Type a name into the search box to jump to one student.
4. Compare a student's practice against the class average shown in the rail beside the table.

**Worth knowing.** A student who has never started shows as inactive rather than as behind, because nothing has happened yet to judge. A class nobody has joined yet shows its empty places instead of a table, with **Add students** in it.

## The invites desk

Section: getting-people-in · roles: admin · anchor: `invites-mode-strip` · in `packages/player-vue/src/components/admin/invites/InviteCreateCard.vue` · has a walk

**What it's for.** The platform-wide desk where SSi mints and manages invites across every organisation at once.

**Where it is.** The admin area, **Invites**.

1. Open the invites desk from the admin area.
2. Pick the mode from the strip along the top — the mode decides what kind of invite you are minting.
3. Fill in who it is for and submit.
4. Use the active toggle to read live invites rather than spent ones.

**Worth knowing.** This is the operator's desk, not a school's. A school brings its own people in from its own home page.

## The numbers on any level

Section: seeing-progress · roles: admin, leader, school_admin · anchor: `node-stats` · in `packages/player-vue/src/views/admin/NodeHomeView.vue`

**What it's for.** The row of figures at the top of any level of your organisation. They always count everything below that level, each person once, so a group's numbers already include every school, class and learner underneath it.

**Where it is.** Across the top of the page for a group, a school or a class, under the name.

1. Open the level you want — a group, a school or a class.
2. **Phrases spoken this week** is how many phrases the classes beneath this level were prompted and said back in whole-class play over the last seven days. It is recorded for every clip the app plays, so it is the truest picture of a lesson.
3. **Classes practising this week** is how many of them played together in the last seven days, out of all the classes below.
4. **Minutes in the app this week** is the time the classes beneath this level, and their staff and students on their own accounts, spent in the app over the last seven days, pauses included — the time they were in the lesson. The sentence under the row says how much of it was whole-class play and how much was audio playing.
5. **Teachers** counts the staff below this level, each once however many classes they take.
6. On a class the row switches to that class's own phrases spoken this week, its minutes in the app, its students and its teachers.

**Worth knowing.** An organisation that is not school-shaped sees the same row worded as practice hours, groups and learners instead.

## Voice and pause

Section: seeing-progress · roles: admin, leader, school_admin · anchor: `insights-voice-pause` · in `packages/player-vue/src/views/admin/NodeInsightsView.vue`

**What it's for.** What the microphone is actually giving us below this level: how many learners have any mic-derived data at all, and for those who do, how the pause the app leaves them to speak in is settling, and how they sound when they speak.

**Where it is.** The **Voice and pause** section at the bottom of any level's insights page.

1. Open a level and tap **See insights**.
2. Scroll past the rate comparison to the voice section.
3. Read the uptake figure first — it is how many learners this is based on.
4. Open a class or a learner within it to see the same reading at a smaller scope.

**Worth knowing.** A learner with no microphone data is absent from these figures rather than counted as a zero, so the denominator is always stated. A class that practises from the front counts as one learner, its own class account, so a school with no pupil accounts still has a roster here.

## Walking down to a school, a class or a person

Section: seeing-progress · roles: admin, leader, school_admin · anchor: `below-tree-name` · in `packages/player-vue/src/components/admin/NodeBelowTree.vue`

**What it's for.** A drawn tree of everything hanging beneath the level you are on — groups inside groups, the classes in each, the teachers who take them and the staff who teach nothing yet. It is one picture of the shape of your organisation, not a list you have to filter.

**Where it is.** The **Below this** panel under the numbers on any group or school page.

1. Open a group or a school.
2. Tap a caret to open or close what sits under a name.
3. Tap any name to go to that level — the numbers and the tree redraw for it.
4. A class row names its teachers, its student count, and how many phrases it spoke together in the last seven days, or says plainly that it has not practised together this week, without you opening it.
5. Where there are more than eight classes or people, a **more** button reveals the rest.

**Worth knowing.** The top two levels open themselves and deeper ones wait to be tapped, so a large organisation shows you its shape instead of eighty-five rows.

## Ways in — who can get in, and how to change it

Section: getting-people-in · roles: admin, leader, school_admin · anchor: `ways-in-ledger` · in `packages/player-vue/src/components/admin/WaysInLedger.vue` · has a walk

**What it's for.** The ledger of every way into this part of the tree — who has a live link, what it lets them do, and how to change your mind.

**Where it is.** The node's home page, the **Ways in** section below the lists.

1. Open the node's home page and scroll to **Ways in**.
2. Read the rows: each one is a live way in, personal or shareable.
3. **Copy** hands you the link again.
4. **Re-mint** issues a fresh link and kills the old one on the spot.
5. **Revoke** closes that way in entirely.

**Worth knowing.** A shareable link is open to anyone who holds it, so revoke is the tool when a link has travelled further than you meant.

## What the nightly findings say about this question

Section: seeing-progress · roles: admin · anchor: `findings` · in `packages/player-vue/src/intel/QuestionFindings.vue`

**What it's for.** Every night a job reads the week's practice and writes a handful of findings in plain words. Each one appears here on the question it is about, so you read the finding beside the number it is a finding about.

**Where it is.** The cards between the verbs and the answer on a question page. A question with no findings shows nothing here.

1. Read the cards. Each carries a dot in one of four tones: good, watch, alarm or quiet.
2. Read the line above them for when they were found.
3. If that line is red, the nightly job has missed two nights or more and the findings are old. The job is not on this estate and cannot be restarted from here.

**Worth knowing.** The numbers inside a finding were the job's own on the night; the page's own numbers are fetched fresh and may differ.

## What your classes actually practised

Section: seeing-progress · roles: admin, leader, school_admin · anchor: `node-phrases` · in `packages/player-vue/src/views/admin/NodeHomeView.vue`

**What it's for.** A list of the phrases the classes beneath this level said together in the last seven days, with how many times each one came round. A phrase that appears again and again is the course bringing it back on purpose, which is how it sticks.

**Where it is.** The **What they practised this week** card under the row of numbers on a group or school page, and on a class page under its own practice card.

1. Open a group, a school or a class.
2. Read the list: the prompt, the phrase the class said back, and the number of times it came round this week.
3. Tap a column heading to sort by it.

**Worth knowing.** A level whose classes have not played together this week says so in words instead of showing an empty list. Only whole-class play appears here; what staff and students practise on their own accounts is counted in the minutes in the app figure above.

## When an answer was fetched

Section: seeing-progress · roles: admin · anchor: `updated-stamp` · in `packages/player-vue/src/intel/UpdatedStamp.vue`

**What it's for.** Saying when the numbers on a question page were actually read from the database, so you know whether you are looking at this minute or this morning.

**Where it is.** Beneath the answer sentence on every question page, reading **Updated** and a time.

1. Read the time beneath the answer.
2. While it reads **Updating**, the page is still fetching and no number on it is final.

**Worth knowing.** The time is taken when the fetch completed, never when the page drew itself.

## When more people join than you have seats

Section: your-school · roles: school_admin, leader · anchor: `upgrade-seats-actual` · in `packages/player-vue/src/views/schools/UpgradeView.vue`

**What it's for.** What happens when your school or organisation outgrows the seats it is paying for. Nothing is blocked, nobody is locked out, and no lesson stops. The page simply tells you the truth so you can put it right.

**Where it is.** The Upgrade page, the line directly under the seat stepper.

1. Open the Upgrade page.
2. Read the line under the stepper: how many people have joined, and how many seats are paid for.
3. If more have joined than you pay for, the line says so and names the difference.
4. Step the seat count up to match and tap the update button.

**Worth knowing.** This is deliberately an honest count rather than a gate. We would rather show you the gap than shut a class out mid-lesson.

## Where classes are in the course and where they stop

Section: seeing-progress · roles: leader, school_admin · anchor: `insights-org-journey` · in `packages/player-vue/src/insight/OrgIntelPanel.vue`

**What it's for.** Where in the course your classes have got to, shown as the last phrase each class played, and the point most of them stop before.

**Where it is.** The **Journey** question on any level's insights page, under Quiet.

1. Read the sentence for how many classes have started, how far the furthest have got and where most stop.
2. Read the funnel: each step is a sentence of the course, and the bar is how many classes have reached it.
3. Read the class rows, furthest first, for each class's own position.

**Worth knowing.** A position is the phrase the class last played, in both languages. A sentence is one of the course's own sentences; the count out of the total says how far along that is.

## Where in the world people are using us, and on what

Section: seeing-progress · roles: admin · anchor: `question-where-and-what` · in `packages/player-vue/src/views/intel/WhereAndWhatView.vue`

**What it's for.** Which countries real people practised from in the last thirty days, whether they were on phones, tablets or desktops, and whether they were in the app or in a browser.

**Where it is.** **Where and what**, under What's happening.

1. Read the sentence for how many real people, from how many countries, and the country and device most of them are on.
2. Read the chart for people by country, most first.
3. Read the rows, one per country, each with its phone, tablet and desktop split and its in-the-app or in-a-browser split. Tap a country to narrow the page to it; tap a device chip to count only that device. Both choices are written into the page address.

**Worth knowing.** A person seen on two devices is counted once in the headline and once under each device. In the app or in a browser has only been recorded since 10 September 2026, so earlier people read as not recorded rather than being guessed at. Machine traffic is left out by rule.

## Where the class has got to

Section: seeing-progress · roles: leader, school_admin, teacher · anchor: `class-journey` · in `packages/player-vue/src/views/schools/ClassDetail.vue`

**What it's for.** How far the class has travelled through its course, as a bar with the class average behind it and the next belt named. A class carries its own place on the course, moved by the sessions you run together.

**Where it is.** The class page, the **Course Journey** card in the column beside the roster.

1. Open the class from **My Classes**.
2. Read the bar for how much of the course the class has covered.
3. Read the line under it for the class average and how far it is to the next belt.
4. Compare that with the belt spread underneath, which shows how tightly the class is travelling together.

**Worth knowing.** The class average is the honest number for planning a lesson. The belt spread is the one that tells you whether the class is holding together or pulling apart.

## Whether a class is practising together

Section: seeing-progress · roles: admin, leader, school_admin · anchor: `class-practice` · in `packages/player-vue/src/views/admin/NodeHomeView.vue`

**What it's for.** The headline card on a class: how many phrases the class was prompted and said back together in the last seven days, when it last practised, and the list of those phrases with how often each came round. Classes practising together is what a language programme lives on, so this leads over anything individual students do alone.

**Where it is.** The **Class practice** card on a class page.

1. Open a class from the tree or the map.
2. Read the big figure for phrases spoken this week.
3. The line under it gives the time since the class last practised and its minutes in the app this week.
4. The list beneath is every phrase the class said this week and the number of times it came round.

**Worth knowing.** The minutes are time in the app with the lesson running, pauses included, so they are the time the class was in the lesson. A class that has never played together says so plainly and names the teacher's **Play as class** button as the thing that starts the first lesson.

## Whether the app is working right now

Section: seeing-progress · roles: admin · anchor: `question-working` · in `packages/player-vue/src/views/intel/WorkingView.vue`

**What it's for.** Whether audio is failing for real people, and on which build and which kind of device, so you can tell if the last fix reached them.

**Where it is.** **Working now**, under What's happening.

1. Read the sentence for the failure rate over the last seven days and the build most people are on today.
2. Read the chart for the rate by day.
3. Read the rows, one per build, most people first. Tap a build to narrow the rows to it; the choice is written into the page address.
4. Read the device line under the rows for phones against desktops.

**Worth knowing.** Only real people's plays are counted, so your own session on staging is not here. Machine traffic is left out by rule.

## Which bits of a course make people stumble

Section: seeing-progress · roles: admin · anchor: `question-weak-points` · in `packages/player-vue/src/views/intel/WeakPointsView.vue`

**What it's for.** Seeing, for one course, which pieces of it real learners skip, retry, or stop on, ranked by how much trouble each piece caused per person who met it.

**Where it is.** **Weak points**, under What's happening. Pick a course on the left.

1. Tap a course under **Courses** in the map on the left.
2. Read the sentence for the piece that gave people the most trouble.
3. Read the rows, worst first, showing both languages for each piece.
4. Open a row to see that piece's phrases.

**Worth knowing.** When fewer than five real people have practised a course, the page says **too few to say** rather than showing a number. That is the truth about the course, not a fault in the page.

## Which classes have gone quiet

Section: seeing-progress · roles: leader, school_admin · anchor: `insights-org-quiet` · in `packages/player-vue/src/insight/OrgIntelPanel.vue`

**What it's for.** The half you act on: which classes practised before and have stopped, how long ago, and which have never started at all.

**Where it is.** The **Quiet** question on any level's insights page, under Practising.

1. Read the sentence for how many classes have gone quiet and how many have never started.
2. Read the bars for how long since each class last practised.
3. Open a class row to see where it stopped.

**Worth knowing.** Practised this week counts any sign of practice, a phrase spoken or the course opened and progress saved. The Practising figure above counts phrases spoken only, so it can be lower.

## Which classes practised this week

Section: seeing-progress · roles: leader, school_admin · anchor: `insights-org-practising` · in `packages/player-vue/src/insight/OrgIntelPanel.vue`

**What it's for.** Whether your classes are actually doing it: how many practised together in the last seven days against the seven before, how many phrases they spoke, and which people practised on their own account and for how long.

**Where it is.** The **Practising** question at the top of any level's insights page.

1. Read the sentence for this week against last week.
2. Read the line for how many phrases were spoken each day over the last four weeks.
3. Read the class rows for who practised, when they last practised together and where in the course they are.
4. Read the people rows for own-account minutes.

**Worth knowing.** A class is counted in phrases spoken, never minutes. Nothing records how long a whole class practised, so no time is invented for it. Minutes appear only for people's own logins.

## Which courses are worth attention

Section: seeing-progress · roles: admin · anchor: `question-courses` · in `packages/player-vue/src/views/intel/CoursesView.vue`

**What it's for.** One ranking of every course by real people practising it this month, with how many have ever been in it and how many have reached its end.

**Where it is.** **Courses**, under What's happening.

1. Read the sentence for how many courses are alive this month and which had the most people.
2. Read the chart for the courses with anybody in them, most first.
3. Use the chips to show every course, only the alive ones, or the quiet ones somebody once joined. The chip is written into the page address.
4. Open a course row to see which bits of it people stumble on.

**Worth knowing.** Reaching the end means getting through nine tenths of the course. A course with no recorded length shows a dash there rather than a zero. Minutes are not shown: the stored counters are not reliable, and a number that might be wrong is left off.

## Who is about to leave

Section: seeing-progress · roles: admin · anchor: `question-leaving` · in `packages/player-vue/src/views/intel/LeavingView.vue`

**What it's for.** The list of who to write to and why: real people who were practising regularly and have stopped, paying people who have gone quiet, and people whose access runs out within a fortnight.

**Where it is.** **Leaving**, under What's happening.

1. Read the sentence for how many, and why.
2. Read the chart for how long they have been gone.
3. Read the rows, most recently seen first, then the most regular first. Each carries every reason that applies.
4. Open a row to see that person and act on them.

**Worth knowing.** Nobody is ranked by money. No amount is stored anywhere in this database, so the order is who was seen most recently and who was most regular before they stopped. This page sends nothing.

## Who is behind every number

Section: seeing-progress · roles: admin · anchor: `population-chip` · in `packages/player-vue/src/intel/PopulationChip.vue`

**What it's for.** Saying, under every answer, how many real people the numbers on that page are counted from and who has been left out. Demo accounts, SSi staff, class accounts and machine traffic are never counted as people.

**Where it is.** The small pill beneath the answer sentence on every question page.

1. Read the pill under the answer for the number of real people counted.
2. If a page is deliberately showing demo or staff data, the pill says so in red.

**Worth knowing.** The count comes from the server, from one shared rule, never from the page itself. Two pages cannot disagree about who is real.

## Why the insights show a rate, not a total

Section: seeing-progress · roles: admin, leader, school_admin · anchor: `insights-rate-widget` · in `packages/player-vue/src/insight/NodeRateEngine.vue`

**What it's for.** Everything on the insights page is a rate — an amount per learner per week — rather than a running total. A total only ever says how big and how old something is, so a large school always beats a small one. A rate says how fast it is moving, which is the thing you can actually act on.

**Where it is.** The comparison block under the pickers on any level's insights page.

1. Open a level and tap **See insights**.
2. Read the line under the pickers — it says in words what the current measure counts.
3. The block below puts this level's rate beside whatever you are comparing it to.
4. Change the window to compute the same rate over a shorter or longer period.

**Worth knowing.** A pace matters more than a position: a class three sentences behind but climbing fast is healthier than one parked far ahead.

## Work through setup at your own pace

Section: your-school · roles: school_admin · anchor: `setup-save-exit` · in `packages/player-vue/src/views/schools/SetupView.vue`

**What it's for.** The first-run wizard that takes a brand-new school from nothing to teachers, courses and classes. It is four short steps and it does not have to be done in one sitting.

**Where it is.** Settings, then First-time setup. The steps are listed down the left, and **Save & exit** sits at the bottom of every one.

1. Open the wizard and work down the steps on the left — your school, your staff, your courses, your classes.
2. **Continue** saves the step you are on and moves you to the next one.
3. Tap any step in the left-hand list to jump straight to it, forwards or back.
4. **Save & exit** saves the step you are on and puts you back on your dashboard. If something cannot be saved it stays put and tells you why, so you never leave work behind without knowing.
5. Come back to Settings and First-time setup whenever you want to carry on.

**Worth knowing.** Nothing here is a one-shot. Everything the wizard sets up — the school name, the invite links, the classes — can also be changed later from Settings and from your class pages. The course ticks on step three are only a filter for the class list on step four, so they are not kept when you leave.

## Your class against the average

Section: seeing-progress · roles: teacher · anchor: `teacher-insights-class` · in `packages/player-vue/src/insight/TeacherInsightsView.vue`

**What it's for.** The teacher's own insight tool: pick one of your classes and see its pace set against the average, over the period and for the measure you choose. It answers whether a class is moving well, which a roster of totals cannot.

**Where it is.** **Analytics** in the schools navigation.

1. Open **Analytics**.
2. Pick the class you want from **Your classes** if you teach more than one.
3. Pick the **measure** — the line underneath says exactly what it counts.
4. Pick the **window** the rate is computed over, and what to **compare to**.
5. Read the comparison block for your class's rate beside that average.

**Worth knowing.** A class with too few sessions to compare honestly says so rather than showing a number built from nothing.

## Your classes at a glance

Section: seeing-progress · roles: teacher · anchor: `dash-class-card` · in `packages/player-vue/src/views/schools/DashboardView.vue`

**What it's for.** Your teaching dashboard, with your classes first. Every class you teach is a row or a card carrying its course, how many students are in it, their average practice, and the join code you read out to get a new pupil in.

**Where it is.** The schools dashboard you land on, above everything else on the page.

1. Open the schools dashboard.
2. Read down the list — one entry per class you teach.
3. Tap a class name to open its own page, with the roster and its settings.
4. **Play as class** on any entry starts a session the whole class does together.

**Worth knowing.** A brand new account shows a single button to create your first class instead of the list.

## Your own teaching numbers

Section: seeing-progress · roles: teacher · anchor: `dash-teacher-stats` · in `packages/player-vue/src/views/schools/DashboardView.vue`

**What it's for.** One quiet line totalling your whole teaching load — how many students you have across every class, how many minutes they have practised between them, and how many sessions have been run. It is a record of what has happened, never a target.

**Where it is.** Underneath your classes on the schools dashboard.

1. Open the schools dashboard and scroll past your classes.
2. **Students** counts every pupil in every class you teach, each person once.
3. **Minutes practised** is real practice time those pupils have logged, in minutes.
4. **Sessions** is how many class sessions have been run.

**Worth knowing.** The line only appears once you have at least one class — there is nothing to total before that.
