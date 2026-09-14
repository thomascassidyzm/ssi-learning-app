# Revenue for admin Insights: what Paddle gives us today, and the one-table ledger

Read-only scout, 2026-09-14. Follows *The delivery-side intelligence surface* of 2026-09-10, which
said a receipts ledger fed by the Paddle webhook was the answer. This read opened the Paddle SDK, the
handler line by line and the live database. That recommendation stands, sharper on both halves.

## The recommendation

**Build our own one-table revenue ledger, written by the Paddle webhook, and point admin Insights at
that — not at Paddle.** Yes or no.

Better: it is the only place that can join money to a learner, a course, a class, a school, so it
answers questions Paddle structurally cannot, and it survives Apple, Stripe, Google Play or whatever
comes next arriving as a second writer rather than a second integration. Simpler: one table, one
insert per money event, no vendor client in the read path, no API key on a dashboard route, and the
shape already exists in this repo as `tutor_rebate_ledger`. Cheaper: the webhook already receives and
already parses the amount on both the paid and the refund paths and throws it away, so the marginal
cost is an insert, not a pipeline — whereas a Paddle-direct Insights view is a permanent live
dependency on a vendor API that will never see the non-Paddle doors.

## Is Paddle-direct easy or messy? Easy for totals, useless for our questions

Genuinely easy, and easier than the earlier read assumed. The SDK we already ship, version 3.8.0,
carries a whole Metrics resource: `getMonthlyRecurringRevenue`, `getRevenue`, `getRefunds`,
`getChargebacks`, `getActiveSubscribers`, `getCheckoutConversion`. Each returns a ready timeseries.
A Paddle-only MRR chart is perhaps an afternoon.

The catch is in the query parameters. Every one of those seven calls takes exactly `from` and `to`.
No dimension, no filter, no grouping. So Paddle can tell us the company MRR line and nothing about
which course, which school, which teacher's students, which cohort, or which learner. It also cannot
be joined to anything we hold, because Paddle knows a customer id and we key everything on
`learners.id`. And it sees one of at least four doors — Paddle, Apple, Stripe, Recurly — so the
number it gives is not SSi revenue, it is Paddle revenue, and nothing in the chart says so.

Verdict: perfect for a glance at a dashboard Paddle already draws for us, wrong as the foundation of
an Insights surface.

## What the webhook already has in its hand

Field map against the vendored SDK types, not memory.

- `transaction.paid` carries `details.totals` with `subtotal`, `discount`, `tax`, `total`,
  `grandTotal`, `grandTotalTax`, `currencyCode`, plus `fee` and `earnings` which are typed nullable;
  `details.payoutTotals` with non-nullable `fee`, `earnings`, `exchangeRate`, `feeRate`, but that
  object is itself nullable; `items[].price.id` and `product`, `billingPeriod.startsAt/endsAt`,
  `customerId`, `subscriptionId`, `address`, `currencyCode`, `billedAt`, `customData`.
  The handler reads `details.totals.grandTotal` at line 1796 and uses it for one decision — is this
  zero — then drops it. Nothing else is stored.
- `transaction.completed` is an explicit no-op at line 394. This matters: net after Paddle's fee is
  where the nullable typing points, and completed is the event where Paddle settles it. Our own
  dedup table shows 15 paid and 15 completed, landing about one second apart, so completed is
  reliable and immediate here. **Check before building: whether `fee`/`earnings` are actually
  populated on our live events, and on which of the two. That decides whether "revenue" in Insights
  can mean net or must mean gross.**
- `adjustment.created` carries `action`, `reason`, `totals.total`, `payoutTotals` with `fee`,
  `chargebackFee`, `earnings`, `transactionId`, `subscriptionId`, `currencyCode`. The handler reads
  the total at line 259 to decide full versus partial refund, then drops it.
- `subscription.*` carries `currencyCode`, `currentBillingPeriod`, `items[].price`, `billingCycle`,
  `startedAt`, `canceledAt`. We store status, plan, period end and the two provider ids — no money.

Every figure a revenue ledger needs is already arriving. None of it is kept.

## Live inventory, 2026-09-14

Queried against the live database, correcting the 2026-09-10 numbers where they moved.

