# What's sitting on `dev`, and what to promote

*Read-only inventory, 2026-08-22. `staging` and `main` are byte-identical at `b846df73`. `dev` is at `b3f4623c`.*

## The corrected headline

`dev` shows 30 commits and a 12,494-line diff against `main`. Both numbers overstate the backlog.

**Unlanded work is 28 commits, not 30.** Two of the thirty are already in `main` under different hashes — `git cherry` confirms it. One is the Pod 1 listening-resolver Tom asked about directly (it's `main`'s current tip); the other is a small admin-page retirement. Neither needs promoting; they're already live.

**The real content size is 7,486 lines, not 12,494.** `supabase/schema.sql` — a regenerated database dump, not authored work — accounts for 5,737 of those lines by itself. Strip it out and the actual diff across 89 files is 7,486 insertions and 863 deletions. Still substantial, but not "12.5k lines of risk."

**One migration is already applied live; the other needs a decision before anything ships.** More on this below — it's the single thing most likely to bite if promotion goes on autopilot.

## The groups

### 1. Join-code security fix (SEC22-01) — ready now, arguably already the safest thing on the list

Three commits (`df609ad4`, `2d7cd658`, `0760f15e`), merged into `dev` this morning via `a4b96eaa` from branch `security/audit-2026-08-22`.

**What it is, in learner terms:** nothing a learner sees. It closes a hole in how class and school join codes get minted — the codes teachers hand students, and the codes that grant teacher/admin/government roles on redemption. Before the fix, the database was generating those codes from a predictable, non-cryptographic random source, and any unauthenticated caller could hit the database directly and sample that source at will — verified live against production this morning (eight anonymous calls, eight working codes). After the fix, codes come from a proper cryptographic source and only the server-side service role can mint one at all. A companion commit adds rate-limiting to the handful of app routes that create classes or schools (and therefore mint codes), so a script can't hammer the mint path either.

**Learner-facing or internal?** Internal — it's a hardening fix behind the scenes. A teacher creating a class or a school notices nothing different.

**Finished and tested, or work in progress?** Finished. This is the most rigorously verified item in the whole backlog: 15/15 canary checks green in one transaction, a live before/after probe on production (anonymous requests went from 200-OK-with-a-real-code to 401-denied), a reversibility script, and characterization tests flipped from `.todo()` to real assertions. The commit message documents its own verification in detail.

**Coupling:** none that blocks it. It doesn't touch anything else on this list.

**Already verified elsewhere?** Yes, and this is the important part: **the database migration behind this fix (`20260822_join_code_csprng_and_grant_lockdown.sql`) has already been applied to the live, shared database** — the commit message says explicitly "Applied live via `supabase/secfix-toolkit/canary_join_code_csprng.cjs --commit`." Remember `dev`, `staging` and `main` share one database. So the database has been fixed since this morning regardless of which app branch is running; promoting these three commits is about getting the **code and tests** that describe and lock in that fix onto `main`, not about triggering the fix itself. That actually makes this the lowest-risk group to promote — there is no "does the live DB already have this?" question hanging over it, because the answer is already yes.

**Recommendation:** promote first, and it can go via the `hotfix/**` fix lane rather than waiting for Friday's train — this is squarely "something was insecure" territory under the repo's own fix-vs-feature test.

---

### 2. VAD / speech-latency telemetry — finished, but no live-DB dependency to sort out

Nine commits: the read-only probe (`af604a6e`), the playback-vs-speech gating fix (`82072e5c`) and its follow-up correctness fix for early speakers (`82da9eba`), the prompt-end persistence fix (`6ab08d83`) and its pinning test (`f928d666`), the merge commit (`fd5cc762`), plus the deploy-sentinel play-probe fix and its own diagnosis doc (`79feb214`, `8c4111a6`) and sentinel self-update docs (`eac21820`, `c34c4355`).

**What it is, in learner terms:** nothing a learner sees or can interact with. This is the pipeline that measures how quickly a learner starts speaking during the pause phase, which feeds the adaptive-difficulty engine. Before this group, the detector was frequently mistaking the app's own audio playback for the learner speaking — live data showed 83% of "speech starts" were actually the device hearing itself, with "utterances" averaging 14 seconds. The fix makes the detector relative to a measured noise floor instead of an absolute threshold, and separately fixes a real bug it introduced (a confident learner who starts talking *before* the prompt audio finishes was being incorrectly filtered out — now correctly kept and flagged). A companion pair of commits stops the internal deploy-watchdog script from false-paging Tom about "learners can't play" when the fault was in the watchdog's own probe, not production.

**Learner-facing or internal?** Internal — telemetry accuracy and an ops tool. The adaptive-difficulty engine consumes this data, but nothing changes in what a learner sees or hears.

**Finished and tested, or work in progress?** Finished. Every fix has a paired test, including one that specifically pins the sign of a value by mutation-testing the pin (the commit describes injecting a bug and confirming the new test catches it before reverting). No open threads or TODOs in this group.

