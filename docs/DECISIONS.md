## 2026-09-11 — a class row is the class account's own progress; per-pupil framing leaves the class list and the class page (job #265, Tom's ruling)

Tom, on the Chepstow classes list under View-as: every one of 34 cards read Students 0, Belt White,
Avg seeds 0, a flat line, Inactive — while the 8H class page read 53 phrases and 24 minutes this
week. His ruling: "each class row shows the class's progress read from the play-as-class learner
account, obviously"; a per-pupil student count on a class is meaningless because a class IS one
learner account; where the account has never played, say "not started" in words, never zeros;
minutes per week, never hours.

- **One source.** `/api/school/class-practice-7d` now carries `classAccountByClass` — started,
  journey in LEGOs (the same chain the class node home uses: enrollment ceiling → last completed →
  `classes.last_lego_id`, as an ordinal via the shared `legoOrdinal`), the seed the class has reached
  for its belt, the cursor stamp, phrases this week and the class account's own in-app minutes per
  UTC day for the sparkline. The list reads only that; `class_sessions` (dead since 2026-08-19) and
  `class_student_progress` averages no longer drive any cell.
- **Gone from the list:** the Students column, the Students sort, "Avg seeds". **In:** "Journey,
  LEGOs" as done / total, sortable. Header line: "34 classes across School · 352 min in the app
  this week". A never-played account reads **Not started** in the belt, journey, time and health
  cells and shows no sparkline.
- **Gone from the class page:** the Students stat tile (now "LEGOs travelled together"), the
  "Students average N LEGOs on their own" sentence, the Belt distribution card and the Practice
  min/student/week card, with their Handbook entries. The student roster section stays — it is the
  invite target, and "No students in this class yet" is words, not a zero.
- **Verified live for Chepstow (query in the job report):** 34 class accounts, 30 with diary
  events, 4 never played (11E, 11H, 8S, "Rachel Tiller Cleaves Personal"); no account carries a
  `highest_completed_lego_id`, so the journey comes off `last_completed_lego_id` / `last_lego_id`.
  35 of 39 staff accounts have played as themselves — reported, not moved.

## 2026-09-11 — practice is MINUTES on every school surface, and the school headline is this week's in-app minutes, the number the admin reads (job #265)

Tom on staging: "why the fucking hell are they all showing 0h progress. Why the fuck is hours a thing
anyway? How many TIMES do I have to tell you guys to get the damn data displaying properly." Two
faults, both closed:

- **Hours are not a unit.** One formatter, `composables/schools/practiceMinutes.ts` — "352 min",
  nothing else, no "h m", no "1.2h". The DB views still carry hours; `useSchoolData` converts at its
  boundary, `roster.ts` returns minutes, `groups/[id]/home.ts` sends `practiceMinutes` beside the
  hour fields it keeps for older readers. Eleven locale keys named for hours were deleted from all
  25 locale files and fourteen minutes keys minted in English, enrolled in `pending-translation.json`.
- **The school dashboard headline changed SOURCE, not just unit.** It read all-time hours off
  `school_summary`, while the admin's node home read minutes in the app this week off the
  class-practice spine — two different measures of one school, never able to agree, and the school
  one rounding to "0h". The dashboard now reads `/api/school/class-practice-7d`'s new `rollup`,
  computed by the same helpers and rule as the admin page: minutes in the app this week and "X of Y
  classes practising this week". Not loaded → a dash and a sentence, never a zero.
- **Role-only View-as for a school role no longer exists.** It sent no userId, so no scope loaded and
  every count painted 0 as if real — a silent lie. The role buttons now pick the most recently active
  real person of that role (`/api/admin/users?role=`), whose real school then loads; a learner stays
  role-only because a learner has no school scope to fake. Chosen over an explicit "no school
  selected" state on every stat because it deletes a whole state instead of adding one to every page.
- **The admin's empty scope is passed around, not widened.** Under View-as every fetch runs as the
  ssi_admin, whose `resolveVisibleScope` is empty. `class-practice-7d` takes `?school_id=` for that
  caller only, behind `verifyAdmin`; a staff caller's own scope is never widened by the parameter.
  Same shape as `group-summary.ts`'s `?groupId=` passthrough.

