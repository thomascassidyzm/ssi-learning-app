# India pricing and the entitlement model — the design

*2026-09-04. A design, not a spec survey. The calls are made; each carries its
better × simpler × cheaper narrative in plain language. Code verified against
`packages/core/src/pricing/`, `api/_utils/courseAccess.ts`,
`api/_utils/entitlementGrant.ts`, `api/_utils/paddle.ts` in this worktree.*

---

## The one-sentence answer

**India is a price variation, not a product variation.** Sell exactly the thing
the UK already buys — the ceiling of the whole catalogue — through one product
id that never names a price, a currency or a language, and let Google Play's
per-country price table carry the Indian number. The entitlement predicate the
whole app reads does not change by one line.

This agrees with Watson's "one flat price" and disagrees with Watson's
"entitlement should key on the target language" — not because the target-language
unit is wrong, but because it is the answer to a question the flat price
dissolves. Building it now would be anticipation of a ladder nobody has data
for, which is the exact class of thing Tom already declined. The
target-language unit is written down below as the sealed design for *if* a
ladder ever earns its way in — so the thinking isn't lost — but nothing of it
gets built now.

---

## 1. The calls

### Call 1 — Pricing shape: one flat monthly price for India, no ladder

Everyone in India who pays, pays one number per month and gets everything a UK
subscriber gets. No 1-language / 2-language / unlimited tiers.

**Better.** At £1–2 a month, the ladder is segmenting below the threshold
anyone deliberates over. The entire revenue the ladder can ever add over flat
is the gap between X and 3X on the minority of learners who'd have paid more —
on a price where 2X is still less than a cup of chai out. Meanwhile the ladder
*costs* conversions: every choice at a payment screen is a place to bounce, and
the free-through-Yellow door means the purchase moment arrives mid-flow, at a
padlock, where the last thing you want is a menu. Flat converts better than a
ladder at these numbers, and there is zero data saying otherwise because there
is zero data at all.

**Simpler.** This is the decisive leg, and it's stronger than Watson stated.
Watson argued three SKUs cost "three things in every place that touches money."
True — but the deeper point is what the code shows: the paid path today is one
boolean. `checkCourseAccess` asks *is there an active paid subscription*, and
if yes, everything opens. A flat India price means **the entitlement model for
India is the entitlement model, unchanged** — same predicate, same
`subscriptions` row shape, same server/client agreement, same behaviour under
the anonymous-purchase-then-alias merge (one subscription row moves to the
learner; nothing bound to a language has to survive the move). The ladder
doesn't add three SKUs; it adds a whole second *kind* of entitlement (partial
catalogue access) to a system that currently has only one kind on the paid
path, plus the definition, storage, migration, support and refund semantics
that come with it. Forever.

**Cheaper.** Build cost: the billing integration Play requires anyway, and
nothing else. Run cost: one price row per country in a console. Maintenance:
the number can chase the data with a console edit and no deploy. The ladder's
maintenance is Tom's own words: "a bit of a ballache to maintain" — and it's a
ballache with no consumer, because nothing can currently measure whether
learners even open a second course (see §4).

**Brother-in-law test:** "You pay for the club, not per room. In India the
club costs less. Same club."

The number itself (₹99? ₹149? ₹199?) is IME's to give — this design
deliberately makes it a console field, not a design decision, so it can be
wrong cheaply.

### Call 2 — Entitlement unit: the catalogue ceiling, same as everywhere

What a paid learner has bought: **removal of the Orange-belt ceiling across the
entire premium catalogue.** Not a course, not a target language, not a bundle.
The free tier is untouched and identical worldwide, per Tom's standing ruling:
free courses free forever, premium free through end of Yellow, everywhere.

