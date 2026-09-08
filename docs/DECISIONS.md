## 2026-09-08 — Family to Premium: what happens today, and what should (job #376·F)

Tom's commission, verbatim: *"Ok so also can we have a look at downgrading the Family to premium
plans and what happens?"* The named failure mode, in his words: *"a parent downgrades to save money
and silently destroys four peoples learning, or a child is stranded with no way to sign in or pay."*

Two parts, kept apart on purpose. Part one is what the running system does, read from `origin/dev`
at `4dfb8f40`, the live Paddle account and the live database on 2026-09-08. Part two is the design,
every call decided. Nothing here is built; a following job builds it from this record.

### Part one — what is TRUE today

**A Family owner cannot start a downgrade anywhere a customer can reach.**
- In the app: `api/subscription/change-plan.ts` returns 400 to anything but `plan:'family'`, and
  `useCheckout.canUpgradeToFamily()` only opens that door for a plain Premium row. There is no
  downgrade control in `SettingsScreen.vue`, `FamilyManagementModal.vue` or the plan picker.
- In the Paddle customer portal: the live subscription's `management_urls` carry exactly two
  actions, `update_payment_method` and `cancel`. Paddle's portal offers no plan switch.
- The only hands that can move a Family subscription onto the Premium price are ours: the Paddle
  dashboard or the API. So today the question is not "what does a parent see" but "what would the
  system do if we did it for them".

**If the price were swapped in Paddle, our record would freeze and the whole family, owner
included, would go dark at the end of the current period while the owner keeps paying £15.**
The brief's reading of the precedence guard is right for one of the two ways a Family subscription
can have been born, and there is a second, worse path it did not name:
- *Born as a Family checkout* — the live case, `custom_data.kind='family_plan'`. Paddle keeps
  `custom_data` across a price change. `handleSubscriptionEvent` routes on `kind`, reaches the
  `family_plan` branch, finds the billed price is the Premium tier and REJECTS the event with
  `REJECTED family_plan subscription: billed price is not the family tier`. Nothing is written.
- *Born as Premium, upgraded in place* — `kind='learner_premium'`. The tier check passes,
  `handlePremiumSubscription` runs, and `wouldDowngradePlan()` sees the existing `SSi Family` row
  outranking `SSi Premium` and skips the write. Nothing is written.
- Either way the owner's `subscriptions` row stays `plan_name='SSi Family'`, `status='active'`,
  with `current_period_end` frozen at the old period end. Every later event on that subscription
  takes the same path, so renewals never advance the period end, and cancellation never lands.
  `resolveEffectiveSubscription` and every entitlement reader then fail closed on the stale
  `current_period_end`: members lose access at that date, and so does the owner, who is by then
  paying £15 a month for nothing. No cron or reconciliation job exists to repair it, only a hand
  edit. The identity record at /d/c55e4b2d called this "Paddle moves back, our record refuses to";
  the refusal is real and the consequence is worse than a disagreement.

**Members hold no rows, so their access moves with one write and no notice.** If a downgrade
ever did reach the row, `familyAccess.ts` requires the owner's row to say `SSi Family`, so every
member stops resolving at the next server call. Every gate is server-side per request
(`courseAccess`, `audioAccess`, `offline-lease`, `/api/subscription`), so no token is revoked and
nobody is signed out; a running session keeps playing whatever the script and audio caches already
hold, new content past the free preview stops loading, and the app's subscription state changes on
its next fetch. An offline lease already granted keeps its recorded `expires_at`, up to 30 days,
and the next validation as a non-payer honours that date rather than sliding it.

**Progress is safe on every path, because no path touches it.** The downgrade path writes only
the owner's `subscriptions` row; `family/remove` and `family/leave` stamp `status='removed'` and
`removed_at` and nothing else. No code on any of these paths deletes or edits `seed_progress`,
`lego_progress`, belts, streaks or `offline_leases`. The governing rule holds today by absence of
any code to break it, not by design of the downgrade path, which does not exist.

**The owner is told nothing, because there is nothing to tell them from.** No confirm screen, no
consequence list, no member email. `family.planNotActive` in the family page is the only copy that
would ever say the family had stopped being covered.

