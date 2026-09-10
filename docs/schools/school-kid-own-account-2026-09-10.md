# A school kid on their own account: parent-paid, class-linked, school-priced

2026-09-10. Design and verification only. No product code, no migration, no database write. Every claim about current behaviour was read from the code on this branch, cut from `origin/dev` at `6dd831df`, and every count was read from the live production database tonight. Where something could not be established it is listed as a gap in section 9, not guessed.

Ysgol Cas-gwent, Chepstow, is the live case throughout: school `0f5bd6e4`, course `cym_s_for_eng`, 34 classes, 39 teachers, on a trial that runs to 2027-07-16.

---

## 0. The answer in six lines

1. **A Chepstow pupil can play on their own account today, for nothing, with no email.** The class page's **Invite students** link opens `/redeem/<code>`, asks for a first name only, mints an account, tags the pupil into the class, and the school's live cover gives them the class's course free. Thirteen such accounts have real play on other schools' links. Nobody at Chepstow has been handed the link yet, and per Tom's ruling that number says nothing about demand either way.
2. **The £5 school-priced seat is also live, on a second door on the same code.** The classes list's **Copy link** opens `/with/<code>`: email code, then a Paddle checkout at £5 a month or £50 a year, price re-derived on the server from the class's school. It has never completed a purchase for any class in production. The two doors give the same code two different meanings and the Handbook says they are the same link. They are not.
3. **No parent exists anywhere on the class lane.** The payer on `/with/` is the account holder, and the account holder is the child. The parent-payer relationship exists only in SSi Family, which knows nothing about classes.
4. **The hierarchy carries no price today.** School pricing is one binary test, is the class's `school_id` set. Chepstow sits under no group, and the one cascade that does walk the tree reads a column Chepstow does not populate.
5. **The join between the Family child account and the class link already works by accident, and it is the right shape.** A parent who holds Family can create the child's account with a first name, open the class link on the child's device, and the child lands on the teacher's roster with no email, no birthday and no card. The design in section 3 makes that the deliberate path and gives the £5 seat the same parent-held, child-shaped account.
6. **What happens to a £5 pupil when the parents later buy Family is Tom's call and it is parked.** Section 6 states the fork in one paragraph and does not answer it.

---

## 1. What is live, verified

### 1.1 The two ways a learner reaches a class

**Spine A, the class entity.** Every class owns a learners row of its own, `learners.user_id = 'class-learner:<classId>'`, `is_class_entity = true`, pointed at by `classes.class_learner_id`, enrolled in the class's course. It is never signed in. The teacher drives it from the whiteboard as **play as class**, and progress is written through `POST /api/school/class-progress`, which resolves the learner from the class row so a caller can never target anyone else. All 34 Chepstow classes have one. Five have been played. Between 2026-08-06 and tonight those five recorded eleven sessions, about 1,545 minutes of whole-class practice. That figure is the first of Tom's two school measures, how much lesson time the teacher gave it, and it already exists in `sessions` keyed on the class entity.

**Spine B, the individual pupil.** The pupil holds their own auth user and learners row, and belongs to the class through one row in `user_tags`: `tag_type = 'class'`, `tag_value = 'CLASS:<classId>'`, `role_in_context = 'student'`. That row is what the roster reads, what class coverage reads, and what the cascade reads. The second of Tom's two measures, how many pupils now hold their own account attached to the class, is a count of those rows. It is zero for Chepstow tonight, and there are zero for every real school except four probe rows from the 2026-09-07 and 09-08 test passes.

Query behind the zero, run tonight:

```sql
select count(*) from user_tags t
join classes c on t.tag_value = 'CLASS:'||c.id
where c.school_id = '0f5bd6e4-f40b-4dbf-ac4f-a93478d20255'
  and t.role_in_context = 'student' and t.removed_at is null;
-- 0
```

### 1.2 One code, two doors

Every Chepstow class has a `student_join_code`, and the same string sits as an `invite_codes` row of `code_type = 'student'` with `grants_class_id` set, `max_uses` null, no expiry. Thirty-four codes, zero uses. Two different pages hand that code to pupils as two different URLs.

