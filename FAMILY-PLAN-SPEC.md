# SSi Family Plan — Design + Spec

*2026-07-10. Design pass only — no implementation. Grounded in the live code: `api/teacher/paddle-webhook.ts` (incl. the precedence fix `8fdafc04`), `api/_utils/audioAccess.ts`, `api/_utils/courseAccess.ts`, `api/access/claim.ts` + `grant-emails.ts`, `api/entitlement/offline-lease.ts`, `useOfflineLease.ts`/`useScriptCache.ts`, and the `subscriptions`/`learners`/`user_entitlements` schema.*

**Settled decisions honoured (not relitigated):** one Family plan ~£25/mo, up to 6 learner accounts with fully independent progress; one payer owns the umbrella and mints/invites members; no child self-signup; schools/tutor world completely separate; Tom creates the Paddle product; no barbaric flows (magic-link grade joining, pain paid once ever).

---

## The story in one paragraph

Mum pays £25/mo. She adds Dylan (9) and Ffion (14) by tapping "add a child" — each gets an account she created, signed in on their device by scanning a QR code once, never touching an email or password. She adds Grandpa by typing his email; the next time he signs in the normal way, he's premium — nothing to redeem, nothing to type. Everyone learns independently; every learner_id keeps its own progress, belts, and offline downloads. If Mum's card fails, all six drop gently to the free tier until she fixes it; nobody's progress is touched. If Ffion turns 18 and buys her own Premium, Mum frees the seat and nothing else changes.

---

## 1. Data model

**No new umbrella entity.** The umbrella *is* the payer's `subscriptions` row (`UNIQUE(learner_id)`, `plan_name = 'SSi Family'`). One new table:

```sql
CREATE TABLE family_members (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_learner_id   uuid NOT NULL REFERENCES learners(id),   -- the payer
  member_learner_id  uuid REFERENCES learners(id),            -- NULL until an email invite is claimed
  invited_email      text,                                    -- normalized; NULL for parent-minted children
  is_child_account   boolean NOT NULL DEFAULT false,          -- parent-minted; parent can re-mint sign-in links
  status             text NOT NULL DEFAULT 'invited'
                       CHECK (status IN ('invited','active','removed')),
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now(),
  removed_at         timestamptz
);

-- A learner belongs to at most ONE live family.
CREATE UNIQUE INDEX family_members_one_family
  ON family_members (member_learner_id) WHERE removed_at IS NULL AND member_learner_id IS NOT NULL;
-- No duplicate live invites to the same email within a family.
CREATE UNIQUE INDEX family_members_invite_dedupe
  ON family_members (owner_learner_id, invited_email) WHERE removed_at IS NULL AND invited_email IS NOT NULL;
CREATE INDEX family_members_owner_idx ON family_members (owner_learner_id);
```

- **Posture (CLAUDE.md rule 7):** RLS ON, no policies — service-role-only, all access via `/api/family/*` endpoints. This is the settled "hierarchy authz = endpoints" doctrine; no clever policies.
- **Owner is implicit** — no self-row. Seat count = 1 (owner) + live member rows. Cap: **6 total including the payer** (→ decision D1 below if Tom meant 6 + payer).
- **Identity discipline:** both columns are `learner_id` (learner PK), per the identity-rationalisation rule. The auth uid appears nowhere in this table.
- Removal is a stamp (`removed_at` + `status='removed'`), never a delete — provenance and instant re-add both come free. The member's `learners` row and all progress are untouched, ever.
- **Nice property:** memberships key on `owner_learner_id`, not the subscription row id — a lapse/cancel/re-buy by the owner reactivates the whole family with zero writes, because resolution (see §3) just re-checks the owner's row.

**Fork scored — losing options, one line each:**
- *Separate `families` table:* an entity with exactly one owner and no other attributes is a join table wearing a hat — worse (more concepts), not simpler, not cheaper. Rejected.
- *Reuse `user_tags` (`FAMILY:<id>` tags):* that's the schools world's table, auth-uid TEXT keyed, and Tom ruled the worlds stay separate — near-zero on Simpler. Rejected.
- *Fan out a `subscriptions` row per member:* breaks every `.eq('provider_subscription_id', …).maybeSingle()` in the webhook (6 rows, one Paddle sub → error → 500 → retry loop), needs N-row sync on every event, and tangles per-member precedence — near-zero on Simpler. Rejected.
- *Fan out `user_entitlements` per member from the webhook:* you still need the membership table for the parent UI + seat cap, so this only ADDS a second, snapshot-shaped copy of the truth that can drift from the first — worse and not simpler. Rejected.