**Better.** It matches what the learner experiences: the app never asks them
what they bought, nothing is locked that a UK payer would have open, and the
Indian learner is a full citizen, not a discount citizen with a partial key.
**Simpler.** The unit already exists in code (`tier: 'paid'`,
`reason: 'subscribed'`); it needs no new vocabulary, no new table, no new
predicate branch, and it is indifferent to the grid (see §2). **Cheaper.**
Its marginal cost against the 149-course catalogue is exactly zero, and stays
zero at 300 courses, because nothing anywhere enumerates courses on the paid
path.

### Call 3 — Product ids: name the entitlement and the period, never the money

The `standard.month.15gbp` id charging ₹1,800 is the specimen: an id that
names a currency it doesn't charge, because price got baked into an immutable
name. Product ids are forever; prices are weather. The scheme:

- **RevenueCat entitlement id:** `full` — the one entitlement the app checks.
- **Play subscription product id:** `full.v1` (Play's modern model is
  product + base plans), with **base plan** `monthly`. No annual base plan now
  — Tom expects few-to-no annual subscribers in India, and adding a base plan
  later is additive and cheap; minting one now is a permanent artefact with no
  consumer.
- **Prices live in the Play console's per-country price table on that base
  plan.** UK £15 default, India override at IME's number. To the best of my
  knowledge this per-country override on a single base plan is a standard Play
  console feature — I am confident but cannot open a console from here, so the
  builder's first act is to confirm it. If Play somehow forced separate
  products per price region (I don't believe it does), the fallback is a
  second base plan (`monthly-in`) on the *same* product — still never a new
  product id, still no money in any name.
- **The `v1` suffix** is the only escape hatch this scheme needs: if the
  *shape* of the offer ever changes (a ladder, a family plan), those are new
  products (`one-target.v1`, …), and `full.v1` is grandfathered rather than
  mutated.
- **Paddle/web:** untouched. The existing web product keeps charging what it
  charges; the misnamed `standard.month.15gbp` is not worth migrating for its
  own sake — just never mint in that style again.

**Better:** the id tells the truth forever. **Simpler:** one product, one
entitlement, one place prices live. **Cheaper:** a price change in any country
is a console edit, not a SKU, not a deploy, not a migration.

One housekeeping note found while reading: `UserSubscriptionStatus.source` is
typed `'stripe' | 'gift' | 'government' | 'admin_grant'` while the live rail is
Paddle — the type already lies slightly. The Play integration should add
`'play'` (and honestly `'paddle'`) rather than reusing `'stripe'`.

### Call 4 — The purchase moment: a price, not a question

The learner hits the padlock at the end of Yellow belt in whatever course they
are playing. The screen shows one price and one button. Play sheet opens,
purchase attaches to the anonymous id, and the very next screen offers email
sign-in to alias it — per Tom's settled identity ruling (email is the account,
social logins are doors, buy first and alias instantly). No language is ever
named in a payment flow; there is nothing to name, because the product is the
catalogue.

This is where Call 2 quietly pays for Call 4: a catalogue-wide boolean survives
the anonymous→email merge trivially. Any language-bound entitlement would have
to carry its binding through that merge, across devices, and into the web app.
The flat design never poses the problem.

**Server side:** RevenueCat webhooks write into the same `subscriptions` table
Paddle feeds, with `source: 'play'`, so `resolveEffectiveSubscription` and
`resolveServerCourseAccess` change by nothing. This is the single integration
point the billing build must honour: **Play purchases become rows in the
existing table, not a parallel truth.** If RevenueCat's entitlement state ever
became a second authority the client checks directly, client and server would
drift — the exact disease `courseAccess.ts` was built to cure.

---

## 2. What the grid does to this answer

Nothing — and that is the design working, not an omission.

- **Learner switches known side** (`deu_for_hin` → `deu_for_eng`): both are
  premium courses; the subscriber boolean opens both. Not charged twice for
  the same German. Not charged once *for* German, either — German was never a
  thing they bought.
- **Learner plays two courses sharing a target** (`deu_for_hin` +
  `deu_for_tam`): both open. The pedagogical fact that these are different
  courses (gender mapped from Hindi vs minted from nothing for Tamil) stays
  where it belongs — in the curriculum — and never becomes a commercial
  object.