| Door | Where the teacher finds it | What the pupil does | What is written | What it costs |
|---|---|---|---|---|
| `/redeem/<code>` | Class page, **Invite students** panel | Types a first name. Nothing else. | Auth user on `link-<uuid>@invite.saysomethingin.app`, learners row, `CLASS:` student tag, `course_enrollments` for the class course | Nothing. Class coverage grants the course while the school's cover is live. |
| `/with/<code>` | Classes list, **Copy link** button | Types an email, receives a six-digit code, pays by card in Paddle | The webhook writes `subscriptions` as SSi Student Access, `teacher_referrals` with `locked_price_pence = 500`, the same `CLASS:` tag, the same enrolment | £5 a month or £50 a year. Price re-derived on the server from `classes.school_id`. |

The Handbook comment on the Copy link button, which is what a Chepstow teacher reads at `/schools/handbook`, says: *"It is the same link the class page offers, so a student who follows it lands in that class either way."* The class page offers `/redeem/`. The list offers `/with/`. A teacher who reads the Handbook and sends the list's link will send a class of eleven-year-olds to a card checkout.

**The lockout finding of 2026-08-31 is closed on the code.** That walk found the shared pupil link tripping a per-address limit inside twenty loads and locking the whole class out for fifteen minutes. `POST /api/code/validate` and `by-code.ts` now throttle on `REDEEM_PER_IP_LIMIT`, 120 attempts per address per quarter hour, and that commit is on `main`. The second half of that finding, the join card vanishing on a third of fresh browsers, was not re-walked tonight and stays open as a gap.

### 1.3 The price, and what the school relationship actually grants

Two rulings live in the code side by side and both are true today.

- `api/onboarding/provision.ts` says the school relationship entitles pupils to the cheaper £5 price, not free access, and deliberately creates no `entitlement_grants` row for a self-service school so the cascade cannot hand pupils free play.
- `api/_utils/classCoverage.ts`, the "FINAL model" of 2026-07-15, says a class-affiliated pupil gets their class's course in full for as long as the school's cover is live, recomputed on every check, no pupil-level state.

So for Chepstow a tagged pupil plays `cym_s_for_eng` free until 2027-07-16 whether or not they paid, because `resolveActiveEntitlements` adds the class-coverage layer for any live student tag. The £5 seat therefore buys three things and only three: the other nine languages, play after the school's cover ends or after the pupil leaves the class, and a real credential the child can come back to. One correction to the archived ruling, which said all languages during the trial: the code grants the class's course only. Code wins.

The Paddle side is exact and server-guarded. Client fallbacks are the live price ids, school annual `pri_01kvaj05x1y16trwvm8pdm2wcb`, school monthly `pri_01kv5wrc5cz17pwgeva4zk8s0r`. The webhook ignores the billed price for tier and re-derives it: `school_id` and `group_id` both null means tutor at 1000 pence, either set means school at 500 pence, frozen into `teacher_referrals.locked_price_pence`, with a logged mismatch if the client sent the wrong price. One divergence to note: `by-code.ts` and the webhook treat a group-only class as a school class, `WithTeacher.vue` tests `school_id` alone. Zero rows are affected today, there is no class with a group and no school.

Live money facts tonight: `teacher_referrals` has zero rows. `subscriptions` holds 16 SSi Premium, 1 SSi Family, and no SSi Student Access at all. The £5 lane has never completed a purchase in production.

### 1.4 The parent, and where a child account exists

Outside SSi Family there is no parent, payer or guardian concept anywhere. `learners`, `subscriptions`, `teacher_referrals`, `user_entitlements` and `entitlement_grants` carry no such column. On `/with/` the Paddle customer email is prefilled with the pupil's own address and the account paying is the account playing.

SSi Family is the one place a child account exists as a child. `POST /api/family/create-child` is owner-only, takes a first name, creates an auth user on `fam-<uuid>@members.saysomethingin.app` that is never emailed, writes the learners row and an active `family_members` row with `is_child_account = true`, and returns a one-time sign-in link the parent opens or scans on the child's device. Recovery is the parent re-minting through `/api/family/signin-link`. The child never types an email, a password or a birthday. The account's only personal data is a first name. Two such children are live tonight, both on Tom's own test family. A child's entitlement is the owner's subscription, resolved at check time by `familyAccess.ts`, with a 30-day grace when the owner changes plan.

