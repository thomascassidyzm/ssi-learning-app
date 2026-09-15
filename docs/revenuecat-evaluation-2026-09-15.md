# RevenueCat as the single subscription and entitlement layer

Scout, read-only, 2026-09-15. Commissioned by Tom: "have a look at RevenueCat as a service, for the native apps and webapp combined so that we can avoid all the payment shenanigans." Every vendor number below was fetched from the vendor's own page on 2026-09-15. Every SSi fact comes from the live code in this checkout or the live database, not from docs.

## What SSi bills through today

- **Web: Paddle, and nothing else.** `api/_utils/paddle.ts`, `api/teacher/paddle-webhook.ts`, `api/subscription/*`, `useCheckout.ts`. A grep of `api/` for stripe, recurly, revenuecat, storekit and google_play finds no non-test billing file. The Wise webhook is teacher commission payouts, not billing. Paddle is merchant of record on this rail.
- **Neither store is wired.** `paymentRoute.ts` sends web to Paddle and the native shell to a store route, with `STORE_BILLING_WIRED = false`. Capacitor 8.5 is installed for Android and iOS. No purchases plugin is installed.
- **Live subscriptions table, counted 2026-09-15 read-only:** 19 rows, all provider paddle. 7 active, made up of 5 SSi Premium and 2 SSi Family. 12 cancelled. Up from 16 rows and 4 active on 2026-09-06. The row is UNIQUE per learner and keyed to Paddle by provider_subscription_id and provider_customer_id.
- **Legacy native app:** Apple IAP via StoreKit, plus Stripe and Recurly subscribers on automagic.saysomethingin.com. Nobody has a credential for that backend. Its subscriber counts remain an explicit gap and this scout did not try to fill it.
- **Type drift:** `packages/core/src/pricing/types.ts` still types the subscription source as stripe, gift, government or admin_grant. The live rail is Paddle. Cosmetic, worth fixing when the store rail lands.

## 1. Merchant of record

RevenueCat now offers three web billing engines, and the merchant of record differs by engine. From the RevenueCat Web overview page, fetched 2026-09-15:

| Engine | Merchant of record | Tax and VAT |
|---|---|---|
| RevenueCat Billing, their own engine on Stripe | **SSi** | SSi registers and remits. Stripe Tax calculates only. |
| Stripe Billing | SSi by default, Stripe if Managed Payments is enabled | Stripe Managed Payments makes Stripe MoR at +3.5% per transaction |
| Paddle Billing | **Paddle** | Paddle registers, files and remits, as today |

So the answer to "does RevenueCat Web Billing make SSi the merchant of record" is yes for RevenueCat's own engine. Under it SSi takes on what Paddle carries today: UK VAT, EU VAT via OSS, US state sales tax nexus tracking, invoicing, chargebacks, refunds and currency. RevenueCat's tax page says only that you should "seek tax advice from a qualified tax accountant". Stripe Tax softens the calculation, at 0.5% per transaction on the no-code plan or from €80 a month on Tax Complete with two registrations and four filings a year, with non-US filings costing extra. It does not remove the registrations or the quarterly returns. Under that design an SSi accountant would run a UK VAT return, an EU OSS return and a US nexus check each quarter, plus dispute handling. Under Paddle, or under Stripe Managed Payments, the accountant reconciles one payout statement and nothing else. That is the whole point of a merchant-of-record rail and it should not be given up for a percentage point.

## 2. Can RevenueCat sit over Paddle

**Yes, fully.** RevenueCat's Paddle Billing integration launched 2025-06-04 and the docs page fetched 2026-09-15 lists what it supports: importing external purchases, the Web SDK, Web Purchase Links, web paywalls, funnels and redemption links. The doc states: "Paddle acts as the billing engine and merchant of record. This means that Paddle operates the subscription, sends receipts and emails to subscribers, and handles any subscription management." It is not receipt ingestion only. It runs embedded Paddle checkouts through RevenueCat's purchases-js SDK, and it tracks purchases automatically through Paddle webhooks once a Paddle API key with read access to customers, subscriptions, products and prices is pasted in. Existing subscriptions can be imported manually via the receipt endpoint using the Paddle subscription id and an app_user_id. A Paddle Price maps to a RevenueCat Product. Entitlements are RevenueCat's usual model: keyed to app_user_id, identical across the web and native SDKs.

Two limits from the doc worth naming. RevenueCat's own Customer Portal and product configuration are not used with Paddle, so subscription management stays on Paddle, which is what SSi's portal and change-plan routes already do. And "purchases that contain only one product" are supported, so the checkout must never bundle a setup fee or a second item. SSi's checkout sells one price per transaction today.

## 3. Fees at our scale

RevenueCat pricing page, 2026-09-15: free up to $2,500 monthly tracked revenue, then 1% of everything tracked. Unchanged from the part-2 Play Billing doc of 2026-09-03, so that doc's "about £300 a month at £30k" still stands. Note that tracked revenue includes store revenue, so the 1% is on the whole subscription business once RevenueCat is the ledger, not just the web slice.

