# Payment architecture: the option space, rails by fee shape, and the combinations worth a taste call

*Fable explore, 2026-09-15. Options gathered, nothing decided. Every number carries one of three marks: OBSERVED means read from the live database, the live code or a vendor page today; COMPUTED means arithmetic on observed inputs, with the inputs named; GAP means I could not get it, with the cause. Prior work is cited, not repeated: the India merchant-of-record comparison at /d/ccb4b7bc, the RevenueCat scout at /d/03745d8e, the Paddle-fed revenue ledger read at /d/56a3feac, the India price census at /d/17485a5e, and `docs/india-entitlement-design.md`.*

---

## 0. What is fixed, and the one idea this document tests

Fixed by Tom, not re-opened here: Paddle stays merchant of record on the web unless something matches its shield. App stores are merchant of record and that is the point of them. India sells through Google Play and the Capacitor Android app exists for that reason. India is a price variation on one product, free through end of Yellow everywhere. RevenueCat on Stripe, and Stripe Managed Payments, are out.

The idea under test: **entitlement is a ledger of grants from any source, and the rail is chosen per market by the shape of its fee against that market's price.** Section 1 gives the live numbers, section 2 the fee shapes at our prices, section 3 the reframe against what already exists, section 4 the options, section 5 the combinations.

---

## 1. Live numbers

**The seven active subscriptions.** OBSERVED, `subscriptions` table, 2026-09-15.

| Plan | Period | Currency | Count | Note |
|---|---|---|---|---|
| SSi Premium | monthly | GBP | 5 | one is cancel-at-period-end |
| SSi Family | monthly | GBP | 1 | cancel-at-period-end |
| SSi Family | annual | GBP | 1 | period ends 2027-09-14 |

Nineteen rows in all, all provider paddle, twelve cancelled. The table carries no amount, no currency and no country; currency and period above are inferred from the plan id and the period-end date.

**Transaction count.** OBSERVED: 16 `transaction.paid` events in our own webhook dedupe table, 2026-06-18 to 2026-09-14. A prior worker with Paddle dashboard access read 27 transactions on 2026-09-08, all GBP, across 8 prices, none in INR, at /d/17485a5e. The two counts differ because the dedupe table only started recording on 2026-06-16 and because Paddle counts more event kinds; neither is wrong.

**India share of revenue and of transactions.** OBSERVED as zero: there is no INR price in the Paddle account and every transaction seen was GBP. India has never been sold to on the current stack. All-time and last-90-days are the same number.

**Actual Paddle fee per transaction, `payout_totals.fee` and `fee_rate`.** GAP. There is no Paddle key on this machine. The Vercel project env does hold `PADDLE_API_KEY` for production, but the API returns it as an encrypted envelope, not a value: the variable is stored as sensitive and Vercel decrypts those only at build time. I did not try further. Every fee figure below is therefore COMPUTED from Paddle's published shape, not observed from our payouts.

**Price points used.** OBSERVED from `packages/player-vue/src/lib/paddle.ts` comments and the live plan rows: Premium £15 a month, £150 a year; Family £25 a month, £250 a year; school student £5 a month, £50 a year; tutor student £10 a month. India: ₹299 a month and ₹2,990 a year, Aran's numbers, exclusive of tax, per /d/ccb4b7bc. No lifetime price exists anywhere; a lifetime figure below is hypothetical and marked so. No INR price is configured in Paddle or Play.

**Phone-first signup share.** OBSERVED, and the answer is that the number barely exists yet. `player_events.app_shell` has been a live column since 2026-09-10. In the 30 days to today, cold starts came from 146 web learners, 238 unstamped rows from before the column, and exactly 1 learner in the native shell, with 85 events between 2026-09-11 and 2026-09-14. That one learner is almost certainly internal testing. So the reader-model question in option 6 cannot be decided from live data today; it can be from about a month after the Play listing goes live.

**Legacy native app subscriber counts.** GAP, unchanged from #796: the automagic backend has no credential on this estate. I did not spend time on it.