- **Catalogue grows 149 → 300 courses:** zero pricing work. No SKU minted, no
  entitlement row touched, no list refreshed. The only artefact whose size
  tracks the catalogue is the catalogue.

The general principle, stated once: **the grid is a pedagogical structure, and
the moment any money object references a cell, a row, or a column of it, that
object inherits the grid's growth rate.** The catalogue-ceiling unit is the
only unit with a growth rate of zero. That is why "a course" and "a target
language" both lose as units *today* — not because they're incoherent, but
because they cost grid-shaped maintenance and nothing currently justifies
paying it.

---

## 3. Reversible versus not

**Reversible with a console edit or a config number (safe to be wrong):**
- The India price itself, and which countries get an override.
- Whether the India price exists at all (remove the override; the default
  price applies).
- The free-preview ceiling (`PREMIUM_PREVIEW_MAX_SEED` — one constant), though
  Tom has ruled the Yellow door never changes; the point is the *machinery* is
  a config, not a schema.
- Paywall copy and the padlock screen.
- Adding an annual base plan later.

**One-way (get right before anything is minted):**
- **Product and base-plan ids.** Immutable once published; they outlive every
  price and appear in receipts, refunds and support threads forever. Hence
  Call 3.
- **The entitlement vocabulary code reads.** `full` as the one entitlement id
  is cheap to keep, expensive to rename once the app, RevenueCat and webhooks
  all speak it.
- **A per-language SKU catalogue, if ever minted.** Cannot be cleanly
  unminted: existing purchasers must be honoured (grandfathering forever), and
  the store listing becomes a public commitment. This is the single most
  irreversible thing in the whole space, which is why the design refuses it.
- **Asking a learner to choose a language at purchase, even once.** It's a UI
  contract: people who chose and paid believe they bought *that language*, and
  every future simplification has to negotiate with that belief. Never opening
  the question is free; closing it is not.
- **A second source of entitlement truth.** If any client code ever reads
  RevenueCat's SDK state as authority instead of the server's table, unwinding
  that is a bug-hunt, not a config change.

**The mistake this table exists to prevent:** `standard.month.15gbp` was a
reversible thing (a price) welded into an irreversible thing (an id). Every
one-way item above is one-way precisely because something mutable got a
permanent name. The scheme in Call 3 is the general cure: names carry meaning,
consoles carry money.

---

## 4. Build now, versus what waits on data that does not exist

**Build now (all of it in service of the Play integration that's happening
anyway):**
1. RevenueCat + Capacitor billing with the one `full` entitlement, the
   `full.v1` / `monthly` product, and per-country pricing.
2. The webhook path writing Play subscriptions into the existing
   `subscriptions` table (`source: 'play'`).
3. The padlock → Play sheet → alias-offer flow, per the settled identity
   ruling.
4. **One piece of measurement, because it is the ladder's missing consumer:**
   count, per learner, distinct *target languages* with meaningful play
   (`player_events` already carries course_code per event; this is a query,
   not a schema). Until this number exists, every ladder conversation is
   fiction. This is not anticipatory *building* — it's a read of data already
   being written.

**Explicitly not built, though designed (the sealed envelope for the ladder):**
If telemetry ever shows a real segment of multi-target learners *and* IME
still wants tiers, the shape is: tier SKUs only (`one-target.v1`, with `full`
as the top), the *which language* binding made in-app after purchase —
defaulting to the target of the course the learner was playing at the padlock,
changeable within a short grace window — stored as a new
`UserEntitlement.accessType: 'target_lang'` with a `grantedTargets` list, and
one added comparison in `checkCourseAccess` against `course.target_lang`.
Watson's target-language call is correct *here*: it is the only partial unit
that doesn't charge twice for the same German and doesn't enumerate courses
(a materialised `granted_courses` list per target would go stale the day
course 150 ships — the grid tax again; comparing `target_lang` at check time
is O(1) forever). But none of this exists until the measurement in (4) says
the segment does.