Three synthetic-address conventions now exist in `auth.users`: `fam-` on `members.saysomethingin.app` for Family children, 2 rows; `link-` on `invite.saysomethingin.app` for name-only pupils, 18 rows, 13 with real play; and the same `invite.` domain for named staff seats, the rest of 37. Three is one too many, and section 3 picks one.

### 1.5 The hierarchy, and whether it can carry a price down

The schema has both `schools.group_id` and `schools.node_group_id`. Across 43 schools, 12 populate the old column and 38 the new one. Chepstow populates `node_group_id` only, pointing at a `groups` row of type `school` with no parent. No real school in the database has any node above its own. Every one of Chepstow's 34 classes also carries `classes.group_id` set to that same node.

`get_cascade_courses`, the RPC that walks group to school to class and intersects `entitlement_grants` at each level, joins on `schools.group_id`. For Chepstow that is null, so the walk never starts. This does not matter for price, because the cascade only ever grants free play, and provision.ts deliberately keeps schools out of it. `orgCoverage.ts` walks `groups.parent_id` upward to the nearest ancestor carrying a `platform_status`, capped at 24 levels, for class-less orgs. That is the only working "inherit through the tree" rail, and it inherits cover, not a price.

So today nothing in the tree reaches a pupil's price. The price is `classes.school_id`, one hop, one boolean. That is not wrong for Chepstow. It is insufficient for the moment a group of schools exists above a school, and section 4 says what to do then.

### 1.6 The safeguarding and privacy position on the record

The brief pointed at `/d/1492e5a7` as the existing public position. It is not SSi's. It is a safeguarding page for a private maths tutor, Dominic Roberts, drafted for a tutor profile. SSi's own privacy page at `/privacy` is four kilobytes and contains no clause about children, age, schools or parents. Estate search for "safeguarding" finds Thrive Work clinical policies and today's support-channel spec, nothing for SSi schools. There is no SSi position to contradict. Section 5 writes the first one.

---

## 2. The walk: one Chepstow pupil, both doors

Teacher Angharad, class 7T, pupil Rhys, aged eleven, parent Sian.

**Step 1. The teacher decides.** She opens `/schools/classes`. Two buttons offer a pupil link. The row's Copy link gives `/with/ABC-123`. Opening 7T and tapping Invite students gives `/redeem/ABC-123`. The Handbook tells her they are the same. Nothing tells her one is free and one asks for a card. **Works, misleadingly.**

**Step 2a. Free door.** Rhys taps `/redeem/ABC-123` on a school Chromebook. `POST /api/code/validate` confirms the code, throttled at 120 per address per quarter hour so the whole class can tap it in one lesson. The page asks "What's your name? Your teacher will see it on the class list." He types Rhys. `POST /api/auth/possession-redeem` in link-auth mode mints `link-<uuid>@invite.saysomethingin.app`, an auth user, a learners row, a session. `POST /api/code/redeem` writes the `CLASS:` student tag and the `course_enrollments` row. He lands in the Welsh course. `resolveActiveEntitlements` finds the tag, finds Chepstow live to 2027-07-16, grants `cym_s_for_eng`. He plays. Angharad sees Rhys on the 7T roster and his practice under it. **Works, end to end, tonight. No money moves. No parent is involved.**

**Step 2b. Where the free door breaks.** Rhys goes home and opens the app on his own phone. There is no session. There is no email to send a code to and no password was ever set. The staff sign-in link mints for teachers only, the family sign-in link for Family children only. His only move is to tap the class link again, which mints a second Rhys with a second placeholder address. Angharad now has two Rhyses and the first one's practice is stranded. **Breaks. The free account has no way back on a second device.** This is the real defect of the free door and the reason a "own account" needs a parent holding a credential.