**Entitlement tables.** OBSERVED. `user_entitlements`: 124 rows. By shape: 47 timed course grants with no code and no email grant, so gifts or admin; 34 lifetime full gifts or admin grants; 20 lifetime full from codes; 12 lifetime full from the email allowlist; 5 lifetime course grants from codes; 5 timed full from codes; 1 lifetime course gift. `entitlement_grants`: 2 rows, both paid and active, org-level. 1,508 learners in all.

---

## 2. Fee shapes at our prices

Fee shapes verified today from vendor pages, with the fetch named.

| Rail | Merchant of record | Shape | Source, read 2026-09-15 |
|---|---|---|---|
| Paddle Billing | Paddle | 5% + $0.50 per checkout transaction; "selling products under $10 … contact us for custom pricing" | paddle.com/pricing |
| Google Play, India and rest of world | Google | 15% on subscriptions, percent only; India alternative billing cuts it by 4 points to 11% on those transactions | Play Console Help, service fees |
| Google Play, UK, EEA, US since 2026-06-30 | Google | 10% service fee on subscriptions plus 5% billing fee if Play billing is used; the 5% falls away on alternative billing or link-out | Play Console Help; Android Developers Blog, June 2026 |
| Apple, Small Business Program | Apple | 15%, percent only, subscriptions included | developer.apple.com small business page |
| Apple EU link-out terms | Apple | 2% acquisition + 5% store services + 5% core technology commission, 12% in all, 10% under Small Business; discontinued 2026-10-01 for new unified terms | developer.apple.com EU alternative payments page |
| Apple US link-out | Apple | injunction in force since the Supreme Court declined a stay in August 2026; no commission on linked-out purchases has been set; Apple filed a proposed rate on 2026-08-13 | Courthouse News, 9to5Mac, MacObserver, September 2026 |
| Apple UK link-out | Apple | CMA steering conduct requirement consulted on, closed 2026-07-28, no rule yet; Apple objected 2026-07-29 | CMA coverage, July 2026 |
| RevenueCat | none, a layer | free to $2,500 monthly tracked revenue then 1% of everything tracked, including web revenue Paddle already processed | revenuecat.com/pricing |
| Lemon Squeezy | Lemon Squeezy, Stripe-owned | 5% + $0.50, plus 0.5% on subscriptions, 1.5% on international cards, 1% on non-US payouts | vendor page refused the fetch with 403; figures from three 2026 third-party pricing pages, so treat as unverified |
| Gumroad | Gumroad since 2025-01-01 | 10% + $0.50 direct sales | gumroad.com/pricing |
| FastSpring | FastSpring | unpublished, "flat-rate pricing based on transaction type and your volume", contact sales | fastspring.com/pricing. GAP: no number can be quoted |
| Razorpay, import flow | SSi itself | unpublished for foreign merchants, contact sales; SSi registers for Indian GST as an OIDAR supplier from the first sale and files monthly | per /d/ccb4b7bc, verified there 2026-09-08 |

Two things about Paddle's shape matter more than the headline. First, the fee is taken on the transaction total including tax, per Paddle's adjustments documentation, so the effective take on the net price is about a fifth higher in the UK at 20% VAT and in India at 18% GST than the rows below show; I could not open Paddle's own fee help page today, so that base is COMPUTED on Paddle's adjustments wording, not confirmed against a payout. Second, the flat fifty cents is a dollar amount; the conversion below uses ₹88 and £0.74 to the dollar, which is a spot assumption and moves each rupee row by a point or two, never a conclusion.

**Effective take at each price point.** COMPUTED. Play and Apple are shown at the percent-only figure that applies in that market. The Play UK column assumes a new install after 2026-06-30.

