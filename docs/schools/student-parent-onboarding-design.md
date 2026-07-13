# Schools: student onboarding via parent email

*Design doc — 2026-07-13. No implementation. Grounded in a read of:
`FAMILY-PLAN-SPEC.md` (merged, D1/D2 confirmed; `family_members` table live since
`ebee0d94`, `/api/family/*` endpoints not yet built), `WithTeacher.vue` (the
`/with/:code` student join surface), `api/code/redeem.ts` + `invite_codes`,
`api/teacher/paddle-webhook.ts` (`student_via_teacher`), `api/onboarding/provision.ts`
(the £5 school-linked price comment), the double-redeem fix (`6ebc1780` — unique
indexes on `schools.admin_user_id`, `govt_admins.user_id`), `supabase/schema.sql`
(`learners_user_id_key UNIQUE`), and `docs/schools/region-tier-design.md`
(branch `schools/region-tier-design`) for the hierarchy + visibility floor.*

**Owner's ruling honoured, not relitigated:** individual students joining a class are
paid users (£5/month school-linked). Children cannot create their own accounts — a
parent creates the account with the parent's email, because the parent pays. One
parent email may cover multiple children in different classes. User ID is the unique
identifier; email is mere login.

---

## The story in one paragraph

Mrs Evans hands out a slip with the class link. Dylan brings it home; Mum opens it on
her phone, sees "Ysgol y Garnedd — Year 5 Spanish, with Mrs Evans — £5/month", signs
in with her own email (one OTP — the account she already has from Ffion's class last
year), taps "Add a child", types *Dylan*, pays £5, and scans a QR code on Dylan's
tablet once. Dylan is on Mrs Evans's roster by first name that evening and stays
signed in on his tablet from then on. Mum's email is the only real email anywhere;
Dylan never touches an email, a password, or a birthday. If Mum's card fails, Dylan
stays on the roster and keeps his free-tier belts until she fixes it. When the third
Evans child starts lessons, the family-plan upsell is sitting right there.

---

## 0. The convergence, stated once

**One child-account primitive, two billing wrappers.** The family plan (merged spec)
already built exactly the thing this flow needs: a parent-minted child account —
synthetic email the system owns, QR one-time sign-in, parent-re-mintable links,
custody recorded in `family_members` with `is_child_account: true`. This design
**reuses that primitive verbatim** and adds nothing parallel:

- **School-linked child, no family plan (the default):** the child's learner carries
  its own £5/mo `'SSi Student Access'` subscription (existing `student_via_teacher`
  webhook path, existing Paddle prices), paid by the parent. The `family_members` row
  is pure custody/control — it grants no entitlement, because the entitlement
  resolver's family join requires the owner's row to be `plan_name = 'SSi Family'`
  (FAMILY-PLAN-SPEC §3). This composes with zero changes to the resolver.
- **Family-plan household:** the child is an ordinary family seat; the resolver
  already covers them; the class join skips checkout entirely (the
  `alreadySubscribed` path in `WithTeacher.vue` — the child's own check, see §1
  step 5). No £5 sub is ever created.

So the family plan is not a prerequisite and not a parallel system: it's the optional
umbrella over the same custody table. The reconciliation the brief asked for:
**a school-linked child is one family seat when a family plan exists, and a
standalone £5 subscriber when it doesn't.** Cross-over arithmetic for the parent:
£5 × n children vs £25 family — family wins at 2+ children *plus a learning adult*,
or 5+ children; the UI can surface this honestly at the second child (§6 F1).

---

## 1. The flow — real screens

**Entry point unchanged:** the teacher's existing class link
(`/with/{student_join_code}`) — a capability link, carries no identity, safe to
photocopy onto a paper slip (link-first doctrine). No new code type, no new mint
surface for teachers.

### Screen 1 — the class page (`WithTeacher.vue`, extended)
What exists today: teacher photo/name, class name, course, £5/mo · £50/yr toggle,
inline email OTP. **One addition — a "who is learning?" fork above the sign-in:**

