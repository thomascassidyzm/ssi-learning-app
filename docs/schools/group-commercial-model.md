# Group commercial model — settled shape

*Settled 2026-07-14, superseding the 2026-07-14 think-piece it replaces. Owner ruling in
conversation; numbers still open.*

## 0. The shape

**The unit is the teacher, not the school.** Price `y(band)` per teacher, PAYG subscription
via **Paddle** (merchant of record — Paddle handles VAT/GST for regional pricing, so we
don't build tax logic). Monthly or annual, no contract, cancel anytime, hop-on/hop-off.
Teachers start whenever they start; each seat is its own Paddle subscription with its own
billing anchor. **No proration, no true-up** — the model makes them unnecessary, because
there's nothing to reconcile: a seat's subscription starts when the teacher starts and bills
on its own cycle from then on.

**Students are always paid, no trial**, at the existing school-linked £5 price. Students
carry the marginal infra cost (audio streaming) — which is exactly why teacher pricing can
be a simple flat platform fee: the cost driver and the revenue line are the same object.

**Groups aggregate payers; they are never a pricing tier.** A group paying is one Paddle
subscription with an adjustable quantity covering its schools' teachers; a school can
equally pay for itself. *Who pays* is a fact in Paddle's ledger, not a fact in the domain
schema. Sub-groups (path-tree nesting or flexible-grouping tags) stay organisational lenses
— never billing objects, exactly as the earlier think-piece's §3 argued.

**No commercial caps.** Subscription count is the truth; school creation stays uncapped
commercially (abuse guards, if ever needed, are a separate concern). This supersedes the
school-cap-as-purchase idea below — a cap needed inventing when the unit was the school; it
has nothing to enforce when the unit is the teacher and Paddle already meters seats.

**Trial:** 30 days, single language, clock starts at **course-pick**, with a ~7-day browse
window at redemption before commit (the resolution of the earlier think-piece's decision
#1). 365-day no-lock stays for minority-language schools. Expiry → **read-only**
(dashboards stay visible, play stops) — never lockout.

**Trial clock is per teacher seat, not per school (owner ruling, 2026-07-15).** The 30-day
clock attaches to the individual teacher, starting at *that teacher's* first course pick —
consistent with "the unit is the teacher, not the school" above. One school can therefore
have several teachers on independent, staggered trial clocks; this is intended behaviour
(bottom-up adoption — a school doesn't need a single synchronised start). Serial-trial abuse
via fake teacher rotation (spinning up throwaway teacher accounts to keep re-triggering
fresh 30-day clocks) is accepted as self-limiting pre-Paddle: the teacher roster is visible
to the school admin and staff are finite, so the abuse doesn't scale quietly. No guard is
built for it by policy — revisit only if real abuse shows up post-Paddle, not preemptively.

**Regional bands:** price band set once per school/group by an SSi human at creation time;
Paddle carries the per-region price lists. Three bands as the object model; band values are
open numbers.

**Domain schema impact is minimal:** paid/trial state per teacher seat, plus the trial
columns that already exist on `schools` (`platform_status`, `trial_course_code`,
`platform_expires_at`). Enforcement stays at the choke points that already exist:
course-pick for the trial lock, the player paywall at Orange belt for Big-10, and a
teacher-seat active check.

## Open numbers (for the owner)

- `y` — price per teacher, per band.
- Band list (3 bands assumed; names/values open).
- Annual-vs-monthly discount, if any.

## Superseded explorations (deleted from the design — kept for record)

- **x-per-school flat pricing.** Replaced once the unit moved from school to teacher —
  per-school flat pricing was solving for the wrong denominator once Paddle can meter seats
  directly.
- **School caps as purchased capacity.** A cap only needs inventing when schools are the
  billed unit; with per-teacher PAYG subscriptions, Paddle's subscription count already is
  the cap, so no `school_cap` column is needed.
- **Invoicing / true-up machinery.** PAYG per-seat billing with no proration removes the
  reconciliation problem the true-up logic existed to solve.
- **Payer objects (`group_contracts`, contract columns on `groups`).** Rejected — "who pays"
  is Paddle's ledger, not a domain-schema fact; inventing a payer object here would be a
  second source of commercial truth next to Paddle.

*Build order, when the numbers land: Paddle per-seat subscription integration, trial
re-keying to course-pick, read-only-at-expiry enforcement.*