| Price | Paddle 5% + $0.50 | Play India 15% | Play India alt-billing 11% + processor | Play UK new install, Play billing 15% | Play UK link-out 10% + Paddle | Apple 15% | Gumroad 10% + $0.50 | Lemon Squeezy, subscription, international |
|---|---|---|---|---|---|---|---|---|
| ₹99 | 49% | 15% | 11% + p | n/a | n/a | 15% | 54% | 51% |
| ₹149 | 35% | 15% | 11% + p | n/a | n/a | 15% | 40% | 37% |
| ₹199 | 27% | 15% | 11% + p | n/a | n/a | 15% | 32% | 29% |
| ₹299 | 20% | 15% | 11% + p | n/a | n/a | 15% | 25% | 22% |
| ₹2,990 annual | 6.5% | 15% | 11% + p | n/a | n/a | 15% | 11.5% | 8.5% |
| £5 | 12% | n/a | n/a | 15% | 22% | 15% | 17% | 14% |
| £10 | 9% | n/a | n/a | 15% | 19% | 15% | 14% | 11% |
| £15 | 7.5% | n/a | n/a | 15% | 17.5% | 15% | 12.5% | 9.5% |
| £25 | 6.5% | n/a | n/a | 15% | 16.5% | 15% | 11.5% | 8.5% |
| £150 annual | 5.2% | n/a | n/a | 15% | 15.2% | 15% | 10.2% | 7.2% |
| £250 annual | 5.1% | n/a | n/a | 15% | 15.1% | 15% | 10.1% | 7.1% |
| £300 lifetime, hypothetical | 5.1% | 15% | n/a | 15% | 15.1% | 15% | 10.1% | 7.1% |

What the table says, in three lines. In the West, Paddle beats every store at every price we sell, and the gap widens with the ticket: at £15 monthly Paddle takes half what a store takes. In India, the monthly ticket is where Paddle is hammered: 20% at ₹299 and near half the sale at ₹99. And the annual Indian ticket flips it: at ₹2,990 Paddle at 6.5% is cheaper than Play at 15% by a wide margin. So the rail choice in India is not "Play or Paddle", it is "monthly or annual", and that is a pricing lever before it is an integration.

**Side by side on what actually sold.** COMPUTED on the 7 active plans, monthly run rate about £121. Paddle's take on that run rate is about £8 a month; on Play at 15% it would be about £18; on Apple the same £18; adding RevenueCat is £0 today because $2,500 monthly tracked revenue is about twenty times our current run rate. At Tom's stated target of £30,000 a month, all on the £15 monthly ticket, the same numbers become roughly £2,250 Paddle, £4,500 Play or Apple, and £300 RevenueCat. None of these figures is observed; every one is the published shape applied to the observed price.

---

## 3. The reframe, tested against what exists

**What a grant ledger is.** One table, one row per grant: learner, source, source reference, starts, ends or null, revoked or null. One predicate: does this learner hold a grant whose window contains now. Every rail, code, invoice and gift is a writer; nothing else is a reader.

**What already exists, read from the code today.** Three stored truths and three derived ones, resolved in two places.

- `subscriptions`: one row per learner, provider, status, period end, cancel flag, scheduled plan change. Written by the Paddle webhook. Read by `resolveEffectiveSubscription`, which also derives family cover from the owner's row with a 30-day grace.
- `user_entitlements`: a grant row with learner, access type, granted courses, expires at, and one of two foreign keys naming a code or an email grant; gifts and admin grants have neither. 124 rows. Written by `api/_utils/entitlementGrant.ts` from three doors. Read by `resolveActiveEntitlements`.
- `entitlement_grants`: org-level, one of group, school or class, trial or paid, expiry. 2 rows. Cascaded to people by an RPC and three derived coverage layers.
- The predicate is `checkCourseAccess` in `packages/core/src/pricing`, fed by `resolveServerCourseAccess`, which calls both resolvers and unions them.

So the ledger-of-grants shape already exists, twice, and the predicate already unions its sources. `user_entitlements` is a grant ledger in all but name: it has learner, window and a source. What the reframe would need is small and specific:

1. A `source` column that names the writer outright: paddle, google_play, apple, code, email_allowlist, gift, admin, school_invoice, partner. Today the source is inferred from which foreign key is set, and `packages/core/src/pricing/types.ts` still types it as stripe, gift, government or admin_grant. Drift, not a blocker.
2. A `source_ref` unique per source: the Paddle subscription id, the Play purchase token, the Apple original transaction id, the code id. That is the idempotency key the Paddle webhook already uses in `processed_webhook_events` and the revenue-ledger read at /d/56a3feac proposed for money; it is the same key for grants.
3. A `starts_at` distinct from `redeemed_at`, and a `revoked_at`. Today a refund is a status change on `subscriptions`, and a code grant has no revocation at all.
4. Renewals as window extension. A subscription is not one grant; it is a grant whose end moves every renewal. The writer sets ends to the period end on every paid event and leaves it alone on failure, so past-due and grace fall out of the date plus a policy constant, exactly as family grace does today.

