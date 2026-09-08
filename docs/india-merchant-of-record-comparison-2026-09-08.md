# India — who is merchant of record for INR

*A comparison, not a recommendation. 8 September 2026.*

Six routes for the moment a Hindi-speaking learner hits the padlock. They are laid out
side by side and the document ends with the disagreements between them, because the
call is Tom's and closing it here would be the one thing this document must not do.

**How to read the evidence marks.** Every factual claim carries one:

- **VERIFIED** — I read it in this repo, or in a named primary source I can quote and
  link, with the date I read it. All outside sources below were read on 8 September 2026.
- **PRIOR-VERIFIED** — established by the India payments brief of 3 September 2026
  (`/d/c7793728`), carried forward rather than re-checked.
- **ASSERTED** — a platform claim, a policy reading or a judgement I could not check.
  Treat it as a lead, not a fact.

---

## What is already settled, and is not re-opened here

1. **The free trial is the web app, in Hindi, with no gate.** The learner plays first.
   The padlock only appears at the point of entitlement. Tom's ruling.
2. **Aran builds the Hindi landing page today.** Nothing in this document blocks him.
   His hard requirement, verbatim: *"everything the visitor sees must be in Hindi at
   every step. If any stage would show hard-coded English, we need to design around it
   before building."* His prices, verbatim: *"Pricing ₹299/month and ₹2,990/year,
   exclusive of tax."*
3. **The earlier Paddle-web-funnel design is out of date in its means, not its intent.**
   The `/en/hindi` pay-page shape is not re-litigated. The intent is scored.
4. **The entitlement model does not change.** `docs/india-entitlement-design.md` already
   settled it: one flat price, entitlement is the whole-catalogue ceiling, and a
   purchase becomes a row in the existing `subscriptions` table whoever took the money.
   [VERIFIED — the doc is in this repo.] That is why the choice below is genuinely a
   *till* choice and not an architecture choice.

**Not settled, and the whole point of this document: who is merchant of record for INR.**

---

## The state of the code, in four lines

- **`STORE_BILLING_WIRED = false`** in `packages/player-vue/src/platform/paymentRoute.ts`.
  No store route can take money today. [VERIFIED — read in this repo.]
- **Paddle is the only live rail**, and it is `paddle` for web, `store` for a native
  shell, decided in that one file. [VERIFIED.]
- **`useCheckout.ts` mounts a Paddle *inline* iframe checkout** and is imported by
  `CourseSelector.vue`, `LearningPlayer.vue`, `SettingsScreen.vue` and
  `PlayerContainer.vue`. [VERIFIED — recorded in
  `docs/india-android-capacitor-assessment-2026-09-03.md`, from code.] This matters
  twice below: once as a Play-policy hazard, and once as the thing that makes option 5
  cheap.