Proof: `DashboardView.minutesHeadline.test.ts` mounts the real SFC and is red on the pre-#265 code
(no minutes headline, "6m" from a 0.1h row) and green after; `class-practice-7d.test.ts` pins the
rollup composition and the passthrough's refusal of a non-admin.

## 2026-09-11 — The in-app support channel for school and org admins is built, reconciled to Tom's two rulings (job #214, branch cs/214-build-the-in-app-support-channel)

Spec `/d/8e1fce9d` §14, built as written except where Tom's two later rulings changed it: **admins
only** ("not individual teachers — a bridge too far at the moment", 2026-09-10 21:55Z) and **DB
writes as turn-taking and as surfacing data points for the handbook page**. The transport is the
database: her question is a row through `POST /api/support/messages`, the answer is a row the
watcher on watson-1 writes back, and there is no reply-in endpoint. Decisions taken where the spec
was silent or ambiguous, each overturnable in a word:

- **Support sits directly under Handbook in the user menu.** The commission doubted the Handbook
  entry existed in `SchoolsTopBar.vue`; it does, at the top of the menu, so the spec's placement
  stands. Shown only to `isSchoolAdmin || isGovtAdmin`; the routes refuse a teacher with 403.
- **The Handbook data points are a third signal key, not a page.** Every answer row records
  `handbook_anchors` and `handbook_hit`; a how-to the pack could not answer mints
  `handbook-gap:<anchor-or-topic>` on `support_signals`, so the count of what people have to ask
  about accumulates by itself and is readable from the table. The admin-facing half is the quiet
  question mark beside the stats row and the class-practice card, reading the compiled sentence by
  anchor. No authoring tool, no editor, no second corpus (§15).
- **The endpoint does not call the agent inline.** §14 item 6 says "calls the agent, writes the
  agent's reply, returns both"; the reconciled architecture has the agent on watson-1, so the route
  writes her row and the watcher takes the turn seconds later. Simpler: one agent, one place, and
  the app never holds a model key. The thread view polls every 15s while visible, and on focus.
- **A thread is keyed by school OR by group.** `support_threads.school_id` / `group_id`, exactly one
  set, so an org leader has a thread of their own without pretending to be a school.
- **Three columns the sketch did not have:** `draft_reply` on the question (the card's draft, so
  `yes` is one INSERT with no retyping), `last_read_at` on the thread (the unread dot and the
  doorbell key on it), `escalation_resolved_at` (what turns "Waiting on Tom since …" off).
- **Population counts OTHER schools**, the caller's own excluded, so the integer reads as the
  sentence the agent says.
- **The doorbell is a Vercel cron, not the watcher.** `api/cron/support-doorbell.ts`, hourly at
  :20 — the Resend key already lives in Vercel and nowhere on watson-1. Rings once per reply,
  after three hours unopened, to the admin who asked, in the thread's language.
- **Tom's one word maps to one flag on one script.** `tools/support/reply.cjs --message <id>`
  with `--yes` (the draft, in his name), `--body "…"` (verbatim, in his name) or `--no` (SSi says
  a person is looking). Author stamps are author-stamp.js's vocabulary: human · Tom · login-header.
- **The estate side lives on a command-surface branch made in a git worktree**, never on the live
  checkout that the running surface reads from. `cs/214-support-channel-watcher`, not merged.
- **The watcher is written and not armed.** `ops/ssi-support-watcher.service` is not installed;
  the file says what arming takes. `SUPPORT_PACK_PATH` must point at a `dev` checkout with the
  handbook compiled — the shared checkout's pack had no handbook section on 2026-09-11, and the
  loader now says so out loud rather than answering every how-to with "I don't know" quietly.
- **The migration is unapplied.** `supabase/migrations/20260911_support_channel.sql`; the three
  tables are declared by hand in `schema.sql` so the snapshot gate stays honest until it is.