---

## 2. Paddle

### 2.1 What Tom creates (exact, one sitting)

1. **Product:** name **"SSi Family"**, tax category *Standard digital goods* (same as the existing products).
2. **Price 1 (monthly):** £25.00 GBP, billed monthly, quantity min 1 / max 1. No trial (consistent with Premium).
3. **Price 2 (annual):** £250.00 GBP, billed yearly, quantity min 1 / max 1 — the house 10× pattern (£15→£150, £10→£100, £5→£50). → decision D2 if Tom wants to skip annual at launch.
4. Copy both `pri_…` ids to Vercel env (all environments): `VITE_PADDLE_FAMILY_PRICE_MONTHLY`, `VITE_PADDLE_FAMILY_PRICE_ANNUAL` — and paste them to the implementing agent, who hard-codes them as fallbacks in `lib/paddle.ts` + `PRICE_CATALOG` exactly like the existing prices.
5. **Nothing else.** The existing webhook endpoint receives all subscription events already; no Paddle-dashboard webhook change. Country-specific pricing rides on the same price ids, as today.

The value narrative writes itself: 6 accounts for £25 vs £90 individually.

### 2.2 Checkout (client)

Mirror of `useCheckout.ts`'s premium flow — same inline overlay, same auth-first chaining:

```js
customData: { kind: 'family_plan', supabase_user_id: userId }
```

No other custom data. The webhook never needs member info at purchase time — membership is managed by the family endpoints afterwards, so the checkout stays dumb and the money path stays clean.

### 2.3 Webhook handling (small, additive)

- `PRICE_CATALOG` += the two family prices with a new tier `'family'` — so the existing spoofed-`customData.kind` defence works unchanged: `kind:'family_plan'` billed on a non-family price → REJECT, exactly like the `learner_premium` and platform guards.
- `handleSubscriptionEvent`: new branch `kind === 'family_plan'` → verify billed tier `'family'` → resolve owner learner via `supabase_user_id` (owner must exist — checkout requires sign-in) → precedence-aware upsert of the owner's row with `plan_name: 'SSi Family'`. **No membership side effects in the webhook** — one row write, absolute and idempotent, like the platform handlers.
- `transaction.paid` / adjustments: zero changes. Family sub → subscription found, no `teacher_referrals` row → early return (no commission, correct). Full refund/chargeback → existing revoke path cancels the owner's row → the whole family switches off through resolution. It composes.

### 2.4 Precedence: where Family ranks

```ts
PLAN_PRECEDENCE = {
  'SSi Family':                4,   // NEW — top
  'SSi Premium (tutor bundle)': 3,
  'SSi Premium':               2,
  'SSi Student Access':        1,
}
```

**Why top:** the owner's row *carries five other people's access* — nothing may clobber it. The tension case is a tutor (rank 3) buying Family: if Family ranked below the bundle, the guard would skip the write and the family would silently get nothing (webhook 200s, Paddle collected — the exact bug class the side-effects fix just killed). Ranked above, the tutor's row becomes 'SSi Family' and *nothing breaks*: the tutor's dashboard entitlement lives on `teachers.platform_status`, which `handleTutorPlatformSubscription` sets unconditionally — only the redundant subscription-row write is precedence-gated, and the `own_subscription_id` link-back already handles the skip path (returns the existing row id).

**Member who ALREADY has individual Premium — the definition (simple, no arithmetic):**
Family membership is **additive**. Resolution (§3) is an OR: your own active row, *or* your live membership in a family whose owner's row is active. A member with their own £15 Premium keeps their own row and their own Paddle relationship; joining a family changes nothing for them technically. They're double-covered, and the fix is theirs: cancel their individual sub whenever they like; access continues seamlessly via the family. The parent's family page shows a gentle "already has their own Premium" note next to that member. No proration, no credits, no forced cancellation of someone else's Paddle sub.
- *Losing option — auto-cancel the member's own sub on join:* touching a third party's payment relationship from a webhook is an outward-facing money action with horror-story failure modes; barbaric in reverse. Rejected.

