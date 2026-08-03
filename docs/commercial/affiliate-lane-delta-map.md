# Affiliate lane — architecture delta map

**Status: RECONNAISSANCE. Nothing built.** Founder exploration 2026-08-03: could an
*introducer* (e.g. ZNotes) refer PURE LEARNERS — no tutor, no class — and earn from the
existing rebate engine?

Everything below is read off the shipped code, cited by file and line-range. Where a
question needs a founder ruling it is marked **[TOM]** and left open.

---

## 1. What exists today (verified)

| Piece | Where | What it actually does |
|---|---|---|
| Attribution | `teacher_referrals` (`supabase/schema.sql:8671`) | `class_id` **NOT NULL**, `student_learner_id`, `source ∈ signup_link\|manual_link\|admin`, `locked_price_pence`, `status`, `subscription_id`. Written by the webhook at checkout, never by the client. |
| One-attribution guarantee | `idx_teacher_referrals_student_active` (`schema.sql:11745`) | **UNIQUE on `student_learner_id` WHERE status IN ('pending','active')** — a learner can have exactly one live attribution, DB-enforced. |
| Payee entity | `teachers` (`schema.sql:8705`) | `learner_id`, `payout_recipient_id`, `referral_active`, `platform_status`. Table comment already says *"Private-tutor / **affiliate** teachers"*. |
| Accrual | `handleTransactionPaidEvent` (`api/teacher/paddle-webhook.ts:1186-1400`) | sub → referral → **gate `locked_price_pence === 1000`** → teacher resolved *through the class* (`classes.teacher_user_id` → `learners` → `teachers.id`) → flat **500p** → `accrue_teacher_commission_held` RPC. |
| Zero-collected guard | `:1241` | `transaction.paid` collecting £0 accrues nothing. |
| Hold | `:1295-1302` | `hold_until = paid_at + 1 month + 30 days`. |
| Ledger line | `tutor_rebate_ledger` (`supabase/migrations/20260802_tutor_rebate_ledger.sql`) | `teacher_id`, `learner_id`, `class_id` *(nullable already)*, `service_month`, signed `amount_pence`, accrual/reversal/reaccrual. Service-role only. |
| Reversal | `:1516-1570` | refund/chargeback reverses the accrual and the ledger line. |
| Payout | `api/cron/teacher-payouts.ts` | releases `status IN ('held','accruing') AND hold_until <= today`, **£100 threshold**, Wise batch-group; `wise-webhook.ts` reconciles. Batch funding is manual — money moves only when Tom funds. |
| Statement | `api/teacher/commissions.ts` | own-teacher scoped, service role; same release rules as the cron. |
| Never-stack | `paddle-webhook.ts:983-999`, `api/teacher/by-code.ts:87` | tutor tier requires `classes.school_id IS NULL **AND** group_id IS NULL`; either set → org £5 tier, **zero** commission. |

**The load-bearing finding:** the engine's only structural dependency on *teaching* is that
the payee is resolved **through a class**. Everything downstream — hold, ledger, reversal,
threshold, Wise, statement — is class-agnostic already. `tutor_rebate_ledger.class_id` is
even nullable.

---

## 2. The delta — what an affiliate lane needs that does not exist

### 2.1 Attribution without a class *(the only real schema change)*

`teacher_referrals.class_id` is NOT NULL and the payee is derived from it. An affiliate has
no class.

**Recommended shape — extend the existing table, do not add a parallel one:**

```sql
ALTER TABLE teacher_referrals ALTER COLUMN class_id DROP NOT NULL;
ALTER TABLE teacher_referrals ADD COLUMN introducer_teacher_id uuid;  -- payee when class_id IS NULL
ALTER TABLE teacher_referrals ADD COLUMN commission_pence integer;    -- frozen at attribution
-- widen the source CHECK with 'affiliate_link'
```

