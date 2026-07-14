# Group commercial model — how we control the commerciality of group access

*Think-piece — 2026-07-14. First articulation, built from the owner's raw framing and a read of
`region-tier-design.md`, `api/_utils/schoolPlatformTrial.ts`, `api/code/redeem.ts`,
`api/entitlement/grant.ts`, `docs/methodology/flexible-grouping.md`, the capacity-caps
WORKLIST item, and `build-plan-2026-06-16.md` §A (schools billing). This is a forming design,
not a polished whitepaper — argue with it.*

**The owner's frame, kept intact:** groups are the commercial container. Control lands on
(a) sub-groups, if they're a thing at all, and (b) number of schools — relatively fixed, set
by us. Standard pricing, **no scale benefits** — the product is already very cheap AND every
additional school has genuine marginal cost to us (bandwidth, server, DB — we stream a lot of
audio). x per school per region; 10 schools = 10x. Regional bands (charge the Middle East
more than Sri Lanka). School trials: 30 days, one language, unlimited teacher/class minting —
play-as-class is the model. Students always paid, no trial. Individual free trials are dead:
White + Yellow free on ALL courses, paywall at Orange on Big-10.

---

## 0. The one-paragraph shape

The commercial contract lives on the **group row** — three or four columns, set by SSi at
contract time, never client-writable: `school_cap`, `price_band`, and a trial policy. Price
is arithmetic, not machinery: `price(band) × school_cap`. Language access stays where it
already lives, in `entitlement_grants` targeted at the group — the cascade already exists and
already inherits heritage-style to every current and future school in the subtree. Trial
state stays where IT already lives, on the `schools` row (`platform_status`,
`trial_course_code`, `platform_expires_at`) — per-school clocks, exactly as the owner
suspects ("could differ per school, likely same"). Enforcement bites at the two places
schools are born (redeem.ts's school_admin branch + the slice-2 leader create-school
endpoint) and at the content gate that already exists (`gateSeed()`); **nothing new is built
at the student/teacher/class layer because those are deliberately uncapped**. Sub-groups
never carry billing. The whole model is columns + checks on existing choke points — no new
tables except possibly a tiny `price_bands` config table, and even that can start as a
constant.

---

## 1. The entitlement object: where does the contract live?

Three candidate homes were on the table:

1. **A new `group_contracts` table.** Rejected outright — a second parallel system next to
   `entitlement_grants` and the `schools.platform_*` columns, three sources of commercial
   truth instead of one-per-concern. Fails Simpler catastrophically.
2. **Everything into `entitlement_grants`.** Tempting because it already targets groups and
   already cascades. But `entitlement_grants` answers exactly one question — *which courses
   can this subtree play* — and it's good at it (one active grant per target, ssi_admin-set,
   `granted_courses[]`, `expires_at`). `school_cap` and `price_band` are not course access;
   they're facts about the group **as a customer**. Stuffing them in makes the grant row a
   junk drawer and breaks the one-target-one-grant upsert shape in `api/entitlement/grant.ts`.
3. **Columns on `groups` + reuse `entitlement_grants` for language + reuse `schools.platform_*`
   for trial clocks. ← This one.**

So the contract is **split by concern, each concern in the object that already owns it**:

| Concern | Lives on | Why there |
|---|---|---|
| How many schools the plan covers | `groups.school_cap int` (null = uncapped, e.g. a signed national deal) | The cap is a fact about the contract-holding node; checked against a live `count(schools where group_id in subtree)` |
| What they pay per school | `groups.price_band text` (e.g. 'A'/'B'/'C', set by SSi at group creation) | Band is a property of the customer's region, decided by us, once |
| Which languages the deal covers | `entitlement_grants` row with `group_id` = the group | **Zero new machinery.** The cascade + heritage inheritance already exist; a new school added in 2027 inherits the grant the day it's born |
| Trial state | `schools.platform_status / trial_course_code / trial_kind / platform_expires_at` (all live today) | Trials are per-school clocks — the owner's own instinct — and the columns, the burn ledger, and the fail-open provisioning already exist in `schoolPlatformTrial.ts` |