- `subscriptions`: **18 rows**, was 17. All `provider = 'paddle'`. Five active SSi Premium, one
  active SSi Family, twelve cancelled Premium. Columns: no amount, no currency, no period start, no
  country. `signup_course_code` is null on 7 of 18, so course attribution is missing on 39 per cent
  of rows even where it is the only attribution that exists, and it is set at signup only.
- `processed_webhook_events`: **81 rows**, all Paddle — 29 `subscription.updated`, 15
  `transaction.paid`, 15 `transaction.completed`, 9 activated, 6 created, 4 canceled, 3 past_due,
  spanning 2026-06-16 to 2026-09-12. The table holds `provider`, `event_id`, `event_type`,
  `processed_at` and **no payload**, so there is nothing local to replay a backfill from.
- `teacher_commissions`: **0 rows**. `tutor_rebate_ledger`: **0 rows**. `teacher_referrals`: **0
  rows**. No commission money has ever moved.
- Platform billing: `groups.platform_status` is trial on 12 rows and null on 92;
  `schools.platform_status` is trial on all 43. No paid platform row exists, so org and school
  revenue in the app today is zero, not merely unmeasured.
- No `receipts`, `payments`, `transactions`, `invoices` or `revenue` table exists in the schema.
  `tutor_rebate_ledger` is the only signed-money table in the database.

## The ledger, one table

`revenue_events`, append-only, signed minor units:

`id` · `provider` · `provider_ref` — the Paddle transaction or adjustment id · `entry_type` —
charge, refund, chargeback, chargeback_reverse · `occurred_at` · `currency_code` · `gross_minor`
signed · `tax_minor` · `fee_minor` nullable · `net_minor` nullable · `settlement_currency` ·
`learner_id` · `subscription_id` · `plan_name` · `price_id` · `course_code` · `country` ·
`period_start` · `period_end`. Unique on `(provider, provider_ref, entry_type)`, exactly the
idempotency key `tutor_rebate_ledger` already uses.

That answers revenue by month, MRR from active rows and period length, refunds, and per-learner
lifetime value by a sum over `learner_id`. What it cannot answer honestly without more work: revenue
per course, because `signup_course_code` is the only attribution and it is absent on 39 per cent of
rows and never updated; and net after fees, if the live events turn out to carry null fees at paid
time. And nothing in it covers Apple, Stripe or Recurly until somebody exports those rails into the
same table — until then every chart needs the words "Paddle only" on it.

## Distance from here

Small, with one trap. The insert belongs at the **top** of `handleTransactionPaidEvent`, before the
subscription lookup at line 1744 — not where the amount is parsed at line 1796, which sits behind the
`if (!referral) return` gate at line 1774. Today almost every transaction, including every learner
Premium payment, returns before the amount is ever read. A naive insert at the parse site would
capture only tutor-referral sales, which is currently none of them.

Shape: one insert in `handleTransactionPaidEvent`, one in `handleAdjustmentEvent` beside the existing
`recordRebateLedgerLine` calls, and — if net matters — turning the `transaction.completed` no-op at
line 394 into an update of fee and net on the row the paid event wrote. Roughly 120 to 180 lines
across the handler, one migration, one helper mirroring `recordRebateLedgerLine`. Idempotency does
**not** come free from `processed_webhook_events`: that row is deleted on a handler error so retries
reprocess, so the ledger needs its own `(provider, provider_ref, entry_type)` unique index, the
pattern already proven next door.

Backfill is available and cheap: `paddle.transactions.list()` returns every historical transaction
with full totals, so the ledger can be populated from Paddle's own history and would not be empty on
day one. Fifteen paid transactions is a small history, but it is the whole history.

## Honest gaps

- **No live Paddle API call was made.** No `PADDLE_API_KEY` is present on this machine and pulling
  production secrets was outside this read. Everything said about the Paddle API comes from the
  vendored SDK 3.8.0 type definitions, which are authoritative for shape but not for which nullable
  fields are populated on our live events. The fee-and-net question above is the one thing to check
  with one read-only call before building.
- Paddle's only active webhook destination is staging, so the 15 paid events above are what staging
  received. Dev and main receive none.
