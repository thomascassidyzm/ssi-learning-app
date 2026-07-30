# tools/release-train

The weekly `staging → main` release train. Full process: **`docs/RELEASE-TRAIN.md`**.

| File | What it is |
|---|---|
| `lib.mjs` | Shared machinery: the `main..staging` delta, the process/substantive split, area clustering, and the throwaway-worktree publish. One pipeline — the report and the notes are two renderings of it. |
| `candidate-report.mjs` | Thursday-evening cron. Computes the candidate, condenses it to headlines, **drafts the release notes**, checks CI, flags regressions, commits report + draft notes to `dev` in one commit, posts the **"Friday ship: N commits ready — GO / HOLD"** needs-you card. Writes nothing to any branch but `dev`, and never promotes. |
| `release-notes.mjs` | The notes: headlines only, user-facing language, **under-claiming by construction** (untranslatable commits are dropped, never guessed at). Drafts on Thursday, `--finalize` stamps the ship date + promoted sha on Friday, keeping hand edits. |
| `release-notes.test.mjs` | Gate tests for the above (`pnpm test:release-train`, node's built-in runner). Fixtures are real commit subjects. In CI. |
| `promote.sh` | Friday-morning promote, run **by a human on Tom's GO**. Refuses without `--go`. Stamps the notes final after the push. Never cronned. |
| `reports/` | Committed candidate reports, one per Thursday. The needs-you card links here. |
| `notes/` | Release notes, one file per ship — draft on Thursday, final on Friday. Named by the DRAFT date so it pairs with `reports/<date>.md`; the ship date is inside. Edit the bullets freely before GO. |

Cron (watson-1, UTC):

```
0 17 * * 4  /usr/bin/node /home/tomcassidy/ssi-learning-app/tools/release-train/candidate-report.mjs >> /tmp/ssi-release-train.log 2>&1
```

Handy:

```bash
node tools/release-train/candidate-report.mjs --dry-run   # print the report, touch nothing
node tools/release-train/candidate-report.mjs --no-post   # write + push the report, no card
./tools/release-train/promote.sh                          # preview the promote

node tools/release-train/release-notes.mjs --dry-run       # print the draft notes only
pnpm test:release-train                                   # the notes gates
```

Release notes are **not** `CHANGELOG.md` — that file is Tom's prose and stays hand-written. These
are its headline skeleton. Full flow: `docs/RELEASE-TRAIN.md` → *Release notes*.

Post-ship fallout is **not** this tool's job — `tools/deploy-sentinel/` already watches every
`main` push for 2 hours. Don't duplicate it.