**The child.** A child is a real auth user on a synthetic address, reachable only by a parent-
minted magic link. `api/family/signin-link.ts` requires the caller to own the membership row and
the row to be unremoved; it does NOT require a Family plan. So after any downgrade the parent can
still mint a link, the child can still sign in, and the child's account drops to the free tier
with everything learned intact. The stranding mechanism is not the downgrade, it is **Remove**: the
moment a parent frees a child's seat with `family/remove`, `signin-link` answers 404 for that row,
`invite` cannot re-add a child because it is email-only, and `create-child` makes a brand new
account. A removed child is unreachable forever and their progress is orphaned in an account nobody
can open. That is live today and it will be the first thing a parent does after a downgrade if the
design does not stop them. No graduation path exists yet for a child to attach a real email.

**Live scale: nobody real is on this yet.** Paddle holds exactly one subscription on either Family
price: `sub_01m1z3z0k2b6htg77tctxwa5ty`, monthly, active, started 2026-09-07 23:41 UTC, owned by
Tom's own `thomas.cassidy+family_002` account, one child seat named Lewis, one pending invite, two
removed rows. The database agrees: one `SSi Family` row, four active and twelve cancelled
`SSi Premium` rows. The migration story is therefore nil, and the build can change the webhook's
behaviour without a backfill.

**Paddle's own shape at the boundary, read from the API reference and the live account.** An
items change on `subscriptions.update` applies at once; `proration_billing_mode` only decides what
is billed and when, across `prorated_immediately`, `prorated_next_billing_period`,
`full_immediately`, `full_next_billing_period` and `do_not_bill`. `scheduled_change` holds only
`cancel`, `pause` and `resume`, so Paddle cannot schedule a price change for the period end; any
end-of-period downgrade is ours to hold. The 55p minimum that refuses a whole update below it, met
live on 2026-09-07 on the upgrade, applies to any prorated mode and never to `do_not_bill`. The
webhook destination subscribes to `subscription.updated`, which is the event a price change fires.

**Explicit gaps.** Not verified, because each would need a real money movement or a Paddle write:
whether a `do_not_bill` downgrade produces any customer-facing Paddle email or receipt; whether a
prorated downgrade credits the customer balance as the docs imply; and the exact behaviour of a
`subscription.updated` payload after a price swap on this account. The build's first real
downgrade on Tom's own family subscription is the shakedown for all three.

### Part two — the design, every call decided

The tie-break, from the commission: works first time for the person it happens to, who is the
displaced member and not the owner, then better × simpler × cheaper. The governing rule: membership
is an access grant, progress is theirs and kept indefinitely.

**D1. The owner keeps the Premium seat.** The subscription is bound to the payer's learner row, the
resolver already reads it own-row-first, and every other answer needs fan-out writes this system
deliberately has none of. Taste-safe default taken; overturn cost is high, so say so early.

**D2. It takes effect at the end of the paid period, and the period is held by us, not Paddle.**
Paddle cannot schedule a price change, so the change-plan endpoint gains `plan:'premium'`: it
writes `scheduled_plan_name='SSi Premium'` and `scheduled_plan_at=current_period_end` on the
owner's row, then calls `subscriptions.update` onto the Premium price with `do_not_bill`. Paddle's
items change now, no money moves, and the next renewal bills £15. Our row keeps
`plan_name='SSi Family'` until the flip, so every member is covered for exactly what was paid.
Two columns on `subscriptions`, no new table, no cron. The delay is also the window in which every
displaced person can act. Reasons in order: nobody loses something already bought; `do_not_bill`
never meets the 55p refusal; no refund or credit arithmetic exists to go wrong.

**D3. The flip is the renewal webhook, and the webhook stops freezing.** Plan changes are filed
off the BILLED price in both directions, replacing the Family-only `handlePlanChangeToFamily`: an
event whose subscription id already owns a row is a plan change on that row, whatever `kind` says.
The precedence guard applies only across DIFFERENT subscription ids; a price change on the same
subscription is Paddle's truth and is never "clobbering". With a pending schedule whose date is
still ahead, the handler updates period and status but holds `plan_name`; once an event's billing
period starts on or after `scheduled_plan_at`, it writes `SSi Premium` and clears the schedule.
If the renewal event is late, the existing `current_period_end` check already fails closed for
everyone, exactly as any late renewal does today. An unscheduled swap made by hand in the Paddle
dashboard flips at once, members dark immediately; that is acceptable because the app door is the
only customer path and it always schedules.

**D4. The owner sees named people before confirming, and the confirm sentence names them.** The
confirm screen lists every live member by display name, a pending invite by its address, a child
marked as a child, and says in one sentence what changes on the date: "On 7 October Lewis and
Ffion lose Premium. Everything they have learned stays. You keep Premium at £15 a month." The
button reads "Change to Premium on 7 October". If the family has no live members the screen is
just the price and date. With a cancellation already scheduled the downgrade door is hidden;
cancel wins. Annual Family goes to annual Premium; the interval is preserved as on the upgrade.