**Coupling:** none. No migration — everything here writes into the existing `player_events` JSON payload, which needed no schema change. The two deploy-sentinel commits are a special case worth flagging: the sentinel already runs live on a cron job on a dedicated machine that **pulls `origin/dev` directly** (a deliberate design so its own bugfixes don't wait for an app release). So the false-alarm fix is *already running in production today*, independent of whether these commits ever reach `main`. Promoting them just brings the app repo's history in line with what's actually running.

**Already verified elsewhere?** The playback-rejection numbers (83% false-positive rate) were measured against live production rows before the fix; the docs in `docs/vad-telemetry/` record the diagnosis. No independent second-party audit, but the evidence trail is unusually thorough for an internal fix.

**Recommendation:** safe to ride the normal train. No urgency, no blockers.

---

### 3. Library numbers: Phrases spoken, Phrases learnt, Total Time — learner-facing, and the one with a live-migration question attached

Six commits: `1a6cd832` (Phrases learnt + hiding the dead Phrases tile), `3636bf5a` (Total Time becomes real playback time), `14ad1995` (Phrases spoken gets a server-side, lifetime home), `624d8146` (tab-close test for the phrases-spoken flush), plus the demo-refresh fix `f38b2820` and admin deep-link fix `95d7a17e` which piggyback on the same telemetry ledger this group touches.

**What it is, in learner terms:** three numbers on a learner's Library screen change meaning, and this is squarely "the app was lying to the user" territory:
- **"Words" becomes "Phrases learnt"** and now correctly counts distinct material across *all* of a learner's enrolled courses, not just the seed position of whichever course happened to be open. (Tom's own account: the tile read "280"; the correct number is 12,153 across 53 courses.)
- **"Phrases spoken"** now has a real home in the database instead of living only in the browser's local storage for 30 days on one course — so it survives closing the tab and accumulates for life. It's also now hidden entirely (not shown as a lying "0") unless the learner has turned on the mic/adaptation setting that's needed to measure it at all.
- **"Total Time"** now measures actual playback time (audio genuinely sounding) instead of wall-clock time between session start and end. The old number was badly broken — Tom's own account read 437 hours, including one session logged as 128 hours straight with zero items practiced, because a timer was never being closed. The corrected figure is 43 hours. This is a real bug fix, not a preference change.

**Learner-facing or internal?** Directly learner-facing — these are three numbers on the Library screen every learner sees.

**Finished and tested, or work in progress?** Finished, with one honestly-flagged gap. Tests exist for the accumulation/flush logic including the tab-close case specifically (`624d8146` — written precisely because neither the database canary nor the end-to-end test could reach that code path). The commit for Total Time states plainly that historical session rows can't be repaired retroactively (they only ever recorded wall-clock spans) and that the playback ledger only goes back to 2026-05-14 even for accounts older than that — so the corrected number is a floor for long-standing learners, not a perfect lifetime total. That's a stated limitation, not an unfinished feature.

**Coupling — the part that needs a decision before promotion:** the "Phrases spoken" half of this group depends on a database migration, `supabase/migrations/20260819_phrases_spoken_ledger.sql`, which adds one column and one new function to the existing speaking-opportunities table. **I could not confirm from the repo alone whether this migration has already been run against the live, shared database.** Unlike the join-code fix above, its commit message does not say "applied live." A matching canary script exists (`supabase/secfix-toolkit/canary_phrases_spoken_ledger.cjs`, dry-run by default, `--commit` to apply) and looks complete and ready to run, but I found no dated applied-log or doc recording that it has actually been run. This is an explicit gap, not a guess either way: **someone needs to check the live database for the `phrases_spoken` column on `learner_speaking_opportunities` (or run the canary in dry-run mode, which is read-only and safe) before this group goes anywhere near `staging` or `main`.** If the column isn't there yet, the migration needs applying first — before or in the same step as promoting the code, since the API route (`GET /api/me/phrases-spoken`) and the write path assume the column exists. If it *is* already there, this group is exactly as safe as the join-code group.

**Already verified elsewhere?** No independent audit; verification is the tests plus the commit-message evidence described above (live account numbers quoted before/after for two of the three tiles).

**Recommendation:** confirm the migration state first (cheap, read-only — see the migrations section below), then this is a strong, self-contained "fix" batch for the train — it's fixing things that were actively misleading users, which is the repo's own bar for the fast lane rather than a Friday feature release.

---

### 4. Admin deep-link sign-in fix, and demo-data refresh rollup fix — small, internal, already covered above

`95d7a17e` and `f38b2820`. Both are one-off bugs Tom found himself while using admin tooling: tapping an admin link while signed out silently dropped him into the learner player with no way to sign in (now routes to sign-in and replays the link); and clicking "Refresh demo activity" didn't refresh the specific rollup table the "Last 7 days" panels actually read, so a regenerated demo student looked inactive. Both are internal (admin-only surfaces), both are finished with tests and gate-passes noted in their commit messages, and neither depends on anything else in this inventory. They can ride with whichever batch is convenient — there's no reason to hold them.

---

### 5. A159 documentation and the Aran-pad churn — internal, mostly docs, nets close to zero app change

