# What one additional learner costs us to serve for a month, by region

**2026-09-11. Delivery only — no content creation, no TTS, no authoring, no voice artists.**
Marginal cost of one *additional new* individual learner, not an average.
Every input is labelled **[MEASURED]** or **[ASSUMED]** on its own line.

---

## The table

One new individual learner, first month, on the path we actually serve audio over.

| Region | Per-GB rate that applies | GB pulled, first month | **Marginal delivery cost** | Revenue | **Cost as % of revenue** |
|---|---|---|---|---|---|
| **UK** | **$0.21/GB** — $0.15 Fast Data Transfer at lhr1 + $0.06 origin transfer at dub1 | **0.028 GB** | **0.66p** | £5.00/month | **0.13%** |
| **Europe** | **$0.21/GB** — $0.15 at dub1 + $0.06 origin | **0.028 GB** | **0.66p** | *price not set* | — |
| **India** | **$0.26/GB** — $0.20 Fast Data Transfer at bom1 + $0.06 origin at dub1 | **0.028 GB** | **0.75p** | ₹299/month (**£2.32**) | **0.32%** |
| **Rest of World** | **$0.22/GB typical** ($0.16 + $0.06), **$0.41/GB worst** ($0.35 Seoul + $0.06) | **0.028 GB** | **0.70p typical, 1.10p worst** | *price not set* | — |

All rates from Vercel's published regional pricing for lhr1, dub1, bom1, sin1, hnd1, hkg1, syd1,
gru1, cpt1 and icn1, plus AWS S3 and Supabase pricing, **all retrieved 2026-09-11**. Costs include
audio egress, the app shell, course bundles, edge requests and S3 GETs. FX **£1 = ₹129.03 = $1.352**,
European Central Bank reference rates for **2026-09-10**.

**The answer to the question is that region barely matters.** The whole spread from cheapest (UK)
to the single most expensive edge region on Vercel's published list (Seoul) is **0.66p to 1.10p** —
less than half a penny. **Mumbai is not the expensive tier**: at $0.20/GB it is 1.33× London, where
Vercel's published range runs to $0.35. Delivery is a third of one percent of the Indian ticket.

**Rest of World basis [ASSUMED]:** "typical" is $0.16/GB, the rate shared by Singapore, Tokyo, Hong
Kong and Sydney. "Worst" is **Seoul at $0.35/GB**, which is the top of Vercel's entire published
range — I checked all nine non-European regions to find where it sat rather than assuming. São Paulo
is $0.22 and Cape Town $0.28.

### The same table across real engagement, because the mean hides everything

The month-1 distribution is savagely bimodal [MEASURED]: of 137 real learners, **31 touched ten
clips or fewer** and left, while **40 passed 200**. The table above uses the *returned learner*
profile — someone who came back for a second session, which is the only kind who would ever pay.

| Learner profile [MEASURED] | UK | Europe | India | RoW typical | RoW worst |
|---|---|---|---|---|---|
| median joiner, 54 clips | 0.10p | 0.10p | 0.11p | 0.11p | 0.15p |
| mean, 475 clips | 0.40p | 0.40p | 0.45p | 0.43p | 0.65p |
| **typical paying, 843 clips** | **0.66p** | **0.66p** | **0.75p** | **0.70p** | **1.10p** |
| engaged, 1,527 clips | 1.15p | 1.15p | 1.31p | 1.21p | 1.92p |
| p99, 5,008 clips | 3.62p | 3.62p | 4.14p | 3.82p | 6.10p |

**Even the p99 learner in the most expensive region on earth costs 6p a month to serve.**

**From month two it collapses to about 0.10p** in every region — an established learner makes a
**[MEASURED]** mean of 51 real network fetches a month, because the content is already on the device.

---

## What a new learner actually pulls down

This is the load-bearing measurement, and it is the one the August model got wrong.

A **new** learner has an **empty device cache**, so every distinct clip they touch crosses the
network. An established learner replays content they already hold. **[MEASURED]** the estate-wide
98.5% cache-hit rate is dominated by the second kind and says nothing about a joiner.

