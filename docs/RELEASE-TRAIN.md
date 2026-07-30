# The weekly release train

**Features ship once a week, Friday mornings, on Tom's explicit GO. Fixes ship the moment
they're ready, any day, without release notes.**

Founder ruling 2026-07-30, verbatim: *"wait on this - I want to ship to production on a weekly
basis - Friday mornings."* Amended 2026-07-31, verbatim: *"fixes go live immediately - at any
point in the week - without release notes; whereas features, and/or minor fixes that are just
better affordances stick to the weekly release train."*

## Which lane is this? — the classification test

> **Was something broken, or lying to the user?** → it's a **fix**. Ships now, no notes.
> **Is something newly possible, or just nicer?** → it's a **feature or an affordance**. Rides the
> train, gets notes.

"Lying to the user" is deliberate and load-bearing: dishonest behaviour (a play button out of step
with what's playing, a "Saved" that didn't save, a stale number presented as live) is breakage even
when nothing crashed. Regressions are fixes by definition. A *minor* fix that is really a better
affordance — nothing was broken, it's just improved — rides the train; the test is the state of the
thing before the change, not the size of the diff.

Nothing in this mechanism promotes anything by itself. A cron writes the *question*; Tom's word
is the only trigger for the *answer*. `dev → staging` keeps its own rhythm (promote when green,
per `CLAUDE.md`); this document is about `staging → main` (the train) and the `hotfix/**` fix lane
that goes straight to `main`.

```
Thu evening        Fri morning                Fri, next 2h
───────────        ───────────                ───────────
candidate report → Tom says GO or HOLD  →  promote.sh  →  deploy sentinel watches
+ DRAFT NOTES       (conversational)         + NOTES STAMPED   (already cron'd)
(cron, automatic)                            (a human runs it)
```

**Tom never writes release notes separately.** They are drafted by Thursday's run and stamped
final by Friday's promote — see *Release notes* below. **Fix-lane pushes carry no notes at all**;
a fix restores behaviour the user was already promised, so there is nothing to announce.

---

## Any day — the fix lane

A fix does not wait for Friday. It goes straight to production the moment it's ready, using the
mechanism `CLAUDE.md` already describes — this is that lane, with a broader definition of what
qualifies, not a second parallel mechanism:

```bash
git checkout -b hotfix/<desc> origin/main    # branch off main
# fix, run the gates, PR or push to main
# then back-merge into BOTH staging and dev so the fix survives the next promotion
```

- **Branch off `main`, land on `main`, back-merge into `staging` AND `dev`.** Skipping the
  back-merge is the one way this lane can hurt you: `promote.sh` refuses to run when `main` is not
  an ancestor of `staging`, so an un-back-merged hotfix blocks Friday's train until reconciled.
- **No release notes, no notes file, no card.** The Thursday draft will not mention it; the
  phrasebook gates would drop most fixes anyway, and a fix that *is* worth telling people about is
  the exception Tom adds by hand to that week's draft.
- **The gates still apply in full** (typecheck, tests, lint, api) — "immediately" is about the
  calendar, not about the bar.
- Everything else — features, and minor fixes that are really better affordances — stays on the
  train below. When in doubt, ask which side of the classification test it falls on; if it's still
  in doubt, it rides the train, because a week's wait costs less than an unannounced surprise.

---

## Thursday — the candidate report

`tools/release-train/candidate-report.mjs`, cron'd on watson-1:

```
0 17 * * 4  /usr/bin/node /home/tomcassidy/ssi-learning-app/tools/release-train/candidate-report.mjs >> /tmp/ssi-release-train.log 2>&1
```

The VM runs on **UTC**, so `17:00` is 18:00 UK summer time — Thursday evening for Tom, and the
report lands before Friday morning either way. It:

1. computes `origin/main..origin/staging` — the exact candidate;
2. condenses the commits to human headlines, splitting **process** commits (merges, worklist
   claims, promote records) from **substantive** ones and clustering the substantive ones by area
   (schools, player, family/billing, walkthrough, insights, admin, infra);