**Where it breaks, honestly.**

- **Identity across web and phone.** Checkout sends `supabase_user_id`; the webhook resolves `learners.id` from it. A Play purchase must carry `obfuscatedAccountId` = `learners.id`, set at purchase time, or the receipt arrives with no learner to attach to. And the settled identity ruling for India is buy anonymous then alias to email on the next screen, which means the grant is written against an anonymous learner id first and must move on merge. Any ledger design has to name that move as a step: a grant follows the learner row through the alias merge, and the merge is the only place a grant's learner changes.
- **Two overlapping grants from two rails.** The predicate is unbothered: any active grant opens the door. The problem is money, not access: a learner paying Paddle on the web and Play on the phone is paying twice, and nothing on either side knows. The ledger makes this visible for the first time, which is the argument for it, but it does not prevent it. Prevention is a purchase-time read: if the learner already holds an active grant from another source, the app shows the existing subscription rather than a buy button. That is one read of the same table.
- **Refunds, grace and account hold as revocations.** A revocation is a row update with a timestamp; Paddle adjustments, Play account hold and Apple refund notifications all arrive as events with a reference, so they map. What does not map is a store-side grace period Google or Apple grants without telling us the new end date; the writer has to read it from the re-fetched purchase, not from the notification.
- **Restore purchases on a new phone.** The store is the truth for the device. The app re-verifies the receipt with the server, which finds the grant by `source_ref` and, if the learner id differs from the row's, this is either a family member on a shared account or a reinstall after alias, and the honest answer is to attach the device to the row's learner, never to mint a second grant. That rule needs writing down; it is where a naive ledger duplicates.
- **What it does not save.** The two store integrations are the same size with or without the ledger: purchase execution, receipt re-fetch, notification handlers. The ledger only decides what they write, and it makes them write less: a grant, not a subscription row with provider-specific status vocabulary.

The reframe holds. It is closer to a rename and three columns than to a build, and the derived layers, family cover and class and org coverage, already show that the predicate can read grants that are not rows. The one real design decision inside it is whether `subscriptions` folds into the ledger or stays as the Paddle-specific detail table behind a grant. Nothing in this document depends on which.

---

## 4. The option space

Each option: what it is, who is merchant of record, fee shape at our prices, what it composes with, its better × simpler × cheaper story with cheaper meaning total cost, and the failure test that matters.

### Option 1. Annual and lifetime pricing to cut transaction count

Sell India annual-first: ₹2,990 a year as the default button, ₹299 monthly as the smaller option, and consider a ₹1,499 six-month step. A flat per-transaction fee is defeated by fewer, larger transactions and nothing else defeats it.

- MoR: whichever rail is already there; this is a pricing move, not a rail.
- Fee shape: Paddle at ₹2,990 is 6.5%, COMPUTED, against Play's 15% at any ticket. At ₹299 monthly Paddle is 20%. The crossover where Paddle and Play cost the same is a ticket of about ₹440, so anything above six weeks of the monthly price on one transaction makes Paddle the cheaper rail in India.
- Composes with: everything. It is the cheapest lever in the document.
- Better: fewer renewal failures, fewer UPI pre-debit notices, less churn friction. Simpler: no new rail, no new code, a price row. Cheaper: the fee falls by two thirds on Paddle and the transaction count by twelve.
- Failure test: does an Indian learner who has just hit the padlock at the end of Yellow pay ₹2,990 up front? The India design doc expected few annual subscribers. That is an assumption with no data behind it, and the only way to get data is to show the annual button. The second failure: an annual ticket on Paddle is still an English checkout and an English receipt, the disqualifier /d/ccb4b7bc found.

### Option 2. Rail per market, one ledger

Play in India, Paddle on the web in the West, Apple where the phone is an iPhone, all writing grants to one table. This is the status-quo intention, stated cleanly so the others can compose with it.