| Rail, design | Vendor fees per £100 | Source, 2026-09-15 |
|---|---|---|
| Paddle, as today | £5.40, being 5% plus 50¢ | paddle.com/pricing |
| Paddle under RevenueCat | £6.40 at £30k or £60k; £5.40 today below $2.5k tracked | paddle.com/pricing, revenuecat.com/pricing |
| RevenueCat Billing, SSi as MoR | £3.20 UK card to £5.85 international plus 2% FX, plus VAT returns and registrations | stripe.com/gb/pricing, stripe.com/tax/pricing |
| Stripe Billing with Managed Payments, Stripe as MoR | £6.20 UK card to £8.85 international plus 2% FX | stripe.com/gb/managed-payments, plus 1% |
| Google Play, small tier under RevenueCat | £16 | Play service fee 15% on subscriptions, first $1M, plus 1% |
| Apple App Store, small business under RevenueCat | £16 | 15% under $1M prior-year proceeds, plus 1% |

Monthly RevenueCat cost: £0 today, roughly £300 at £30k, roughly £600 at £60k. Stripe Managed Payments would cost roughly £1,050 a month more than Paddle at £30k for the same merchant-of-record outcome. RevenueCat's own engine looks cheapest on the table and is dearest in practice, because the accountant's quarter is the cost that is not on the table.

## 4. Migration shape for the 7 live Paddle subscribers

- **Paddle under RevenueCat, the recommended design.** The live subscriptions stay exactly as they are. No re-consent, no new card entry, no email to a subscriber. Two things happen: RevenueCat is given a Paddle API key and webhook and starts tracking every renewal, and the 7 active subscriptions are imported once via the receipt endpoint with app_user_id set to the learner id. Code that changes in this repo: one new RevenueCat webhook receiver writing the same subscriptions table, as india-entitlement-design.md already specifies, and the native store route in paymentRoute.ts. The Paddle webhook, the four subscription routes and useCheckout.ts stay byte for byte. Optionally the web checkout later moves to RevenueCat's purchases-js with the Paddle engine so the web paywall and the native paywall are one component, but that is not required for entitlement to unify.
- **RevenueCat Billing replacing Paddle.** Every live subscriber must re-consent on a new Stripe-backed checkout because a Paddle subscription cannot be moved to Stripe. SSi becomes merchant of record. The whole Paddle code surface, about 4,000 lines across the webhook, routes and checkout, is rewritten. With 7 active rows the re-consent is not the problem; the merchant-of-record change is.
- **RevenueCat for stores only, Paddle left alone.** Nothing happens to the Paddle rows and nothing Paddle changes. But entitlement is then two ledgers, the Paddle webhook writing one table and RevenueCat writing another view of it, and a learner who buys on the web and opens the Android app is only unlocked if the server table wins every time. That is exactly the unification Tom asked for and this design does not give it.

The count matters in one way only: at 7 active rows, migration cost is not a discriminator between designs. The discriminator is merchant of record, and that is decided by the engine, not by the row count.

## 5. Recommendation

**RevenueCat as the one entitlement ledger over all three rails, with Paddle kept as the web billing engine and merchant of record through RevenueCat's Paddle Billing integration, and @revenuecat/purchases-capacitor for Play and StoreKit.** One entitlement id, `full`, as india-entitlement-design.md already names it, checked from one CustomerInfo on every platform.

- **Better.** A learner who pays anywhere is unlocked everywhere, because one app_user_id keyed to the learner id carries one entitlement across web, Android and iOS. Paddle keeps sending the receipts and running the portal, so nothing a subscriber sees today changes.
- **Simpler.** One ledger instead of three. The store rail is a plugin and a webhook rather than two hand-built receipt validators. The Paddle code stays untouched and the 7 live subscribers are never asked to do anything.
- **Cheaper.** Free until $2.5k tracked, about £300 a month at the £30k target, against weeks of engineering for raw Play and StoreKit validation and against roughly £1,050 a month more for Stripe Managed Payments to reach the same merchant-of-record position. The accountant's quarter stays as it is.

All three legs hold. The honest cost is the 1% on the whole subscription business once the stores are live, which the part-2 doc already left to Tom as the money decision, and this scout confirms the number is current.

**The failure test that fails silently:** identity drift between app_user_id and the learner. If a web purchase lands under one app_user_id and the phone signs the RevenueCat SDK in under another, because of an email alias or an account merge, the learner has paid and sees the paywall, and no log fires. The guard is already written into india-entitlement-design.md: the server's subscriptions table is the authority, RevenueCat's webhook writes into it, and the SDK state is never trusted on its own. The one probe to keep forever is a buy-on-web, open-on-phone walk on a fresh account after every identity change.

**What would change the answer, one line each:**
- RevenueCat drops or restricts the Paddle engine: fall to stores-only RevenueCat and keep Paddle standalone.
- SSi ever wants a bundle or setup fee in one checkout: the Paddle engine's one-product limit blocks it.
- Revenue passes $1M a year: the store cut doubles to 30% and web-to-app funnels become the lever, which is also RevenueCat territory.
- Tom rules that 1% of the whole business is too much: the fallback is the raw Play plugin named in part-2, and the web stays Paddle with the entitlement table as the only bridge.

## Explicit gaps

- Legacy backend subscriber counts on Apple, Stripe and Recurly: no credential, not attempted, per the brief.
- Stripe Managed Payments per-country availability for the UK entity was read from Stripe's GB page but not confirmed with Stripe.
- RevenueCat's tax page does not state who registers; the merchant-of-record table above rests on the Web overview page's own comparison, quoted, not on a legal reading.
- The one-product-per-purchase limit was not tested against SSi Family's Paddle price configuration.