Seven commits: `270edaf6`, `79de055f`, `901f7776`, `642ca340`, `2cd56de8`, `2b1d21da`, `c1e4586b`. (`d40f2f62`, the `/admin/onboarding` retirement, is already in `main` per `git cherry` — it's not part of this group's unlanded content.)

**What it is, in learner terms:** nothing. This is a documentation and internal-tooling cluster: an inventory of learner-facing features that sit off the app's default navigation path, an adoption-numbers study of who actually turns on optional features, and a short-lived internal editing tool for the "How This Works" learner-explainer copy that was built (`79de055f`) and then retired again three commits later (`901f7776`) once the same editing job moved into the Popty dashboard instead. That in-and-out nets close to zero real code change even though it's three commits.

**Learner-facing or internal?** Internal. Nothing here is a screen a learner sees differently.

**Finished and tested, or work in progress?** The docs are finished, dated analyses. The Aran-pad code was built and then deliberately deleted in the same batch, so there's no half-built code left on `dev` from it — just documentation of the decision.

**Coupling:** none — self-contained, no migrations, no dependency on the other groups.

**Already verified elsewhere?** Not applicable; these are the source documents themselves.

**Recommendation:** low priority, no risk. Fine to promote whenever, or to fold into whichever batch is going anyway — it changes nothing a learner or the live app can regress on.

---

### 6. Pod resolver — already in `main`, not backlog

`b3f4623c`, the commit Tom asked about directly. `git cherry` shows it's already `main`'s tip under this hash — it's not waiting on anything. Its `docs/DECISIONS.md` entry records a genuinely thorough verification (live anon-read check on the resolver's database table, 2,328 tests passing, typecheck and lint clean). Mentioned here only so it's clear this one needs no action.

---

## The migrations question, plainly

`dev`, `staging` and `main` share one database, so a code promotion and a database migration are two separate questions and mixing them up is exactly how a promotion either breaks the app or silently does nothing.

- **`20260822_join_code_csprng_and_grant_lockdown.sql` (Group 1): already applied live**, per the commit's own record of running its canary with `--commit` and getting 15/15 green. No further DB action needed — code-only promotion.
- **`20260819_phrases_spoken_ledger.sql` (Group 3): unverified from the repo.** A canary script exists and looks ready, but I found no record — no applied-log, no dated doc — saying it has actually been run. This needs a cheap, read-only check before Group 3 is promoted: either run the canary in its default dry-run mode (it rolls back automatically and is safe against production), or query whether `learner_speaking_opportunities` already has a `phrases_spoken` column. I did not do either, because both are outside this job's read-only-on-the-repo rails — flagging it for whoever picks up the promotion.

## Recommended promotion shape

Tom hasn't said whether he wants one big promotion or several small ones — in the absence of that instruction, my default is **several small, coherent batches, security first**, purely because it's the lower-risk shape; say the word and I'll bundle it differently.

1. **Batch 1 — SEC22-01 (Group 1), now, via the hotfix lane.** It's a security fix ("was something lying to the user / leaving a door open" — yes), it's the most thoroughly verified item on the list, its database half is already live, and it doesn't wait on anything else. Straight to `main` via `hotfix/**`, back-merged to `staging` and `dev` per the repo's own hotfix rule. What would tell you it went wrong: a spike in 401s on `generate_join_code` from legitimate signed-in teacher class-creation (would mean the SECURITY DEFINER trigger path broke) — the canary already checked this, so it's a belt-and-braces watch, not an expectation.

2. **Batch 2 — VAD telemetry + deploy-sentinel fixes (Group 2), on the normal train.** Nothing learner-facing, nothing to break for a user, no live-DB question. What would tell you it went wrong: adaptive difficulty behaving oddly for learners with mic/adaptation consent on, or the deploy sentinel's play-probe verdict changing shape unexpectedly (it already runs live independent of this promotion, so this is really just closing the gap between what's running and what the repo says is running).

3. **Batch 3 — Library numbers (Group 3), on the train, but only after the phrases-spoken migration state is confirmed.** This is a genuine "the app was lying to the user" fix — Total Time alone corrected a 10x-inflated number — so once the migration question is settled it has a strong case for going out sooner rather than waiting for a full weekly cycle. What would tell you it went wrong: `/api/me/phrases-spoken` erroring for any signed-in learner (would mean the column/RPC isn't actually live yet), or Total Time dropping to zero for accounts with real history (would mean the ledger read path regressed).

4. **Batch 4 — the two small admin/demo fixes (Group 4) and the A159 docs/Aran-pad cluster (Group 5), whenever, together or split across the above.** Genuinely no risk, no coupling, no reason to hold them back or rush them.

Either way, per `CLAUDE.md`'s own flow, the first real act of any of this is `dev → staging` — `staging` and `main` are identical right now, so there's no `dev → main` shortcut available even for Batch 1's hotfix lane in spirit; the hotfix lane is for `main` emergencies cut from `main`, and nothing here is an active production emergency, so all four batches should genuinely go through the normal `dev → staging` soak first, security fix included, unless Tom decides SEC22-01's live-verified severity warrants skipping the soak. I've defaulted to *not* assuming that skip; say the word if you want it treated as urgent enough to bypass the soak.