- MoR: Google in India, Paddle on the web, Apple on iOS.
- Fee shape: 15% India, 7.5% at £15 on the web, 15% Apple, per section 2.
- Composes with: 1, 4, 7 or 8, 9.
- Better: every market gets the till its learners expect, in their language, with the store's geography enforcement. Simpler: one predicate, one table, three writers. Cheaper: total cost is the two store builds and their maintenance, which option 7 sizes; the fee in each market is the best percent-only figure available there.
- Failure test: the web trial with a Hindi padlock has nowhere to send an Indian learner except "install the app", which /d/ccb4b7bc named as the break in continuity. And the two builds are real: every store rule change lands on us twice.

### Option 3. Indian partner as merchant of record, selling codes

A local partner sells access under its own rails and GST registration. SSi grants entitlement on code redemption. The partner is a candidate, not a decision; the estate does not even hold its legal name.

- MoR: the partner. SSi sells to the partner, B2B, one invoice.
- Fee shape: unpriced. Withholding at source on payments from India to a UK supplier is 0% if a clean resale, 10 to 15% under treaty if characterised as royalty, per /d/ccb4b7bc. That range dwarfs any rail fee and is settled by accountants, not engineers.
- Composes with: 4, which it is a special case of; and 2 in the West.
- Better: a person in an Indian school, INR pricing set by people who know it, one invoice. Simpler: zero payment code in the app for India; code redemption already exists at `api/code/redeem.ts`. Cheaper: nothing to build, but the learner relationship, churn signal and price control move to the partner, and that is the total cost.
- Failure test: what does the partner do that a payment gateway does not? If the answer is distribution into schools, this is not a rail decision at all and sits beside options 1 and 2. If the answer is "takes the payment", it is a reseller and the prior brief's objections stand.

### Option 4. Codes as a product

Gift codes, school codes, partner codes, prepaid cards. A code is a grant source, sold anywhere, redeemed once. The redeem door, the entitlement_codes table and the grant helper exist and have 25 live redemptions in the ledger already.

- MoR: whoever sells the code. On the web that is Paddle, as a one-off product, so a code is a way to sell an annual through Paddle to somebody else's phone.
- Fee shape: the selling rail's. A £150 code on Paddle is 5.2%. A code sold by a partner is the partner's rate.
- Composes with: everything, and it is the only option that lets a store app take money without any store billing: a code bought on the web and typed into the phone is not a purchase inside the app, it is a redemption.
- Better: gifts, schools and partners all get one mechanism. Simpler: it exists; what is missing is a sell page and a code generator on the web. Cheaper: near zero build, no per-transaction fee beyond the selling rail.
- Failure test: store review. An app whose only path to paid is "type a code you bought elsewhere" is a reader app, and reader-app rules differ by store and region; see option 6. In India specifically, a code path with no Play billing offered beside it is the thing Play's payments policy exists to catch. Second failure: a code has an end date but no renewal, so churn is by default unless the sell page makes renewal a habit.

### Option 5. Percent-only merchants of record

A merchant of record whose fee is percent-only, or whose flat part is small enough not to bite at ₹299, would give India a web rail without the hammer.

- MoR: the vendor.
- Fee shape: I could not find one. FastSpring publishes nothing and says contact sales. Lemon Squeezy and Gumroad have the Paddle shape with a worse percentage. The one percent-only door I did find is on Paddle's own page: "selling products under $10 … contact us for custom pricing". ₹299 is $3.40. Nobody has asked.
- Composes with: 1 and 2 as a replacement for Paddle in India only, if any vendor turned out to be percent-only.
- Better: not demonstrated. Simpler: a second web MoR is a second webhook, a second portal, a second set of receipts, forever. Cheaper: unknowable without a quote.
- Failure test: the quote. Two emails, one to Paddle about sub-$10 pricing and one to FastSpring for its rate card, decide this option, and both are Tom's to send since they touch a vendor. Until then it is a gap, not an option.

### Option 6. Reader model, West only

No in-app purchase outside India. The apps read; the web sells through Paddle; the phone app shows the learner they already have access, or nothing about paying at all.

