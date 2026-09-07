# JOB B — replacing the legacy iOS and Android apps: the size

**2026-09-06, job #737. Sizing only. No subscription record was read for modification,
no store listing was touched, nothing was migrated.**

Tom's framing, verbatim: *"they're the old code with the much harder to maintain codebase
and no hot fixing and no listening exercises and basically nothing that's any good at all
- it barely works, but we have paying users using it right now"*.

**The wrapper is not the job.** The wrapper is Job A plus a Play upload, and it is cheap.
This document is about the cutover, and the cutover is dominated by one question that is
both **irreversible and undetectable**. It is §4. If you read one section, read that one.

---

## 1. What the legacy apps actually are — proved, not assumed

The legacy iOS app is installed on Holmes as an App Store redownload, so its internals are
readable without any account access at all.

```
codesign -dv --entitlements - /Applications/SaySomethingin.app
plutil -p /Applications/SaySomethingin.app/Wrapper/Runner.app/Info.plist
ls        /Applications/SaySomethingin.app/Wrapper/Runner.app/Frameworks
```

| | iOS | Android |
|---|---|---|
| Listing | **`com.saysomethingin.apple`**, App Store id `6476493414` | **`com.automagic.a3f`** on Google Play |
| Publisher | SaySomethingin.com Ltd / "Cyf" | SaySomethingin.com |
| Apple team | **`U6RU2PLYFR`** | — |
| Live version | **2.0.15**, released **2026-07-08** (first release 2024-08-29) | not probed |
| Framework | **Flutter** (`Flutter.framework`, `Runner.app`) | Flutter (same codebase, assumed) |
| Ratings | 3.8★ from 26 | not probed |
| Min OS | iOS 15.0 | — |
| Size | 110 MB | — |

The frameworks list is the interesting part, because it is the migration surface:

- **`in_app_purchase_storekit.framework`** — **Apple IAP is live in the legacy iOS app.**
- **`sign_in_with_apple.framework`**, `GoogleSignIn.framework`, `FBSDKLoginKit.framework` —
  three social doors, and a Facebook app id in the plist.
- `just_audio`, `audio_service`, `audio_session`, `flutter_foreground_task` — the audio stack.
- `BugfenderSDK`, `FirebaseCore`, `ffmpegkit`, `pdfrx`, `sqflite`, `flutter_secure_storage`.
- `UIBackgroundModes: [audio]`, `aps-environment: production`.

The commands that proved each of these are in `docs/ios-port-sizing-2026-09-06.md` §2.

**`com.automagic.a3f` is the Android listing, not the iOS one.** `capacitor.config.ts`'s
own comment calls it "the live published listing" without saying which store.
`curl "https://itunes.apple.com/lookup?bundleId=com.automagic.a3f"` returns
`resultCount: 0`; `curl "https://play.google.com/store/apps/details?id=com.automagic.a3f"`
returns 200 with the title "SaySomethingin". **Two stores, two package identities, two
separate irreversible id decisions.**

---

## 2. The payment rails — what the code knows, and what it doesn't

### This repo's API knows exactly one rail

```
for r in paddle stripe recurly revenuecat storekit google_play; do
  echo -n "$r: "; grep -ril "$r" api/ --include=*.ts | grep -v test | wc -l
done
→ paddle: 21   stripe: 0   recurly: 0   revenuecat: 0   storekit: 0   google_play: 0
```

(The two `apple` hits in `api/` are `-apple-system` in email CSS font stacks. Checked.)

**The new app's server-side billing vocabulary is Paddle and nothing else.** Plus
`STORE_BILLING_WIRED = false` in `packages/player-vue/src/platform/paymentRoute.ts` —
neither Play Billing nor StoreKit is wired on the client either.

### The new app's database

Read-only, via PostgREST with the service key from `~/ssi-learning-app/.env`, against
`https://swfvymspfxmnfhevgdkg.supabase.co`. 180 tables; the payment-shaped ones are
`subscriptions`, `learner_subscription_status` (a view), `user_entitlements`,
`entitlement_grants`, `entitlement_codes`.

