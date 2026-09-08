## 2026-09-08 — Family to Premium: built as designed, and the calls the build had to make (job #383·F)

Built from the #376·F record (D1–D9) on fable, as Tom asked: "Fable needs to execute it as well - it's
a payment related issue". Part One, the removed-child sign-in-link fix, landed on `dev` on its own
first (`f6d82c41`, merged at `61e0cefb`). Part Two is the downgrade: two columns, `change-plan`
accepting `premium`, the webhook filing plan changes off the billed price in both directions, the
confirm screen, the member email and `familyEndsAt`. D1–D9 were not reopened. These are the calls
the design left to the build, each decided by the tie-break (works first time for the displaced
member or the child; then better × simpler × cheaper; membership is access, progress is theirs).

- **A displaced member's checkout route.** The checkout front door (`routeForPlan`) sent anyone
  who counts as subscribed to the already-subscribed notice — and a family member counts as
  subscribed through the owner's row. That dead-ended the one person D6/D8 exist for. A member
  whose `familyEndsAt` is set now routes to `buy`; their own row, once bought, resolves first.
  Members whose cover is not ending are still blocked, as before.
- **`familyEndsAt` covers a cancellation too.** The field the member banner reads is the owner's
  scheduled change when there is one, else the owner's cancellation date. One field, one banner;
  the member is told either way and the cost is nil.
- **`plan_id` is held with `plan_name` during the window.** Nothing reads `plan_id` for
  entitlement, and a row saying Family by name but Premium by price id is a trap for the next
  reader. Both flip together at the renewal.
- **The price-first webhook path is scoped to the two tiers a Family subscription moves between.**
  A premium-tier price is also the tutor and school platform unit; those rows are never Family and
  keep their handlers and side effects. A Premium-priced event on a row that is not Family and holds
  no schedule falls through to the ordinary path.
- **Schedule first, Paddle second, and undo on refusal.** The columns are written before Paddle's
  price moves, so the `subscription.updated` that follows within seconds finds the schedule and
  holds. If Paddle refuses, the columns are cleared and the request fails; nothing has changed.
  "Keep Family" runs the other way round, Paddle first, so a refusal leaves row and price agreeing.
- **The member email's address.** The address the member joined on (`invited_email`, which the
  claim path leaves on the row), else the first of the learner's verified emails. No address, no
  mail, logged. Best-effort, never fails the change.
- **Premium price ids on the server** come from `VITE_PADDLE_TEACHER_PRICE_*` with the in-repo
  ids as fallback — the same two sources `PRICE_CATALOG` and `lib/paddle.ts` already agree on.
- **Copy.** No parentheses anywhere; "Lewis · child" is a tag, not a bracket. The child line says
  "their", not "his".

**Shakedown, live, 2026-09-08 09:41 UTC, on `sub_01m1z3z0k2b6htg77tctxwa5ty` only, `do_not_bill`
only.** Swapped to the Premium price and back through the Paddle API. Both updates applied at once;
`next_billed_at` and `current_billing_period` did not move; no transaction was created (the only
one on the subscription is still the original £25). `subscription.updated` fired within seconds
with `custom_data.kind` still `family_plan` and the billing period unchanged — the exact shape the
hold path reads. The deployed webhook, still on the old code, REJECTED the Premium-priced event and
left the row untouched, as #376·F predicted; the revert event converged it. Gap closed: the payload
after a price swap. Still open: whether Paddle sends the customer an email on a `do_not_bill` swap
(Tom's `+family_002` inbox knows), and whether a prorated downgrade credits the balance (never run,
by rule).

**The one thing that must be true before 7 October.** Paddle notifies exactly one active
destination, and it is `staging.saysomethingin.app/api/teacher/paddle-webhook` (read from the live
notification settings, 2026-09-08). A downgrade scheduled from any deployment moves Paddle's price
at once; the flip at renewal is done by whichever webhook receives the renewal. Until the webhook
change is promoted `dev → staging`, a scheduled downgrade would renew at £15 and leave the row
frozen at Family with a stale period end — the very failure this job removes. "Keep Family"
reverts cleanly at any point.

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