- MoR: Paddle, everywhere in the West.
- Fee shape: 7.5% at £15, 5.2% at £150, COMPUTED, against 15% in either store.
- Composes with: 1, 2 for India, 4, 7 or 8 for India only.
- What the link-out rules allow today, OBSERVED from the sources in section 2. US iOS: the Epic injunction is in force, developers may include links and buttons to outside purchase, and no commission has been set, though Apple has proposed one and the district court has not ruled. EU iOS: link-out is allowed under the addendum at 12%, or 10% under Small Business, and those terms end 2026-10-01 for new unified terms nobody has seen. UK iOS: no link-out right yet; the CMA consultation closed 2026-07-28. Android in the UK, EEA and US: link-out and alternative billing are allowed since 2026-06-30 at a 10% service fee, so a Paddle link-out from the Android app in the West costs 10% plus Paddle, about 17.5% at £15, more than Play billing's 15%. Android India: link-out is not allowed; only the embedded-webview alternative billing beside Play billing, at 11% plus processor.
- Better: one till in the West, one receipt, one portal, Paddle's shield on all of it. Simpler: no Apple build at all, and no Play build outside India. Cheaper: the smallest total cost in the document, by a build and a half.
- Failure test: the number this turns on is the share of learners who first meet SSi on the phone rather than the web, because a reader app converts only learners who already know where the till is. That share is 1 learner in 30 days today, which is the Play listing not having launched, not an answer. Re-run the query a month after the listing is live; it is one line against `player_events.app_shell`. The second failure is Apple's reader-app rule: a reader app may not mention that a purchase exists elsewhere, in the UK today.

### Option 7. Own ledger, own handlers, no RevenueCat

Apple App Store Server Notifications v2 and Play Real-time Developer Notifications into our own routes, each re-fetching the purchase from the store before writing a grant. Watson's "we write the code" option.

- MoR: the stores. Nothing changes there.
- Fee shape: the store's, and nothing on top. The saving over option 8 is the 1%: £0 today, about £300 a month at £30,000.
- Composes with: 2, 4, 1.
- Better: no third party in the entitlement path, no vendor to outlive, the ledger is ours. Simpler: two webhook routes shaped like the Paddle one that already exists with its tests, plus one store-billing module behind the seam in `paymentRoute.ts`. Cheaper on fees, dearer on tail.
- The tail, sized honestly. Play: acknowledgement within three days or auto-refund, purchase token re-fetch via `androidpublisher`, account hold, grace, pause, upgrade proration, restore. Apple: JWS verification of notifications, the original transaction id as the stable key, refund and revocation notifications, family sharing, Ask to Buy, restore. Each store changes its notification schema roughly yearly. The part-2 scope doc put the Play half with RevenueCat at 6 to 8 days and said raw roughly doubles it; Apple by hand is a second build of the same size. So the honest number is four to six weeks across both stores, then a day or two a quarter, forever, for one person who has to stay current on two vendors' change logs.
- Failure test: the silent refund. An unacknowledged Play purchase refunds itself and the learner is told nothing by us. That is the class of bug a vendor layer exists to have already met.

### Option 8. RevenueCat as ledger over merchant-of-record rails

The #796 answer, here for composition only. RevenueCat sits over Play, Apple and Paddle Billing; Paddle stays merchant of record on the web; one entitlement, one webhook shape, the store tails carried by the vendor.

- MoR: unchanged, the stores and Paddle.
- Fee shape: 1% of tracked revenue above $2,500 a month, percent only, on top of every rail, including web revenue Paddle already processed and already charged for. That oddity is real: at £30,000 a month it is £300 for RevenueCat to watch Paddle's webhook.
- Composes with: 2, 1, 4; it replaces 7.
- Failure test, not re-argued: a second entitlement authority. If any client code ever reads RevenueCat's SDK state instead of our table, client and server drift, the disease `courseAccess.ts` was built to cure. The ledger reframe answers this cleanly: RevenueCat is a writer to the grants table and nothing reads it.

### Option 9. Off-distribution