```
curl -sI ".../rest/v1/subscriptions?select=id&limit=1" -H "Prefer: count=exact"
  → content-range: 0-0/16
curl -s   ".../rest/v1/subscriptions?select=provider,status,plan_name,current_period_end"
```

| provider | status | count |
|---|---|---|
| `paddle` | `active` | **4** |
| `paddle` | `cancelled` | 12 |
| **anything else** | | **0** |

**16 subscription rows in total. All Paddle. Four active.** Zero Stripe rows, zero Recurly
rows, zero Apple rows, zero Play rows. `user_entitlements` holds 95 rows (65 `full`,
30 `courses`), and those are code/grant redemptions, not purchases.

### THE GAP — and it is the central one

**I cannot count the legacy paying users. Not "approximately"; not at all.**

The legacy estate runs on its own backend at `automagic.saysomethingin.com` — Deborah's
own link in the team channel is
`https://automagic.saysomethingin.com/api/v1/signup/C13CE2F4-…`. It is reachable
(`curl -o /dev/null -w "%{http_code}" https://automagic.saysomethingin.com/` → `200`) and
its API answers `{"error":true,"reason":"Not Found"}` to an unauthenticated probe. **I have
no credential for it, and I did not attempt to obtain one.**

So every number in the Slack traffic — the £15 Stripe subscriptions, the £3.95 Recurly
ones, the Apple IAP subscribers, the £1 V3 intro offers, the £150 annuals, the free Dysgu
Cymraeg grants — lives in a database this estate cannot see. **Stated plainly as an
explicit gap rather than estimated.** The counts I can prove are the 16 Paddle rows above,
and those are the *new* app's, not the legacy one's.

**This is the first thing to fix.** Sizing a cutover without knowing whether it affects 200
people or 6,000, and how they split across four rails, is sizing in the dark. It is one
question to Ivan (§6, item 1) and it should be asked before anything else on this page.

### The rails, as best the evidence supports

| Rail | Evidence | Where the truth lives | Reachable from this estate |
|---|---|---|---|
| **Stripe** | Ivan: *"if you cancel the £15 Stripe one…"*; Deborah: *"His subscription is active in Stripe"*; *"I'll go into Stripe and alter it there as well"* | legacy backend + Stripe | **no** |
| **Recurly** | Ivan: *"the £3.95 Recurly won't be affected. The £3.95 is active on the DB already"* | legacy backend + Recurly | **no** |
| **Apple IAP** | `in_app_purchase_storekit.framework` in the shipping binary; Deborah: *"one with Apple that he's paying"* | App Store Connect + legacy backend | **no** |
| **Google Play Billing** | not directly evidenced; the Play listing exists and the iOS twin takes IAP, so assume it | Play Console + legacy backend | **no** |
| **Paddle** | 21 files in `api/`; 16 rows, 4 active | this repo's Supabase | **yes** |
| **Promotional grants** (Dysgu Cymraeg) | Deborah's whole first thread | legacy backend | **no** |

**Five money rails and a grant rail, and the same person can sit on two at once** — Ivan's
£15-Stripe-plus-£3.95-Recurly customer is the proof that duplicate billing across rails is
not hypothetical, it is a live state today.

---

## 3. Sizing against Tom's three settled rulings

These are not re-opened. Nothing in my evidence contradicts any of them; two of them get
*stronger* under it.

**CONSOLIDATE, DO NOT REPLATFORM.** Supported. The new app is already built, the wrapper is
proved on Android by four strangers to it, and the legacy app is Flutter with a
fifteen-framework dependency surface nobody wants to maintain. There is nothing to
replatform *to* that isn't already running.

**LAZY MIGRATION ON LOGIN, not big-bang.** Strongly supported, and it is the ruling that
makes §4 survivable — see below. It also means the legacy backend and the new one run in
parallel for as long as the tail takes, and **that duration is a real cost line**, not a
transition detail. Deborah supports both during it.

