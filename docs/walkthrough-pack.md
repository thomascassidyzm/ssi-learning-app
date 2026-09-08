# Walkthrough pack — compiled render

**Version `f22c43cb6903` · generated 2026-09-08 by `tools/walkthrough/compile.mjs`. DO NOT EDIT — edit tools/walkthrough/walks/*.json and recompile.**

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

## create-your-first-classes — Create your first classes

Personas: school_admin · place: setup

1. [`setup-add-class-row` · next] A class is a name, a course and the students who join it, and it is the thing every progress figure in your dashboard is eventually counted against. Step four is where the first ones are made.
2. [`setup-class-course` · next] Type a class name in the first row. Its course is already set to the language you signed your school up with, so most rows need nothing done here.
3. [`setup-add-class-row` · next] **+ Add another class** gives you a further row, starting on that same language. The cross at the end of a row removes one you no longer want.
4. [`setup-add-class-row` · next] Tap **Finish setup** and every filled-in row is created, each marked Added as it saves. Classes you made earlier are listed above the rows, so running the wizard twice will not duplicate them.
   - terminal: That is step four — your classes exist, and students join them from each class page. This tour changed nothing; only your own taps do.

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

## give-a-class-its-course — Give a class its course

Personas: school_admin · place: setup

1. [`setup-class-course` · next] A course does not belong to a person, it belongs to a class — so this picker beside the class name is how a course reaches learners at all. It already holds the language you chose when you signed your school up.
2. [`setup-class-course` · click] Leave it alone to teach that language. To teach something else, tap the picker and it opens.
3. [`setup-class-course` · next] Start typing to narrow the list, because the catalogue runs to dozens of courses. Where a language offers more than one version, the versions differ by region or accent — pick the one you want and everybody who joins the class lands in it.
   - terminal: That is the course picker — one choice per class, changeable until you save. This tour changed nothing; only your own taps do.

## go-back-over-something — Go back over something

Personas: learner · place: library

1. [`library-belt-browser` · click] Nothing is ever locked behind you. Tap here to open the whole course up.
2. [`belt-browser-list` · next] Every belt is listed, with a tick on the ones you have already come through. Open one and you can look through everything you met there.
3. [`belt-browser-list` · next] Choosing something in there does not just show it to you — it moves you to that point and starts you off from there. So use it when you genuinely want to go over old ground, not to peek.
   - terminal: If you land somewhere you did not mean to, come straight back in here and pick your way forward again. Nothing is lost by wandering.

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

## let-a-named-address-in — Let a named address in through your links

Personas: school_admin · place: settings

1. [`settings-identity-add-address` · next] This is the exception to the domain rule: one named person, let in by their own address. A supply teacher here for a fortnight, or a colleague who only uses a personal email.
2. [`settings-identity-add-address` · next] Type the address exactly as they will use it and tap **Add address**. Then send them your usual teacher link.
3. [`settings-identity-add-address` · next] Without this they can still get in, but they show as **Unverified address** on the Teachers page until they confirm their email. Adding them here first skips that.
   - terminal: That is a named address let through — the smallest door you can open. This tour changed nothing; only your own taps do.

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

## see-what-your-school-pays — See what your school pays

Personas: school_admin · place: settings

1. [`settings-billing-plan` · next] This is the whole of what your school pays, in one line: the plan it is on, how many teacher seats it covers, and whether the subscription is running.
2. [`settings-billing-plan` · next] Underneath it the price per teacher seat is spelled out, so the number on your card statement is never a surprise.
3. [`settings-billing-plan` · next] **Manage subscription & seats** takes you to the one Upgrade page where every payment change happens. **Billing & invoices** opens your invoices, your card and cancellation, and only appears once a subscription is running.
   - terminal: That is your plan, read from the top of the Billing panel. This tour changed nothing; only your own taps do.

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

## where-you-are-in-this-course — Where you are in this course

Personas: learner · place: library

1. [`library-progress-card` · next] This card is your whole position in the course in one glance. Nothing here is a score, and nothing here is counting anything against you.
2. [`library-belt-strip` · next] Those eight coloured dots are **belts**, and the filled one is where you are now. A belt marks how far along the course you have come — it is a position, not a grade, and there is nothing to pass. You move to the next one simply by carrying on.
3. [`library-position-track` · next] The bar underneath lays the whole course out end to end, with each belt as its own band of colour. The marker on it is you — so it shows how far you have come rather than how far is left.
4. [`library-belt-browser` · next] Tap the card itself to open the belts up. You can look through everything you have met so far, and start again from any point you fancy revisiting.
   - terminal: That's your position. Close this whenever you like and press play — it always picks up exactly where you left off.

## work-through-setup-at-your-own-pace — Work through setup at your own pace

Personas: school_admin · place: setup

1. [`setup-save-exit` · next] Setup is four short steps — your school, your staff, your courses, your classes — and it does not have to be done in one sitting. The steps are listed down the left and you can tap any of them to jump forwards or back.
2. [`setup-save-exit` · next] **Continue** saves the step you are on and moves you along. **Save & exit** saves the step you are on and puts you back on your dashboard.
3. [`setup-save-exit` · next] If something cannot be saved, it stays put and tells you why, so you never leave work behind without knowing. Come back through Settings and First-time setup whenever you want to carry on.
   - terminal: That is the wizard — nothing here is a one-shot, and everything it sets up can be changed later. This tour changed nothing; only your own taps do.
