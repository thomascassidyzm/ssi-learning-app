# Cycle 1: one miss, one catch, four explicit gaps

**Silence still fools the detector in the tested dev-derived snapshot.**
The loop built and served a disposable app preview on 127.0.0.1:4173, then
qualified the shared instrument using network-isolated browser fixtures.
It did not run a learner journey through the real app or touch live data.

| Breakage | Applied | Suite result | Added / outstanding |
|---|---|---|---|
| Silent lesson audio | Zero PCM WAV substituted in browser | **MISS** | Reused negative control is red. Worker #168's fix passes it in a separate scratch comparison. |
| Belt never advances | Source patch, restored | **GAP: not exercised** | Needs local course fixture reaching a real belt transition. |
| Subscribe wall absent | Source patch, restored | **GAP: not exercised** | Needs local account/backend fixture; passwords exist, isolation is missing. |
| Settings wrong server | Source patch, restored | **GAP: not exercised** | Needs rendered Settings assertion against the actual configured host. |
| Duration not written | Both SessionStore write payloads zeroed, restored | **GAP: not exercised** | Needs a local ongoing-session persistence fixture. No database was contacted. |
| Blob lesson unrecognised | Shared instrument made to reject blob URLs in scratch | **CATCH by added check** | Positive blob control: observed GREEN before, RED on the mutation, GREEN after restoration. |

All six entries were applied and reverted, with a clean tracked/untracked tree
asserted between entries. Only **two** were exercised and scored. Source patch
applicability for the other four is not a learner-level measurement.
The blob result uses the newly added check; it is not evidence that the previous
suite already caught this defect. On this snapshot the original URL predicate
accepts blobs; the seed deliberately introduces the opposite behaviour.

## Evidence and additions

`cycle-1.json` records the full preview run on `deb32995e759730ff10d3a63d429438de008afa3`.
The silent clip clock advanced to 0.212616 seconds and was reported audible.
The deliberately excluded positive blob reached 1 second and was not recognised.
The restored positive was recognised. No thresholds were adjusted.

`worker-168-comparison.json` records temporary scratch use of the instrument and
its audibility helper from worker #168 at
`7a3e4a67308765cb10f330e289d19815ac04a52d`. Both the silence and positive-blob
controls exited 0. **The same silence check was observed RED on the old detector
and GREEN on worker #168's fix.** That fix is not imported into this branch and
has not been claimed as merged. Integration remains outstanding.

`controls-rerun.json` records the short rerun after timeout/stale-result cleanup
changes; it again reports one MISS, one CATCH and four GAPS, exit 2. No second
app build was used as ritual verification. The original negative control is
byte-identical to the requested #157 branch file.

Added `pnpm --filter player-vue verify:audibility`: a positive blob check followed
by the reused silence control. This deliberately stays red on this checkout.
The release automation worker can use it to qualify the measuring instrument;
the human/Astra six-step promotion gate remains in force.

The library uses one JSON file per seeded breakage plus an index. The runner
clones to CS_SCRATCH, uses serial niced builds/browsers, rejects patch drift,
records gaps separately, restores source bytes and stops preview on exit.
The add/strengthen-only hard rule is in both code and README.

## Explicit delivery gaps

- Four application mutations still lack safe local learner-level fixtures. This
  is a working first instrument cycle, not a completed six-defect app suite.
- No conversation token or conversation ID was supplied in this session's
  preamble/environment. The seven-step progress API and publish-doc API were
  not called with a fabricated identity. These committed documents have not
  been published to Command Surface; Watson needs to publish them.
- The supplied worktree's Git index is read-only under the shared metadata path.
  Commits and push therefore use a separate repository in CS_SCRATCH/tmp; files
  are also left in the supplied worktree. No shared checkout was edited.
- The 00:45 UTC standing job is proposed, not installed. README gives the exact
  systemd dispatch line under cs-workers.slice, conditional on the command being
  available in that checkout. No service or shell background task is left running.

No full Vitest suite, typecheck or lint was run. No staging/main merge, promotion
or deployment was performed. No silence-instrument fix was duplicated.

Milestones: scratch preview, library and runner complete; cycle attempted all six
and scored two; blob check proved red/green and silence closure verified only on
worker #168's branch; hard rule documented; standing dispatch proposed. The four
coverage gaps and fix integration are unfinished work, not green milestones.