## 2026-09-10 — The layer-1 voice order is settled: v2 third, not last (job #74, branch cs/74-glossary-voice-order-ruling)

Tom ruled on the one open question the vocabulary glossary was carrying. Asked whether the code was
right or whether target voice 2 should come last, he answered: *"this order is fine: The voice
ordering inside drill — code plays target v1, known, target v2, target v1. You'd said v2 last."* His
earlier stated order, with v2 last, is withdrawn by him. The code was already correct and does not
change.

- **The ruling settles the pattern everywhere, not just in drill.** The question was put about
  drill; the constant is `DEFAULT_LISTENING_PATTERN` at `listeningExposureRamp.ts:84`, which is one
  pattern, mode-agnostic and layer-agnostic — layer 1 maps it onto a seed's two recorded voices,
  layer 2 onto a pod sentence's target and translation clips. So the entry it closes is
  `LAYER-1 SEEDS PLAY t k t t ALWAYS` in `tools/vocabulary-pointers.json`, now `clean`, carrying his
  words rather than a summary of them.
- **The dead `seedPlaylist` DB row was aligned rather than left holding the rejected order.**
  `algorithm_config['listening'].seedPlaylist` held `['t1','known','t1','t2']` — the withdrawn
  order. It is dead on the learner path: `LearningPlayer.vue:4421` always supplies a
  `listeningPolicy`, so neither ternary at `useLayer1Scheduler.ts:819` or `:881` takes the
  `c.seedPlaylist` arm for a real learner. Dead is not unreachable, though: the field stays
  admin-editable on the Listening config page, so a value Tom has just rejected sitting there is a
  landmine for the next admin. It was written to `['t1','known','t2','t1']` and read back. Zero
  effect on what any learner hears, by definition of the arm never being taken.
- **Two pointers added, no prose about behaviour.** The second live ternary at `:881` and the
  config read at `LearningPlayer.vue:4392` were unpointed; they are pointers now. 63 pointers across
  17 terms, all resolving.

## 2026-09-08 — The 30-day grace: a family member's cover outlives the plan name (job #402)

Tom's ruling, superseding #376·F **D8** ("no grace discount, the end-of-period window is the
grace"). His family identity model of 01:50 that morning says the opposite and it wins: *full
access continues to the end of the paid period, plus 30 days, applied to every member
individually*. #397·F had found the build honouring the older rule — the moment the renewal webhook
wrote `plan_name = 'SSi Premium'`, `familyAccess.ts` stopped returning the owner's row for every
member, with no tail at all.

- **The cutoff is derived from one date already on the row, not stored a second time.**
  `scheduled_plan_at` is the end of the paid Family period, written by `change-plan` when the owner
  confirms. The webhook now clears only `scheduled_plan_NAME` when it applies the change and
  **keeps the date**, so after the flip that column reads as "when Family cover ended".
  `api/_utils/familyGrace.ts` adds the 30 days — once, in one function. The alternative, a second
  `family_ended_at` column, would have been a second date to keep in step with the first for no new
  information; the alternative of inferring the date from the new billing period would have been
  wrong for an annual plan and for any missed webhook.
- **`scheduled_plan_name` alone now says whether a change is pending.** Every existing test of
  "is something scheduled?" already read the name, so nothing had to change — but it is now the
  rule rather than a coincidence, and the column comments say so.
- **The resolver stopped filtering on the plan name and started reading it.** The `.eq('plan_name',
  'SSi Family')` predicate WAS the cliff. The owner's row is fetched on `status = 'active'`, and
  the plan name decides which branch runs: live family, or the grace tail.
- **One computed date, everywhere.** `resolveEffectiveSubscription` returns `coverEndsAt` and
  everything downstream states that: `/api/subscription`'s `familyEndsAt` for a member,
  `familyCoverEndsAt` for the owner before and after they confirm, `/api/family`'s two dates
  (`planChangesAt` and `familyEndsAt`), the confirm dialog, the family page and the member email.
  Nothing but `familyGrace.ts` adds days to anything.