**EMAIL IS THE ACCOUNT, social logins as doors into it.** This is the ruling with the most
evidence behind it in the ticket sample, and §5 shows why: *every single ticket that
RevenueCat could not have touched is either an identity ticket or a flow ticket*, and the
identity ones — Apple private-relay addresses, password resets failing for Apple/Google-only
users — are exactly what this ruling fixes. The legacy binary carries three social
frameworks and Sign in with Apple's private-relay behaviour; consolidating them onto email
is the highest-value single thing in the cutover that isn't §4.

---

## 4. The Apple IAP binary-replacement question — the whole job

**The question.** What happens to a subscriber who is paying through Apple IAP, inside
`com.saysomethingin.apple`, when the binary under that listing is replaced by a Capacitor
WebView wrapper?

### What is settled by how Apple works (not opinion, but not proved on this estate either)

- **The subscription survives the binary.** An Apple auto-renewable subscription is
  attached to the **Apple ID** and to a **product id inside an App Store Connect app
  record**. It is not attached to a build. Replacing the binary does not cancel anything,
  does not stop the money, and does not notify the subscriber. Apple keeps charging.
- **The bundle id is the boundary.** Receipts and StoreKit transactions are scoped to the
  app record. A build under the *same* bundle id inherits the subscriptions. A build under
  a *new* bundle id inherits nothing — it is a different app to Apple, and existing
  subscribers are invisible to it and cannot be moved.
- **So the money keeps flowing either way. What breaks is the app's ability to
  ACKNOWLEDGE it.**

### The failure mode, stated concretely

If `com.saysomethingin.apple` gets a new binary that does not query StoreKit — and the
Capacitor wrapper does not: `STORE_BILLING_WIRED = false`, and `grep -ril storekit api/`
returns zero — then a paying Apple subscriber opens the app after the update and the app
has **no way to know they are paying**. It asks them to subscribe. Their money is still
leaving their bank every month.

That is the specimen. It is not speculative: it is **exactly the `dave.dorf@gmail.com`
ticket** in the Slack sample — active subscription, app says "you need to subscribe" — and
that happened *within* the legacy system, on the legacy binary, from nothing worse than a
status-string mismatch. Replacing the binary is a much larger version of the same event.

### Reversibility

| Outcome | Reversible? | How |
|---|---|---|
| The subscription itself is cancelled by the replacement | **No — it isn't cancelled.** The risk isn't cancellation | — |
| The app stops recognising an active subscriber | **Yes, technically** — ship another build | but see detectability |
| The subscriber gets fed up and cancels in iOS Settings | **NO. Irreversible.** | You cannot un-cancel. You cannot re-subscribe them. You may never learn their name |
| The subscriber demands a refund from Apple | **No** | Apple refunds unilaterally |
| The bundle id, once uploaded under | **NO. Permanent, forever** | An id can never be renamed and never reused, even after deletion |
| A new listing chosen instead: existing subscribers left behind on the old app | **No practical route** | You cannot migrate an Apple subscription between app records |

**So the irreversible thing is not the software. It is the human.** Every day between
"the app stopped recognising them" and "we noticed" is a day of subscribers deciding this
product no longer works and cancelling — and a cancellation is permanent, silent, and
attributed to nothing.

### Detectability — and this is the part that should worry you most

**Would we know?** On the evidence in front of me: **no, not quickly, and not from
telemetry.**

- This repo's database has **zero Apple IAP rows** — proved in §2. There is no table that
  could go quiet.
- The legacy backend is not visible from here at all, so whatever it does record is not
  something anyone on this estate is watching.
- Apple does not tell you a subscriber was shown a paywall. It tells you, eventually, in
  aggregate, that renewals fell — on App Store Connect's own reporting delay, which is days.
- **The detection channel is Deborah's inbox.** Every ticket in §5's sample arrived that
  way: a human noticed, emailed support, and Deborah escalated it in Slack. That channel
  works, and it is the only one — but it is *sampled*, not complete. A subscriber who
  simply cancels without writing in produces **no signal anywhere**.