**Step 3. Paid door.** Rhys taps `/with/ABC-123`. `GET /api/teacher/by-code` finds 7T, sees `school_id` set, sees Chepstow's status is trial not expired, returns the class, the lead teacher's name, and `course_is_free: false` because Welsh is priced premium. The page shows £5 a month or £50 a year and asks for an email. Rhys has none, or has a Hwb address that quarantines the code. If Sian types hers, the account is now Sian's. The six-digit code arrives. Paddle opens with Sian's email prefilled and Sian's card. The webhook receives `student_via_teacher`, re-derives 500 pence, writes SSi Student Access on the learner, a `teacher_referrals` row at 500 pence, the `CLASS:` tag, the enrolment. Rhys plays on his mother's account. **Works, mechanically, if the parent is willing to be the account. Nothing in the data says a parent exists, nothing says a child is playing, and the parent's own learning and the child's are one row.**

**Step 4. Rhys already has a Family account.** Sian bought SSi Family last term and made Rhys a child seat. She opens `/redeem/ABC-123` on Rhys's phone, where his fam- session is live. RedeemCode sees the session, shows a confirm step, redeems, and writes the `CLASS:` tag. Rhys is on the 7T roster on his own child-shaped account with a parent who can re-mint his sign-in. Via `/with/` instead, `hasActiveSubscription` calls `/api/subscription`, which is family-aware, returns true, and the page links him without opening a checkout. **Works, both doors, tonight, and it is already the right shape.**

**Step 5. Leaving.** Angharad taps Remove on his roster row, `removed_at` is stamped on the tag, class coverage stops at the next check, the account and any subscription survive. If the school's trial lapses, coverage stops for every tagged pupil at the same instant and each drops to the ordinary free preview of the course, nothing confiscated. If Sian stops paying on `/with/`, the webhook marks the subscription cancelled and the referral lapsed, the tag stays, and coverage keeps the course alive while Chepstow is live. **Works.**

---

## 3. The design: who pays, who consents, what a child account needs

**The seat is a parent-held child account, class-linked, school-priced.** Concretely:

**The account.** Reuse the SSi Family child shape exactly: a first name, a synthetic `fam-` address on `members.saysomethingin.app`, `email_confirm` true, a one-time sign-in link the parent opens on the child's device, recovery by re-minting. This is the taste-safe default from the brief and it survives contact with the code: the endpoint, the sign-in link, the re-mint, the settings page and the deletion restrictions all exist. It should not go through the `link-` name-only convention, because that account has no adult behind it and no way back. It should not go through ordinary email signup, because the child then owns a credential and an inbox we cannot reach. Cost of the choice: `family_members` becomes the parent-child table for non-Family parents too, which means one row with `owner_learner_id` the parent and a subscription that is not SSi Family. `familyAccess.ts` already resolves "own row first, else the owner's", so a child seat carrying its own SSi Student Access row resolves correctly without touching the resolver.

**The parent.** The parent is identified by holding the parent account. The pupil door for a school-introduced child becomes: the class link opens on the child's device or the parent's, offers **I'm the parent, set up my child**, and the parent signs in with their own email code or password, names the child, and the account is minted with the class tag written in the same call. The parent then pays or does not. If they do not, class coverage carries the child while the school is live, exactly as today. If they do, the checkout is the existing `student_via_teacher` checkout with one change: `customData.supabase_user_id` is the child's, `customer.email` is the parent's, and the webhook writes `subscriptions` on the child. The parent's email on a child's subscription is exactly the fact we want in Paddle's ledger.

**Consent.** The parent's act of creating the account is the consent act, recorded as `family_members.created_at` with the parent as owner. The school introduces and never consents on the parent's behalf. Section 5 sets out why.

**The class link.** Written by the server in the same request that mints the child, from the class code the parent arrived on, into the existing `CLASS:` student tag. Nothing new is written, the teacher does nothing, and the roster is the record.

**The child leaves the class.** Teacher removes on the roster, `removed_at` stamps, coverage stops. The account is the parent's to keep, the subscription runs on, and the price question on the next billing event is answered in section 4.

**The child changes school.** New class link, new tag, old tag removed. One account, one history.

**The parent stops paying.** The webhook cancels the subscription. The child drops to class coverage while the school is live, then to free preview. Nothing is deleted.