---

## 3. Entitlement: one join away

**One new helper, four call sites, zero client changes.**

New `api/_utils/familyAccess.ts`:

```ts
// Own row first; else the family join. Returns the effective subscription + how it resolved.
async function resolveEffectiveSubscription(supabase, learnerId):
  Promise<{ sub: SubscriptionRow | null; viaFamily: boolean }>

// The family join (one query):
//   family_members fm  ⋈  subscriptions s ON s.learner_id = fm.owner_learner_id
//   WHERE fm.member_learner_id = :me AND fm.removed_at IS NULL AND fm.status = 'active'
//     AND s.plan_name = 'SSi Family' AND s.status = 'active'
//     AND (s.current_period_end IS NULL OR s.current_period_end > now())
```

The `plan_name = 'SSi Family'` predicate matters: if the owner's row later becomes something else (downgrade to plain Premium), members correctly stop resolving.

**The four call sites** (the complete set of entitlement-deciding `subscriptions` readers — verified by grep; portal/cancel/admin/teacher readers are payer-scoped by nature and untouched):

| File | Today | Change |
|---|---|---|
| `api/_utils/courseAccess.ts` | own-row `status==='active'` | use resolver — this is the real content paywall |
| `api/subscription/index.ts` | own row → `isSubscribed` | use resolver; members get a virtual `planName: 'SSi Family (member)'` so the client UI can say "covered by your family plan" |
| `api/entitlement/offline-lease.ts` | own-row `subActive` | use resolver — members' offline leases renew like any payer's |
| `api/me/subscription.ts` | own row (checkout-decision UI) | use resolver — a covered member shouldn't be sold a redundant sub |

Client: **no entitlement changes.** `useSubscription`/`useEntitlement` consume `isSubscribed` from the API; a member simply reads as subscribed. The only client work is UI (family management screen + paywall option + the "covered by family" branch on the manage-subscription screen).

**Entitlement tokens (future-proofing note, one line):** audio is fail-open today pending tokens; when subscriber `et` tokens ship and `ENTITLEMENT_ENFORCE=strict` arms, the mint must call this same resolver — noted here so it can't be forgotten.

- *Losing option — new `family_entitlements` system:* a parallel entitlement source alongside `subscriptions` + `user_entitlements` is exactly the "parallel primitive" BSC exists to kill. Rejected.

---

## 4. Membership flows (the no-barbarism section)

Joining pain budget, per `feedback_no_barbaric_auth_flows`: **paid at most once per human, ever.** Nobody re-proves an identity the system knows; nobody is bounced into a context they don't use; magic code/link over password, always.

### 4.1 Adding members — two paths

**(a) Member has an email (grandparent, teen):** parent types the email on the family page → `POST /api/family/invite` writes an `invited` row → **if a learner with that verified email already exists, attach immediately** (the `grant-emails.ts` immediate-apply pattern — `learners.verified_emails` match). Otherwise it attaches on the member's next sign-in: the app already POSTs `/api/access/claim` on every sign-in with the OTP-verified email — the family claim folds into that same moment (same file, same idempotency discipline: match `invited_email` to the verified session email, stamp `member_learner_id` + `status='active'`, seat-cap re-checked at claim). Grandpa's total pain: one standard OTP sign-in he'd have done anyway. He never sees the word "family".

**(b) Child, no email (the age-verification sidestep — preserved religiously):** parent taps "add a child", types a first name → `POST /api/family/create-child` → server creates a Supabase auth user on a **synthetic address we own** (`fam-<uuid>@members.saysomethingin.app`, `email_confirm: true` via the admin API), a `learners` row (display_name), and an `active` membership (`is_child_account: true`) → returns a **one-time sign-in link, rendered as link + QR**. Parent opens/scans it on the kid's device once; the Supabase session + refresh token keep the child signed in indefinitely. The child never enters an email, password, or birthday — the parent performed every step, and the account's only PII is a first name; the contact human is the payer.
**Recovery = re-mint:** device wiped or link expired → parent taps "get sign-in link" on the family page (`POST /api/family/signin-link`, owner-only, child-accounts-only, `auth.admin.generateLink type:'magiclink'`). Support never touches it; the parent is self-serve forever.