- **The live India listing is `com.automagic.a3f`**, titled "SaySomethingin"; the
  Capacitor wrapper currently builds as `com.saysomethingin.devwrap`. Taking the live id
  is permanent and updates the app under every existing user of it.
  [VERIFIED in the capacitor assessment; the "irreversible, Tom's call" framing is that
  doc's and stands.]

---

## The money arithmetic, stated once so it can be checked

Two prices, ₹299/month and ₹2,990/year, **exclusive of tax**. One assumption used
throughout, marked so you can move it: **₹88 ≈ US$1** [ASSERTED — a spot rate I did not
verify; the conclusions below hold over any rate between ₹80 and ₹95]. So ₹299 ≈ $3.40
and ₹2,990 ≈ $34.

The one number that decides more here than any headline percentage is **a fixed
per-transaction fee against a ₹299 ticket**. Paddle's published fee is
**"5% + 50¢ per Checkout transaction"** [VERIFIED — paddle.com/pricing, read 8 Sep 2026].
Fifty cents on a $3.40 ticket is **≈14.7%**. Add the 5% and the monthly ticket is
carrying **≈20%** before anything else. The same fifty cents on the ₹2,990 annual ticket
is 1.5%, so annual carries **≈6.5%**.

Google Play's fee for auto-renewing subscriptions is **15%**, with no fixed component
[VERIFIED — Play Console Help, service fees, read 8 Sep 2026], and India is not yet on
the new split-fee model, so there is no additional "billing fee" there yet (see option 1).

**India prices on Play are tax-inclusive** and Google remits the GST out of them
[VERIFIED — Play Console Help, tax rates and VAT]. Paddle prices are set exclusive and
GST is added on top [PRIOR-VERIFIED]. So ₹299 does not mean the same thing on the two
rails, and a like-for-like comparison has to say which:

| | Learner pays | GST | Rail fee | SSi receives, monthly |
|---|---|---|---|---|
| Play, ₹299 tax-inclusive | ₹299 | ₹46 (in the price) | 15% of ₹253 = ₹38 | **≈ ₹215** |
| Paddle, ₹299 + tax | ₹353 | ₹54 (added) | 5% + $0.50 ≈ ₹62 | **≈ ₹237** |

[ASSERTED — the arithmetic is mine; the inputs above are verified. Paddle's exact fee
base — gross including GST versus net — I could not confirm, and it moves this by a few
rupees, not by a conclusion.] The honest summary: **on the monthly ticket the two are
close, and Paddle only wins because it charges the learner 18% more.** On the annual
ticket Paddle is clearly cheaper. On a headline-percentage view Play looks worse than it
is, and Paddle looks better than it is.

---

## Option 1 — Google Play billing, on the existing India listing

**Merchant of record: Google.** Google is the marketplace service provider and
*"is responsible for determining, charging, and remitting GST on your behalf for all
Google Play Store paid app and in-app purchases made by customers in India"*
[VERIFIED — Play Console Help, tax rates and VAT, read 8 Sep 2026]. SSi carries no
Indian tax registration and no Indian filing on Play sales.

**What comes free that a web till has to build.**

- **Hindi at the checkout.** The Play payment sheet and Store UI render in the device
  and account language, and Hindi is a supported Play listing locale
  [ASSERTED — I confirmed Hindi is among Play's ~77 store-listing locales from Play
  Console Help; I could not open a Play sheet in Hindi to see it, so the *checkout
  sheet* half of this claim is a platform assertion, not a verified one]. This is the
  single biggest thing Play gives Aran and it is exactly what Paddle cannot give him.
- **UPI, including UPI Autopay for subscriptions**, alongside cards, netbanking, carrier
  billing and gift cards [VERIFIED — Google's own India blog and contemporaneous
  coverage; the feature has been live since November 2022]. Google's plumbing, nothing
  for SSi to build.
- **Rupee pricing per country**, on one product's base plan, tax-inclusive [VERIFIED —
  Play Console Help].