**The child turns eighteen.** No ruling exists on this. Proposed default: nothing changes automatically. A child account carries no birthday, so the product cannot know. The parent can hand the account over by adding an email to it, which is the existing settings nudge, and a member can already leave a family through `/api/family/leave`. Say so in the parent-facing copy and do nothing mechanical.

**The school's relationship with SSi ends.** Coverage stops. The account, the subscription and the parent's ownership are unaffected. The teacher's window onto the child's practice closes with the tag, which is section 5's visibility rule.

---

## 4. Making the price fall out of the link

**The rule, resolved on the server on every billing event:** a seat is school-priced if the child is tagged into a class that sits inside a school with a live platform status, or inside a school whose nearest ancestor with a platform status is live. No admin flag. No parent-side choice.

This is three existing rails joined, not a new mechanism:

1. **Membership** is the `CLASS:` student tag, already the unit the roster, coverage and cascade read.
2. **Ancestry** is `classes.school_id`, then `schools.node_group_id`, then `groups.parent_id` upward. `orgCoverage.ts` already walks that last hop to the nearest node with a `platform_status`, and `classCoverage.ts` already answers "is this school live" from the school row. A single helper, `resolveSchoolPricingForLearner`, would take a learner, find their live student tags, and return the nearest live covering node or none.
3. **Derivation and freezing** is the webhook's existing shape. Today it derives from `classes.school_id` at purchase and freezes 500 into `locked_price_pence`, and commission gates on the frozen value forever. Keep the freeze for commission. For the price the child pays, follow the brief's default: re-derive on each renewal, so a child removed from every class reverts to the individual price at the next period. That is a Paddle price change on the subscription, which the estate already does for the Family to Premium move.

**Where the freeze and the re-derive disagree, and a taste call for Tom.** Freezing at purchase is simpler, cannot surprise a parent mid-year, and is what the commission logic already does. Re-deriving is what "by hierarchy and thus qualifying" literally means and stops a family keeping a £5 seat after the child has left the school. My read: re-derive, but only ever downward in kindness at the boundary of a period, never mid-period, and tell the parent a month ahead. If Tom prefers the frozen year, nothing in the design changes but one line in the webhook.

**Two column fixes ride along for free.** `get_cascade_courses` should read `node_group_id` where `group_id` is null, or the schools reorg should finish moving the column. And `WithTeacher.vue` should test `school_id || group_id` to match `by-code.ts` and the webhook. Neither affects Chepstow today, both bite the first time a group exists.

**A group of schools above a school.** Tom has never ruled a price for a group tier. The archived commercial model's position, as history, was that groups aggregate payers and are never a pricing tier. Nothing in the live schema contradicts that: `groups.platform_status` exists so an org can carry the clock for its sub-groups, and pricing reads the nearest live node. So the honest design is: a child under a school under a live group is school-priced at £5 through the same nearest-ancestor rule, and there is no third number. If Tom wants a group price to exist, it is a fourth entry in `PRICE_CATALOG` and a second branch in the derivation, and that is his to open.

---

## 5. Safeguarding and consent

These are children. A parent pays. A school introduces. The practical and legal shape in the UK, with Chepstow in Wales:

**Lawful basis and who holds it.** The contract is between SSi and the parent, so the lawful basis for the child's account and practice data is the performance of that contract with the parent, and consent for anything beyond it. The school has no contract with SSi for the pupil's own account and is not the data controller for it. The school is controller for its own use of the classroom entity and for whatever it sees through the roster, under its public-task basis, and that needs saying in the school agreement because a Welsh school's DPO will ask. Nothing here relies on the child's consent, which under UK GDPR cannot be relied on below thirteen for an information-society service and should not be relied on at all when a parent is available.

**Age Appropriate Design Code.** The child account is in scope from the moment it is created. What the code already does well: it collects a first name and nothing else, sets no birthday and asks for none, has no messaging, no social features, no advertising, cookie-free analytics, and defaults to the least data. What it must add: a child-readable, and Welsh, explanation of what the teacher sees; a parent-facing privacy notice in Welsh and English; a default that a child's practice is visible to their class teacher only while the tag is live; and no nudge toward buying inside the child's own screens. The existing `link-` name-only account fails the code on one point, it has no adult attached and no route to exercise rights, which is a second reason to retire it for school pupils.

