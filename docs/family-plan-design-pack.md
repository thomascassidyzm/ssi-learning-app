# FAMILY PLAN — Design Pack

*2026-07-29. Founder-commissioned. Design only — no implementation in this pass. Reads cold for a
build worker and for Tom. Companion source documents: `FAMILY-PLAN-SPEC.md` (repo root, 2026-07-10),
`docs/schools/group-commercial-model.md`, `docs/commercial-model.md`.*

**The ruling (Tom, 2026-07-29, honoured throughout — not relitigated):** pricing becomes TWO
products. £15/mo = one learner, all languages, all premium courses. £25/mo = FAMILY — a family IS a
group in the tutor/freelance shape (NOT the schools shape — no play-as-class): one pay point (the
group admin / parent / payer), each member a full learner identity accessing everything as normal,
the payer can see all members' access, all members get all languages. Default cap 6 members
(adjustable constant, not sacred). Positioning: **"Bring the language home"** — intergenerational
language transmission as product; each member is their own VAD instrument.

---

## 0. The headline finding: this is already built

The reuse audit (§1) was commissioned expecting "mostly a billing wrapper + warmer skin" over the
group/tutor machinery. The truth is better than that expectation:

**A complete family plan matching this ruling was specced, founder-confirmed, and BUILT in July —
and never merged.** `FAMILY-PLAN-SPEC.md` (2026-07-10) is the same product: £25/mo, single payer,
6 seats including the payer (Tom confirmed D1/D2 on 2026-07-10), full independent learner
identities, gentle lapse, magic-grade joining. The implementation lives on the unmerged branch
**`origin/impl/family-plan`** — ~2,900 lines including tests: the `family_members` table (already
applied to the live DB — the account-delete work on dev has an FK dependency on it, proving it's
live), the Paddle webhook `family_plan` kind, the effective-subscription resolver, six
`/api/family/*` membership endpoints, the sign-in claim fold-in, and the Settings → Family UI with
QR child sign-in. The learner-scoped offline-lease prerequisite (spec §5) is the one piece that DID
merge, shipped to dev and promoted 2026-07-11.

**What "family IS a group (tutor shape)" means against that build — the altitude call this pack
makes:** the ruling names the *shape*, and the built family plan IS that shape: one admin who pays,
a member roster the admin manages, invite flows, members as full independent learners, admin
visibility, no play-as-class, no org tree. The July spec explicitly scored and rejected implementing
it on the schools-world tables (`groups`/`user_tags` — auth-uid TEXT keys, org-tree semantics, the
world Tom ruled stays separate), and that reasoning still holds: `family_members` is the
tutor-shaped group, purpose-built, learner-id keyed, service-role-only. Re-platforming onto the
`groups` table would add concepts, add drift risk, and delete a working build — a near-zero on
Simpler and Cheaper with no Better to buy it. So the pack's recommendation is:

> **Rebase and land `impl/family-plan`, then build the two genuinely new pieces this ruling adds:
> payer visibility of member activity (§3) and the two-product pricing surface/copy (§5), plus the
> legacy-tier cleanup (§4).**

What changed between the July spec and today's ruling — the delta this pack covers:

| July build had | Today's ruling adds | Where covered |
|---|---|---|
| Payer sees member list + seat usage + invite status | Payer sees members' **access/activity level** ("who's used it lately") | §3 — small endpoint extension |
| Family alongside the multi-tier price list | **Two products only** — £15 / £25; legacy consumer tiers removed | §4, §5 |
| Paywall option + Settings page | **"Bring the language home"** landing framing | §5 |
| — | Member cap as adjustable constant | already true: `FAMILY_SEAT_CAP = 6` in `api/_utils/familyMembership.ts` |

---

## 1. Reuse audit — what exists, what adapts, what's new

*Worker pass, 2026-07-29 (full archaeology in the `family-reuse-audit` worker session). Branch:
`origin/impl/family-plan`, 9 commits, all authored 2026-07-10, forked from dev at `149a8c27`,
never merged. 37 files, +2,924/−105.*