3. reads CI health per commit SHA from the Verify workflow's run history, plus the staging head's
   own combined status;
4. flags open regressions and ship-gates out of `WORKLIST.md` by keyword heuristic — including
   **"unblocked by this promote"**, the items whose stated gate is code reaching `main`;
5. drafts the **release notes** for this exact candidate (`release-notes.mjs`) and puts the
   bullets straight into the report under *Release notes (draft)*;
6. commits the report to `tools/release-train/reports/<date>.md` AND the draft notes to
   `tools/release-train/notes/<date>.md` on `dev` in one commit (from a throwaway worktree — it
   never touches the live working tree) and posts a needs-you card:

> **Friday ship: N commits ready — GO / HOLD**

The card's 🔗 opens the committed report. (The needs-you board takes text + url and has no detail
field, which is why the detail is a file.)

Run it by hand any time: `node tools/release-train/candidate-report.mjs --dry-run`.

**Verify runs on `staging` and `main` pushes** (added 2026-07-30 with this mechanism) so the
Thursday report can read a real verdict on the exact tree being promoted rather than inferring
one from the branch each commit happened to be tested on. Those runs gate nothing — they are the
promotion's evidence.

---

## Friday — GO or HOLD

Tom decides, conversationally, through Watson. There is no timer and no default. HOLD is a
first-class answer: the candidate simply rolls to next Friday and grows.

On **GO**:

```bash
cd ~/ssi-learning-app
./tools/release-train/promote.sh          # preview — what would ship, no writes
./tools/release-train/promote.sh --go     # merge staging → main and push
```

