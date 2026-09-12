# Does the suite catch a defect a real learner would feel?

The misses are the deliverable. Green tests, coverage percentages and a failing
baseline are not fitness measures. This loop does not replace the human/Astra
six-step pass required between staging and main.

**The loop may ADD and STRENGTHEN checks. It may NEVER weaken, delete, skip or
retire a check to make a run pass, nor lower a threshold to fit observed data.
An inconvenient red stays red. Only Tom or Watson retires a test.**

If an energy check newly fails clips, report the count. Never lower the floor
to agree with existing false greens. Every genuine bug reaching a user should
become an entry here, with an independent expectation of the learner's outcome.

## Run

From a committed checkout with the workspace dependencies available:

```sh
nice -n 15 node tools/test-loop/run.mjs
```

`CS_SCRATCH` must name an existing disk-backed directory with a writable `tmp`
subdirectory. The runner creates a fresh local clone, builds that clone's core
JavaScript and player, and serves Vite preview on **127.0.0.1:4173**, strict port.
No downloads, accounts or live database writes. Builds and browsers are serial.
The preview is stopped on completion; no background shell job is left running.
`--controls-only` omits the preview build and explicitly records that omission.
This is useful for instrument work, never evidence of an application pass.

Read the printed `REPORT` JSON path. Exit 0 means every entry caught, 1 means
misses, 2 means gaps or an execution failure (which may coexist with misses).
Reports retain the source SHA, actual child exit, playback clock and detector
observation. Archive them before Command Surface sweeps the scratch directory.

The release automation worker can run the additive qualification check with:

```sh
pnpm --filter player-vue verify:audibility
```

This runs the positive blob control and then the three-case audible control
(silence refused, click-at-end refused, real bundled clip heard), serially.
Worker #168's energy-predicate detector is merged on `dev` as `069ef0c5c`, so
this is expected GREEN; a red here is a genuine instrument finding to report,
never a threshold to adjust. The blob control is kept alongside the real-clip
case because it exercises blob-URL provenance specifically, which the real-clip
case does not. It is a prerequisite instrument check, not the human/Astra
release pass itself.

## Library and cycle semantics

`breakages/index.json` fixes the six seeded entries; each JSON file names the
learner impact, exact reversible patch, expected check and local limitations.
Patches demand an exact occurrence count: code drift produces GAP, never CATCH.
Every source patch runs in a disposable clone and is restored byte for byte in
`finally`; git status must be clean before and after every entry. Ignored build
output is disposable. Nothing rewrites the original checkout's checks.

The silence entry uses `dev`'s `release-audible-control.mjs` (worker #168's
three-case control). Its mutation is media substitution inside a fully stubbed
browser: 16,000 zero PCM samples through a blob URL. It does not alter app
files. The runner scores the **silence case alone**: verdict `wrong` (zero PCM
reported as heard) is **MISS** because the suite's detector was fooled; verdict
`correct` is **CATCH**, but only with a passing positive blob companion and an
advancing playback clock. A wrong verdict on the click or real-clip case turns
the control red without scoring this entry; read `run.evidence.results`.
`cannot-run`, timeout, absent evidence and stalled media are GAP. Cycle 1
measured this entry as MISS on the pre-#168 detector; the integrated detector
measures it as CATCH (see `reports/`).

The added positive blob control plays a known non-zero 440 Hz WAV through the
actual shared instrument. The blob mutation deliberately rejects blob URLs in
the scratch instrument. A green unmutated positive followed by red mutant and
green restored positive proves this narrow instrument assertion works. It does
not prove IndexedDB provenance or real lesson content recognition.

The four other patches are applied and reverted to prove patch applicability,
but **GAP / applied is not exercised**. They have no safe local learner fixtures
yet. Their source is not rebuilt while broken; do not count them as scored
application mutations. The baseline preview serves real app HTML; both audio
controls fulfil all browser routes with a button fixture, so they do not visit
the actual app. This deliberately small first cycle measures the instrument.

The six journeys are performance/behaviour probes, not an automated six-step
release pass. Their user creation and session helpers target live Supabase.
They are therefore named as intended consumers, not run against live services.
The library identifies the relevant standalone probes and where their claims
stop. The full Vitest estate, typecheck and lint are not part of this loop.

Existing private audio instruments remain untouched. The ground search found
`first-play-latency-probe.mjs`, `returning-learner-latency-probe.mjs`,
`cold-start-readiness-probe.mjs`, `upfront-download-budget-probe.mjs`, and
`_bootfallback-probe.mjs` using the clock-based pattern. The brief mentioned six;
a sixth exact copy was not established here. Do not treat this as a completed
estate-wide sweep.

## Run a cycle now (on demand)

One command, from any checkout of this repo that has its workspace dependencies
installed; it measures the tip of `origin/dev`, not whatever is checked out:

```sh
nice -n 15 node tools/test-loop/run.mjs --ref origin/dev
```

Omit `--ref` to measure the current checkout's HEAD instead. The printed
`REPORT` line names the cycle JSON in `$CS_SCRATCH/tmp/test-loop-*/cycle.json`;
copy it somewhere durable before the scratch directory is swept. The nightly
wrapper below does that copy for you and is the same one command to type:

```sh
tools/test-loop/nightly.sh
```

Its report lands in `~/SSi/test-loop-reports/<UTC stamp>-<sha>.json` with the
runner's console log beside it and `latest.json` / `latest.log` pointing at the
newest. A full cycle takes several minutes: fresh clone, two builds, preview,
serial browser controls.

## Standing job — installed 2026-09-11, report-only, SEMI-AUTOMATIC

**This loop is not a gate. Its exit code is advisory and nothing may consume
it as a gate.** No CI job, release script, promotion path or deploy reads it.
It scored one catch of six seeded breakages in its first cycle and missed
silence outright, so it is not trustworthy as a gate, and Tom has ruled it is
not to be one. The human/Astra six-step pass between `staging` and `main`
remains the actual release gate and is untouched by this. Semi-automatic means:
it runs on its own schedule and writes a report a person reads and acts on.

Slot: **00:45 UTC** nightly, outside the 03:30 UTC estate-wide suite, as the
user timer `cs-test-loop.timer` → `cs-test-loop.service` in
`~/.config/systemd/user/`, under `cs-workers.slice`, `Nice=15`, `Persistent=true`.
The service fetches `origin/dev` in the shared checkout, extracts
`tools/test-loop/nightly.sh` from that ref and runs it, so the tested code and
the runner are both the tip of `dev`, never the branch the checkout happens to
be on. The report records `ref` and `sourceCommit`. `RuntimeMaxSec` is set from
the measured full-cycle wall-clock with headroom, see the unit file.

```sh
systemctl --user list-timers cs-test-loop.timer     # next run
systemctl --user start cs-test-loop.service          # run the nightly now
journalctl --user -u cs-test-loop -n 100 --no-pager  # last run's console
cat ~/SSi/test-loop-reports/latest.json              # last run's report
```

Watson reads `latest.json` and dispatches work on a specific miss, requiring
red-on-defect / green-on-restoration evidence for every added check. The four
GAP entries stay GAP until someone builds a safe local learner-level fixture;
exit 2 for them is honest and expected. Do not schedule another browser worker
on this repo at 00:45.
