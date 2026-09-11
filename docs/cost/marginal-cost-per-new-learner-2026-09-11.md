# What one additional learner costs us to serve for a month

**2026-09-11. Marginal delivery cost only — no content-creation costs of any kind.**
Refreshes and extends the 2026-08-18 per-learner cost floor. Every input below is labelled
**[MEASURED]** or **[ASSUMED]** on its own line.

---

## The two numbers

**One additional NEW learner in India costs about 0.4p to serve in their first month.**
Range across real usage: **0.10p** for a median joiner who tries it and stops, **1.1p** for one who
actually engages, **5.5p** for a p99 heavy user. From month two onward it falls to **0.09p**.

**One additional NEW Welsh school seat costs between 0.11p and 1.2p in its first month**, and the
spread is almost entirely the cache-hit rate:

| Device-cache hit for the new seat | Bytes pulled | Cost, month 1 |
|---|---|---|
| **0%** — own device, 1:1, nothing pre-cached | 43.0 MB | **0.93p – 1.22p** |
| 50% — two learners sharing a device | 21.9 MB | 0.50p – 0.65p |
| 80% — shared trolley, course already on the tablet | 9.3 MB | 0.24p – 0.30p |
| 95% | 3.0 MB | 0.11p – 0.13p |

**A 1:1 classroom is the expensive end and it is still just over a penny.** From month two a Welsh
seat costs **0.12p**.

The fixed estate — Supabase Pro, Vercel Pro, S3 storage — is **$48.81/month ≈ £38/month**
[ASSUMED, published rates, carried unchanged from 2026-08-18]. It is named here so you know it
exists and is then set aside: it is not modelled, not divided across learners, and does not move
when one more learner joins.

**And the honest caveat that sits above all of it: today every one of these numbers is actually £0.**
All of this usage is inside Vercel Pro's included first 1 TB of data transfer and first 10 million
edge requests. The rates below are what the *next* learner costs once we are past those allowances —
which is the right way to price a decision about thousands of new learners, but it is not a bill we
are paying this month.

---

## The spine: what a NEW learner actually pulls down

This is the load-bearing measurement and it is the thing the August document could not see.

A new learner has an **empty device cache**, so every distinct clip they touch must cross the
network. An established learner replays content they already hold. The two are not comparable, and
August's estate-wide 97.7% cache-hit figure is dominated by the second kind.

**[MEASURED]** `player_events`, every real learner's first 30 days of play, all time.
n = 137 learners, after excluding `is_demo` / `is_internal` / `is_class_entity` /
`platform_role in (ssi_admin, popty_user, tester)` and the JP and FI non-human cohorts.

| Month-1 distinct clips touched | Clips |
|---|---|
| p25 | 16 |
| **median** | **54** |
| mean | 475 |
| p75 | 299 |
| p90 | 1,591 |
| p99 | 5,008 |
| max | 6,985 |

**[MEASURED]** Of those 137, **31 touched 10 clips or fewer** — they opened it and left. **40 passed
200 clips.** Mean sessions in month 1: 5.8. The distribution is savagely bimodal, which is why every
figure in this document is given as a range and why the mean is the least useful number in it.

**[MEASURED]** An **established** learner (month 2+) makes a mean of **51 real network fetches per
month** across a mean of 3,466 plays — a 98.5% play-time cache-hit rate, on the refreshed 30-day
window. A new learner in the same window shows 99.8% — *higher* — which is the tell that the
`cacheHit` flag records whether the **player** found the clip in cache at play time, not whether
the **network** was touched. Progressive prefetch fetches the clip a moment before it plays, so the
play logs a hit. **This is why distinct-clips-touched, not `cacheHit`, is the correct basis for a
new learner's bytes**, and it is the one methodological change from August.

**[MEASURED]** Clip sizes, sampled live through the real serving path today:

| Course | Mean | Median | p90 | n |
|---|---|---|---|---|
| `eng_for_hin` (India) | **22.1 KB** | 20.5 KB | 35.7 KB | 45 |
| `cym_s_for_eng` (Wales) | **51.2 KB** | 38.0 KB | 79.6 KB | 45 |
| `spa_for_eng` | 33.9 KB | 30.1 KB | 54.6 KB | 45 |

Welsh clips are **2.3x the size of Hindi-course clips**, and that single fact is most of why a Welsh
seat costs more than an Indian learner at the same engagement.