**The trap, and why the method changed.** New learners log a *higher* cache-hit rate (99.8%) than
established ones (98.5%) — impossible on an empty cache. The flag records whether the **player**
found the clip in cache at play time, not whether the **network** was touched: progressive prefetch
fetches each clip moments before it plays, so the play logs a hit. **Bytes must therefore be counted
from distinct clips touched, not from the cache flag.**

**[MEASURED]** — every real learner's first 30 days of play, all time, n = 137:

| Month-1 distinct clips | |
|---|---|
| median | 54 |
| mean | 475 |
| **returned, ≥2 sessions** | **843** |
| p90 | 1,591 |
| p99 | 5,008 |

Mean sessions in month 1: 5.8.

**[MEASURED]** mean clip size **33.9 KB** — the full S3 census of 5,127,351 objects (2026-08-18),
independently confirmed today by sampling 45 random Spanish-course clips through the live path,
which returned 33.9 KB to the decimal. One clip size is used across all four rows so the table
isolates the regional rate. **Course mix is the real sensitivity, not region:** the English-for-Hindi
course, the one an Indian learner would most likely take, measures **22.1 KB/clip** (n=45, live) —
which would cut the India figure by **35%**, to about 0.49p. Welsh clips measure 51.2 KB and would
raise it by half.

**[MEASURED]** non-audio bytes: app shell plus scripts and styles, **218 KB** compressed, once, then
service-worker cached; course bundle 20–34 KB gzipped. **[ASSUMED]** 20 bundle fetches a month, and
~250 batched telemetry posts. Requests are 20–30% of the total cost, so if that assumption is 2×
wrong the figures move by roughly 0.1p.

**[MEASURED] School and class accounts are excluded from every number above.** A class is a single
learner row, not a person — 181 exist and 33 of them have played audio (1,934 plays). Those, plus
723 demo, 29 internal and 26 staff accounts, and the two non-human telemetry cohorts, are filtered
out before any figure in this document. No schools model is costed here.

---

## The serving path, and why the region hardly moves the answer

**[MEASURED]** from the deployment config and from live response headers on the production site:

- **Every serverless function executes in Dublin, for every learner on earth** — the deployment pins
  its functions to that one region. There is no Mumbai origin and no Mumbai function.
- A live request confirmed it: entered at the **edge nearest the user**, executed in **Dublin**.
- The audio proxy sets **no-store for the CDN**, to dodge an iOS Safari byte-range bug, with a
  one-year immutable cache for the browser. Every audio request showed a CDN **miss**. So there is
  **no cross-user edge caching** and every fetch traverses the whole path.
- The audio bucket is in **AWS Ireland**.

So for all four regions the path is identical — **S3 Ireland → function Dublin → edge → device** —
and the only leg that changes with the learner's location is the last one. That is why the four rows
sit so close together: **the India-specific rate applies to one leg out of three.**

**[ASSUMED]** S3 → Vercel is free. AWS's pricing page states data transferred from an S3 bucket to
any AWS service **within the same region** is **$0.00**, and Vercel's Dublin region runs in AWS
Ireland. This resolves, in the cheaper direction, a question the August model flagged and priced
conservatively at $0.09/GB. It is an architectural inference, not a line on an invoice.

**[ASSUMED]** origin transfer bills at the **function's** region ($0.06 in Dublin) rather than the
edge's ($0.25 in Mumbai). Vercel describes the resource as traffic "between the CDN and Vercel
Functions" but does not say which rate applies when the two differ. On the other reading the India
figure rises from 0.75p to **1.33p** — still a rounding error against ₹299.

**A cheaper path already exists and is not worth taking.** Presigned direct-to-bucket URLs are
already issued for bulk download, at $0.09/GB against the proxy's $0.21–0.26. Routing ordinary play
through them would take the India learner from 0.75p to about 0.35p — **a saving of four tenths of a
penny, against losing the entitlement check that sits in the proxy.** Noted as a finding, not a
recommendation.

---

## Payment processing on the Indian ticket — this is the real cost

Delivery is a third of a percent of ₹299. **Payment processing is between fifteen and twenty-one
percent of it** — sixty-five times larger.