### 4.2 The four narrated stories (support-readable)

**(a) Parent buys + adds 3 kids and a grandparent.**
Mum taps Family on the paywall, pays £25 in the normal checkout. Under Settings → Family she taps "add a child" three times — Dylan, Ffion, Osian — and scans each QR on each kid's iPad; they're in, permanently. She types Grandpa's email; he's "invited". Next Sunday Grandpa signs in as always and is simply premium — nothing to redeem. Five seats used of six; everyone's progress is their own.

**(b) Member leaves / parent removes one.**
Mum removes Osian (or Ffion taps "leave family" herself — `POST /api/family/leave`). The row is stamped removed; the seat frees instantly. Osian's account, belts, streaks, and downloads all remain — he drops to the free tier (everything through Yellow still plays; his offline lease for premium content quietly runs out its remaining days rather than snapping shut). Re-adding him later is one tap and everything is exactly where he left it.

**(c) Payment fails / lapses.**
Mum's card expires. Paddle retries and emails her (dunning); the webhook marks the one owner row `past_due`, and all six learners drop to the free tier together — same experience as any lapsed individual: progress untouched, free belts keep playing, downloaded premium content plays out its remaining offline-lease days, then locks softly. Mum updates the card in the existing Paddle portal; the next webhook event flips the row active and all six are premium again. Nothing was deleted, nobody re-onboards, no support ticket.

