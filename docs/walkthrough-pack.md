# Walkthrough pack — compiled render

**Version `567cfb0bd93e` · generated 2026-08-03 by `tools/walkthrough/compile.mjs`. DO NOT EDIT — edit tools/walkthrough/walks/*.json and recompile.**

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

## reading-insights — Reading your insights

Personas: admin, leader, school_admin · place: node-insights

1. [`insights-measure` · next] The **measure** picks what's being counted — progress, practice, class sessions. The line underneath the pickers says exactly what the current one means.
2. [`insights-window` · next] The **window** is the period the rate is computed over — shorter windows react faster, longer ones smooth the noise.
3. [`insights-compare` · next] **Compare to** puts an average alongside. Everything here is a rate, not a raw total — so groups of different sizes compare fairly.
4. [`insights-overview` · next] **Overview** takes you back to the same place's home — insights is a lens on where you already are, not a different page to get lost in.
   - terminal: Rates lead, position is context — and the picker text always says what a measure means.

## run-class-session — Run your first class session

Personas: teacher · place: class-detail

1. [`class-join-link` · next] Students join with this link — share it and they sign up straight into this class.
2. [`class-join-code` · next] Prefer a whiteboard? **Show code instead** reveals a standing code — anyone who enters it at saysomethingin.com/redeem joins this class, until the code changes.
3. [`class-play` · next] **Play as class** is the heart of it: one device — yours — leads the whole class through a session, and it counts for every student on the roster.
   - terminal: When you're ready, tap Play as class for real — this tour never starts a session for you.

## ways-in — Ways in — who can get in, and how to change it

Personas: admin, leader, school_admin · place: node-home (org/group/school)

1. [`ways-in-ledger` · next] Every way in, in one ledger: personal sign-in links and shareable join links, for everywhere below here. Filter by role or by place with the chips.
2. [`ways-in-copy` · next] **Copy** re-shares the same live link — always safe, nothing changes.
3. [`ways-in-remint` · next] **Re-mint** is the one to know about: it mints a NEW link and the old one stops working the moment you tap — anyone who bookmarked the old link is locked out until you send them the new one.
4. [`ways-in-revoke` · next] **Revoke** switches a link off. It's undoable — a revoked row grows a **Put back** button.
   - terminal: The short version: copy is safe, re-mint kills the old link instantly, revoke can always be undone.
