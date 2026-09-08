# Walkthrough pack — compiled render

**Version `ceba798d6815` · generated 2026-09-08 by `tools/walkthrough/compile.mjs`. DO NOT EDIT — edit tools/walkthrough/walks/*.json and recompile.**

## add-a-class-to-a-group — Add a class to a group

Personas: admin, leader, school_admin · place: node-home

1. [`verb-add-class` · click] **Add a class** builds a class underneath the group you are standing on, before anybody is teaching it. Tapping it opens the form and creates nothing.
2. [`add-class-name` · next] The class name goes here, and the course beside it is what the class will learn. Both are needed before the button will do anything.
3. [`add-class-submit` · next] **Add** creates it. A class needs no teacher to exist — it sits under the group waiting, and you put a teacher on it from your staff list whenever you are ready.
   - terminal: That's a class set up in advance, teacher to follow. This tour changed nothing; only your own taps do.

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

## choose-something-else-to-learn — Choose something else to learn

Personas: learner · place: library

1. [`library-course-search` · next] Everything you can get to lives below, and this box is the quick way in. Type a language and the list narrows as you go.
2. [`library-course-grid` · next] Tap any one of these and you are straight into it — no setting up, no starting over.
3. [`library-course-grid` · next] Your current course is not going anywhere. Each one keeps its own place, so you can have a poke at a second language and come back without losing an inch in the first.
   - terminal: That's the Library. Close it and press play to carry on with the one you are in.

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

## delete-a-school-or-group — Delete a school or group

Personas: admin · place: node-home

1. [`verb-delete` · next] **Delete** sits on its own at the end of the row, in red, because it is the one verb here that takes everything below it with it. This tour points at it and will not tap it.
2. [`verb-delete` · next] Tapping it shows you a summary first: the classes, people and links that go with it, counted for you. Where there is real activity underneath you are asked to type the name back before it will go, which is the signal to stop and check.
   - terminal: That's the one door with a lock on it — an empty shell goes on a single confirm, a live school does not. This tour changed nothing; only your own taps do.

## email-someone-their-invite-again — Email someone their invite again

Personas: admin, leader, school_admin · place: node-home

1. [`ways-in-copy` · next] Every live way in has its own row down here in **Ways in**, with its verbs at the end of it. Find the row for the person who says they never got their invite.
2. [`ways-in-resend` · next] **Email again** sends the same invite a second time. Nothing changes and no new link is made, so the one they may yet dig out of a spam folder still works. Only rows for a named person with an email on file carry this button.
   - terminal: That's the same invite, sent again — and the note above the table names the address it went to. This tour changed nothing; only your own taps do.

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

## set-up-a-demo-organisation — Set up a demo organisation

Personas: admin · place: node-home

1. [`verb-mint-demo` · click] **Mint a demo org** stands up a whole organisation with plausible people and activity already in it, so a prospect sees the product running rather than empty. Tapping it opens the form and mints nothing.
2. [`verb-mint-demo` · next] Give it a name, and a leader's email if somebody is to be handed it. **Mint** builds it under the node you are standing on and gives you back a leader link to copy.
   - terminal: That's a demo org ready to show — and its own page grows a **Refresh demo activity** button so it never looks abandoned. This tour changed nothing; only your own taps do.

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

## where-you-are-in-this-course — Where you are in this course

Personas: learner · place: library

1. [`library-progress-card` · next] This card is your whole position in the course in one glance. Nothing here is a score, and nothing here is counting anything against you.
2. [`library-belt-strip` · next] Those eight coloured dots are **belts**, and the filled one is where you are now. A belt marks how far along the course you have come — it is a position, not a grade, and there is nothing to pass. You move to the next one simply by carrying on.
3. [`library-position-track` · next] The bar underneath lays the whole course out end to end, with each belt as its own band of colour. The marker on it is you — so it shows how far you have come rather than how far is left.
4. [`library-belt-browser` · next] Tap the card itself to open the belts up. You can look through everything you have met so far, and start again from any point you fancy revisiting.
   - terminal: That's your position. Close this whenever you like and press play — it always picks up exactly where you left off.