- **A cancellation gets no grace, deliberately.** A downgrade leaves the owner paying and displaces
  other people; a cancellation ends everything for everybody at the paid period, and there is
  nobody left paying to hang a tail on. The family page says so in its own sentence rather than
  borrowing the downgrade's.

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
## 2026-09-08 — a shared tenant is DERIVED from who lives on the domain, never listed (#385)

Tom's commission, off the #375 write-up: close the hole where the first school to sign up on a
national email tenant — hwbcymru.net, every school in Wales — claims it, and its teacher link then
vouches for any Hwb address in the country with no code and no mail. His constraint: **a hardcoded
list of shared tenants is refused**; derive it from the live data the way the backfill did, once, so
the creation path and the backfill agree by construction. Ordering: a legitimate Welsh school must
still get set up without emailing support; correctness is the second function of the same design.

**The rule.** A domain is a SHARED TENANT for school S when another school, outside S's group, has
its FOUNDING ADMIN living at that domain or beneath it. One async derivation in
`api/_utils/schoolDomain.ts` — learner_emails (kept in step with auth by triggers) joined to
`schools.admin_user_id` — and both sides call it: the creation path at claim time and at every
arrival, and `tools/backfill-school-identity-claims.mjs`, whose own admin-loop test is deleted.

**Three moments, one derivation.** CLAIM refuses `shared_tenant` when another household already
lives there. ARRIVAL suppresses a domain row whose domain has since become shared — re-derived every
time, never deleted, so accounts already born verified under it are untouched; suppression IS the
un-claim and no delete path exists. DOOR names only an effective holder: the second head on a tenant
is told who signed up first and carries on in one tap; the third sees nothing, because by then the
domain belongs to nobody.

**Better × simpler × cheaper.** Better: the hole closes the instant a second school proves an
address on a tenant, and no legitimate school is ever stopped — a refused claim degrades to today's
off-domain path. Simpler: no table, no column, no list, no migration; one function replaces the
backfill's N-lookup loop. Cheaper: three indexed PostgREST reads per claim or arrival, and nothing to
maintain when the next national tenant appears.

**The floor, stated rather than papered over.** The FIRST school on a fresh tenant is
indistinguishable from a school on its own domain — no evidence exists yet — so it claims, and its
link vouches for that domain until a second school proves an address there. Without a list or an
outside oracle the live data cannot know sooner. The window is bounded by the contest rule in
`unclaimedMint.ts`, which stays armed, and it shrinks to zero the moment the second Welsh school
signs up. Teachers who joined OTHER schools off-domain are deliberately not counted as evidence: an
off-domain arrival is the unproved shape, and counting it would let a leaked link switch a real
school's one-tap off.

**Proven on the live data, read-only.** Residents of hwbcymru.net are the four Welsh schools; of
chepstowschool.net, Chepstow alone; of schoolsedu.org.uk, two schools beneath it, so the parent can
never be claimed either. The door names nobody for an Hwb address and names Chepstow for a Chepstow
one. The repointed backfill's dry run reproduces the #375 distribution exactly — 42 schools, 6
already claimed, 24 public mail, 10 shared tenant, 2 with no admin — with zero writes and the claims
table unchanged at 6 rows.

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

## 2026-09-10 — the school board counts phrases spoken, not hours it never measured (job #159)

**The finding.** Every clip a class plays is in `player_events`, with its audio id, for every kind
of account. The playback ledger — the one definition of a minute since 2026-08-19 — cannot be
written by a class account: `bump_speaking_opportunities` checks `learners.user_id = auth.uid()`,
and a class's user_id is `class-learner:<id>`, so the write is refused and the player only logs it.
The class account's `sessions` rows are inverted: none for Chepstow's nineteen real lessons this
week, eight for app opens with no play. So the board's "Class practice 0h" was reading a ledger
that cannot see lessons, while throwing away the school_summary hours it had already computed, and
the Lens still reads `class_sessions`, dead since 19 August.