**[MEASURED]** Non-audio bytes, fetched live today: app shell + JS + CSS, compressed, **218 KB**
once (then service-worker cached); course bundle **20 KB** gzipped for `eng_for_hin`, **34 KB** for
`cym_s_for_eng`. **[ASSUMED]** 20 bundle fetches a month. Both are rounding errors next to audio.

---

## The serving path, leg by leg

**[MEASURED]** from `vercel.json` and from live response headers on `saysomethingin.app`:

- `"regions": ["dub1"]` — **every serverless function executes in Dublin, for every learner on
  earth.** There is no Mumbai origin and no Mumbai function.
- A live request returned `x-vercel-id: arn1::dub1::…` — entered at the edge PoP nearest the user,
  executed in dub1. An Indian learner enters at **bom1** and is served by a **dub1** function.
- `x-vercel-cache: MISS` on every audio request. `/api/audio/[audioId].ts` sets
  `Vercel-CDN-Cache-Control: no-store` and `CDN-Cache-Control: no-store` (to dodge an iOS Safari
  byte-range bug), with `Cache-Control: public, max-age=31536000, immutable` for the browser.
  **So there is no cross-user edge caching, and every miss traverses the whole path.**
- S3 bucket is **eu-west-1** (`AWS_REGION=eu-west-1`, and the CSP allows only
  `*.s3.eu-west-1.amazonaws.com`).

So for **both** populations the path is identical: `S3 eu-west-1 → Vercel function dub1 → edge PoP
→ device`. The only thing India changes is the last leg's regional rate.

### Rates, sourced and dated

All retrieved **2026-09-11** from `vercel.com/docs/pricing/regional-pricing/{bom1,lhr1,dub1}`,
`aws.amazon.com/s3/pricing` and `supabase.com/pricing`.

| Leg | India (bom1 edge) | Wales (lhr1 edge) |
|---|---|---|
| S3 egress → Vercel function, same region | **$0.00/GB** [ASSUMED — see below] | **$0.00/GB** [ASSUMED] |
| Vercel Fast Origin Transfer | $0.06/GB (dub1) — or $0.25/GB if billed at bom1 | $0.06/GB |
| Vercel Fast Data Transfer | **$0.20/GB** | **$0.15/GB** |
| Edge requests | $2.20/M | $2.40/M |
| S3 GET | $0.0004/1,000 | $0.0004/1,000 |
| **Blended proxied rate** | **$0.26/GB likely, $0.54/GB worst** | **$0.21/GB likely, $0.30/GB worst** |
| Direct presigned S3, for comparison | $0.09/GB | $0.09/GB |

**Mumbai is not the expensive tier.** Vercel's published range for Fast Data Transfer is $0.15–$0.35
per GB, and bom1 sits at **$0.20** — only **1.33x** Dublin's $0.15, not the premium the question
assumed. What *is* 4.2x more expensive in Mumbai is **Fast Origin Transfer, $0.25/GB against dub1's
$0.06** — and whether that even applies to us turns on whether Vercel bills origin transfer at the
function's region or the edge's. Our functions are in dub1, and Vercel's own documentation describes
Fast Origin Transfer as traffic "between the CDN and Vercel Functions". **[ASSUMED]** it bills at
dub1; the worst-case column prices it at bom1 so the exposure is visible either way. The difference
between those two readings is about **0.2p per new Indian learner**.

**The August document's flagged S3→Vercel question is now resolved, in the cheaper direction.** AWS's
pricing page states that "data transferred from an Amazon S3 bucket to any AWS service(s) within the
same AWS Region" is **$0.00**. Vercel's dub1 runs on AWS eu-west-1 and our bucket is eu-west-1, so
that leg is very likely free rather than the $0.09/GB internet rate August used throughout. The
worst-case column keeps $0.09 because this is an architectural inference, not a line on an invoice.

**[MEASURED]** No Popty service sits on the learner path. The player's only network dependencies are
`saysomethingin.app` (Vercel), `*.supabase.co` and `*.s3.eu-west-1.amazonaws.com` — the full
`connect-src` allowlist in the deployed CSP. The August exclusion of the build machines still holds.

---

## Model 1 — India, one additional new learner, month 1

Course `eng_for_hin` at a measured 22.1 KB/clip. Requests = distinct clips + **[ASSUMED]** ~250
batched telemetry POSTs (`api/player-events.ts` batches up to 50 events) + ~30 bundle + ~10 asset.