- **Real geographic enforcement.** Play prices by registered account country, and country
  changes are rate-limited and payment-method-gated. No web till can do this; a web INR
  price is visible to anyone with a VPN. [PRIOR-VERIFIED — this is
  `docs/india-entitlement-design.md` §5's argument and it holds.]
- **Install attribution.** Play Install Referrer would carry `course=eng_for_hin` from
  Aran's landing page into first launch — which does not work today because the current
  install link is a direct APK from popty.app, not a Play listing [VERIFIED — recorded
  in the draft reply to Aran, `/d/2b88a1dd`, from code].

**What it costs.**

- **15% of subscription revenue** [VERIFIED]. Note what India is *not* on: Google's new
  Billing Choice model — which splits the fee into a service fee (10% for subscriptions)
  plus a 5% billing fee, and lets developers *"guide users outside of their app to their
  own websites for purchases"* — went live **30 June 2026 for the EEA, UK and US**, with
  **"rest of world" scheduled for 30 September 2027** [VERIFIED — Android Developers
  Blog, "A new era for choice and openness", March 2026, and Play Console Help on lower
  service fees]. **India is rest of world.** So the friendlier regime exists, and India
  does not get it for another year.
- **Real engineering.** `STORE_BILLING_WIRED = false` is not a flag waiting to be flipped;
  behind it sits purchase execution plus server-side receipt verification. The scope doc
  puts it at a plugin choice (`@revenuecat/purchases-capacitor`, free below $2.5k/month
  tracked revenue then 1% of it), a `play-webhook` route that re-fetches the purchase from
  Google before writing, `obfuscatedAccountId` binding to `learners.id`, and
  restore-purchases. [VERIFIED — `docs/payment-route/part-2-play-billing-scope.md`.]
  The capacitor assessment sizes the whole Play-billing-plus-RevenueCat piece at
  **6–8 days** [VERIFIED — that doc's own estimate].
- **RevenueCat's 1%** if that plugin is taken, on top of Google's 15% [VERIFIED — the
  scope doc; the rate itself is that doc's claim and I did not re-check it].
- **The package-id decision.** Taking `com.automagic.a3f` updates the app under every
  existing user of the live listing; taking a new id starts at zero installs. Permanent
  either way. [VERIFIED as a fact about Play; the "irreversible" framing is the repo's.]
- **A distribution constraint that is easy to miss.** Play billing requires Play
  distribution. Today's install path is a direct APK download, so option 1 is not only a
  billing build, it is a store-listing build — Data Safety declaration, privacy policy
  URL, target-API compliance, and a review that will look at a WebView-shaped app
  [ASSERTED — from the capacitor assessment's own risk read, which flags Google's
  minimum-functionality and repackaging policies].

**And the thing option 1 breaks.** Tom's settled shape is a *web* trial with a padlock.
If the till is Play, the padlock in the web app has nowhere to send an Indian learner
except "install the app" — and the web app cannot say "install the app and pay ₹299"
without becoming the funnel Aran was told not to build. It does not break the trial. It
breaks the *continuity* of the trial into the purchase.

---

## Option 2 — Paddle, on the web

**Merchant of record: Paddle.** Registered for Indian GST, charges and remits 18%, SSi
has no Indian filing obligation [PRIOR-VERIFIED].

**What is genuinely good here.**

- **It exists.** One live rail, one webhook, one `subscriptions` table, one composable.
  Zero build to take an Indian rupee tomorrow beyond configuring a price.
- **INR and UPI both work, including recurring.** Paddle's own changelog, 17 June 2026:
  *"Paddle now supports UPI in early access for both one-time purchases and subscriptions
  in India"* [VERIFIED — developer.paddle.com changelog, read 8 Sep 2026].
- **The limits are survivable at these prices.** A ₹15,000 ceiling per checkout containing
  a recurring item, a ₹100,000 overall transaction ceiling, and a pre-debit notification
  at least 24 hours before each charge [VERIFIED — same changelog]. ₹299 and ₹2,990 are
  nowhere near either ceiling.
- **It keeps the learner.** SSi holds the email, the payment relationship, the refund and
  the churn signal.

**The two facts that go straight at Aran's hard requirement.**

- **Paddle Checkout is not localised into Hindi.** Paddle's own help centre lists the
  checkout's 18 languages: English, German, Spanish, French, Italian, Japanese, Korean,
  Dutch, Swedish, Norwegian, Danish, Polish, Portuguese, Russian, Chinese (Simplified),
  Chinese (Traditional), Arabic, Turkish. **Hindi is not among them.**
  [VERIFIED — paddle.com help centre, "Do you offer localised checkouts?", read
  8 Sep 2026.]
- **Paddle's transactional emails are not localised into Hindi either.** Paddle's
  localised-email set is the same family — English, French, Portuguese, German, Spanish,
  Russian, Japanese, Italian, Polish, Dutch, Arabic, Chinese (Simplified), Korean,
  Swedish, Danish, Norwegian, plus Turkish. **Hindi is not among them.** So the receipt,
  the pre-billing notice, the failed-payment notice and the cancellation notice all
  arrive in English. [VERIFIED — Paddle changelog and help-centre pages on localised
  emails, read 8 Sep 2026. Both language lists come from Paddle's published pages; I have
  no dashboard access to confirm what is actually enabled on SSi's account — see Gaps.]

That is not a detail. It means a learner whose whole journey has been in Hindi meets
English at the exact moment they are asked for money, and then again every month in
their inbox. Aran said design around it before building; this is the thing to design
around.

**Cost.** ≈20% all-in on the monthly ticket, ≈6.5% on the annual, per the arithmetic
above [VERIFIED inputs, ASSERTED arithmetic]. **The monthly price and the fixed fifty
cents are fighting each other**, and at ₹299 the fifty cents wins. Paddle's pricing page
says to contact them for custom pricing on products under $10 [VERIFIED], which is an
open door nobody has walked through.

**Reversibility.** High. A price is a dashboard field; the rail is already wired; nothing
about choosing Paddle for India forecloses a Play till later, because the entitlement is
a server row either way.

---

## Option 3 — an Indian PSP on the web, such as Razorpay

**Merchant of record: SSi itself.** This is the whole shape of the option and everything
follows from it.

**Can a UK company even be the merchant?** Yes. Razorpay's own documentation for its
import flow says *"Razorpay allows foreign (non-Indian) businesses to accept payments
from Indian customers without any additional paperwork or registration"* and that
international businesses *"do not need to spend significant time and resources in setting
up an Indian entity or opening a local bank account in India"* [VERIFIED — Razorpay docs,
accept-international-payments-from-indian-customers, read 8 Sep 2026]. Supported methods
include **UPI, UPI Autopay, netbanking, cards, card recurring and e-mandate**, with
settlement in the merchant's own currency including GBP [VERIFIED — same page].

**And Razorpay has a Hindi checkout.** Razorpay launched a vernacular checkout in Hindi,
with other Indian languages following [VERIFIED that Razorpay published this; the current
availability of Hindi on the *import-flow* checkout specifically is ASSERTED — the
vernacular announcement is a Razorpay blog post and does not state which product surfaces
it covers]. If it holds, this is the only option other than Play that clears Aran's
requirement at the payment step.

**What it costs, and this is the price of the option.** With no merchant of record, SSi
becomes a non-resident OIDAR supplier to Indian consumers and **must register for Indian
GST from the first transaction, with no turnover threshold**, charge 18%, and file
**GSTR-5A monthly, forever** [VERIFIED — multiple Indian tax-practice sources, read
8 Sep 2026; this also matches the prior brief's conclusion, PRIOR-VERIFIED]. That is a
permanent compliance limb in a country SSi has no other presence in, opened for a revenue
line that does not exist yet.

**Fees are unpublished.** Razorpay's import-flow page says only *"Please connect with your
sales/business team on a case-to-case basis"* [VERIFIED]. Indian domestic UPI pricing is
famously near-zero and card pricing around 2%, but **an import-flow rate for a foreign
merchant is not a domestic rate and I have no number** [ASSERTED, and flagged as a gap].
The plausible shape is a low single-digit percentage with no punishing fixed fee — which
is the one thing that would genuinely fix the ₹299 problem — but plausible is not a quote.

**Also real:** SSi becomes the party that handles Indian refunds, chargebacks, mandate
failures and RBI notification mechanics itself, and builds a second payment integration
from scratch alongside Paddle. Nothing in the repo speaks Razorpay [PRIOR-VERIFIED].

---

## Option 4 — IME as merchant of record, remitting to SSi

**Merchant of record: IME.** They sell to the learner; SSi sells to them.

The prior brief argued hard against this and the argument is carried forward intact
[PRIOR-VERIFIED, `/d/c7793728` and `/d/cdcbeae2`]: a reseller takes the learner
relationship, the learner data, price control and the receipt; it splits refunds and
support so the party who made the promise is not the party who can keep it; and it turns
a clean monthly recurring line into one lumpy B2B line where churn shows up a year late.
Every piece of machinery SSi has built — progress tracking, the teacher dashboard, the
whole reason a school pays — assumes SSi can see the learner.

**What it genuinely buys:** INR-native pricing at Indian levels set by people who know
the market, a school-by-school route to market, and one invoice instead of thousands of
card payments.

**The tax number, now with a range.** Payments from an Indian company to a UK supplier
face withholding at source. Under the India–UK treaty, **royalties are capped at 10% or
15% depending on character, and fees for technical services at 15%**, against an Indian
domestic rate of 20% (effectively ~20.8–21.8% with surcharge and cess) if no treaty
relief applies [VERIFIED — India–UK DTAA summaries and PwC's India withholding-tax
summary, read 8 Sep 2026]. **Which characterisation applies — a clean resale, which is
not withheld, versus a royalty or licence fee, which is — is genuinely contested in
India** [ASSERTED, and it is the prior brief's own position]. That difference is 0% or
10–15% off the top of every payment, and it must be settled by both sides' accountants in
writing before signing, not after.

**And the ground truth: nothing has been agreed.** No price, no terms, no draft. The
estate does not even record IME's full legal name [PRIOR-VERIFIED]. This option cannot be
priced because there is no counterparty position to price against.

**Where it is genuinely strong and the others are not:** none of the other three options
put a person in an Indian school. If what IME actually offers is distribution, this is not
a till decision at all and it does not compete with options 1–3 — it sits beside them.
The question the prior brief poses is still the right one: *what do you do that a payment
gateway doesn't?*

---

## Option 5 — Play billing *plus* India's user-choice alternative billing

Tom asked not to close the options too early, and this is the one the search turned up
that nobody in the estate has written down.

**India already has a court-driven alternative-billing regime, and it is not the same as
the 2026 Billing Choice programme.** Following the CCI's order, Google offers *"all
developers the ability to offer an alternative billing system alongside Google Play's for
their mobile and tablet users in India"*, and **the service fee is reduced by 4%** on
transactions taken through it [VERIFIED — Play Console Help, "Changes to Google Play's
billing requirements for developers serving users in India", and "Understanding user
choice billing on Google Play", both read 8 Sep 2026]. India is one of the 35+ user-choice
regions today, a year ahead of the rest-of-world Billing Choice date.

**What the India programme actually permits — and this is the precise bit that keeps
getting conflated:** *"this program allows developers to use web-based payments as an
alternative payment method in an embedded webview within their app"* [VERIFIED — same
India page]. So the alternative is an **embedded webview**, offered *alongside* Play
billing, not a redirect out to a website.

**Why that is interesting here:** `useCheckout.ts` already mounts a Paddle **inline
iframe** checkout. The thing the capacitor assessment graded a High policy risk because it
sells outside Play from four everyday screens is, under India's user-choice programme and
with Play billing offered next to it, close to the permitted shape rather than the
forbidden one.

**What it costs.** 15% − 4% = **11% to Google**, *plus* the alternative processor's own
fee. With Paddle as the alternative that is 11% + ≈20% on a monthly ticket — worse than
either alone. With Razorpay as the alternative it is 11% + a low single digit, and SSi is
merchant of record for those transactions, which drags option 3's GST registration back in
for the share of learners who choose it. Plus the programme's own obligations:
**certify PCI DSS compliance** (or handle no card data at all, which UPI-and-netbanking-only
would satisfy), **report every authorised transaction to Google within 24 hours via the
alternative billing APIs**, provide customer support and a fraudulent-transaction reporting
path, and migrate active subscriptions via the ExternalTransactions API [VERIFIED — Play
Console Help, India page].

**The honest read: this is more machinery than options 1–3, not less, and it only pays if
the alternative processor's fee is far below 4%.** It is here because it is the only route
that gets both a Hindi Play sheet *and* a Hindi own-brand checkout in the same app, and
because Tom asked for the search not to close early. Its real value may be as leverage
rather than as a build.

---

## Option 6 — Paddle, with the Hindi built around it

The cheapest response to the one thing that disqualifies option 2. Not a different
merchant of record; a different amount of work around the same one.

Everything before and after the payment step is SSi's own surface and can be fully Hindi:
the landing page, the padlock screen, the price, the confirmation, the receipt SSi sends
itself. What cannot be Hindi is the Paddle payment form itself and Paddle's own
transactional emails [VERIFIED, per option 2].

So the option is: **accept an English payment *form*, and buy back everything around it.**
Ship a Hindi pre-checkout screen that states the price, the tax and what happens next in
Hindi; ship SSi's own Hindi welcome and renewal-reminder emails so Paddle's English ones
are not the learner's only word from us; and ask Paddle directly whether Hindi is on their
locale roadmap and whether the sub-$10 custom pricing they advertise applies here.

**Whole-life cost:** a day or two of copy and one small screen, plus the ≈20% monthly fee
problem left untouched. **Reversibility:** total. **The thing it does not fix:** the
learner still meets an English form at the moment they enter a payment instrument, which
is precisely where trust is thinnest and Aran's requirement is sharpest.

---

## The cross-cutting question: does Play let an Android app honour a web purchase?

Three different things get conflated. Google's Payments policy separates them, and the
answers are different.

**1. Selling inside the app.** Google Play's billing system is required for in-app
purchases of digital content: *"Unless otherwise permitted by the Payments policy,
purchases that require use of Google Play's billing system include: Digital items…,
Subscription services…, App functionality or content…"* [VERIFIED — Play Console Help,
Understanding Google Play's Payments policy, read 8 Sep 2026]. The Paddle inline checkout
shipped in an Android build is squarely this, and is the correctly-graded High risk in the
capacitor assessment.

**2. Linking out to a purchase.** *"Within an app, developers may not lead users to a
payment method other than Google Play's billing system unless Section 3, 8, or 9 of
Payments policy applies"* [VERIFIED — same page]. This is the general rule, and it is why
`part-2-play-billing-scope.md`'s flat instruction — *"Do not add a link out to a web
purchase page. No URL, no price, no 'subscribe at…'"* — is the right default. Two
carve-outs exist and neither is India: the **US**, where following the Epic injunction
Google states it *"will not prohibit a developer from communicating with users about the
availability or pricing"* and will not prohibit *"a link to transactions"*, with fee
reporting on link-outs starting 1 October 2026 and scope stated as the United States only
[VERIFIED — Play Console Help, "An update regarding Google Play's policies for developers
serving users in the US"]; and the **Billing Choice programme**, which explicitly lets
developers *"guide users outside of their app to their own websites for purchases"* but
reaches India only on **30 September 2027** [VERIFIED].

**3. Honouring an entitlement bought elsewhere. This is allowed, explicitly, everywhere,
today.** Google's own FAQ: *"Can I offer a consumption-only (reader) app on Google Play?
Yes. Google Play allows any app to be consumption-only, even if it is part of a paid
service. For example, a user could log in when the app opens and access content paid for
somewhere else. Remember, consumption-only means that any product(s) or service(s),
whether digital or physical, cannot be purchased from within the app."* [VERIFIED — same
page.] And such an app may even *say* where to buy: Google's own permitted examples
include *"Go to our website to upgrade your subscription to Premium"* and *"You can
purchase this book directly on our website"* [VERIFIED — same page].

**So Tom's shape is legal today, with one condition.** A web trial, a web purchase, and an
Android app that logs the learner in and unlocks what they already bought is a
consumption-only app and is permitted. The condition is **all or nothing**: the moment the
app sells anything itself, it stops being consumption-only and rule 2 snaps back on. The
app cannot both take a Play payment *and* point at the web.

Two cautions on this, marked honestly. First, whether a permitted *mention* may be a
tappable button rather than plain text is the reading I am least sure of — Google's
examples are sentences, not links, and I would treat plain text as safe and a live link as
untested [ASSERTED]. Second, **India's NCLAT upheld the CCI's finding against Google in
March 2025, including that Google may not impose anti-steering provisions preventing
developers from communicating alternative payment methods to users; that order is under
appeal at the Supreme Court** [VERIFIED — contemporaneous Indian press coverage of the
NCLAT order and the subsequent Supreme Court appeals, read 8 Sep 2026]. So in India there
is a live gap between what a court has ordered and what Google's policy pages currently
offer. **Do not build on the court order.** Build on the policy page, and note that the
gap is a reason India's rules may move before September 2027.

---

## The four axes, side by side

**Aran's demands.**

| | Hindi at checkout | Hindi in receipts/emails | UPI + Indian habits | ₹299 / ₹2,990 configurable | Cohort separable from Welsh |
|---|---|---|---|---|---|
| 1. Play | Yes [ASSERTED for the sheet] | Google's, Hindi [ASSERTED] | Yes, incl. Autopay [VERIFIED] | Yes, tax-inclusive [VERIFIED] | Yes — `course_code` on every event [VERIFIED] |
| 2. Paddle | **No** [VERIFIED] | **No** [VERIFIED] | Yes, incl. Autopay [VERIFIED] | Yes, tax-exclusive [VERIFIED] | Yes |
| 3. Razorpay | Yes [ASSERTED for import flow] | SSi's own — so yes, if built | Yes, incl. Autopay [VERIFIED] | Yes | Yes |
| 4. IME | Theirs | Theirs | Theirs | **Theirs, not ours** | **Only what they report** |
| 5. Play + UCB | Yes on both paths | Mixed | Yes | Yes | Yes |
| 6. Paddle + Hindi wrapper | Form no, everything else yes | Paddle's no; ours yes | Yes | Yes | Yes |

**Whole-life cost.**

| | Rail take, monthly ₹299 | Build | Ongoing compliance |
|---|---|---|---|
| 1. Play | 15% (+1% if RevenueCat) | 6–8 days + a Play listing | None Indian — Google remits GST |
| 2. Paddle | ≈20% | ~0 | None Indian |
| 3. Razorpay | unquoted, likely low single digit | a second full integration | **Indian GST registration + monthly GSTR-5A, forever** |
| 4. IME | their margin + 0–15% withholding | invoicing only | None Indian; contract + reconciliation instead |
| 5. Play + UCB | 11% + processor | option 1's build + PCI DSS + 24h reporting | inherits 3's if the processor is Razorpay |
| 6. Paddle + wrapper | ≈20% | 1–2 days of copy | None Indian |

**Reversibility.**

- **Most reversible:** 2 and 6 — a price is a dashboard field and nothing new is minted.
- **Middling:** 3 — the integration is throwaway, but **a GST registration is not a
  reversible act**; deregistering a non-resident OIDAR registration is a process, not a
  toggle [ASSERTED].
- **Least reversible:** 1 and 5 — the **package id** (permanent, and it decides whether
  the existing India installs come with you), the **product and base-plan ids**
  (immutable once published — this is exactly the `standard.month.15gbp` mistake the
  entitlement design was written to prevent [VERIFIED, that doc]), and the store listing
  itself as a public commitment.
- **A category of its own:** 4 — a signed reseller agreement is the only option here that
  hands a third party something you cannot take back by editing your own systems: the
  learner relationship.

---

## Explicit gaps — what I could not reach

1. **The Paddle dashboard.** No credential exists on this box; the repo `.env` carries
   only Supabase keys [VERIFIED by the dispatching agent, and I did not find one either].
   So I cannot tell you what an Indian buyer is shown today, whether an India price is
   already configured, whether UPI early access is enabled on SSi's account, or whether
   localised emails are on or off. **Who could get it: Tom, or whoever holds the Paddle
   login.** This would settle the entire "is option 2 already half-live?" question.
2. **Razorpay's import-flow pricing.** Unpublished; sales-team only [VERIFIED that it is
   unpublished]. **This is the single missing number that could change the ranking**,
   because option 3 is the only route with a plausible near-zero fixed fee against a ₹299
   ticket. **Who could get it: an email to Razorpay sales.**
3. **Whether Razorpay's Hindi vernacular checkout covers the import flow.** The
   announcement does not say. Same email.
4. **The Play payment sheet in Hindi.** I could not open one. Everything I assert about
   the *sheet* (as opposed to the store listing) is a platform assertion.
5. **IME.** No legal name, no terms, no price, nothing agreed [PRIOR-VERIFIED]. Option 4
   cannot be costed until somebody asks them the five questions in `/d/cdcbeae2`.
6. **The withholding characterisation** — resale versus royalty — needs an Indian
   accountant, on both sides, in writing. Not an agent's call.
7. **Paddle's fee base** (gross-of-GST or net) and whether sub-$10 custom pricing is
   actually available to SSi. Both are questions for Paddle, not for research.

---

## Where the options disagree, and what would settle it

**1. Hindi at the payment step versus the till that already exists.**
Option 2 is free and works today; option 1 costs 6–8 days, a store listing and a permanent
package-id decision. If Aran's requirement is literal — *every* step in Hindi — Paddle
fails it at the payment form and in every email, verified. If it is "everything the learner
reads *from us*", option 6 satisfies it for a day's work. **This is not a fact question.
It is a taste question about what "everything they see" means, and it is Tom's.**

**2. The fee argument and the price argument point opposite ways.**
At ₹299/month Paddle's fifty cents is the largest single cost in the whole comparison — and
it disappears at ₹2,990/year. Play's 15% is indifferent to ticket size. So *"which rail is
cheaper"* has no answer until *"which price do we expect people to actually buy"* has one.
**Settled by: a decision on whether India is sold annual-first.** If India is an annual
market, Paddle is comfortably the cheapest option here. If it is monthly, it is the
most expensive except the reseller.

**3. The web-first strategy and geographic enforcement genuinely conflict.**
Options 2, 3 and 6 sell on the web, where an INR price is visible to anyone with a VPN.
Option 1 sells on Play, which enforces by account country for real — but then Tom's web
trial has nowhere to send a converting learner. `docs/india-entitlement-design.md` called
this a "coherence wound" and could not dissolve it either. **Settled by: whether leakage of
an Indian price to non-Indian buyers is a real risk at this volume or an imagined one.**
That is a judgement about the size of the number, and today the number is zero.

**4. Play policy makes the *app* easy and the *funnel* hard, or the reverse.**
The consumption-only rule means a web till plus an unlock-only app is permitted today,
everywhere, verified — which fits Tom's shape exactly. But it is all-or-nothing: an app
that takes Play payments cannot also point at the web. **So options 1 and 2 are not
points on a spectrum, they are two doors, and taking one closes the other for that app.**
**Settled by: whether the Android app is ever expected to be the primary acquisition
surface in India.** If it is, option 1. If the web is, option 2/3/6 with a
consumption-only app.

**5. Option 3 buys the best learner experience with the worst institutional commitment.**
Razorpay plausibly gives a Hindi checkout, native rails and the lowest fee — and the price
is a permanent Indian tax registration for a revenue line that does not exist yet.
**Settled by: Razorpay's actual quote.** If it is 2–3% with no fixed fee, the GST limb may
be worth opening. If it is 5%+, option 3 has nothing left to offer that Paddle does not,
and it should be dropped.

**6. IME is not on the same axis as the other five and pretending otherwise is the error.**
If IME is distribution, it composes with any of options 1, 2, 3, 5 or 6 and no reseller
agreement is needed. If IME is collection, it competes — and the prior brief's case
against it stands and this document adds nothing to it. **Settled by: one question on the
call — "what do you do that a payment gateway doesn't?"**

**7. There is a timing disagreement nobody has voiced.** India reaches Google's Billing
Choice programme on 30 September 2027, which brings a 10% subscription service fee and an
explicit right to send users to your own website. Meanwhile the Supreme Court is sitting on
the CCI/NCLAT anti-steering case, which could move it sooner. **Anything built as a
permanent India billing architecture today is being built against rules with a known
expiry date.** That argues for the most reversible option now and the real decision later —
or it argues nothing, if the volume in the next twelve months is small enough not to care.
**Settled by: Tom's read on how much India revenue exists before September 2027.**

---

## Sources read on 8 September 2026

- Google, *A new era for choice and openness*, Android Developers Blog, March 2026 — https://android-developers.googleblog.com/2026/03/a-new-era-for-choice-and-openness.html
- Play Console Help, *Changes to Google Play's billing requirements for developers serving users in India* — https://support.google.com/googleplay/android-developer/answer/13306652
- Play Console Help, *Understanding user choice billing on Google Play* — https://support.google.com/googleplay/android-developer/answer/13821247
- Play Console Help, *Understanding Google Play's Payments policy* — https://support.google.com/googleplay/android-developer/answer/10281818
- Play Console Help, *Service fees* — https://support.google.com/googleplay/android-developer/answer/112622
- Play Console Help, *Understanding Google Play's lower service fees* — https://support.google.com/googleplay/android-developer/answer/16954621
- Play Console Help, *Tax rates and value-added tax (VAT)* — https://support.google.com/googleplay/android-developer/answer/138000
- Play Console Help, *An update regarding Google Play's policies for developers serving users in the US* — https://support.google.com/googleplay/android-developer/answer/15582165
- Google India blog, *Now pay for subscriptions via UPI on Google Play* — https://blog.google/intl/en-in/products/platforms/now-pay-for-subscriptions-via-upi-on-google-play/
- Paddle Help Centre, *Do you offer localised checkouts?* — https://www.paddle.com/help/start/intro-to-paddle/do-you-offer-localised-checkouts
- Paddle Help Centre, *Which emails will customers receive on Paddle Billing?* — https://www.paddle.com/help/manage/your-customers/which-emails-will-customers-receive-on-paddle-billing
- Paddle Developer changelog, *Accept UPI for one-time and recurring payments in India*, 17 June 2026 — https://developer.paddle.com/changelog/2026/upi-autopay/
- Paddle, *Pricing* — https://www.paddle.com/pricing
- Razorpay Docs, *Accept international payments from Indian customers* — https://razorpay.com/docs/payments/international-payments/accept-international-payments-from-indian-customers/
- Razorpay blog, *Vernacular Checkout* — https://razorpay.com/blog/vernacular-checkout-by-razorpay-accept-payments-from-your-customers-in-their-language/
- India Briefing, *OIDAR compliance in India: GST registration, NTOR rules, GSTR-5A* — https://www.india-briefing.com/news/oidar-compliance-india-gst-registration-ntor-gstr5a-digital-tax-43951.html/
- PwC Worldwide Tax Summaries, *India — Corporate — Withholding taxes* — https://taxsummaries.pwc.com/india/corporate/withholding-taxes
- High Commission of India London, *Withholding tax rates under India–UK DTAA* — https://www.hcilondon.gov.in/docs/Witholding_tax_rates_under_DTAA.pdf
- Business Standard, *NCLAT upholds CCI ruling against Google, cuts penalty to ₹216 crore*, March 2025 — https://www.business-standard.com/industry/news/nclat-upholds-cci-ruling-against-google-cuts-penalty-to-rs-216-crore-125032800940_1.html
- Business Standard, *Google appeals NCLAT order in Supreme Court*, July 2025 — https://www.business-standard.com/industry/news/google-moves-sc-against-playstore-billing-policy-order-levying-216-cr-fine-125072401692_1.html

Internal: `/d/c7793728`, `/d/cdcbeae2`, `/d/2b88a1dd`;
`docs/india-entitlement-design.md`, `docs/payment-route/part-2-play-billing-scope.md`,
`docs/india-android-capacitor-assessment-2026-09-03.md`,
`packages/player-vue/src/platform/paymentRoute.ts`.