**What the design does with `kor_for_hin`:** release it. It is the first
premium course a Hindi-medium learner can hit a padlock in, so it is the first
conversion data India will ever produce — and under this design its release
requires *zero pricing work beyond the build-now list*, because the course is
just another premium cell under the same ceiling. If conversion is zero, the
price moves (console edit). If conversion is fine, the price holds. **What
this design refuses to wait for:** any of it. Every India-specific fact lives
in reversible places, so shipping before data costs nothing that data could
have saved.

---

## 5. Web versus Play geography

**Not a blocker. The India price ships Play-only, and that is a position, not
a deferral.**

Play enforces price by registered account country — real enforcement (country
changes are rate-limited and payment-method-gated by Google). The web sells
through Paddle, which will sell to any IP. If the India price appeared on the
web on day one, the UK £15 becomes advisory to anyone with a VPN, and there is
no console anywhere that fixes that.

So: the Indian go-to-market *is* the Android app — which matches the market
(Android-dominant) and the partner motion (IME distributing an app, not a
URL). The web app keeps showing its existing price to everyone. An Indian
learner who subscribed on Play has full access on the web too, because the
entitlement is a server-side row, not a platform flag — they just wouldn't
*buy* on the web.

The honest residue: this leaves a coherence wound. SSi's strategy says the
web/PWA is the zero-friction door, and an Indian learner who finds SSi through
a shared link sees a £15 price that is wrong for them until they install the
app. Partially treatable later — Paddle does support country-localised
pricing, IP-determined — but IP is enforcement theatre next to Play's, so any
web India price is a deliberate leak. My recommendation: accept the wound now,
revisit only if telemetry shows meaningful Indian web traffic hitting the
paywall. Measured, that's a query; imagined, it's a reason to build nothing.

---

## 6. Where I could not break the frame

Two places, honestly labelled.

**First, the web-geography wound above.** I do not think it is a physical
floor — it is a real trade-off between friction (web-first strategy) and
enforcement (only stores enforce geography), and I could not dissolve it, only
sequence around it. I suspect a genuinely better frame exists — something like
entitlement-priced-at-first-touch, where the price a learner first converts at
becomes *their* price regardless of platform — but every version I generated
either reinvents leaky IP geography or creates a second entitlement vocabulary
(per-learner price bindings) that fails the simpler leg worse than the wound
it heals. I'm calling it a search failure of mine rather than a floor, and
parking it: it costs nothing today because there is no Indian web demand to
serve wrongly yet.

**Second, a floor I believe is real: price and product cannot both be
market-shaped without the grid tax.** If India ever genuinely needs a
*different product* (not a different price) — say, a Hindi-known bundle at one
price because that is how the market thinks — then some money object must
reference the grid, and the zero-maintenance property is spent, deliberately.
No frame dissolves that; it is the actual exchange rate between market fit and
catalogue-scale simplicity. The design's position is only that nobody should
pay that price on zero data — not that the price is never worth paying.

---

## Summary of calls for the builder

| # | Call | Where it lives |
|---|------|----------------|
| 1 | One flat India monthly price, no ladder | Play console price override |
| 2 | Entitlement = full catalogue ceiling (unchanged) | `checkCourseAccess`, untouched |
| 3 | Ids: `full` (entitlement), `full.v1`/`monthly` (Play); no money in names | RevenueCat + Play console |
| 4 | Padlock shows a price, never a language; buy anonymous, alias next screen | Paywall flow |
| 5 | Play webhooks → existing `subscriptions` table, `source: 'play'` | `api/` webhook route |
| 6 | Measure distinct-targets-per-learner now (query, not schema) | `player_events` |
| 7 | India price is Play-only; web unchanged | Nothing to build |
| 8 | Release `kor_for_hin` as the conversion probe | Popty release, no pricing work |

The number is IME's. Everything else is this document's.