### 1.1 Two facts that shrink the remaining work

1. **Spec-§6 PR #1 (learner-scoped offline lease) is already shipped.** Dev commit `90193f53` is
   byte-identical to the branch's version (`useOfflineLease.ts`, `useScriptCache.ts`, `App.vue`,
   and the 9-case lease test all hash-equal), and it's been promoted to staging (`eb7d59e0`).
   Nothing to reapply.
2. **Spec-§6 PR #2 (the `family_members` table) is already live in the shared DB** — hand-applied
   on 2026-07-10 during branch authoring (grant-hygiene decision journaled in `docs/DECISIONS.md`,
   2026-07-10: applied live + REVOKE of the grant-open default), picked up by dev's routine schema
   snapshot `fc502ee8` on 2026-07-13. **No migration file exists on any branch** — the table is
   live but unrecorded in `supabase/migrations/`. Verify-only at build time, plus one hygiene
   item: commit a retroactive migration file marked already-applied (the 20260704 gated-migrations
   pattern — "do not re-apply") so the migrations dir tells the truth.

So of the spec's six PRs, #1 and #2 are done; the remaining work is #3–#6 (webhook, resolver,
endpoints, UI) — all complete on the branch, none landed anywhere.

### 1.2 Branch inventory (verdict per piece)

| Piece | Files | Tests | Verdict |
|---|---|---|---|
| Effective-subscription resolver | `api/_utils/familyAccess.ts` (+114) | 12 cases | **still-good** |
| Membership helpers (`FAMILY_SEAT_CAP = 6`, seat counting, invite-attach) | `api/_utils/familyMembership.ts` (+128) | 9 cases | **still-good** |
| Six endpoints: `GET /api/family`, `invite`, `create-child`, `signin-link`, `remove`, `leave` | `api/family/*` (+564) | 11 cases (seat cap, dup invite, cross-family steal, owner-email reject, claim idempotency) | **still-good** |
| Claim fold-in (invite attaches at normal OTP sign-in) | `api/access/claim.ts` (+20) | 3 cases | **still-good, zero drift** |
| Resolver wired into the four entitlement readers | `courseAccess.ts`, `subscription/index.ts` (virtual `'SSi Family (member)'` plan name), `me/subscription.ts`, `entitlement/offline-lease.ts` | existing suites | **still-good**; offline-lease needs a careful (not blind) reapply — see drift |
| Webhook: tier `'family'`, `PLAN_PRECEDENCE['SSi Family'] = 4` (top), `handleFamilySubscription`, spoof guard | `api/teacher/paddle-webhook.ts` (+114) | 7 new + 3 precedence cases (incl. tutor-buys-family) | **still-good**, clean 3-way merge |
| Client: checkout plan option, overlay title, price-id env config | `useCheckout.ts`, `CheckoutOverlay.vue`, `lib/paddle.ts` | — | **still-good, zero drift**; price ids deliberately env-only until Tom creates the Paddle product |
| Settings → Family UI + QR child sign-in | `FamilyManagementModal.vue` (+257), `useFamilyManagement.ts` (+161), `SettingsScreen.vue` | — | **still-good** — dev's later SettingsScreen rewrite touches disjoint regions; auto-merges clean |
| Offline-lease client work | `useScriptCache.ts` etc. | 9 cases | **superseded — already on dev** |
| Deps (`qrcode`, `@types/qrcode`) + lockfile | `package.json`, `pnpm-lock.yaml` | — | deps fine; **regenerate the lockfile**, don't reapply |

51 real, specific test cases across 6 new test files — not placeholder coverage.

### 1.3 Drift assessment (dev moved ~19 days)

`git merge-tree` across all 37 files: **zero conflict markers** — everything auto-merges. Three
spots need eyes rather than a blind rebase:

| File | Dev's change since fork | Action |
|---|---|---|
| `api/entitlement/offline-lease.ts` | Write-failure now throws (fail-closed, 07-13 audit) adjacent to where the resolver read lands | Reapply carefully; re-verify the fail-closed path composes with the family branch |
| `api/_utils/audioAccess.ts` | `ENTITLEMENT_TOKEN_SECRET` rework removed the line the branch's forward-pointing comment anchored to | Re-anchor the comment (cosmetic) |
| `packages/player-vue/package.json` | vitest `^1` → `^3`, lint now real `eslint .` | Re-run the branch's 51 tests under vitest 3 and the real lint gate; expect minor churn, not rewrites |

### 1.4 The tutor/freelance machinery — why it's the shape, not the substrate

The ruling's "tutor/freelance group shape" maps onto the family build concept-for-concept — and
the code audit confirms literal reuse of the schools/tutor tables would be a downgrade:

| Tutor-world concept | Family equivalent | Reuse verdict |
|---|---|---|
| One admin who pays (tutor's own Paddle sub, `teachers.platform_status`) | Payer's single `subscriptions` row, `plan_name='SSi Family'` | **shape reused, substrate not** — same one-payer-one-row pattern |
| Member roster (class membership via `user_tags`, auth-uid TEXT keys) | `family_members` (learner-id UUID keys, one live family per learner enforced by partial unique index) | **not-applicable** — `user_tags` is the schools world's org fabric, auth-uid keyed, the world Tom ruled stays separate |
| Join flows (`invite_codes`, join codes, `/with/:code`) | Email invite auto-attaching at the existing sign-in claim moment + QR child accounts | **pattern reused** (the `grant-emails.ts` immediate-apply pattern), tables not — no codes for family members to type |
| Leader visibility (`resolveVisibleScope`, dashboards) | `GET /api/family` owner view (+ §3 activity extension) | **doctrine reused** (hierarchy visibility = server endpoints, service-role, RLS-on-no-policies), machinery not — a family needs one page, not a dashboard namespace |
| `groups` table (org tree, `path`, subtree rollups) | — | **not-applicable** — org-tree semantics with nothing for a household to use; a family is flat |

## 2. Billing design — single payer, one row, everything derives

*Worker pass, 2026-07-29 (full map in the `family-billing-map` worker session). Key facts of the
current dev stack the family plan rides on:*

- **One Paddle webhook** (`api/teacher/paddle-webhook.ts`, 1,405 lines) handles every subscription
  event kind. Money truth is server-side: `PRICE_CATALOG` re-derives the tier from the billed
  price id and rejects spoofed `customData` — the branch's `'family'` tier slots into exactly this
  guard. `PLAN_PRECEDENCE` (tutor bundle 3 > Premium 2 > Student 1) is the existing mechanism
  `'SSi Family': 4` extends with zero conflicts.
- **`subscriptions` is `UNIQUE(learner_id)`** — one row per learner. The family design (members
  have no row; entitlement resolves through the owner's row) is the only shape that doesn't fight
  this constraint.
- **£15 = all languages is VERIFIED in code:** `checkCourseAccess`
  (`packages/core/src/pricing/access.ts:75-85`) takes no course code on the subscribed branch —
  `isSubscribed` alone grants every premium/community course. That's also why the family resolver
  composes for free: making `isSubscribed` true via the family join needs zero changes to the
  access logic itself.
- **Refund/chargeback semantics compose:** full refund/chargeback revokes the one owner row →
  whole family off; partial/goodwill refunds fail safe toward the payer; reversed disputes
  regrant. No family-specific handling needed.
- **Checkout is inline** (`CheckoutOverlay.vue`, not Paddle's own overlay — iOS safe-area fix);
  the branch's family option reuses it unchanged.
- *(Cosmetic, noted for a rainy day: `subscriptions.provider` still defaults to
  `'lemonsqueezy'`; every write sets `'paddle'` explicitly.)*

**Rebase-risk reconciliation (the two workers disagreed; verified directly):** dev has moved 857
commits since the fork, which one pass read as merge-conflict territory. Checked at the git level:
`git merge-tree` reports **zero conflict markers**, and `git diff 149a8c27..dev` on the checkout
files (`useCheckout.ts`, `CheckoutOverlay.vue`, `lib/paddle.ts`, `api/subscription/index.ts`) is
**empty** — dev never touched them. The 857 commits are unrelated platform churn; the honest
residual risk is environmental (vitest 1→3, real lint gate) and behavioural drift caught by the
stage-1 shakedown, not textual conflicts. The 2-session stage-1 estimate stands.

### 2.1 The single-payer flow (as designed and built)

- **Subscribe:** parent taps Family on the paywall → the same inline Paddle checkout as Premium,
  `customData: { kind: 'family_plan' }` → webhook writes ONE `subscriptions` row on the payer
  (`plan_name = 'SSi Family'`, precedence rank top). No member info at purchase time; the money
  path stays dumb.
- **Invite (email path):** parent types an email on Settings → Family → `POST /api/family/invite`.
  If a learner with that verified email exists, attach immediately; otherwise it attaches
  automatically at the invitee's next normal OTP sign-in (the `/api/access/claim` fold-in — the
  member never sees the word "family", never redeems anything).
- **Invite (child path):** parent taps "add a child", types a first name → server mints an account
  on a synthetic address, returns a one-time sign-in link as QR. Scan once on the kid's device;
  signed in indefinitely. Re-mint self-serve if the device is wiped. The child never enters an
  email, password, or birthday.
- **Entitlement:** members have NO subscription row. Every entitlement check resolves "own active
  row, OR live membership in a family whose owner's row is active" via one server-side resolver.
  Lapse, refund, cancel, re-buy all compose from the owner's single row with zero fan-out writes.
- **Non-payment:** Paddle dunning retries and emails the payer; the webhook marks the one owner row
  `past_due`; all members drop gently to the free tier together (free courses + Yellow-belt preview
  keep playing; offline leases run out their remaining days rather than snapping shut; progress
  untouched). Card fixed in the Paddle portal → next webhook event → everyone premium again.
  **Grace period — the honest state and the recommendation:** as implemented today,
  `checkCourseAccess` only accepts `status === 'active'`, so content access cuts the moment the
  row flips `past_due` — Paddle's dunning keeps *billing* alive but does not keep *access* alive.
  For one learner that's tolerable; for a family, one expired card silently downgrades six people
  including children mid-streak. **Recommendation: a 7-day past_due grace, one rule for both
  products** (treat `past_due` as active for 7 days from period end, in the server-side
  subscription read — a few lines, no new state; dunning emails do the chasing). Flagged as a
  founder polish decision below.
- **Member leaves / is removed:** stamp (`removed_at`), never delete. Seat frees instantly; the
  member's account, belts, and progress remain; re-adding later is one tap.
- **Admin transfer:** deliberately NOT built at launch. It's a rare event with an easy manual
  shape: new payer subscribes at £25 (their checkout works because members have no own
  subscription row — no precedence collision), old payer cancels, members are re-invited (email
  members: one invite each, attach on next sign-in; child accounts: support-assisted re-parent, or
  the old payer removes + new payer re-mints). If real demand shows up, a one-endpoint
  `transfer-ownership` (re-point `owner_learner_id` rows) is a small, self-contained add. No signal
  before its consumer.

## 3. Payer visibility — access, not surveillance

**What the admin sees (the taste-safe default):** per member, on the existing Settings → Family
page — no new dashboard, no schools-style analytics surface:

1. **Access state** — active / invited (pending) / covered-by-own-sub note. *(Already built.)*
2. **Alive-ness** — "last practised: 3 days ago" (or "not yet started"), derived from
   `max(course_enrollments.last_practiced_at)` per member. One phrase, relative time, nothing else.
3. **What they're learning** — course names only (e.g. "Spanish, Welsh"), from live enrollments.

Deliberately NOT shown: minutes, streaks, belts, positions, session logs — adults in a family are
peers, not pupils, and each member is their own VAD instrument. A parent who wants a child's detail
sits next to the child; the app's job here is only "is the seat I'm paying for being used".

**Implementation shape:** extend `GET /api/family` (owner-only, service-role, already resolves
member display names) with a join to `course_enrollments` for `last_practiced_at` + course codes.
One endpoint change, one UI line per member row. No client-side reads of other learners' rows, no
RLS change — the schools doctrine (hierarchy visibility = server endpoints) already covers it.

**Founder polish decision (flagged, one look):** visibility depth. A = access-only (option 1
alone). B = the default above (1+2+3). C = B plus weekly minutes. **Recommendation: B.** A
under-serves "can I see it's being used"; C starts to smell like surveillance of adults and builds
a consumer for per-member metrics nothing else needs.

## 4. Migration — existing subscribers, and deleting the old tier world

### 4.1 Individual → family upgrade

**The proration question is already answered in our own code.** `api/school/update-seats.ts`
changes a live Paddle subscription's items with `paddle.subscriptions.update(subId, { items,
prorationBillingMode: 'prorated_immediately' })` — its own doc comment calls this "the ONLY
correct way" (a fresh checkout double-bills). Paddle's `subscriptions.update()` accepts *price*
changes the same way as quantity changes, and the customer portal cannot do plan changes
self-serve. So the real upgrade path is:

1. **Launch:** the payer's upgrade is a proper **price-swap endpoint** (~100 lines, modelled
   directly on `update-seats.ts`): swap the £15 price id for the £25 family price id on their
   existing subscription, `prorated_immediately`. Their `subscriptions` row then updates via the
   normal webhook (`subscription.updated` → `plan_name: 'SSi Family'`, precedence rank 4 outranks
   Premium so the upsert is clean). One tap, no double-billing, no portal walk, no cancel dance.
   *Fallback if we want zero new billing code at launch: buy Family fresh + self-cancel Premium
   via the existing portal — honest but clunkier; the endpoint is small enough that I recommend
   building it.*
2. A member who already has their own Premium: additive, no arithmetic (spec §2.4) — covered
   twice until they cancel their own sub themselves; the family page shows "has their own
   Premium". We never touch a third party's payment relationship.
3. Downgrade (family → individual) needs nothing new: cancel Family (period-end semantics), buy
   Premium — or the same price-swap endpoint run in reverse if demand appears.

### 4.2 Legacy tier removal (consumer world only)

The removal job is smaller than commissioned — the audit found **no dead consumer-facing tier
copy or code in this repo.** What looked like legacy multi-tier remnants is actually the *live*
tutor/school student-referral channel:

| Location | What it is | Verdict |
|---|---|---|
| £5/£10 student prices (`lib/paddle.ts:47-50`, `kind:'student_via_teacher'` webhook branch, `WithTeacher.vue`) | The live tutor/school channel — a student joining *via a teacher* pays the channel price | **Stays** — schools/tutor world is a separate commercial model, untouched by this ruling |
| `'SSi Student Access'` plan name | The live plan those channel subs carry | **Stays** (same reason) |
| The stale tier table in the Popty repo (`SSI_2026_EXECUTIVE_SUMMARY.md`) | Docs-only, already flagged stale in the commission | **Fix in the Popty repo** — one docs edit, noted here so it isn't lost |
| `subscriptions.provider DEFAULT 'lemonsqueezy'` | Inert pre-Paddle default; every write sets `'paddle'` | Cosmetic — fold into any future subscriptions migration, not worth its own |

Consumer-facing surfaces therefore need **copy only**: everywhere the consumer story is told, it
becomes the two-product table of §5 — the paywall, the upgrade/settings screens, and any marketing
pages. There is no entitlement code to delete, because there was never a consumer tier between
free and £15 in code.

## 5. Landing framing — "Bring the language home"

**The story (register: invitation, not mission; plain words):**

> You didn't learn Welsh so you could talk to an app. Languages live in houses — over breakfast,
> in the car, at bedtime. The Family plan is one subscription for the whole household: you, the
> kids, Mamgu. Everyone gets their own account, their own pace, their own belts — and the language
> gets what it actually needs: people who share a roof, sharing words.

**The two-product pricing table (the entire consumer price list):**

| | SSi | SSi Family |
|---|---|---|
| Price | £15/mo | £25/mo |
| Learners | 1 | up to 6 |
| Languages | all of them | all of them |
| Premium courses | all | all |
| Offline downloads | ✓ | ✓ (each learner their own) |
| Progress | yours | each learner their own |
| Annual | £150/yr | £250/yr |

Under the table, one line: *Community courses are free for everyone, forever — no plan needed.*

**Upgrade prompt placement (invitation-not-mission):**
- **The paywall** (in-player, end of Yellow belt): Family appears as the second option beside
  Premium — already built on the branch (`CheckoutOverlay` family option). No banner, no push.
- **Settings → Manage subscription** for existing Premium payers: one quiet line — "Learning as a
  household? Family covers six of you for £25." → upgrade flow (§4.1).
- **The moment that actually converts:** when a signed-in Premium payer's device is used to start
  a SECOND account's sign-in, or a payer visits the family page — not modelled, not tracked; the
  two placements above are enough. No emails, no nags.

## 6. Build plan — staged, each stage independently shippable

Estimates in **worker-sessions** (one focused agent session incl. tests + review).

| Stage | Contents | New/reuse | Est. | Ships alone? |
|---|---|---|---|---|
| 1 | **Rebase & land `impl/family-plan`** onto current dev: mechanical merge is clean (zero conflicts); careful eyes on the three §1.3 drift spots; re-run the 51 branch tests under vitest 3 + real lint; regenerate lockfile; commit the retroactive `family_members` migration file (marked already-applied); sandbox-Paddle shakedown on dev | reuse (the whole July build) | 2 sessions | ✓ — the complete original family plan |
| 2 | **Paddle products**: Tom creates "SSi Family" £25/mo + £250/yr, sets the two env vars (spec §2.1 — one sitting, unchanged) | founder action | — | with 1 |
| 3 | **Payer visibility**: `GET /api/family` + last-practised + courses; one UI line per member | small new | 1 session | ✓ |
| 4 | **Two-product surface**: pricing table + "Bring the language home" copy on the paywall/upgrade surfaces; the §4.1 price-swap upgrade endpoint (modelled on `update-seats.ts`) + upgrade screen | new copy + ~100-line endpoint | 1–2 sessions | ✓ |
| 5 | **Copy sweep** per §4.2 (no code to delete — consumer copy to the two-product story; Popty-repo tier-table doc fix) + optional 7-day past_due grace if Tom takes the §2.1 recommendation | copy + a few lines | ½–1 session | ✓ |
| 6 | **Browser pass + promotion**: full household walkthrough on dev (parent buys, QR child, email grandparent, lapse/restore), then ride the dev→staging→main train | verification | 1 session | — |

Total: **6–7 worker-sessions**, of which the first two land a product that was already
founder-confirmed in July. Stages 3–5 are independent and can run in parallel after stage 1.

---

*Decisions already confirmed and honoured: D1 seats = 6 including the payer; D2 annual £250 at
launch (Tom, 2026-07-10). Open for Tom in this pack, each answerable in a word:
§3 visibility depth (A / B / C — recommend **B**).*

*§2.1 past_due grace — **DECIDED (Tom, 2026-07-29): 7-day grace, one rule for both products, with
automatic in-app reminders to the payer during the grace window.** Stage 5 scope updated accordingly:
the grace implementation includes the reminder surface (payer sees "payment failed — fix by <date>"
in-app; members see nothing until access actually pauses).*