> **Setting this up for your child?** Parents create and pay for the account —
> your child never needs an email. **[I'm a parent]** (default for school classes)
> **[I'm the learner]** (the existing flow, unchanged — teens/adults with their own
> email keep working; flexibility > restrictions, the parent path is the offered
> default, never a gate).

### Screen 2 — parent signs in
The existing inline OTP, on the **parent's** email. Creates the payer account or
reuses an existing one (same email = same account = same family page — this is where
"one parent email covers multiple children" lands for free).

### Screen 3 — choose or create the child
A profile picker, populated from the parent's live `family_members` child rows:

> **Who's joining Year 5 Spanish?**
> ○ Ffion (existing profile) ○ Dylan (existing) ● **+ Add a child**

"Add a child" = the family plan's `POST /api/family/create-child` verbatim: first
name only → synthetic auth user (`fam-<uuid>@members.saysomethingin.app`,
`email_confirm: true`), `learners` row, custody row `is_child_account: true`. If the
parent has no family plan and no children yet, this same call creates their first
custody rows — the table works without a subscription (§0). Seat cap (6 incl. payer)
is only enforced when a family plan is live; custody-only households are uncapped
(they pay per child).

### Screen 4 — pay
The existing Paddle inline checkout, with two deltas:

- `customData.supabase_user_id` = **the child's auth uid**, not the signed-in
  parent's — the subscription row must land on the child's `learner_id` (the learner
  who is entitled). Parent's email is the Paddle customer (she pays, she gets the
  receipts, she owns the portal).
- `logEmailMismatch` will fire on every child purchase (customer email ≠ child's
  synthetic email) — annotate it as *expected* for `is_child_account` learners so
  the audit log stays readable.

Webhook: **zero structural change.** `student_via_teacher` already resolves the
learner from `supabase_user_id`, re-derives the £5 tier from `class.school_id`
server-side, writes the `'SSi Student Access'` row (rank 1 — correctly below
Family), tags `CLASS:{id}`, enrols the course. School-class commission is already
nil (`locked_price_pence !== 1000` gate) so no attribution questions arise.

**Already-covered child** (family plan, or an existing £5 sub joining a second
class): the `hasActiveSubscription()` guard runs against the **child's** session
token — since the child's device session may not exist yet at purchase time, this
check moves server-side: a small `GET /api/subscription?for=<child_learner_id>`
owner-scoped variant, or fold into the family endpoints. Covered → skip checkout,
do the idempotent tag + enrol (the existing `linkLearnerToClass()` shape), straight
to Screen 5. **Free-tier course** (non-Big-10): existing `joinFree()` path, still no
checkout — the parent step still runs, because the account-creation consent is the
point, not the payment.

### Screen 5 — put it on the child's device
The family plan's QR moment, verbatim: one-time sign-in link rendered as link + QR;
parent scans it on the child's device once; the Supabase refresh token keeps the
child signed in indefinitely. Plus the confirmation: *"Dylan is in Year 5 Spanish —
Mrs Evans will see him on her roster."* Lost device later → parent re-mints from the
family page (`POST /api/family/signin-link`, owner-only). Support never touches it.

### What the teacher sees
Dylan appears on the class roster (the existing `CLASS:` tag read) by display name,
same as any student. Nothing on the teacher surface changes.

---

## 2. Child access day-to-day (the hardest flow)

The family plan already answers the core question — **a child's access is a
long-lived device session minted by the parent, never an email or password.** Extend
minimally, three situations:

**(a) The child's own device (default, covers most of it).** Screen 5's QR →
persistent session. Nothing more to build. Re-mint on device loss is the recovery
story, and it's already specced.

**(b) Shared family device (the household iPad).** The family plan's §5 prerequisite
(learner-scoped offline leases, keyed per auth user) already assumes multiple users
on one device — the entitlement layer is ready. What's missing is the switching
gesture. **Recommendation: a device-local profile switcher.** The client stores one
Supabase session per signed-in profile (refresh tokens in IndexedDB, keyed by auth
user id); a profile row (first names + avatars) appears at launch when >1 session is
stored; tapping a child switches sessions locally — no network, no OTP. Two rules:

- **Switching TO the parent's profile always re-authenticates** (OTP, or biometric
  where the platform gives it free) — the parent profile holds payment and family
  controls; a child must never wander into it.
- **A child profile may carry an optional 4-digit PIN, set by the parent** — for
  sibling-proofing, off by default. Not a security boundary (siblings share a
  device; the real boundary is the parent profile), just a squabble-reducer.

Each profile is a full, separate auth session, so RLS own-row, progress, offline
leases, and analytics all just work — the switcher is UI over sessions, zero server
surface.