**What the school may pass to SSi.** Nothing about a named pupil. The school hands the child a link. The parent creates the account. The teacher sees the name the parent typed. The school never uploads a roster, a date of birth, a UPN or an email for a pupil, and the product should not offer a way to. This is the position that keeps SSi out of being a processor for the school's pupil records.

**What a teacher sees.** The child's practice in the class they teach, under the class, while the tag is live. Not the child's other courses, not their billing, not their parent, not their account settings. Today the roster and the class progress views are scoped by `resolveVisibleScope` to the caller's classes and that is the right rail. Taste call for Tom, flagged as the brief asked: a teacher seeing minutes and position in the one class and nothing else is my recommendation.

**What a parent sees.** Everything on the child's account, because they own it: the Family settings page today shows the member row and the sign-in link and no practice at all. The parent-facing view should show at least what the teacher sees, otherwise the parent is paying for a window they are not allowed through. That is a small addition to `/api/family/index`.

**Data minimisation against the Family position.** Keep it exactly: first name only, synthetic address, no birthday. Do not collect a year group or a date of birth to get a nicer dashboard. Age is not a thing the product needs to know.

**When the link is broken.** Removing the tag ends the teacher's view at once. The child's history stays on the parent-held account, which is correct: the practice belongs to the child, not to the school. Deleting the account is the parent's act through the existing account deletion, which already refuses to cascade through `family_members` without a human decision, and that restriction is the right one for a child.

**Welsh.** Chepstow's parents may read in either language. The `/with/` page is translated into Welsh, 34 of its 44 keys. The redeem page's 19 keys are translated. The class-detail invite copy has 56 of 98 keys. The parent-facing consent copy, the privacy notice and the sign-in link email do not yet exist in either language.

**No SSi position existed before this section.** The document cited to me as the public position is a private tutor's page. This is the first draft of SSi's own, and it should be read by someone who does this for a living before a Welsh school's governors see it.

---

## 6. The family account beside the pupil seat, and the parked fork

**What a parent is choosing between.** A £5 a month school-linked seat for one child, all ten languages, or SSi Family at £25 a month or £250 a year for up to six learners including the payer, two adults among them, all languages, with the children on the exact child-shaped account this design reuses. A household with one child in a Welsh class and one parent curious about Welsh is already ahead on Family at the second seat. That is Tom's observation and it is a commercial fact of the design: the £5 seat is the entry, Family is where a household lands if either parent wants to learn.

**Family is already class-linkable tonight.** Section 2, step 4: a Family child tapping the class link is tagged into the class with no charge and appears on the roster. So the map has three live shapes: free class coverage on a name-only account, a £5 seat on an adult-shaped account, and a Family child seat linked for nothing extra. The design in section 3 gives the £5 seat the Family child's account shape so that the first two collapse into one kind of account.

**The parked question, stated once.** When a household holding a £5 school-linked seat later buys SSi Family, one of two things must be true of that seat at the next billing event. Either the £5 subscription is cancelled and the child becomes a Family member covered by the owner's plan, which is the clean single-payment outcome but is a downgrade write against a `subscriptions` row that the webhook's plan precedence currently refuses to lower, and it means SSi actively ends a paying subscription. Or the two run side by side, the child keeps an SSi Student Access row that resolves first under "own row first", the household pays £30 instead of £25 until someone notices, and nothing in the product tells them. The fork matters because the precedence table, the family resolver and the cancel flow all take a position on it implicitly, and because it is the first thing a Chepstow parent who upgrades will hit. Tom has deferred it. Nothing in sections 3 to 5 depends on which way it goes, and section 7's build order does not include it.

---

## 7. What it would take, smallest first, and the Chepstow answer

Each item stands alone. Each names what it buys.