**The decision.** Whole-class play is shown as PHRASES SPOKEN — Tom's term for cycles played, one
per `target2` clip, the same count the ledger banks as `opportunities` for own accounts — plus the
phrase-by-count list, off the diary joined to the phrase tables. Practice minutes on the board are
own accounts only, off the ledger, as their own field. Whole-class practice TIME is not shown as any
number: no ledger measures it and no proxy stands in for it; one sentence under the row says so.
The hours tile, the class sessions count and the "Xh practised together" line are deleted, not
relabelled. Learners leaves the school-shaped stats row; it stays in the tree.

**Better × Simpler × Cheaper.** Better: every tile is backed by a live record, and the page shows
what was practised. Simpler: two dead tiles and three dead sentences gone; the phrase list is the
existing insight Table widget. Cheaper: one paged, JSON-path-filtered read of class-account diary
rows over seven days — a few thousand rows estate-wide, 596 ms live for Chepstow — no migration, no
player deploy.

**Not done, named.** Timing whole-class play needs the class account's ledger bump routed through
`/api/school/class-progress` (service role, teacher-authorised) and the class session opened at play
start: a player deploy, not a Friday hotfix. The Lens needs re-pointing off `class_sessions`.


## 2026-09-11 — the human test-sheet gate on staging→main is removed, not disabled (job #211)

**The three rulings, in order.**

- **2026-09-10, Tom: "10 — gate it."** A human test pass on the fixed `colombo-pass-v1` sheet
  became a required gate on `staging → main`. It lived in `tools/release-train/human-pass.mjs`,
  was recorded by `record-pass.mjs` from the tester's own words into `passes/<sha7>.json`, and
  `promote.sh` refused without it. Every step had to read `pass` on both the web run and the
  Android run, an unanswered step blocked exactly as a failed one did, and there was deliberately
  no bypass flag.
- **2026-09-10, later the same evening.** Tom's own words, as the ledger noted them at 21:55Z:
  the third thrust is a "live agent as real learner on the web, testing suite run by Astra".
  Watson recorded the ruling as "release testing is automatic and run by Astra; nobody hands Tom a
  test sheet." The ledger line is the nearest original wording found; Watson's is the paraphrase
  the commission carried. Both are given here so the reader can see the distance between them.
- **2026-09-11, Tom: "ok, remove that gate, we're not slaves to the system we created."** The
  ruling that removed it in code, when Watson offered three ways round the gate — someone runs the
  sheet, Tom waives it once, or hold the release — and Tom rejected the frame.

**What was removed.** The `HUMAN-PASS-GATE` limb in `promote.sh`, the `--accept-drift` argument
that existed only to feed it, and the header paragraph describing it. `human-pass.mjs`,
`record-pass.mjs`, `human-pass.test.mjs` and `passes/` are deleted, `package.json` loses
`test:human-pass`, and Thursday's candidate report no longer prints "the promote will REFUSE".
No pass was ever recorded; the gate blocked exactly one release, today's, for the eleven hours it
existed on the branch that ships. Removed rather than defanged because a bypass flag on the
ordinary path becomes the ordinary path inside a month — the script's own header said so.

**What replaced it.** The semi-automatic release-test loop landed on `dev` by job #208 earlier
today: a nightly user timer at 00:45Z that works the same checklist against staging as a real
learner would, records what it saw, and reports. It deliberately gates nothing yet. The sheet
`TESTER-SHEET.md` stays as the named source of the loop's controls, with a line at the top saying
it is no longer a gate. Nobody hands Tom a test sheet.

**What is still enforced in `promote.sh`, untouched.** Nothing runs without `--go`. The script
refuses when `origin/main` is not an ancestor of `origin/staging`, which is how an un-back-merged
hotfix announces itself. It regenerates the release notes from the range actually promoted and
commits them onto the merge, and if the notes fail to finalise it exits non-zero and says THE
PROMOTE LANDED. THE RELEASE NOTES DID NOT. It is never cronned. The removal is pinned by a case in
`promote-notes-commit.test.mjs` that asserts the gate's absence and those refusals' presence,
seen red on the old script and green on the new one. This was a supersession, not an erosion.