**That is the definition of the risk: the failure is silent at the system level and only
visible through a support queue that catches the fraction of people who bother to
complain.** A cutover that goes wrong and is caught in three weeks by Deborah's queue has
already lost the people who didn't write in, and lost them permanently.

### What follows from that — the recommendation

**Do not replace the binary under `com.saysomethingin.apple` until StoreKit entitlement
resolution is wired and proved against a real subscriber.** Concretely, in order:

1. **Ship the wrapper to iOS under a different id, or TestFlight-only, first.** Job A's
   step A5 already puts the bundle-id decision in Tom's hands and nothing presumes it.
   Choosing the throwaway id for TestFlight defers this entire risk at zero cost.
2. **Wire StoreKit receipt validation server-side BEFORE any in-place replacement.** The
   new app must be able to answer "this Apple ID is paying" from the App Store Server API
   before it inherits a single Apple payer. `paymentRoute.ts`'s seam already has the hole
   shaped for it; nothing needs redesigning, it needs building.
3. **Build the detector before the cutover, not after.** Something that says "N Apple
   subscribers are active at Apple, M have been seen entitled in the new app this week,
   and M is not N". That is the difference between a three-week discovery and a same-day
   one, and it is small — it is one scheduled reconciliation job against the App Store
   Server API. **This is the single highest-leverage thing on this page after the counts.**
4. **Cut over in a cohort, not a release.** Apple has phased release (1/2/5/10/20/50/100%
   over 7 days) and it can be paused. Lazy-migration-on-login and phased release compose:
   the first day's cohort is small enough that Deborah's queue is a fast enough detector.
5. **Never let the legacy app's Apple subscribers reach a paywall.** If entitlement cannot
   be resolved for any reason, the new app should fail **open** for a user whose device
   previously ran the legacy app, not closed. A wrongly-granted month costs pennies. A
   wrongly-refused month costs a subscriber permanently. That asymmetry should be written
   into the code, not left to a code reviewer's judgement.

### What is proved vs what is Apple's documentation vs what only Ivan can settle

- **Proved here:** the legacy binary ships StoreKit; this repo's API has no StoreKit and no
  Apple rows; `STORE_BILLING_WIRED = false`; the bundle ids and team id.
- **Apple's model, not verified on this estate:** subscription-survives-binary,
  bundle-id-scoping of receipts, permanence of an uploaded bundle id, phased release
  mechanics. These are stable and well-documented, but I did not run a transaction to
  confirm them and I am not going to pretend I did.
- **Only Ivan/Tom can settle:** how many Apple IAP subscribers there are, what product ids
  exist under the listing, whether anything already validates Apple receipts server-side in
  the legacy backend, and whether that validation could be reused.

---

## 5. THE SIZE

### What exists already

- The new app, live and working, with the listening exercises and hot-fixing the legacy app
  lacks — that's the whole reason for the job.
- The Capacitor wrapper, merged to `dev`, proved on Android by four independent installs.
- One payment seam (`paymentRoute.ts`) that is genuinely ready for a store rail.
- Paddle, working, on the web.
- Tom's three rulings, which between them remove most of the design work.

### What is genuinely new work