**(d) Family member outgrows to individual.**
Ffion turns 18 and buys her own Premium in the normal checkout. She has no subscriptions row of her own (members don't), so it creates one cleanly — no precedence collision. She's now covered twice; Mum removes her to free the seat (the family page shows "has her own Premium" as the nudge). Ffion's learner_id — and every minute of progress on it — is the same one she's had since she was 14.

### 4.3 Edge rules (one line each)

- One live family per learner (partial unique index); inviting someone already in another family surfaces "already in a family" to the parent — no silent steal.
- Inviting the owner's own email → reject.
- Invite claimed on a different email than invited → simply doesn't attach; parent sees it still pending and corrects/resends. No dead ends.
- Seat cap enforced server-side at invite, create-child, AND claim time (belt + braces against racing invites).
- Owner cancels → row cancelled → members off at period end (Paddle semantics), memberships intact → re-buy reactivates everyone with zero writes.
- Members hitting "manage subscription" see "covered by your family plan" (planName branch) — never a Paddle portal they don't own.

---

## 5. PREREQUISITE: learner-scoped offline lease (the shared-iPad fix)

**The finding (adversarial pass, confirmed in code):** the client lease lives on the `CachedScript` IndexedDB row keyed by `courseCode` only (`useScriptCache.ts` — `offlineLease` field; `setOfflineLease(courseCode, lease)`). The server side (`offline_leases`) is correctly `UNIQUE(learner_id, course_code)` — but the device stores ONE lease per course *regardless of who is signed in*. On a shared household iPad — the family plan's home turf — sibling A's paid lease unlocks offline play for whoever uses the device; worse, a signed-in non-payer's validation can overwrite a payer's lease with a trial clamp, and a free sibling can ride a paid sibling's 30-day window. Family makes this from latent to guaranteed. **It ships in this arc, before or with the entitlement PR.**

**Scope (client-only — the server is already right):**
1. `CachedScript.offlineLease: OfflineLease` → `offlineLeases: Record<authUserId, OfflineLease>` (auth `user_id` is synchronously available from the session; `'anon'` for signed-out). Audio/script BYTES stay shared — they're content, not entitlement; only the lease partitions.
2. `getOfflineLease` / `setOfflineLease` / `getAllOfflineLeases` take the current user id; `useOfflineLease` passes it everywhere it already touches the session for the auth token.
3. **Legacy adoption:** on first run, an old single `offlineLease` value is adopted into the current signed-in user's slot, then deleted — nobody's existing download locks on upgrade day (cardinal sin guard).
4. The playback gate `isCourseLeaseValid` resolves against the *current* user's lease only; signed-out with no anon lease → not valid (unchanged semantics for the signed-out case).
5. Unit tests in the existing `offlineLease.test.ts` style: two users, one course; adoption; anon; the sign-out/sign-in flip.

---

## 6. Build plan — ordered PRs (no implementation in this pass)

All to `dev`, one logical change each, suite green before each merge (`typecheck`/`test`/`lint`).

| # | PR | Contents | Tests | Size |
|---|---|---|---|---|
| 1 | `family: learner-scoped offline lease` | §5 — independent, ships first (fixes a live latent bug even without Family) | lease-keying unit tests + adoption | ~200 lines, S |
| 2 | `family: family_members migration` | table + indexes + RLS-on posture + `NOTIFY pgrst` | migration reviewed against canary runbook (additive, no policy change — low ceremony) | ~80 lines, S |
| 3 | `family: webhook family_plan kind` | `PRICE_CATALOG` tier `'family'`, precedence rank 4, `handleFamilySubscription` | extend `paddle-webhook-precedence.test.ts` (Family vs each rank, tutor-buys-family) + `paddle-webhook-side-effects.test.ts` (spoofed-price reject; refund revoke composes) | ~150 + tests, S |
| 4 | `family: effective-subscription resolver` | `api/_utils/familyAccess.ts` + wire the 4 call sites | resolver unit tests: own row / family row / removed / past_due owner / plan_name-changed owner / both | ~250, M |
| 5 | `family: membership endpoints` | `GET /api/family`, `invite`, `create-child`, `signin-link`, `remove`, `leave` + claim fold-in to `access/claim.ts` | endpoint tests (mocked service client, existing `__tests__/api` pattern): seat cap, dup invite, cross-family steal, owner-email reject, claim idempotency | ~500, L |
| 6 | `family: UI` | Settings → Family page (list/add/QR/remove), paywall Family option (reuse `useCheckout` shape), "covered by family" branch | component tests light; manual pass on dev with sandbox Paddle | ~450, M |

**Total ≈ 1,600–1,800 lines across 6 small PRs.** Dependencies: 1 and 2 are independent; 3→4→5→6 in order. End-to-end shakedown on dev with a sandbox Paddle sub before promoting; the promotion train carries it as one arc.

**Deliberately NOT built (no signal before its consumer):** member usage analytics for the parent, per-member course restrictions, family-to-school coupon fairness (Tom already parked it), seat-count upsell tiers.

---

## 7. Headline choices (for the Chief of Staff)

1. **No `families` table** — the umbrella is the payer's existing `subscriptions` row; one `family_members` join table is the entire new data surface.
2. **Membership is state, entitlement is a join** — one resolver (`own row OR owner's family row`), four server call sites, zero client entitlement changes; lapse/refund/re-buy all compose from the owner's single row with no fan-out writes.
3. **Webhook stays dumb** — `kind:'family_plan'`, new price tier `'family'` reusing the existing spoof guard, one row write; membership never touches the money path.
4. **'SSi Family' ranks top (4)** in plan precedence — the owner's row carries six people, so nothing may clobber it; the tutor-bundle overlap is safe because the dashboard grant lives on `teachers`, not the subscriptions row.
5. **Two joining paths, both magic-grade** — email invite that auto-attaches at the existing sign-in claim moment (Grandpa's pain: the OTP he'd do anyway), and parent-minted child accounts on synthetic emails with QR sign-in + parent-re-mintable links (child enters nothing, ever — the age sidestep preserved end-to-end).
6. **Member-with-own-Premium is additive, no arithmetic** — double-covered until they cancel their own sub themselves; we never touch a third party's payment relationship.

### Needs Tom (answerable cold)

- **D1 — Seats:** "up to 6 learner accounts" = **6 total including you** (my spec), or 6 members + you = 7? One word: *including* / *plus*.
- **D2 — Annual price:** create £250/yr alongside £25/mo at launch? My recommendation: yes (house 10× pattern, zero extra code). *Y / N.*

## Decisions confirmed (Tom, 2026-07-10)
- **D1 — Seats:** up to 6 learner accounts INCLUDING the payer (as specced).
- **D2 — Annual:** yes — create £250/yr alongside £25/mo at launch.