The script refuses without `--go`, refuses if `main` is not an ancestor of `staging` (an
un-back-merged hotfix — reconcile per `CLAUDE.md`'s hotfix lane first), and does its merge in a
throwaway worktree so the live tree is untouched. It's the same deliberate merge idiom
`CLAUDE.md` describes for `dev → staging`, just written down.

Doing it by hand is equivalent:

```bash
git fetch origin --prune
git merge-base --is-ancestor origin/main origin/staging   # must pass
# merge origin/staging into origin/main with --no-ff, push to main
```

---

## Release notes

One file per ship: `tools/release-train/notes/<draft date>.md`, generated by
`tools/release-train/release-notes.mjs`. **Headlines only**, in user/teacher-facing language. No
commit hashes, no refactors, no process commits.

**The shape is fixed** (founder ruling 2026-07-30, superseding "a handful of bullets"):

```
## What's new     up to 3 features, the most significant FOR THE USERS
## Fixes          the bug fixes
```

**Significance is not commit count.** It is a judgement about a *surface*, so it lives as a weight
on each phrasebook entry (3 = a user would notice and care, 1 = cosmetic) — made once, reused every
week. Bullets we could not translate confidently always weigh 1, so an unclear commit can never
take a feature slot from a known surface. Features that miss the cut are listed in the draft's
coverage section for Tom to promote by hand; nothing is silently binned.

```
Thursday   drafted alongside the candidate report, same commit, same push
           -> Tom edits the bullets in place if he wants to
Friday     promote.sh --go stamps the SAME file: ship date + promoted sha,
           hand edits preserved, the draft-only coverage section stripped
```

The file keeps the **draft** date in its name so it pairs 1:1 with `reports/<date>.md`; the ship
date lives inside the header. Finalising rewrites only the header block (between the
`<!-- release-notes:header -->` markers), so anything Tom types in the body survives.

### The honesty rule

Notes **under-claim by construction**: a commit earns a bullet only if it can be translated
confidently, and everything else is dropped rather than guessed at. Three gates, in order:

1. **kind veto** - docs, tests, chores, refactors: internal by construction.
2. **not-live veto** - "stage 1", "phase 1", "shadow", "behind a flag", "groundwork". Code can be
   on `main` and invisible; announcing it is the one mistake these notes may not make.
3. **translate** - a **phrasebook** of durable product surfaces (course switching, the schools
   nav, invite links...) supplies polished wording, plus each surface's feature/fix kind and its
   significance weight. A commit matching no entry can still earn a bullet, but only if its subject
   names something a user can see *and* carries no internal-machinery vocabulary — and it lands at
   weight 1, fix-or-feature decided by whether the subject uses corrective language.

The draft carries a **coverage section** listing everything dropped and why, so the gaps are
visible - if a real feature was dropped, add a bullet by hand before GO. That section never
reaches the final notes.

Maintenance: add a phrasebook entry when a new user-facing **surface** appears — with its kind and
significance weight — not to force a bullet for one commit. The gates are tested by `pnpm test:release-train`
(`tools/release-train/release-notes.test.mjs`, node's built-in runner, fixtures are real commit
subjects) and run in CI.

### These are not the changelog

`CHANGELOG.md` is Tom's own prose, one section per promotion, and stays hand-written. The notes
are its headline skeleton - paste and expand - and a shippable summary in their own right. Nothing
generated ever writes to `CHANGELOG.md`.

By hand:

```bash
node tools/release-train/release-notes.mjs --dry-run    # print the draft, touch nothing
node tools/release-train/release-notes.mjs              # draft, commit + push to dev
node tools/release-train/release-notes.mjs --finalize --sha <staging sha> --count <n>
```

---

## After the push — fallout watch

**Already covered. Do not build or run anything.** This applies to **both lanes** — the sentinel
watches *any* new `main` sha, so a Tuesday fix-lane push gets exactly the same 2-hour fallout watch
as a Friday promote. Nothing extra to arm.

`tools/deploy-sentinel/sentinel.mjs` is cron'd
every 3 minutes on watson-1 and opens a 2-hour watch window on any new `main` sha: deploy-live
check against `/version.json` cross-referenced with Vercel's deployment status, endpoint probes,
and production `player_events` volume against a 4-week same-clock baseline. Fallout posts a loud
needs-you card; a clean window closes with one quiet all-clear on the done board.

### Report the ship

Once the sentinel's window closes clean, post the outcome to the done board — the same mechanism
`ops/retention-prune.js` uses:

```bash
curl -s -X POST http://localhost:4317/api/done \
  -H 'Content-Type: application/json' \
  -d '{"text":"Weekly ship: N commits live on saysomethingin.app",
       "conv_id":"8f1c601c-51d0-4de3-8919-dc711e27fc38",
       "detail":"<paste the headlines from tools/release-train/notes/<date>.md>",
       "url":"https://saysomethingin.app"}'
```

---

## The first ride (2026-07-31)

The backlog at the time this was built is **130 commits** — production had not been promoted since
2026-07-27. That backlog is the first Friday candidate, and it is unusually large, so the first
report carries a **staging soak / spot-check list**: four rounds that shipped to staging but whose
taste-pass was still outstanding when the mechanism was built —

- walkthrough guardrails
- admin danger-verb guards
- pull-consistency tranche 3
- How-this-works discoverability throb

Tom said he would taste-pass these on staging the same day, so they may already be checked by the
time the card is read. From week two the candidate should be a week's worth, and a list like this
should be the exception rather than the rule.

---

## Why this shape

- **Better** — production stops drifting a month behind staging, and every ship carries a written
  candidate a founder can read on a phone in a minute instead of 130 commit subjects. The fix lane
  keeps breakage off the weekly clock: nobody lives with a broken thing until Friday because the
  cadence exists.
- **Simpler** — one cron writing a question, one script a human runs on an answer. No release
  manager, no branch ceremony, no new environment; post-ship watching reuses the sentinel that
  already exists.
- **Cheaper** — a few `gh` calls and a `git log` once a week; the promote is one merge. Nothing
  runs on the money path without a human sentence in front of it. The notes are a second rendering
  of the delta the report already computed — one pipeline (`lib.mjs`), no new inputs, no tokens.
