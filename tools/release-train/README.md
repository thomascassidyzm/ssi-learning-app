# tools/release-train

The weekly `staging → main` release train. Full process: **`docs/RELEASE-TRAIN.md`**.

| File | What it is |
|---|---|
| `candidate-report.mjs` | Thursday-evening cron. Computes the candidate, condenses it to headlines, checks CI, flags regressions, commits the report to `reports/` and posts the **"Friday ship: N commits ready — GO / HOLD"** needs-you card. Writes nothing to any branch but `dev`, and never promotes. |
| `promote.sh` | Friday-morning promote, run **by a human on Tom's GO**. Refuses without `--go`. Never cronned. |
| `reports/` | Committed candidate reports, one per Thursday. The needs-you card links here. |

Cron (watson-1, UTC):

```
0 17 * * 4  /usr/bin/node /home/tomcassidy/ssi-learning-app/tools/release-train/candidate-report.mjs >> /tmp/ssi-release-train.log 2>&1
```

Handy:

```bash
node tools/release-train/candidate-report.mjs --dry-run   # print the report, touch nothing
node tools/release-train/candidate-report.mjs --no-post   # write + push the report, no card
./tools/release-train/promote.sh                          # preview the promote
```

Post-ship fallout is **not** this tool's job — `tools/deploy-sentinel/` already watches every
`main` push for 2 hours. Don't duplicate it.