| Rail | Rate | On ₹299/month | **% of revenue** |
|---|---|---|---|
| **Paddle** — the live rail today | 5% + **$0.50** per transaction [ASSUMED — see gaps] | **48.6p** | **21.0%** |
| **Google Play** — the designed India rail | 15% [ASSUMED, standard rate] | **34.8p** | **15.0%** |
| *For contrast: Paddle on the UK £5 ticket* | 5% + $0.50 | 62.0p | 12.4% |
| *Delivery, India* | — | 0.75p | **0.32%** |

**[MEASURED]** The live billing rail in the code is **Paddle**. **[MEASURED]** the India design dated
2026-09-04 routes India through **Google Play** instead, writing into the same subscriptions table —
a design, not shipped.

The reason the gap matters: Paddle's **$0.50 is fixed**, so it costs the same on a ₹299 ticket as on
a £50 one. At ₹299 that single fixed fee alone is **16.6% of revenue** before the percentage is added.
Google Play's flat 15% has no fixed component and is therefore *better at this price point* — the
opposite of the usual instinct about app-store fees, and it is what makes the designed Play rail
worth roughly **six points of margin** on every Indian subscription.

**The lever, unchanged from August: billing annually avoids the fixed fee eleven times.** On the
Paddle rail that is worth about **£4.28 per learner per year** — roughly **five hundred times** the
entire delivery cost of the learner it applies to.

---

## Fixed estate, set aside

**$48.81/month ≈ £36/month** at today's rate — Supabase Pro, Vercel Pro, S3 storage
[ASSUMED, published rates, carried unchanged from 2026-08-18]. It does not move when one more
learner joins, so it plays no part in anything above.

**One caveat above all the numbers: today every figure here is actually £0.** All of this usage sits
inside Vercel Pro's included first 1 TB of data transfer and first 10 million edge requests. These
rates are what the *next* learner costs once we are past those allowances — the right basis for a
decision about thousands of new learners, but not a bill we are paying this month.

---

## Explicit gaps

- **No billing data of any kind was readable, and I tried properly.** AWS credentials exist and work,
  but that IAM user is **not authorised for Cost Explorer or CloudWatch** — both returned explicit
  access-denied errors. There is **no Vercel token and no Supabase management token** anywhere on the
  machine. So every *rate* here is a published list rate and every *quantity* is measured. An invoice
  would supersede the rate column and would most likely move it down. **Granting billing-read to that
  IAM user is a two-minute job and would make the next version of this authoritative.**
- **Our actual Paddle contract was not read.** The 5% + $0.50 is Paddle's published standard rate.
  Paddle's own pricing page says to contact them for custom pricing on products under $10 — **every
  India tier is under $10, so the rate we would actually be offered may differ**, and no
  India-specific or UPI-specific rate is published anywhere. The Google Play 15% likewise assumes the
  standard small-developer rate.
- **₹299 and £5 are Tom's figures, taken as given.** ₹299 was flagged as his own recollection.
- **No Indian learner has ever used the product.** The engagement distribution is drawn from a
  mostly-UK base and applied to India. The clip sizes are real.
- **Whether origin transfer bills at the function's region or the edge's is unresolved** — worth
  0.58p per Indian learner, quantified above.
- **The Europe row uses the Dublin rate.** Frankfurt, Paris and Stockholm were not individually
  checked; Dublin is a European region and is where our functions run, so it is the right
  representative, but it is not a survey.
- **Request counts per learner are modelled, not measured** — distinct clips are measured, the
  telemetry and bundle request counts are read off the code's batching behaviour.
- **n = 137** for the month-1 distribution and **n = 45 per course** for clip sizes. The clip sizes
  are tight; the engagement distribution is bimodal enough that no single number represents it, which
  is why the range table is there.
- **Supabase database egress per learner was not measured** — it is bounded well inside the included
  250 GB at current scale. At 100,000 learners it would need measuring, and Supabase's **$0.00325 per
  monthly active user beyond the first 100,000** would then become the largest recurring marginal
  term of all, at 0.25p — larger than the bandwidth it is being compared with.
- **Content creation is excluded entirely**, per instruction. These are delivery costs only.