| # | Step | Order of magnitude | Confidence |
|---|---|---|---|
| B0 | **Get the counts.** One question to Ivan; without it nothing below can be scheduled | 1 day of waiting | high |
| B1 | Get read access to the legacy backend / a rail-by-rail export | 1–3 days, mostly other people | wide |
| B2 | The **detector**: reconcile Apple + Play + Stripe + Recurly active subscriptions against new-app entitlement, on a schedule | 3–5 days | medium |
| B3 | **StoreKit entitlement resolution** server-side (App Store Server API, receipt/transaction validation, mapping to `learners`) | 1–2 weeks | wide — depends on whether the legacy backend has reusable validation |
| B4 | Google Play Billing equivalent (already scoped as "part 2" in `docs/payment-route/part-2-play-billing-scope.md`) | 1–2 weeks | medium |
| B5 | Stripe + Recurly ingestion into the new entitlement model — **Recurly is the hard one**, see below | 1–2 weeks | wide |
| B6 | Lazy-migration-on-login: identify a legacy user by email, pull their legacy entitlement, mint the new one, idempotently | 1–2 weeks | medium |
| B7 | Email-is-the-account consolidation: Apple private relay, Google, Facebook doors all resolving to one email identity | 1–2 weeks | wide — this is where the §5 identity tickets live |
| B8 | The iOS wrapper itself (all of Job A) | 2–4 days | see Job A |
| B9 | Android wrapper → Play release under `com.automagic.a3f` or a new id | 3–5 days | medium |
| B10 | Phased cutover, cohort by cohort, with Deborah briefed and the detector watched | weeks of calendar, days of work | wide |
| B11 | Decommission the legacy backend once the tail is thin | months of calendar | — |

**Honest total: this is a multi-month programme, not a sprint.** The wrapper half (B8, B9)
is about a week. **The cutover half is 8–14 weeks of engineering** and considerably more
calendar, and the largest single block is not any one item — it is that **five rails times
two stores times three identity doors is a combinatorial surface**, and every cell of it is
somebody's live subscription.

The cheapest genuine acceleration available: **B0 and B2 first, before anything else.**
Knowing the counts might collapse whole columns of that table. If it turns out there are
eleven Recurly subscribers, B5 is an afternoon of manual work and a spreadsheet, not two
weeks of code. **Nobody knows, and nobody has asked.**

### What could kill it

1. **Recurly.** It is a rail nobody plans to keep, RevenueCat does not support it (§6), and
   it holds live subscriptions. Every option is bad: keep a dead billing system alive
   indefinitely, or ask real paying customers to re-enter card details, which loses a
   fraction of them permanently.
2. **§4 going wrong quietly.** Covered above. It is the risk that is both irreversible and
   undetectable, and the only defence is B2 shipping before B10 starts.
3. **The legacy backend being unreadable or unownable.** If nobody can export the
   entitlement truth, lazy-migration-on-login has nothing to read at login.
4. **The bundle-id decision being taken by accident** — by a worker running an upload with
   the wrong id in the config, rather than by Tom deciding. `capacitor.config.ts` already
   guards against this deliberately; keep that guard.
5. **Guideline 4.2.** A WebView app must be demonstrably more than a website at review. The
   answer here is real — offline learning, an audio engine, background audio already
   approved for this product on this team — but it must be *wired* at review time.
6. **Support load during the parallel period.** Two backends, two apps, five rails. Deborah
   is one person and the §6 sample shows the queue is already non-trivial.

---

## 6. The RevenueCat question of fact

Tom: *"and I know this is a different issue - but RevenueCat would help with this type of
thing from now on at least, wouldn't it?"*

### The denominator — named honestly

**I could not find a machine-readable month of support tickets on this estate.** I searched
(`estate-search`, the surface DB, `command-surface/uploads/tom/`). What exists is the
**month of SSi team-channel traffic Tom pasted into the source conversation** — recovered in
full from the surface's own event store (`events` table, job `f97b3597`, seq 258, 14,208
characters). That paste is the denominator, and it is a **sample, not the month**: it is
what Tom chose to paste, weighted toward things that were still unresolved.

**Denominator: 15 distinct tickets**, spanning roughly 2026-08-25 to 2026-09-05, involving
Deborah, Nimesh, Ivan, Imdad and Aran.

### RevenueCat WOULD HAVE PREVENTED — 4 of 15

1. **The Dysgu Cymraeg double-entitlement** (Deborah: *"There should be 2 Entitlements there
   for him - one with Apple that he's paying, and the other the free Dysgu Cymraeg one"* —
   and it wasn't visible in Admin; the follow-up was the user needing certainty before
   cancelling the Apple one). Multiple entitlements per customer, one from a store purchase
   and one granted promotionally with its own expiry, on one page, is RevenueCat's core
   data model. This ticket is a screenshot of the thing it sells.