**(c) School devices.** Two honest sub-cases:
- *A device assigned to the child* (1:1 iPad schemes): the parent QR works there
  too — print the QR on the welcome slip or let the parent forward the link; the
  session persists per device exactly like (a).
- *Shared class sets* (30 iPads, any child on any device): this genuinely needs a
  different gesture (roster-pick + per-child PIN under a teacher-unlocked class
  session, most likely) — but it's a new authentication surface with its own
  safeguarding review, and no school is asking for it yet. **Deliberately deferred**
  (no signal before its consumer); logged as fork F2. Until then the class-set
  answer is the profile switcher from (b) — a teacher can have several children's
  sessions on one device — accepting that in-classroom switching is teacher-mediated.

---

## 3. Identity model — what the schema already says

**Confirmed against the live schema:** two learners **cannot** share one
`user_id` — `learners_user_id_key UNIQUE (user_id)` — and the entire spine assumes
1:1 (`current_learner_id()` is a single-row bridge; own-row RLS on 17+ learner-data
tables; `subscriptions UNIQUE(learner_id)`; the new `6ebc1780` unique indexes on
`schools.admin_user_id` / `govt_admins.user_id` are the same 1:1 doctrine applied to
the org tables). Making several learners literally share the parent's auth uid would
break all of it.

**The reconciliation — custody, not shared uid.** The owner's model ("one auth
account, multiple child learner profiles") is delivered at the *product* level by
the family plan's already-live structure:

```
parent auth user (real email — the only login a human types)
  └─ parent learners row  (payer; owner_learner_id in family_members)
       ├─ child A: own auth user (synthetic email) + own learners row
       │            custody: family_members(is_child_account: true)
       └─ child B: same shape
```

- **User ID as the identifier, email as mere login — exactly as the owner ruled:**
  each child's `learner_id` is their permanent identity; their synthetic email is
  never seen by anyone and never used as an identifier; the parent's email is a
  login credential for the *parent's* account only.
- **Schema delta: none.** `family_members` (live), `create-child`, `signin-link`
  (specced, unbuilt) cover it. This flow becomes the second consumer of the family
  endpoints — build them once, on the family-plan build plan's existing PR 5 slot.
- **Naming rationalisation respected:** custody columns are `learner_id`-keyed; auth
  uid appears nowhere in the table.
- **"Do NOT merge learners" respected:** a child who later gets a real email (§5,
  turning 16) keeps the *same* learner row — the auth user's email is updated in
  place; nothing merges, nothing migrates.

**One clarification to write into the family spec when endpoints are built:** a
`family_members` owner does not need an `'SSi Family'` subscription for custody rows
to exist — the table is the household registry; the plan is one thing that can sit
on top of it. (The resolver already enforces this distinction; it just needs saying.)

---

## 4. Safeguarding

**Parent-email-as-consent is the deliberate design, stated plainly:** the parent
performs every account-creation step with their own verified email; the child enters
nothing — no email, no password, no birthday. This is the age-verification sidestep
the family plan established, preserved religiously: the account's only PII is a
first name, and the contactable human is always the payer.

**Who sees what:**