**The word that reverts it:** gate. The deleted files are one `git revert` away on `dev`.

## 2026-09-11 — a class has started when it has practised, not when it was assigned a course (job #215)

**Better × Simpler × Cheaper.** Better: the two sentences a school leader reads on one screen,
"13 have never started" and "30 of 34 have started", now describe the same fact and add up to the
school. Simpler: one rule, written once in `api/org/intel.ts`, decides what "started" means for
both QUIET and JOURNEY and for each class row's position; no widget hidden, no second read.
Cheaper: a reading-side change to one function and one proving test; no write path touched, no
migration, no shared database change.

**What was wrong.** Opening the class player writes a live position to the enrollment WITHOUT a
practice stamp, by design since 2026-06-11 so that a boot does not read as practice. JOURNEY read
that cursor as "started"; QUIET read the missing practice stamp as "never started". Nine of
Chepstow's thirty-four classes carried a cursor at sentence 1 and no practice, and were counted
both ways.

**The principle, Tom's.** "They know that SSi works, and all it needs is regular use." Assignment
is an intention; practice is what the school is being asked about. So started means practised.

**What changed.** `computeOrgIntel` gives a class a position only when it has practice evidence,
the same evidence QUIET already uses. Pinned by a test that was seen red on the old code and green
on the new: a class with a cursor and no practice is counted never-started by both questions.

**Follow-up, not done here.** The boot-time save still leaves a cursor on a class that never
played. The node home reads that cursor for its journey bar too. Whether a bare boot should write a
cursor at all is a write-path question for its own job.
---

## 2026-09-11 — the support channel's three tables are live; the watcher is not

**Decision.** Job #214 left three questions open. Two of them were answered yes and are done here:
the two branches are merged and the migration is applied. The third — arming the watcher — is
Tom's alone and was not touched.

**The migration.** `20260911_support_channel.sql` was applied to the live shared project by
`supabase/secfix-toolkit/canary_support_channel.cjs`, canary style: one transaction, the DDL, then
fixtures on real schools and a real council group, then thirty-seven assertions, then a rollback of
the fixtures and a COMMIT of the DDL alone. Leak-closed: anon reads nothing; a school admin sees
their own thread and their own turns and nothing of the school next door, cannot see an org thread,
cannot read `support_signals` at all, and cannot insert, update or delete anything anywhere — every
write is the server's or the service key's. Legit paths alive: `ensureThread`'s select, the
messages POST, the thread GET's `last_read_at` stamp, the doorbell's `doorbell_sent_at` stamp, the
population count as an integer, the signals upsert, and the watcher's unanswered-questions query.
The shape holds too — a thread owns exactly one of a school or a group, and there is one thread per
school forever. Live posture after commit: RLS on all three, one SELECT policy each on threads and
messages, zero policies and zero grants on `support_signals`, and SELECT the only privilege
`authenticated` holds anywhere in the set.

**One red the merge found.** `SEC0901-A-03` keeps the cron inventory as an explicit list so that
adding a cron is a deliberate edit to the security file. The doorbell was added to `vercel.json` on
the branch without that edit, so `test:api` went red the moment the branch met `dev`. The
deliberate edit is made; the handler already carried `checkCronAuth`, which the gate's derived
second assertion proves independently. The gate worked exactly as designed.

**The doorbell cannot ring yet, and that is structural, not a promise.** It selects `out` rows
older than three hours. Nothing writes an `out` row but the watcher and Tom's reply tool, and the
watcher is unarmed — so no school admin can receive an email from this until somebody arms it.

**The watcher stays unarmed.** `ops/ssi-support-watcher.service` in command-surface is committed
and installed nowhere: not in `~/.config/systemd/user`, no `~/.config/ssi-support/env`, never
enabled, never started. Arming it means an AI begins drafting replies to real school admins.
That is an intention-level call and it is being asked of Tom separately.
## 2026-09-11 — a class with no pupil accounts is not "inactive" by fiat (job #217·G)