2. **`dave.dorf@gmail.com`** — active Stripe subscription in `overdue`, app says "you need
   to subscribe", possibly a second purchase through Apple. Nimesh's diagnosis is the
   giveaway: *"we are not capturing the overdue status only expired status"*. That is a
   hand-rolled provider-status-to-entitlement mapper, and normalising billing states
   (including grace period and billing retry) across providers into one entitlement boolean
   is precisely what RevenueCat replaces.
3. **The "Unknown Error" login outage** — 6 users in 2 hours. Ivan: *"a few users who had the
   wrong timestamp string format (+00:00 instead of Z) in their cancelled_at or converted_at
   fields"*.
4. **`haloquin@gmail.com`** — same class. Ivan: *"her converted_at field had microseconds in
   it (ending .000Z rather than just Z) … Swift's ISO 8601 parsing is really fussy!"*

**Flagging my own weakest claim:** 3 and 4 are the arguable pair. They are subscription
fields (`cancelled_at`, `converted_at`) serialised by the legacy backend into a payload a
Swift client parses. If subscription state came from RevenueCat's SDK — which parses its
own provider's responses — those fields are not in the client's path and the outage cannot
happen. But that is contingent on those fields *leaving* the auth payload, which is a
migration, not a switch. **Without that pair the number is 2 of 15 (13%). With it, 4 of 15
(27%).** Both are honest; 27% is the one I'd quote, with this paragraph attached.

### RevenueCat WOULD HAVE HELPED DIAGNOSE, not prevented — 4 of 15

5. **The £15 Stripe + £3.95 Recurly customer.** One person paying twice on two rails, and it
   took Ivan to say which was which. RevenueCat's customer view would show the Stripe half
   immediately — **and would not show the Recurly half at all, because RevenueCat does not
   support Recurly.** So: half the picture, faster. Not a fix.
6. **`dotgallagher36@hotmail.com`** — *"she's only paid the £1 introductory fee - V3 … How
   long is the £1 supposed to give her access for?"* Deborah needed an expiry date; that's a
   field on a customer page.
7. **`aoletsgo@gmail.com`** — wrong email at signup, needing a DB edit *and* a separate
   Stripe edit to keep the £150 subscription attached. RevenueCat ties entitlement to an
   `app_user_id`, not to an email, so the "make sure it stays attached" anxiety disappears —
   but the wrong email was still given, and RevenueCat doesn't fix that.
8. **Simon's *"my £1 trial ends in 2027"*.** The white-screen half is an app bug and
   irrelevant; the wrong-expiry-date half is entitlement display, and RevenueCat would be
   the authority the app renders.

### RevenueCat IS IRRELEVANT — 7 of 15

These are the ones that matter most, because **they are the majority.**

9. **`dtd9hr8vwh@privaterelay.appleid.com` → `karlavbillington@yahoo.co.uk`.** An Apple
   private-relay address needing to be re-keyed to a real one. Pure identity. RevenueCat has
   no opinion about who someone is.
10. **Password resets failing for Apple/Google-only users.** Deborah: *"I suspect it's mostly
    because they logged in and registered with a different method, e.g. Apple or Google, so
    they haven't got a password in the system to reset."* Pure identity.
11. **The dunning email's "Update payment method" button** going to the landing page.
12. **The cookie banner hiding the Home tab** for people reaching the web app on a phone.
13. **`symonpryce@hotmail.com`** — trial signup dead-ends after email verification.
14. **`kateperxh@gmail.com`** — errors registering through the Dysgu Cymraeg partner link.
15. **`beryl.langsworthy@hotmail.co.`** — a trailing dot in an email address, bouncing at SES.

### The number, and the finding underneath it