| Viewer | Sees | Never sees |
|---|---|---|
| Teacher | child's display name on roster, progress in class scope | parent's email/contact, child's (synthetic) email, billing |
| School admin | same, school scope | same |
| Region leader | aggregates only, per region-tier §4 (per-learner only behind the school's consent toggle) | any parent contact, ever |
| Parent | own children's progress (family page), billing | other children in the class |
| SSi | billing + parent contact (support, dunning) | — |

Parent contact lives in exactly one place: the Paddle customer + the parent's auth
email. It is never denormalised onto the child, the class, or the school — so no
schools surface can leak it, structurally.

**Sign-in links are owner-mintable only** (`/api/family/signin-link`, owner-only,
child-accounts-only — already specced). Teachers and school admins cannot mint a
child's session; if a school needs device recovery, it goes through the parent.
One-time links expire; a leaked slip QR is a bounded risk the re-mint revokes.

---

## 5. Edge cases

- **Kids in two different schools:** already free. Children are independent
  learners; classes are per-child `CLASS:` tags; nothing keys the parent to a
  school. One parent, three kids, three schools — three custody rows, three tags.
- **One child in two classes / a second school:** the child's single £5
  `'SSi Student Access'` sub is learner-level, not class-level — second join takes
  the already-covered path (tag + enrol, no second checkout). One child never pays
  twice. (School commission is nil, so no attribution conflict.)
- **Separated parents (two payers, one child?):** one child = one learner = **at
  most one live custody row** (`family_members_one_family` unique index — already
  live). The payer is whoever holds the custody row; handover = remove + re-add
  (both are stamps, the learner row and all progress are untouched — the family
  spec's removal semantics make transfer lossless and instant). The £5 sub is one
  Paddle relationship, so "both parents pay half" is not a system state — one pays,
  the other can take over cleanly. A hostile non-release goes to support
  (ssi_admin re-parents the custody row); don't build shared custody.
- **Child turns 16/18 — graduation:** parent taps *"give Dylan his own login"* →
  Dylan verifies a real email by OTP → the auth user's email is updated from the
  synthetic address to the real one (admin API, server-side). Same auth uid, same
  `learner_id`, every belt and streak intact; the custody row can then be removed
  (or kept — a 16-year-old can stay a family seat). If he later buys his own
  Premium, that's the family spec's story (d), unchanged.
- **Parent email changes:** email is mere login — the parent updates their auth
  email (existing OTP-verified account flow). `user_id` unchanged; custody,
  billing, children: nothing moves. This is the owner's identity instinct paying
  rent.
- **Subscription lapses mid-term:** **the child is never ejected from the roster.**
  The `CLASS:` tag and enrolment are untouched; the webhook marks the child's sub
  `past_due`; the child drops to the free tier (free belts keep playing, downloaded
  premium content plays out its offline-lease days, then locks softly). The teacher
  still sees the child in the class — a quiet "access paused" state on the roster
  row is acceptable, a removal is not. Parent fixes the card in the Paddle portal →
  next webhook event restores everything. Identical shape to the family plan's
  lapse story and the flexibility doctrine: degrade access, never structure.
- **Parent already has a family plan when the class link arrives:** Screen 4 is
  skipped automatically (child is covered by the resolver); the join is tag + enrol
  only. The £25 already bought this.

---

## 6. Open taste-forks — RESOLVED (owner, 2026-07-13)

**F1 — RESOLVED: seats, honestly priced.** A school-linked child counts as an
ordinary family-plan seat. One custody primitive, one cap; a family of
school-kids-only being cheaper on £5 subs is honest pricing, not a leak.

**F2 — DISSOLVED, not deferred: there is NO in-school individual learning.**
Owner's ruling: all in-school activity is "play as class" — the teacher's
session, the class as the unit. Children never sign in individually on school
hardware at all; the parent-owned individual account lives entirely in the home
context. This deletes the shared-device safeguarding surface rather than
deferring it, and draws the product boundary cleanly: **school = collective
play under the teacher's session; home = individual learning under the
parent's custody.** Any future request for individual in-school sign-in is a
new product decision, not a deferred design.

Original fork analysis kept below for the record.

**F1 (original) — Seats vs stacking: does a school-linked child count against the family
plan's 6 seats?** My recommendation: **yes — a seat is a seat.** One custody
primitive, one cap, no special child classes; a family-covered child never needs
the £5 sub (resolver rank 4 > 1), and the "already covered — you can cancel the £5"
nudge mirrors the spec's member-with-own-Premium pattern. The commercial wrinkle
worth your eye: a household of 3-4 school children with no learning adult is
*cheaper* on per-child £5 subs (£15-20) than the family plan (£25) — under my
recommendation that's fine and honest (family wins on adults + mixed households,
which is its actual audience), but if you want family to *always* dominate,
school-linked children would have to ride outside the seat count, which splits the
primitive. **Rec: seats, honestly priced.** *Agree / ride outside?*

**F2 — Shared class-set devices (30 iPads, any child on any):** deferred in this
design (§2c) — the parent-QR + profile-switcher covers 1:1 and household devices,
and a roster-pick classroom sign-in is a new safeguarding surface with no requesting
school yet. *OK to defer / design now?*

---

## Build shape (for sequencing, not a plan)

Nearly everything rides on work already queued: the family-plan endpoints (its PR 5)
and the learner-scoped offline lease (its PR 1) are the prerequisites; this flow
then adds the `WithTeacher.vue` parent fork + profile picker (client), the
child-uid checkout delta + expected-mismatch annotation (webhook, ~10 lines), the
covered-child server check, and the profile switcher (client-only). The teacher,
roster, invite-code, and pricing surfaces change **not at all**.