**9a. Prepaid credit through Paddle.** One Paddle transaction buys N months of access as a one-off product, no subscription. The grant is written with ends = now plus N months. This is option 1 without auto-renewal and it is native to a grant ledger. Paddle at ₹2,990 one-off is the same 6.5%. It sidesteps UPI Autopay mandates and pre-debit notices entirely. Failure test: churn by default, and an English checkout.

**9b. Play's India alternative billing as leverage rather than build.** Offer Paddle in an embedded webview beside Play billing, at 11% to Google plus Paddle, about 31% at ₹299 and 17.5% at ₹2,990. Worse than either alone on the monthly, roughly level with Play on the annual. Its value is that it is the only route with a Hindi Play sheet and an own-brand checkout in one app. Machinery: PCI attestation or no card data, 24-hour transaction reporting, ExternalTransactions API. More than options 1 to 3, not less; /d/ccb4b7bc option 5 has the detail.

**9c. Institution as the India rail.** No consumer sales in India at all for now: a school or a state programme buys seats on one invoice, and `entitlement_grants` at class or school level, which exists and has two paid rows today, opens the door for every pupil. Fee shape: a bank transfer. The partner in option 3 becomes a distributor with no payment role. Failure test: the Yellow-belt padlock on a consumer phone still needs an answer, even if the answer is "ask your school".

**9d. SSi as merchant of record in India through a local processor.** Razorpay's import flow, SSi registered for Indian GST as an OIDAR supplier from the first sale, monthly filings forever, unpublished fee. The one route that could be percent-only and low, and the one that opens a permanent compliance limb in a country with no other presence. /d/ccb4b7bc option 3 has it. Not developed further here because Tom's ruling values the MoR shield, and this is the option that spends it.

**9e. Ask Paddle.** The sub-$10 custom pricing door is on their pricing page in plain words. If Paddle drops the flat fee on INR, the India rail question collapses into "Paddle everywhere, annual-first, with the Hindi built around it", which is /d/ccb4b7bc option 6 and the smallest build in the space. One email, zero code.

---

## 5. The combinations worth a taste call

Three, each readable cold.

**A. Rails by market, own ledger, annual-first in India.** Play in India with ₹2,990 as the big button, Paddle on the web in the West, Apple later on iPhone, codes for gifts and schools, all writing grants to one table through our own handlers. Options 2 + 1 + 4 + 7. This is what the estate is already pointed at, made honest about its tail: four to six weeks of store integration and a standing maintenance line, with no vendor in the entitlement path and the best percent-only fee in each market. The taste call inside it is whether the four to six weeks is worth the 1% option 8 would save it, which is £300 a month at target and £0 today.

**B. Paddle everywhere, annual and codes carry India, the phone app reads.** No store billing anywhere yet. India is sold as an annual or a prepaid block on Paddle, or as a code through a partner or a school, redeemed on the phone; the West buys on the web and the app shows what they own. Options 6 + 1 + 4 + 9a + 9c, with 9e as the email that could make it permanent. The smallest build in the document by a wide margin, and the one that keeps one till, one receipt, one shield. It stands or falls on two things outside our code: whether Play accepts a reader app in India that offers no Play billing at the padlock, and whether Indian learners pay ₹2,990 up front in an English checkout. Both are testable, the first by submission and the second by a button.

**C. Rails by market with RevenueCat as the writer.** As A, but options 8 replaces 7: RevenueCat carries the two store tails and Paddle's webhook, writes grants to our table, and is read by nothing. Two to three weeks instead of four to six, 1% above $2,500 a month including on web revenue, and a vendor between the stores and the ledger. The #796 answer, placed in the ledger frame where its one real risk, a second authority, is designed out by rule.

Two things decide between them and neither is a fee. The first is the Hindi checkout: A and C give India a Hindi Play sheet, B does not unless Paddle or a partner does. The second is the phone-first share once the Play listing is live, which is one query a month from now: if most Indian learners arrive on the phone, B's reader model has no till in front of them and A or C wins; if they arrive on the web from Aran's pages, B's continuity argument is the stronger one. The fee shape argument is settled either way: in the West Paddle is half the price of a store at every ticket we sell, and in India the ticket size, not the rail, is what moves the fee.