**4 of 15 prevented — 27%. 8 of 15 (53%) prevented or materially helped. 7 of 15 (47%)
untouched.** Denominator: the pasted SSi-team-channel sample, ~2026-08-25 to 2026-09-05.

**The canon line survives the test, and the test sharpens it.** "RevenueCat solves
entitlement given an identity, and never identity itself" is right — and the evidence adds
something the line doesn't say on its own: **every single ticket RevenueCat cannot touch is
either an identity ticket or a flow/UI ticket.** There is not one entitlement ticket in the
irrelevant bucket. The categories are cleanly separated in the real data.

Which means the honest answer to Tom's question is: **yes, and it is not the bigger half.**
Buying RevenueCat addresses about a quarter of this queue outright. Tom's own
**EMAIL-IS-THE-ACCOUNT ruling addresses the largest untouched bucket** — items 9 and 10 are
that ruling's exact use case, and items 13–15 are onboarding flow that neither fixes. The
two are complementary and the ordering matters: **shipping email-is-the-account first makes
RevenueCat's `app_user_id` mapping trivial, because there is then one identity to map.**

**One caveat that is not optional: RevenueCat does not support Recurly.** It handles App
Store, Play, Amazon, Stripe, Paddle and its own billing. So adopting it does not retire
Recurly — Recurly has to be dealt with separately either way (§5, kill-risk 1), and any
plan that says "RevenueCat unifies the rails" is wrong by exactly one rail, and it is the
awkward one.

---

## 7. What only Ivan or Tom can answer — Job B

Each answerable in one line.

1. **How many ACTIVE paying subscriptions are there right now, broken down by rail — Stripe, Recurly, Apple IAP, Google Play, Paddle?** *(This is the number the whole size hangs on. Ask it first.)*
2. **Can this estate get read access to `automagic.saysomethingin.com`'s data, or an export of subscriptions + entitlements + emails?**
3. **Does the legacy backend already validate Apple receipts server-side — and if so, could that validation be reused by the new app?**
4. **What IAP product ids exist under `com.saysomethingin.apple` in App Store Connect, and how many subscribers are on each?**
5. **Does the Android app take Google Play Billing, and how many subscribers are on it?**
6. **Why is Recurly still live, and is there a route to move those customers to another rail without asking them to re-enter card details?**
7. **How many people are on both a Stripe and a Recurly subscription simultaneously?** *(Ivan's example says it is at least one.)*
8. **Who owns the Google Play listing `com.automagic.a3f`, and does the same person own the Apple team `U6RU2PLYFR`?**
9. **Tom's call: does the new iOS build replace the binary under `com.saysomethingin.apple`, or ship as a new listing?** *(See §4. Recommendation: neither yet — TestFlight under a throwaway id until StoreKit resolution exists and the detector is running.)*
10. **Tom's call: does Deborah get told a cutover is happening before the first cohort, so her queue is a deliberate detector rather than an accidental one?**

---

## 8. Explicit gaps — what this job could not determine

- **Legacy subscription counts on every rail.** No credential for the Automagic backend. The
  single biggest gap on this page.
- **Whether the Apple Developer membership is currently paid**, and who the Account Holder is.
- **What IAP products and subscribers exist** under the live iOS listing.
- **Whether the Android legacy app uses Play Billing** — inferred from its iOS twin, not proved.
- **A complete month of support tickets.** The RevenueCat number is over the pasted sample
  (§6), not the full queue.
- **Whether the generated iOS Xcode project compiles.** Nothing has ever built it.
- **Apple's exact behaviour on binary replacement**, which is documented and stable but was
  not verified by running a transaction here.

## 9. One defect found, not fixed

`packages/player-vue/capacitor.config.ts`'s header comment describes `com.automagic.a3f` as
"the live published listing" without naming a store. It is the **Google Play** listing; the
live **iOS** listing is `com.saysomethingin.apple` (both proved in §1). The comment governs
an irreversible decision, so the ambiguity is worth removing — but it is application-file
text and this job does not touch application files. Written down, per instruction.
