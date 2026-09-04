# Part 2 — wiring Google Play Billing

**Scope only. Nothing here is started.** Part 1 (branch `cs/509-payment-route`) built the
route seam and made the store build safe; this is what part 2 has to do to make it able to
take money.

The one thing to remember from part 1: **`STORE_BILLING_WIRED` in
`packages/player-vue/src/platform/paymentRoute.ts` is `false`.** Flipping that single
constant to `true` turns every consumer payment affordance in the app back on in the native
build. Part 2 is not a UI job — the UI is already written and already asks the right
question. Part 2 is a purchase-execution job plus a receipt-verification job.

---

## 1. The Capacitor plugin

**`@revenuecat/purchases-capacitor`** is the recommendation, not raw
`@capacitor-community/in-app-purchases`.

| | RevenueCat | Raw Play Billing plugin |
|---|---|---|
| Better | Handles the parts that actually bite: acknowledgement within 3 days (an unacknowledged Play purchase is auto-refunded), restore-purchases, grace period, account hold, upgrade/downgrade proration, and — the one that matters most — **StoreKit later for free**. | You write all of that. Twice. |
| Simpler | One SDK, one webhook shape for both stores. | Two stores, two receipt formats, two server verifiers. |
| Cheaper | Free below $2.5k/month tracked revenue, then 1% of that revenue. At £30k/month that is ~£300/month. | £0 in fees, but the engineering to reach parity is weeks, and the failure mode is silent refunds. |

The 1% is real money and it is the honest cost of the recommendation. The counter-argument
is that iOS is coming, and doing StoreKit by hand later is a second full build of the same
thing. **If Tom would rather not pay 1%, the fallback is `@capacitor-community/in-app-purchases`
and part 2 roughly doubles.** That is his call, not the agent's — it is a money decision, not
a detail one.

Either way the app-side surface is small, because the seam already exists:

- a `packages/player-vue/src/platform/storeBilling.ts` module (inside the seam directory, so
  the one-door test keeps it there) exposing `purchase(productId)`, `restore()` and
  `currentEntitlement()`;
- `useCheckout.startCheckout()` branches on `paymentRoute()`: `'paddle'` → today's path,
  `'store'` → `storeBilling.purchase(...)`. That is the ONLY call-site change in the whole
  app, because part 1 already funnelled all fourteen affordances through one composable;
- `STORE_BILLING_WIRED = true`.

## 2. Server-side receipt verification, against Supabase

**Never trust the client's word that a purchase happened.** The existing money spine already
has the right shape for this, which is why part 2 is smaller than it looks:

- `subscriptions` already carries a **`provider`** column (`'paddle'` today) plus
  `provider_subscription_id` / `provider_customer_id`. A Play subscription is the same row
  with `provider: 'google_play'`. **No schema change is expected** — confirm against the live
  table before assuming it.
- `processed_webhook_events` already dedupes on `(provider, event_id)`. Play/RevenueCat
  events insert with `provider: 'google_play'` and the same fail-closed behaviour.
- `api/entitlement/user.ts` reads entitlement without caring who was paid. It should need no
  change at all — that is the test that the abstraction held.

New work:

1. **`api/store/play-webhook.ts`** — mirrors `api/teacher/paddle-webhook.ts` in structure but
   not in size (there is no seat/org/tutor lane in a store build; consumer premium only).
   Must:
   - verify the payload signature (RevenueCat webhook auth header, or Google Pub/Sub push +
     `googleapis` `androidpublisher.purchases.subscriptionsv2.get` for the raw route);
   - **re-fetch the purchase from Google before writing** — the webhook body is a
     notification, not proof;
   - resolve the learner **server-side** from the app-account token, never from client-supplied
     data (the same rule the Paddle webhook already states in its header);
   - insert into `processed_webhook_events` first, fail closed on dedupe unavailability;
   - upsert `subscriptions` with `provider: 'google_play'`.
2. **App-account token binding** — the purchase must carry `obfuscatedAccountId` =
   `learners.id`, set at purchase time, so the webhook can resolve the learner without trusting
   the client. This is the one piece with no Paddle equivalent to copy.
3. **Restore purchases** — a real requirement for store review, and the path a reinstalling
   learner takes. One button in Settings, gated on `paymentRoute() === 'store'`.
4. **Tests** — the Paddle webhook's test file is the template: signature rejection, dedupe,
   downgrade guard, and a fixture per event type.

## 3. What Tom has to do himself, in Play Console

None of this can be done from the codebase, and part 2 cannot be finished without it:

1. **Decide the application id.** The wrapper currently ships `com.saysomethingin.devwrap`
   (deliberately throwaway). The live listing is `com.automagic.a3f`. Taking that id updates
   the app under every existing user of it; taking a new one starts from zero installs.
   **Irreversible, and Tom's call.**
2. **Create the subscription product(s)** — at minimum the £15/month consumer premium, base
   plan + offer, with India pricing set in INR. UPI comes free with Play Billing in India; it
   is not a separate integration.
3. **Set the price in every market you sell in** — Play does not derive them from a GBP price
   the way Paddle does.
4. **Create a service account** with `androidpublisher` scope, grant it "View financial data"
   and "Manage orders and subscriptions" in Play Console, download the JSON key, and put it in
   Vercel env (`GOOGLE_PLAY_SERVICE_ACCOUNT_JSON`). Server verification cannot work without it.
5. **Enable Real-time Developer Notifications** and point them at the Pub/Sub topic (or at
   RevenueCat, if that route is chosen).
6. **Set up a licence-tester account** so purchases can be tested end to end without real
   charges.
7. If RevenueCat: create the project, add the Play app, paste the service-account JSON, and
   copy the public SDK key into `VITE_REVENUECAT_KEY`.

Items 1 and 2 block everything else. Items 4 and 5 block the server half specifically.

## 4. What part 2 must NOT do

- **Do not add an institutional/seat purchase route to the store build.** It is absent from the
  artifact by construction (`__INSTITUTIONAL_PURCHASE__`, `vite.config.js`), and
  `e2e/_payment-route-bundle-check.mjs` fails if it comes back. Organisations buy on the web.
- **Do not add a link out to a web purchase page.** No URL, no price, no "subscribe at…".
  That is the exact thing both stores reject.
- **Do not introduce a second payment-route declaration.** `scanPlatformDoors` now fails the
  build on one.