| Learner profile [MEASURED] | Bytes | Requests | Cost (likely) | Cost (worst) |
|---|---|---|---|---|
| median joiner, 54 clips | 1.8 MB | 344 | **0.096p** | 0.133p |
| mean, 475 clips | 10.8 MB | 765 | **0.361p** | 0.592p |
| returned ≥2 sessions, 843 clips | 18.8 MB | 1,133 | **0.593p** | 0.994p |
| engaged, 1,527 clips | 33.5 MB | 1,817 | **1.024p** | 1.740p |
| p99, 5,008 clips | 108.5 MB | 5,298 | **3.219p** | 5.536p |

Term by term, for the mean new learner:

| Term | Quantity | Rate | Cost |
|---|---|---|---|
| Audio egress, proxied | 10.3 MB [MEASURED] | $0.26/GB [sourced] | $0.00261 |
| App shell + bundles | 0.6 MB [MEASURED] | $0.26/GB | $0.00015 |
| Edge requests | 765 [ASSUMED count] | $2.20/M [sourced] | $0.00168 |
| S3 GETs | 475 [MEASURED] | $0.0004/1,000 | $0.00019 |
| Database (Supabase egress) | <5 MB [ASSUMED] | within 250 GB included | ~$0 |
| Third-party per-seat | — | see below | 0.06p |
| **Total** | | | **≈0.42p** |

**Month 2 onward: 0.090p** — 51 measured network fetches at 22.1 KB, plus requests.

---

## Model 2 — Welsh schools, one additional new seat, month 1

Course `cym_s_for_eng` at a measured 51.2 KB/clip. The whole course is 20,770 clips ≈ **1.01 GB**.

Modelled on the "returned" profile (843 distinct clips in month 1), which is the realistic shape for
a scheduled classroom learner rather than a casual joiner, then ranged across the cache-hit rate:

| Cache hit for the NEW seat [ASSUMED rates] | Bytes | Cost (likely) | Cost (worst) |
|---|---|---|---|
| **0% — 1:1 device, nothing pre-cached** | 43.0 MB | **0.93p** | 1.22p |
| 50% — two learners per device | 21.9 MB | 0.50p | 0.65p |
| 80% — shared trolley, course pre-cached | 9.3 MB | 0.24p | 0.30p |
| 95% | 3.0 MB | 0.11p | 0.13p |

**The cache-hit rate materially changes the answer — it moves it by about 11x across that range —
but the whole range is between a tenth of a penny and a penny and a quarter.** It does not change
any decision about seat pricing.

**Month 2 onward: 0.117p.**

### Does content overlap actually help us? Mostly no — and here is the number

Thirty learners on the same Welsh course is thirty learners fetching the same clips. **The device
cache is per device, so content overlap buys us nothing there** unless the devices are literally
shared. What overlap *could* buy is **cross-user edge caching** — one origin fetch serving thirty
devices — and the `Vercel-CDN-Cache-Control: no-store` header defeats exactly that.

Quantified, for a class of 30 pulling a whole 1.01 GB course:

| | Origin leg (S3 → function → edge) | Edge → device leg |
|---|---|---|
| **Today, no edge caching** | 30 × 1.01 GB @ $0.06 = **$1.83** | 30 × 1.01 GB @ $0.15 = $4.56 |
| **With edge caching** | 1 × 1.01 GB @ $0.06 = **$0.06** | $4.56 — unavoidable |

So edge caching would save **$1.77 (£1.38) per class per whole course** — real, but it saves only the
*cheap* leg. The expensive leg, edge-to-device, is per-device by physics and no caching strategy
touches it. **This is a benefit we are leaving on the table, and it is worth about a pound and a
half per class.** It is not a reason to reopen the iOS byte-range workaround.

### Would the direct-S3 path change the India answer?

`/api/audio/batch-urls` already issues presigned S3 URLs and is used only by bulk download. Routing
ordinary play through it would drop the rate from $0.26/GB to $0.09/GB — a **65% cut** on the audio
term, taking the mean new Indian learner from 0.36p to about 0.16p. **That is a saving of two tenths
of a penny per learner per month.** It is a finding, not a recommendation: it would cost the
entitlement check that currently sits in the proxy, for a saving three hundred times smaller than
the payment fee on the same learner.

---

## Third-party per-seat costs on the serving path

