# The weekly release train

**Production ships once a week, Friday mornings, on Tom's explicit GO.**
Founder ruling 2026-07-30, verbatim: *"wait on this - I want to ship to production on a weekly
basis - Friday mornings."*

Nothing in this mechanism promotes anything by itself. A cron writes the *question*; Tom's word
is the only trigger for the *answer*. `dev → staging` keeps its own rhythm (promote when green,
per `CLAUDE.md`); this document is only about `staging → main`.

```
Thu evening        Fri morning                Fri, next 2h
───────────        ───────────                ───────────
candidate report → Tom says GO or HOLD  →  promote.sh  →  deploy sentinel watches
(cron, automatic)  (conversational)         (a human runs it)  (already cron'd)
```

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
5. commits the full report to `tools/release-train/reports/<date>.md` on `dev` (from a throwaway
   worktree — it never touches the live working tree) and posts a needs-you card:

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

## After the push — fallout watch

**Already covered. Do not build or run anything.** `tools/deploy-sentinel/sentinel.mjs` is cron'd
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
       "detail":"<the areas that shipped, in a sentence or two>",
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
  candidate a founder can read on a phone in a minute instead of 130 commit subjects.
- **Simpler** — one cron writing a question, one script a human runs on an answer. No release
  manager, no branch ceremony, no new environment; post-ship watching reuses the sentinel that
  already exists.
- **Cheaper** — a few `gh` calls and a `git log` once a week; the promote is one merge. Nothing
  runs on the money path without a human sentence in front of it.