**D5. Nobody is removed by a downgrade, ever.** The endpoint touches the owner's row only.
Membership rows stay `active` and simply stop resolving after the flip, which is what makes a
later re-upgrade one write with everyone back where they were. The family page shows the existing
`planNotActive` line plus the date.

**D6. Displaced adults are told at confirm, by email, with their own door in it.** One email
through the invite mail path already reaching them, sent when the owner confirms, not at the flip:
the date, that their progress is safe, and a link to buy their own Premium. In-app, `/api/subscription`
adds `familyEndsAt` for a member so the banner reads "Your family Premium ends 7 October. Keep
going for £15 a month" with the ordinary checkout behind it. Their membership row stays; when they
buy, their own row resolves first and nothing else changes. A pending invitee gets no mail; they
never joined.

**D7. The child, in full.** Three facts to work with: no email, no way to pay, no way in except a
parent-minted link.
- *Never stranded:* `signin-link` will mint for any child row the caller owns, removed or not. The
  parent can always get the child back in, for as long as the account exists.
- *Remove warns:* the Remove control on a child row says the account keeps everything and that a
  sign-in link stays available on this page; there is no path by which a child becomes unreachable.
- *What the child gets:* the same account on the free tier, no migration. A child account, known
  by its synthetic address, is never offered a checkout; the paywall on a child account says "Ask
  your grown-up about the family plan" and nothing else, because a Paddle customer bound to a
  synthetic address is a trap.
- *What the parent is handed at confirm:* the confirm screen says per child "Lewis keeps his
  account and everything he has learned, and can keep using the free part of the course. You can
  always get a new sign-in link for him here." Nothing further needs handing over at the flip,
  because the link is mintable any day.
- *Graduation* to a real email, which the identity record wants, is not built and is not needed
  for any of the above to hold; it stays a separate job.

**D8. The displaced adult's route to paying for themselves is the ordinary checkout.** No grace
discount, no special price; the end-of-period window is the grace.

**D9. Reverting is one tap.** "Keep Family" clears the two columns and calls `subscriptions.update`
back onto the Family price with `do_not_bill`; the period was paid at £25 either way.

**Taste-safe defaults taken, flagged so one can be overturned cheaply:** D1 owner keeps the seat;
D2 end of period; D4 named people on the confirm; D6 told before, not after. No genuine taste
fork was found; every remaining call was decided by the tie-break.