The BSC narrative: **Better** — every question ("can they add a school?", "can this class
play French?", "is this school still in trial?") has exactly one place to look. **Simpler** —
zero new tables in the core shape; two or three columns on `groups`; the language mechanism
and the trial mechanism are the existing ones, untouched. **Cheaper** — the enforcement
checks are one count-query and one column-read at choke points that already exist; nothing
runs per-play.

One deliberate asymmetry to name: `entitlement_grants.granted_courses` is the *deal's*
language list ("this authority bought Welsh + Spanish"), while `schools.trial_course_code`
is the *trial's* single-language lock. Same concept-family, different lifetimes — don't
merge them. When a group converts from trial to paid, the grant row is written and the
per-school trial columns flip to `platform_status='active'`; the grant is the paid truth.

## 2. Enforcement points: where each limit bites

The design invariant from the capacity-caps WORKLIST item holds: **every join flows through
`api/code/redeem.ts`, and school birth has exactly two doors** (invite redemption + the
coming leader create-school endpoint). So enforcement is a handful of checks at doors that
already exist — never a background job, never a client-side guess.

| Limit | Bites at | Check | What the person sees |
|---|---|---|---|
| `school_cap` | School birth: redeem.ts `school_admin` branch, AND the slice-2 leader create-school endpoint | `count(schools in group subtree) >= school_cap` → refuse the *birth*, not the code | Leader, at mint AND at the redeemer's landing: **"You've reached the 10 schools your plan covers — add more schools to your plan"** with the contact/upgrade path. Never an error tone; the plan is working as bought |
| Language scope (paid) | Course selection + `gateSeed()` — the existing entitlement resolution | School's playable courses = union of grants up the hierarchy (exists) | Course picker simply shows what the deal covers; other courses show White+Yellow free like everywhere else, then the standard paywall |
| Trial single-language | Already enforced: `trial_course_code` read by the dashboard's course logic | Existing | "Your trial covers Spanish — 23 days left" |
| Trial expiry | The existing platform gate (`platform_expires_at`) | Existing | Decision #4 below — hard stop vs read-only vs grace is Tom's call, not a mechanism question |
| Students always paid | Checkout, exactly as today (£5 school-linked price, server-re-derived) | Existing | Nothing new — student joins redeem a class code and pay; the trial never touches them because trial usage is play-as-class on the teacher's account |
| Orange+ paywall on Big-10 | `gateSeed()` at seed 19 (`PREMIUM_PREVIEW_MAX_SEED`) — live today | Existing | The current in-player upgrade moment |

Two things deliberately have **no enforcement point**:

- **Teacher count and class count — uncapped, forever, both in trial and paid.** The owner's
  model is per-school pricing precisely so we never police teachers. This also quietly
  deletes a problem the self-serve tier has (the "seat-count drift" risk in the build plan —
  teacher N+1 beyond paid seats going unbilled). In the group tier there are no seats to
  drift. Worth its own decision line (#6): group pricing is per-school-flat while self-serve
  is £15/teacher — two models on one object, and the group one is simpler.
- **Mint-time caps on invite codes.** `max_uses` stays what it is (leader school-invites are
  one-shot already). The commercial cap is per-container (live school count vs `school_cap`),
  checked at birth — because that's the number that maps to the contract. A mint-time warning
  ("this would be school 11 of 10") is nice UX, but the *enforcement* is at birth, so a
  hoarded pile of unredeemed links can never oversell the cap.

One subtlety: the cap check at redemption must count **after** winning the school-insert
race, or two simultaneous redemptions at cap-1 both pass. Cheapest honest version: check
before insert for the friendly refusal, re-check after insert and roll back the attach if
over — or just accept the ±1 race as commercial noise. Recommend accepting it; a cap is a
plan boundary, not a security boundary.

## 3. Sub-groups: organisational lens, never a commercial object

The honest answer to "if they're a thing at all": **they already exist twice, and neither
occurrence should carry billing.**

- The `groups` path-tree supports arbitrary depth today, and `region-tier-design.md` §3
  already settled the product stance: depth is an **ssi_admin capability, not a leader
  capability** — when a national deal genuinely needs nation→region→school, we nest nodes in
  the admin tool and `resolveVisibleScope` handles it for free.
- `flexible-grouping.md` settled the other half: the ways a customer *actually* wants to cut
  their estate (year, department, district-within-authority, intervention cohort) are
  **overlapping memberships — tags, not tree positions** — because a school or class is
  legitimately in several cuts at once. That layer is read-only roll-up scope.

Testing the owner's suspicion that sub-groups should never carry billing: imagine the one
case where it seems attractive — a sub-region inside a national group wants its own budget
line. Even there, the clean move is that the sub-region becomes **its own contract node**: a
sibling top-level group with its own `school_cap` and `price_band`, its schools re-parented
once by ssi_admin. Billing on interior nodes would mean cap arithmetic has to resolve *which
ancestor's cap* a new school consumes, invoices have to split along tree edges, and the
adoption/re-parent flows all become money-moving operations. That's an org-chart product —
exactly what region-tier-design §3 refused to become. The rule, stated once:

> **Billing attaches to exactly one node: the group the contract names. Everything below it
> is lens.** The invariant is checkable: `school_cap`/`price_band` non-null ⇒ `parent_id`
> is null (or at least: no ancestor also has them). Interior structure — whether path-tree
> nesting or grouping tags — is visibility and roll-up, never money.

Suspicion confirmed. And it means sub-groups need **zero build** in this model: the tree
depth already exists for the admin, the tag layer has its own consumer-first plan, and
neither touches the contract columns.

## 4. Price model: flat x per school, banded by region

The owner's position, kept as stated: **no volume discount, ever.** The rationale is real
and worth writing into the doc because it's the answer to every future procurement
negotiation: the product is already priced very cheap, and each school carries genuine
marginal cost — audio streaming is bandwidth we pay for per-school, per-class, per-day.
There is no fixed-cost pool to amortise; school 40 costs us what school 4 costs us. So
10 schools = 10x, 100 schools = 100x.

Mechanism — the object model, not the ops detail:

- `groups.price_band` — a short code set by SSi at group creation. Never client-writable,
  never derived from geography lookups at runtime; it's a **human decision made once at
  contract time**, which is also how it stays honest when a group spans borders or a deal
  warrants an off-band price.
- A band resolves to a per-school price via config — start as a constant map in one server
  file (or a tiny `price_bands` table when ops wants to edit without a deploy; either passes
  BSC, the table earns itself only when someone other than us edits prices). Currency and
  invoicing rails are deliberately out of scope here.
- **The invoice is `price(band) × school_cap`, not × live school count.** Recommended, not
  assumed — decision #3. Cap-based means the group buys a plan ("10 schools"), the number on
  the invoice never surprises anyone mid-term, and under-use is their headroom. Metered
  (× live count) is fairer-feeling but makes every adoption/creation/deletion a billing
  event and demands proration machinery. Cap-based deletes all of that: money changes only
  when the contract changes.
- Same-region assumption: a group's schools share the group's band. If a genuine cross-region
  group ever appears (a chain with schools in two bands), it's two contract nodes — same
  move as sub-group billing, and for the same reason.

BSC: **Better** — pricing a procurement officer can compute in their head, and a no-discount
story backed by honest marginal cost. **Simpler** — two columns and a multiplication; no
seat tracking, no metering, no proration. **Cheaper** — nothing runs at runtime; the price
exists only at contract-write and invoice time.

## 5. Trials — and the conflict that is decision #1

The owner's policy: for English or any Big-10 language, **30 days free, that one language
only** (per-school clocks, likely set the same across a group). During trial: **unlimited
teacher accounts, unlimited classes** — play-as-class is the model, so a whole school can
genuinely evaluate on teacher accounts alone. **Student accounts are always paid, no trial**
— coherent precisely because play-as-class means the trial never needs student accounts;
individual pupils logging in is the thing the school pays for. Individual consumer free
trials are dead, replaced by the standing free tier: **White + Yellow belts free on ALL
courses, paywall at Orange for Big-10** — which is already what `PREMIUM_PREVIEW_MAX_SEED`
(seed 19, end of Yellow) enforces in `gateSeed()`. So the consumer side needs a copy/config
audit, not a build.

The good news: the trial machinery the policy needs **already exists and already has the
right shape**. `schoolPlatformTrial.ts` has per-school clocks (`platform_expires_at`), a
single-language lock (`trial_course_code`), a premium-vs-free track split
(`premium_1mo` = 30 days vs `free_1yr` = 365), and an email-burn ledger (`trial_burns`)
that stops trial farming. The owner's "30 days, one language" IS the premium track with the
course lock set. Unlimited teacher/class minting during trial is already true — nothing
gates those counts today, and per §2 nothing ever will.

**But the live code contradicts the policy at the group tier's front door.** When a school
is born via invite redemption — which is exactly how every group school is born —
`redeem.ts` calls `provisionSchoolPlatformTrial(supabase, email, schoolId, null, true)`:
**a 365-day trial with NO course lock**, because no course has been chosen at redemption
time and the code deliberately grants the generous no-lock window until the admin picks one
(the comment block at redeem.ts:418-430 documents the reasoning — avoiding a second OTP
journey). Under the new policy a group school evaluating Spanish should get 30 days of
Spanish, not a year of everything. This is not a bug to silently fix — the current behaviour
was a deliberate design choice for a different tier — so it's **decision #1** below, with
the reconciliation options laid out there. My recommendation: **the clock starts when the
language is chosen.** Redemption grants a short no-lock browsing window (say 7 days, enough
to look around and pick), and the moment the admin commits to a course the real trial is
written: 30 days + `trial_course_code` for Big-10, 365 days for minority languages. That
keeps the no-second-OTP flow, keeps the burn ledger keyed once, matches the owner's "just
that one language", and makes the trial clock start when evaluation actually starts —
which is more generous in spirit and tighter in scope simultaneously.

Also inherited unchanged: the burn ledger's one-trial-per-email-per-track rule, the
fail-open posture pre-migration, and the 365-day free track for minority-language schools
(the owner's statement is about Big-10; nothing said kills the minority-language year, and
the mission says keep it).

## 6. Decisions for Tom — the shortest honest list

Everything above is buildable without a ruling except these. One line each; (a)/(b)/(c)
answers suffice.

1. **The redemption-trial conflict.** Invite-born schools today get 365 days, no course
   lock. Under the group policy: (a) clock starts at course-pick — short no-lock browse
   window at redemption, then 30d/single-language on commit ← my recommendation; (b) 30-day
   clock starts at redemption, no lock until pick; (c) keep 1yr no-lock for group schools.
2. **x** — the per-school monthly/annual price, per band. And how many bands (suggest 3:
   e.g. Gulf/EU-UK/global-south — names for the object model only, the list is yours).
3. **Invoice basis** — `x × school_cap` (buy a plan, recommended) vs `x × live school count`
   (metered, needs proration).
4. **Trial end** — hard stop, read-only dashboards, or N-day grace? (Recommend read-only:
   data stays visible, play stops — the renewal conversation stays warm.)
5. **Default `school_cap`** for a new group before a contract is signed (suggest a small
   number like 3 — enough to pilot, the cap message is the sales moment).
6. **Pricing-model coexistence** — group schools at flat x/school while self-serve schools
   pay £15/teacher: confirmed as two deliberate tiers, or should group pricing eventually
   subsume self-serve? (No build hangs on this today; it shapes the Paddle work later.)
7. **Student price under a group** — does the £5 school-linked student price stand for
   group schools, or is per-student pricing part of the group contract (x covers dashboards,
   students still £5 each)? The code today would charge £5; confirm that's the intent.

## 7. BSC on the whole shape

**Better:** one place per question; a price a buyer computes in their head; a trial that
matches how schools actually evaluate (whole-staff, one language, play-as-class); the cap
message is a sales moment, not an error. **Simpler:** the design *deletes* concerns — no
seat tracking for the group tier, no metering, no sub-group billing arithmetic, no new
tables in the core shape; the invite economy, the entitlement cascade, the trial machinery
and the content gate are all reused as-is. **Cheaper:** enforcement is a count and a
column-read at existing choke points; nothing new runs per-play, and the marginal-cost
pricing story means growth never eats the margin. The one smell watched for — a parallel
contract system — is exactly what §1 refused; the contract is columns on `groups`, and
`entitlement_grants` stays the single language-access mechanism.

*Nothing in this doc is implementation. Build order, when the rulings land: contract
columns + cap check at the two birth doors (small), trial re-keying per decision #1
(medium — touches redeem.ts and the course-commit moment), invoice rails (later, with
Paddle work).*