Accrual becomes `teacher_id = referral.introducer_teacher_id ?? (resolve via class)` and the
money gate becomes `commission_pence > 0` instead of `locked_price_pence === 1000`.

**Why this shape wins on all three legs:**
- **Better** — the unique partial index on `student_learner_id` then enforces *never-stack
  across both lanes for free*. A learner already bound to a tutor physically cannot take an
  affiliate row. A parallel `affiliate_referrals` table would have to re-implement that
  guarantee in application code, which is exactly how stacking bugs get shipped.
- **Simpler** — ledger, statement API, reversal path, cron, Wise: **zero changes**.
- **Cheaper** — three ALTERs, no backfill (existing rows keep `class_id`, `commission_pence`
  backfills to 500 where `locked_price_pence = 1000`), no new RLS posture.

`commission_pence` is the ONE-number hypothesis encoded as data rather than as a price-tier
`if`: freeze £5 at attribution and a later price change can never retro-change an accrual —
the same discipline `locked_price_pence` already applies.

### 2.2 Binding the link at checkout

Nothing writes a referral for a plain Premium purchase. `handlePremiumSubscription`
(`paddle-webhook.ts:720-880`) resolves a learner and, absent `customData.teacher_id`, returns
at `:844` with *"no teacher link"*.

Needed: `/r/:code` (or `?ref=`) → persist the code client-side → pass it as
`customData.introducer_code` on the £15 checkout → webhook resolves the code to an introducer
and writes the referral row with `class_id: null`, `commission_pence: 500`,
`source: 'affiliate_link'`. **Attribution happens server-side at subscription creation only** —
there is no cookie window to game, and no client-supplied payee id is trusted.

### 2.3 Paddle price — **confirmed: no new price point needed**

Affiliate-referred learners buy the existing SSi Premium monthly
`pri_01kqq85gvncyasfmfvvpcv1xfg` (`lib/paddle.ts:64`). SSi nets £10 after the £5 rebate. This
is the same "one product per adult lane" ruling that already covers school seats and the org
lane.

**One snag: the annual £150 price.** "£5 per *completed student-month*" has no clean meaning
on an annual sub. Recommendation: affiliate links open **monthly-only** checkout and annual
purchases accrue nothing in v1 — mirroring the tutor lane's monthly-only ruling of
2026-08-02, and for the same reason (cap the rebate exposure on money already collected).
**[TOM]** confirm.

### 2.4 An introducer who is not a tutor

`teachers` is already the payee entity and its own comment says *"tutor / affiliate"*. An
introducer needs a `teachers` row (hence a `learners` row) to hold `payout_recipient_id` and
hang commissions off. That works **today with no schema change**, but:

- the `teachers` row would show a teaching dashboard at `/tutors/dashboard` that means nothing
  to ZNotes;
- `referral_active` is currently tied to *the tutor's own £15 subscription* — an introducer
  pays nothing, so that flag must default true and stay decoupled.

Cheapest honest answer: add `teachers.kind text DEFAULT 'tutor'` (`'tutor' | 'introducer'`),
and give an introducer the **statement widget only** — the existing `/api/teacher/commissions`
response rendered on a bare `/introducer` page. No new money code, no new dashboard.

### 2.5 Self-serve vs manual

**Recommend manual for v1** (ssi_admin mints an introducer + code; the `/admin` codes surface
already exists). Affiliates are a handful of named relationships, not a marketplace, and
self-serve creation is precisely where link-farming enters. Self-serve is the L-sized future,
and it should not be built before a second affiliate exists.

### 2.6 Fraud / abuse surface