**The case.** Ysgol Cas-gwent runs 34 classes as whole-class play from the front, with no pupil
accounts at all. On the morning of 11 September its head of department sent screenshots of her
class list reading "Inactive" on every row, next to "0h this week". By 12:03Z the in-app-time
release (`5ea385e88`) had made the hours column true, and the node home true, but the health mark
stayed "Inactive" for every class — the rule in `TeacherDashboard.vue` said "no pupil accounts
means inactive" before it looked at whether the class had practised at all.

**The ruling applied.** The Handbook sentence for that column already says what the rule is:
"Health is worked out from how many of the last seven days the class practised on." The code now
does that. `/api/school/class-practice-7d` carries `activeDaysByClass` — distinct days with any
play in the window, the class account and its pupils together — from the same diary read that
already produces the in-app seconds. `deriveClassHealth` (`views/schools/classHealth.ts`) takes
the higher of the report's active days and the diary's, tiers as before (5+ excellent, 2+ good,
1 needs attention), and only then falls back to the old pupil-count rule for a class with no play
on either record. Classes with pupils keep the answer they had. No Handbook sentence changed,
because the sentence was right and the code was wrong; `--check` stays green.

**What this does not do.** It does not touch the node home, the Insights rate engine (which still
reads `analytics_class_sessions_scoped` over the dead `class_sessions` table and reports "no
practice recorded" for this school — logged for job #215·G), or any copy. It sends no notice to
anyone. Pinned by `classHealth.test.ts`, seen red on the old rule and green on the new one.

## 2026-09-11 — copying a teacher's mistaken own-account play onto the class account (job #266)

**The case.** Chepstow's teachers have been running lessons signed in as themselves. Read live on
11 September: thirty-odd classes on cym_s_for_eng whose teacher's own learner row carries the
sessions and the diary, while the class's own account carries nothing. Under job #265's rule that
a class row reads the class account, those classes say "not started" forever. Tom's ask, verbatim:
"IF the teachers have by mistake played as themselves, Angharad needs to be able to copy all
progress data and telemetry and everything to the play as class account."

**Copy and keep, not move.** Tom said "copy", so the teacher's rows stay where they are and
re-keyed copies land on the class learner. The price of that is a second run doubling everything,
which is paid by the audit record: every apply writes one `class_progress_copy_audit` row naming
every source id it copied, and the next preview skips all of them. Natural-key tables are
insert-if-absent on the class side. Practice minutes on the enrollment are added once, on the
first run for a pair. Seen in the test: a second apply changes no table and still writes its record.

**Scoped to the class's course.** Only rows whose course is `classes.course_code` move. A teacher
who learns Welsh for themselves on a Spanish class keeps that Welsh. If Tom means "everything"
more widely than that, it is one parameter, not a redesign.

**The cursor is the further of the two.** The class enrollment is never duplicated. Position is the
last LEGO actually played, which on the live rows is `last_completed_lego_id` and its round index,
not the seed number and not `highest_completed_lego_id`, which is null on every Chepstow row read.
When the teacher is further, the class takes the teacher's cursor and helix state whole.

**Thirteen tables copy, thirteen are named as skipped.** The inventory came from
`information_schema` live, not from a doc: every `learner_id` column plus `player_events.user_id`,
which holds the learner PK. Identity, roles, billing, leases, entitlements and audit tables are
never copied and every record says so with the reason. `learner_practice_history` is skipped
because it carries no course and its session ids never match `sessions` rows, so no row can be
attributed to the class's course.

**Who may run it.** The server accepts `canTeachClass`: the school admin under either spelling,
ssi_admin, or an active teacher of the class, because a teacher fixing their own mistake is the
commonest case and costs nothing extra. The card is shown to school leaders only. Under View-as
the preview works and the apply is refused with the standard 403; Tom checking on staging as
Angharad will see exactly that, and it is not a bug.

**The audit table is live.** `20260911b_class_progress_copy_audit.sql` was applied to the shared
project by `canary_class_progress_copy_audit.cjs`: nine assertions, anon and authenticated denied
on read and write, service_role writes and reads back by pair, then COMMIT of the DDL alone.