| Service | Basis | Per learner-month | Note |
|---|---|---|---|
| **Supabase MAU** | $0.00325/MAU beyond the first 100,000 [sourced 2026-09-11] | **0.254p** | Zero until 100k MAU; then this is the largest recurring marginal term of all, larger than bandwidth |
| Supabase egress | 250 GB included, then $0.09/GB | ~0 | [ASSUMED] well inside |
| Resend (email) | $20 / 50,000 emails, ~2 emails/learner/month [ASSUMED] | 0.062p | OTP and invites |
| Analytics / error tracking | — | **£0** | **[MEASURED]** no Sentry, PostHog, Mixpanel, Amplitude or Datadog anywhere in the dependency tree. There is no such vendor. |
| Vercel / Supabase staff seats | per seat, not per learner | — | belongs in the fixed £38, not here |
| **Paddle** | 5% + **$0.50** per transaction | **48.8p** | monthly billing, ₹253 plan — carried forward from 2026-08-18 |

---

## The dominant term

**Payment processing, by a factor of between 50 and 500.**

Serving a new Indian learner for their first month costs about **0.4p**. Collecting their ₹253
monthly payment costs **48.8p** — more than a hundred times the infrastructure, because Paddle's
$0.50 is a *fixed* fee and our price point is small. Every other line in this document is noise
beside it.

What moves it: **billing annually instead of monthly avoids the fixed fee eleven times — 11 × ₹50.60
= ₹557 (£4.28) per learner per year, or 36p a month.** That single change is worth roughly **ninety
times** the entire delivery cost of the learner it applies to. For institutional and schools volume
the same logic points at one block invoice rather than per-seat collection, which removes Paddle from
the path altogether.

---

## Explicit gaps

- **No billing data of any kind was readable from this box, and I tried properly.** AWS credentials
  exist and work, but the IAM user is `arn:aws:iam::581560624549:user/replit` and it is **not
  authorised for `ce:GetCostAndUsage`** (Cost Explorer) or `cloudwatch:GetMetricStatistics` — both
  returned explicit AccessDenied. There is **no Vercel token** on this box (no `~/.vercel`, no
  `VERCEL_TOKEN` in any repo env file) and **no Supabase management PAT**. So every *rate* in this
  document is a published list rate; every *quantity* is measured. An actual invoice would supersede
  the rate column and would most likely move it downward. **Attaching billing-read to that IAM user
  is a two-minute fix and would make the next version of this document authoritative.**
- **Whether Fast Origin Transfer bills at the function's region or the edge's is unresolved.** It is
  the difference between $0.06 and $0.25 per GB for Indian traffic — about 0.2p per new learner.
  Vercel's docs describe the resource but do not state which region's rate applies when they differ.
- **Whether S3 → Vercel dub1 is genuinely free is an inference**, not a line on a bill. AWS's
  same-region rule is regional, not account-scoped, and Vercel dub1 runs in eu-west-1 — but I have
  not seen an invoice confirming it. Both columns are given.
- **The request count per learner is modelled, not measured.** Distinct clips are measured; the ~250
  telemetry POSTs and ~30 bundle fetches are assumptions from reading `api/player-events.ts`
  (batches of up to 50) and the bundle's `s-maxage=300`. Requests are 30-40% of the India total, so
  if that assumption is 2x wrong the India figure moves by about 0.15p.
- **No Indian learner has ever used the product**, so the India model applies a measured usage
  distribution drawn from a mostly-UK learner base to a population that may behave differently. The
  clip sizes are real `eng_for_hin` clips measured through the live path; the engagement shape is
  borrowed.
- **n = 137 for the month-1 distribution and n = 45 per course for clip sizes.** Small. The clip-size
  samples are tight enough to trust to the nearest KB; the engagement distribution is bimodal enough
  that the mean should never be quoted alone.
- **The fixed £38/month line is unrefreshed** and still carries August's own caveat that it is a
  construction from published rates rather than a server census. It was out of scope this time.
- **£1 = $1.28 [ASSUMED]**, carried from the August document so the two are comparable. Not a market
  quote for today.
- **Supabase database egress per learner was not measured.** It is bounded well inside the 250 GB
  included allowance at current scale, so it is immaterial today; at 100,000 learners it would need
  measuring rather than assuming.
- **Content creation is excluded entirely**, per Tom's instruction — no TTS, no voice artists, no
  authoring, no Popty estate. These are delivery costs only.