1. **Fix the Handbook sentence and give the teacher one link.** Make Copy link and Invite students hand out the same door, and say in the Handbook which one it is and what it costs the pupil. Buys: no class of eleven-year-olds sent to a card checkout by a teacher who followed the manual. One afternoon.
2. **Give the name-only pupil a way back.** A teacher-minted per-pupil sign-in link on the roster row, the exact shape of the staff sign-in link and the family re-mint. Buys: the free account becomes a real own account across devices, no duplicate Rhys. Two days. This alone makes the free door honest for Chepstow.
3. **The parent door on the class link.** "I'm the parent" on `/redeem/` and `/with/`, parent signs in, names the child, child minted on the Family shape with the class tag written server-side. Buys: the child account that section 5 needs, with an adult holding the credential. A week, mostly the copy in two languages.
4. **The £5 checkout on the child, paid by the parent.** `supabase_user_id` the child's, `customer.email` the parent's, webhook writes to the child. Buys: the parent-paid, class-linked, school-priced seat Tom asked for. Two days on top of 3.
5. **Nearest-live-ancestor price derivation.** The helper in section 4, used by the webhook and by `by-code.ts`, plus the two column fixes. Buys: the price falls out of the tree the day a group exists. Three days, most of it tests on the walk.
6. **Parent's window and the privacy notice.** Practice on the family page, the Welsh and English parent notice, the child-readable line about what the teacher sees. Buys: the Age Appropriate Design Code position in section 5 becomes true rather than written.

**The Chepstow answer.** With today's code, today's prices and today's database, a Chepstow pupil can be playing on their own account tomorrow morning by tapping the class page's Invite students link and typing a first name. It costs nothing, it needs no email and no parent, the teacher sees them on the roster, and the school's cover carries the Welsh course until July 2027. What is ugly: the account has no way back on a second device, nobody adult holds it, and if the teacher sends the other link from the classes list the pupil is asked for a card instead. The smallest change that makes it right is item 2, a sign-in link the teacher can hand the pupil, and item 1 so there is only one link to send. The parent-paid £5 seat is items 3 and 4, and until they land the honest description of `/with/` is: a parent pays £5 with their own card on an account that is really theirs, with the child playing on it.

---

## 8. Decisions stated, not re-opened

- A school's unit is the class, a college or org's unit is the individual. The school view needs two things the org view does not: lesson time the teacher gave, already in `sessions` on the class entity, and pupils holding their own account attached to the class, already a count of live student tags. Both exist as rows tonight. Neither is designed here, job #172 has the org surface.
- The pupil account is parent-paid, class-linked, school-priced by hierarchy. No school-funded seat is proposed.
- Nothing was built or changed. No write touched the database.
- The price falls out of the link, server-side, no manual flag.
- The archived docs carry no authority and were read as history only. Where the archived "all languages during trial" wording disagreed with `classCoverage.ts`, the code won.
- Chepstow's zero pupils is a fact, not a signal.
- The Family upgrade fork is stated in section 6 and not answered.

---

## 9. Explicit gaps

- **The join-card-vanishes defect** from the 2026-08-31 walk was not re-walked. No browser was opened, per the brief.
- **Paddle dashboard facts** were not checked: whether the school price ids are live in the Paddle catalogue and which currencies they carry is known only to the dashboard. The ids are the hardcoded fallbacks in the client.
- **Whether a Family child can currently open the `/with/` checkout** was read from code, not exercised. `hasActiveSubscription` returns true via family cover and the page links without charging. Not verified live.
- **The Welsh translations** were counted, not read for quality.
- **Legal review.** Section 5 is a design position written from the code and the UK rules as I know them. It is not legal advice and it should be read by someone qualified before it reaches a governing body.
- **`resolvePayerAuthUid`** in the webhook requires a verified email to bind a payment by customer email. The student lane binds by `supabase_user_id` instead, so a synthetic-address child can be bound. Read from code, not exercised against Paddle.

## 10. Needs Tom

- Freeze the school price for the paid year or re-derive it at each renewal. Section 4, my read is re-derive at period boundaries only.
- A teacher sees a linked pupil's practice in their own class and nothing else. Section 5, my read is yes.
- Which pupil door survives, the free name-only door with a way back, or parent-first for everyone. Section 7 item 1 needs the answer to write the sentence.
- Whether a group-of-schools price exists at all. No ruling on record. Default in section 4 is no third number.
- The Family upgrade fork, section 6, when there is less on.