## 2026-09-08 — school identity on the domain (job #371)

Tom's commission, verbatim: *"A school top level admin can invite teachers with one link and other
admins with a separate link. So they are multiple use links. But they can only be verified by a
domain level similarity maybe? Also the very first admin person to sign up a school therefore claims
the domain for the school and mints the school and is top level admin. Working first time is most
important. Being secure is secondary in chronology but no less important."*

**What already existed, read from the code.** Every school carries `teacher_join_code` and
`admin_join_code`, minted by a CSPRNG trigger at insert and registered into `invite_codes` with
`max_uses` NULL and no expiry — the two multi-use links Tom described are the shape the code has
had since July. Nothing recorded which email domain a school lives on. The first admin already mints
the school on two paths: self-serve `/schools1` (mailbox proved by OTP before provisioning) and a
leader-minted `school_admin` invite (vouched by the leader, address unproven).

**The domain claim.** One table, `school_identity_claims`: rows of `kind='domain'` and
`kind='address'` owned by a school. The founding admin's own domain is claimed at school creation on
both minting paths, and never for a public mail domain (`api/_utils/schoolDomain.ts` carries the one
declared list, beside the existing disposable-domain list). A claim is per school, not global: a
second head at an already-claimed domain is told which school holds it and pointed at that school's
links (that is "joins rather than mints"), with an explicit confirm to mint a second school on a
shared domain — the multi-academy-trust case, same 409-then-confirm shape the org door uses for
duplicate names. A school may claim several domains, and an arrival matches if its domain is claimed
by the link's school **or by any sibling school in the same group** — a trust sharing one domain
needs no second claim.

**"Domain level similarity" means exact-or-subdomain.** `staff.example.sch.uk` is under
`example.sch.uk`; `example-sch.uk` is not. Fuzzy similarity would be a way to be wrong quietly.

**An arrival on the link at a matching domain is the ordinary path and is one tap.** No code, no
mail, no waiting — exactly today's possession mint. The match is recorded as an attestation on the
account: `learners.needs_verification` is false from birth and the address goes into
`verified_emails`, so the teacher is never nudged to verify. The mailbox-reach card of job #358 is
left alone: it asks whether our mail *arrives*, which the domain says nothing about.

**An off-domain arrival is the contested case.** It still gets in first time — Tom's ordering —
but it stays `needs_verification=true`, so the existing Settings "Verify now" code path is its
route to becoming proven, and the admin sees an "unverified" mark on the Teachers row. Supply staff
and personal addresses are put on the school's address allowlist by the admin beforehand, and then
behave as on-domain. No route here is "email support".

**Contested versus uncontested, made computable.** Job #354 proved the server cannot tell "the
teacher's own second device signing in by code" from "the real owner arriving at a squatted
account" — the two event sequences are identical. So the one party who knows is asked, once: when a
session that proved the mailbox by code arrives at a schools-minted account from a different session,
the app shows one card — was the earlier sign-in you? *That was me* records the address proved and
retires the marker for good; *Not me* revokes every credential and session on the account and hands
the owner a fresh one. The purchase-path sweep stays automatic, because there the password was
planted by a stranger by construction. `mayClaim` keeps its home and its fail-closed default; the
schools mints are `CONTESTABLE`, never `AUTO`.

**The token layer.** Measured live 2026-09-08: after a global sign-out GoTrue reports the session
dead, and the same access token still reads rows through PostgREST until its `exp` — 3600 seconds
on this project. PostgREST checks signature and expiry locally and never asks GoTrue. The close is a
PostgREST pre-request guard (`supabase/secfix-toolkit/session_guard.sql`) that refuses a token whose
`session_id` no longer exists in `auth.sessions`, failing open on any other error. It is a change
to every API request on the one shared database, so it is staged and canaried, not applied — Tom's
call, one command, reversible in one statement. The probe asserts at the PostgREST layer and is red
until it is applied; that red is the truth.

**The word that reverts it:** claims. Drop the `school_identity_claims` table and the arrival check
in `api/auth/possession-redeem.ts` becomes a no-op; the contest card keys off `unclaimedMint.ts`
alone and survives either way.