| Vector | Already covered by | Gap |
|---|---|---|
| Self-referral (introducer buys through own link) | — | **Gap.** Add a check: `introducer.learner_id === subscriber learner_id` → attribute nothing. Also worth blocking same-household churn via the £100 threshold + Wise KYC. |
| Link stuffing / last-touch war | Attribution written server-side at subscription creation; one live row per learner (unique index) | None — first bound wins, and it can't be rewritten from the client. |
| Card testing / chargeback farming | £0-collected guard (`:1241`), reversal path (`:1516`), `hold_until = month + 30d`, £100 threshold, manual batch funding | None material. Money genuinely cannot leave before the refund window closes and Tom funds the batch. |
| Signup farming for volume | Manual introducer creation, Wise recipient KYC | Accepted at pilot scale; revisit if self-serve ever lands. |
| Spoofed price | Server-derived tier + `commission_pence` frozen at attribution | None — the gate never reads the client's price. |

### 2.7 Never-stack when a learner has BOTH a tutor and an affiliate link

**Recommendation: tutor wins, always. Affiliates never stack on tutor-students.**

Two reasons, one commercial and one structural:
1. A tutor-student pays **£10**, not £15. After the tutor's £5 there is no second £5 to pay —
   an affiliate rebate on that learner would be paid out of SSi's remaining £5.
2. If the affiliate lane lives in `teacher_referrals`, `idx_teacher_referrals_student_active`
   **already makes stacking impossible**: one live referral row per learner, enforced by the
   database, not by a code path anyone can forget.

So the rule is "whichever attribution binds first, wins", and the tutor path binds at class
join — earlier than a Premium checkout by construction. This is the same ruling as
2026-08-02's *commissions NEVER stack*, extended to a third role without new doctrine.

---

## 3. Build size — honest estimate

| Size | Covers | Estimate |
|---|---|---|
| **S — the money core** | 3 ALTERs + backfill; webhook: introducer resolution, referral write on Premium checkout, gate moved to `commission_pence`, self-referral guard; `/r/:code` capture + checkout `customData`; tests on all of it. Statements/payouts reuse untouched. | ~1 day |
| **M — S + operability** *(recommended scope)* | + `teachers.kind`, admin mint-an-introducer, bare `/introducer` statement page, monthly-only enforcement on affiliate checkout, docs + a DECISIONS entry. | ~2–3 days |
| **L — the marketplace** | + self-serve affiliate signup, per-affiliate marketing assets, tiered/variable rates, org-level sub-accounts, tax handling. | Not recommended before a second affiliate exists. |

**Verdict: M.** And the ZNotes pilot itself can run on **S plus a spreadsheet** — the
introducer's statement can be read straight from `tutor_rebate_ledger` for the first few
months, which defers the whole introducer-UI question until there is evidence anyone needs it.

**The working hypothesis holds:** one commission number estate-wide (£5 per completed
student-month, any introducer), affiliate-referred learners on normal £15 Premium, SSi nets
£10. The 50/50 split is the option that *would* force new machinery — a £7.50 rebate breaks
the single flat `500` constant, breaks `commission_pence`-as-a-constant, and makes every
future statement lane-aware. Simpler and cheaper is the same number everywhere.

---

## 4. Open — needs a founder ruling

1. **Split.** £5/£10 estate-wide (recommended) vs 50/50 vs £5-affiliate-£10-SSi. The last two
   are the same number for a £15 price; 50/50 is what breaks the flat constant.
2. **Annual referrals.** Monthly-only affiliate checkout (recommended), or define what a
   completed student-month means on a £150 annual sub.
3. **ZNotes as org vs individual students.** One introducer row for ZNotes-the-organisation
   (one Wise recipient, one statement), or per-student introducers inside the ZNotes network?
   The latter is materially more surface — many payees, many KYC recipients, many £100
   thresholds that mostly never clear.
4. **Regional pricing.** Paddle does country-specific prices on the SAME price id
   (`lib/paddle.ts:60-63`), so a learner in India may pay far less than £15 while the rebate
   is a flat £5 — potentially most or all of the collected amount. Either the rebate becomes a
   *percentage* (breaking the one-number rule), or affiliate rebates are capped at a share of
   what was actually collected, or regional pricing is accepted as-is. **This is the sharpest
   open question in the whole lane and it applies to the tutor lane today.**