**What the build job carries from this record.** Two columns; `change-plan` accepting `premium`
with the schedule-then-`do_not_bill` order; the webhook filing plan changes off the billed price in
both directions with the same-subscription carve-out on the precedence guard; the member
`familyEndsAt` field; the confirm screen; the member email; `signin-link` for removed child rows;
the child paywall. Proof: one webhook test that fails on today's code by leaving the row `SSi
Family` after a scheduled flip and passes after; one `signin-link` test on a removed child row.
Shakedown on Tom's own family subscription before any real family exists.

## 2026-09-06 — a stale characterization is the test's bug, not the code's (#912)

The 2026-09-05 security audit (cs/551 and its 552-555 family) was merged into dev by the #900 sweep,
went red on eight tests, and was reverted whole (20dcce04) rather than guessed at. Reconciled here.

**The rule this settles.** A characterization test pins TODAY's behaviour so it goes red when the
behaviour changes — going red is the design, not a defect, and the correct response is to read WHY.
Where dev had since FIXED the very finding the characterization documented, the test is what moves:
it is rewritten as a secure-assertion of the shipped fix, so it now guards the fix instead of the
bug. Reverting a shipped security fix to make an older test green would be the exact inversion.

**What the eight reds actually were.** Six were characterizations of two findings dev had already
closed: A-02 account pre-hijacking (fixed by #557's `shellClaim` invite-binding) and A-01
staff-signin-link containment (fixed by #565's `schoolReachOf` union). Two were machinery going
stale as the file set changed — the pinned `*.security.test.ts` roster, and a literal-string
assertion on `vitest.api.config.ts`'s `include` that dev had widened. None of the eight was a
finding dev is still missing.

**The one residual.** A-03: `staff_access_codes` exists in production and is now recorded in
`supabase/schema.sql` with RLS on and a `service_role`-only grant (regenerated in `a7384811`), but
NO migration file creates it. The repo cannot build the table from scratch. That half of the finding
is still open and is left pinned by its test rather than papered over.

**Also landed:** cs/595's school-authority agreement tests, hand-merged against the schoolReachOf
suite they collided with, carrying a genuinely new finding — `ensureSchoolAdminTag` treated `23505`
as proof of a grant, when the live constraint has no `WHERE removed_at IS NULL`, so a revoked tag
holds the key and re-granting admin to a removed person silently did nothing. It now fails loudly,
which turns `code/redeem`'s school_admin_join branch from a silent 200 into a 500 in that case.

## 2026-09-05 — pod delivery is a work DEBT, not a position schedule (#646 → #649)

Tom ruled yes to both of #646's questions: switch the cadence, and keep Welsh North/South and the
no-pod courses HELD with the detector's RED standing loud rather than muted.

**The rule.** One monotonic per-enrollment counter, `course_enrollments.rounds_since_pod`,
incremented on EVERY completed round — replays, easy-mode rounds, revival-tail rounds. At any clean
round boundary where the debt has reached `pods.roundInterval` (5) and a lap can compose, the pod
fires; lap COMPLETION resets it to 0. Skip, failure, offline-incomplete and composed-nothing all
leave the debt standing.

**Why the axis changed.** The shipped rule was `(mainRound − activation) % 5 === 0` — five rounds of
POSITION. Beuno did 33 round-completions in a month while his position crawled from round 10 to 14
(replays after breaks, easy mode, short sessions), crossed no boundary, and received no pod at all.
Position is a proxy for work; work is the thing. The constant 5 is unchanged. Measured on his real
shape in a unit test: 0 fires under modulus, 6 under debt.

**What was deleted, not left inert.** `usePodActivation.ts` (the returning-learner pin) and its call
site, the 2026-05-20 `POD_ACTIVATION_CAP` hotfix and `DEFAULT_POD_ACTIVATION`, the
`podActivationRound` ref and every read/write of `pod_activation_round` in the runtime path, and the
INF-PLAY revival-ordinal special case in `podCadenceFiresAtRound` (revival rounds are work like any
other now, so one rule covers both). Two interacting cadence mechanisms, one silently winning, was
the named failure mode. The DB column stays — dropping a production column is not additive — but
nothing reads or writes it.

**Preview, the one genuine wrinkle.** `sectorMerge` and the span audio pre-warm take
`shouldFireLapAt` as a pure `(totalRound) => boolean`, and a debt is not a pure function of round
number. Settled as: the live fire decision uses a new `isLapDue()`, and `shouldFireLapAt` survives as
a PREVIEW-ONLY forward projection of the current debt from its anchor. `sectorMerge`'s ratified
rules are untouched.

**Migration.** 1,464 enrollments with real completed rounds seeded to 5 (owed a lap at their next
clean boundary); 300 brand-new left at 0. Seeded to the threshold, not to a computed backlog: the
counter resets on completion and only ever needs to reach 5, so a bigger seed buys nothing and risks
exactly the avalanche the 2026-05-20 cap was fighting.

**The detector stands.** `scripts/pod-delivery-detector.mjs` runs nightly at 06:20 Europe/London
(`ops/systemd/ssi-pod-delivery.{service,timer}`), `--days 7 --notice`, from its own worktree pinned
to origin/dev. After the change it reports the same 9 RED / 2 AMBER / 13 GREEN as before —
`cym_n_for_eng` RED no-servable-pod, `por_br`/`ukr`/`tur`/`isl` RED zero-delivery — which is the
point: the content did not change, so a GREEN there would have meant a broken detector, not fixed
courses. Held pods stay held and stay loud.

Revert: one commit — `git revert fbc66978` (the rule) plus, if wanted,
`ALTER TABLE public.course_enrollments DROP COLUMN rounds_since_pod;`. Nothing else depends on it.


## 2026-09-05 — promoted dev to production (ssi-learning-app)

Tom ruled GO in 環 RBF ("yes to dev / yes to promotion"). Shipped `2e3f43e4` → `71b5dbc0`
(66 commits, 235 files, +9,936/−1,132), then `df39befb` correcting the release notes.

**Census taken at the merged union, not on dev.** `git merge --no-ff origin/dev` onto
`origin/main` produced a tree byte-identical to dev (`git diff origin/dev HEAD` empty), so the
union carried no merge-only interaction. Green at that union: `@ssi/core` build, `vue-tsc`,
player-vue vitest (3114 pass / 0 fail), eslint (0 errors, 166 pre-existing warnings), API
typecheck, API vitest (1758 pass), i18n parity (127 pass), the bare-English passthrough gate
(exit 0; 25 non-fatal Latin-script warnings, nearly all loanwords), release-train (30) and
worktree-deps (7).

**Payers proved against real state, not asserted.** Before and after, live Supabase read-only:
entitlement_grants 2/2 active/2 paid, user_entitlements 95, subscriptions 16/4 active, and the
same five entitlement rows and four active subscriptions identical either side.

**Verified live in a real browser at 390×844**, not by assertion: the Settings build stamp read
`df39bef · 5 Sept 2026, 16:02` off the page (branch correctly suppressed on main), the play probe
returned `healthy` with the session clock advancing 0:00→0:35, 172 audio fetches, zero JS errors
and 7× 200 telemetry POSTs, and belt taps landed rather than going silent.

**One defect found and fixed in flight.** The notes finaliser is line-based, so hand-edited
wrapped bullets were truncated mid-sentence, and the What's New panel has no markdown renderer,
so `**bold**` showed as literal asterisks to learners. Corrected in `df39befb` and back-merged to
staging and dev. The generator itself still has both limitations — a future ship must write
one-line, markup-free bullets.

Revert: `git revert -m 1 71b5dbc0 && git push origin main`

## 2026-09-05 — release notes: constrain the generator, don't teach the panel markdown

The Settings "What's new" panel and the release-train finaliser each held their own copy of the
same bullet regex, so a wrapped bullet was truncated mid-sentence twice over and `**bold**` reached
learners as literal asterisks. The fork was: render the markup, or constrain what may be emitted.

**Constrain.** Rendering means a `v-html` sink on a learner-facing production page fed by a
hand-authored Supabase row — a sanitisation surface bought for the sake of bold text. Constraining
deletes a problem instead of adding one, and a constraint that FAILS the promotion is stronger than
a renderer that silently does its best.

Both sides now import `tools/release-train/notes-bullets.mjs` — one definition of "a bullet"
(joining wrapped lines) and one predicate naming markup the panel cannot render. `--finalize`
throws on a violation; `AdminReleaseNotes` refuses to save one.

**The word that reverts it:** render. If bold in the notes ever earns its keep, the change is to
give the panel a markdown renderer plus a sanitiser, drop `assertRenderable` from the finalise
path, and keep the shared extractor — the joining half of the module survives either way.

## 2026-09-06 — the base checkout goes back on `dev`, and the outstanding work goes to staging

`/home/tomcassidy/ssi-learning-app` — the checkout the deploy sentinel runs out of AND the base
every SSi worker worktree is cloned from — had been on no branch at all since 2026-08-20, because
the sentinel's sync step ran `git checkout -qf --detach FETCH_HEAD` every three minutes. Asked
whether that was deliberate, Tom ruled: *"not deliberate, I have no idea, but we should have merged
everything to staging anyway."*

**The detachment.** It was reasoned, not accidental: detaching guarantees no branch pointer moves,
so the clone's own branches and its ~22 worktrees are safe. That guarantee is kept without the
detachment by advancing `dev` **fast-forward-only** — only `dev` moves, only forwards, and only when
git can do it. Attach failure and ff failure both log and carry on, so the invariant that an update
failure never silences the watchman is unchanged. Nothing existed only in that checkout: it was
bit-identical to `origin/dev` with a clean tree; its two local-only commits were a scratch
main∪dev probe (left alone) and an unpushed README/CLAUDE.md docs fix (merged here).

**The sweep.** Twenty-three unlanded branches — pod carry/ratchet restores, the Layer-1 census, the
Android field-test build and its WebView shim, the cold-start fixes, the iOS scaffold, and the
India/environment/identity design docs — were merged to `dev` and promoted to `staging`. Four were
left where they are, each for a reason that is a finding rather than a chore: `cs/595` (two
independent suites collide in one authz test file), `cs/680` (predates the #672 cup fallback it
would clobber), `perf/journey-baseline` (its i18n key work is superseded — dev's locales carry 702
keys to that branch's 365), and `cs/551` plus its four area branches (characterization tests that
pin code dev has since fixed).

**What the sweep caught that no single branch could.** #701 added a second inline script to
`index.html` while the CSP hash guard asserted there was exactly one. Each branch was green alone.
Together they exposed a real gap: the shim's hash was missing from the policy, so promoting CSP from
Report-Only to enforced would have blocked the very shim that lets Android WebView 80-91 boot.

**The word that reverts it:** detach. If keeping the sentinel's checkout on a branch ever costs more
than it is worth, the change is three lines in `tools/deploy-sentinel/run.sh` and one field in
`command-surface/ops/serving-refs.json`.
