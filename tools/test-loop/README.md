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

## Library and cycle semantics

`breakages/index.json` fixes the six seeded entries; each JSON file names the
learner impact, exact reversible patch, expected check and local limitations.
Patches demand an exact occurrence count: code drift produces GAP, never CATCH.
Every source patch runs in a disposable clone and is restored byte for byte in
`finally`; git status must be clean before and after every entry. Ignored build
output is disposable. Nothing rewrites the original checkout's checks.

The silence entry reuses `release-audible-control.mjs` byte for byte from
`origin/cs/157-automate-the-release-test-pass`. Its mutation is media substitution
inside a fully stubbed browser: 16,000 zero PCM samples through a blob URL.
It does not alter app files. **Control exit 1 means MISS, not CATCH:** the control
went red because the suite's detector was fooled. Exit 0 means the detector
refused silence, but only with a passing positive blob companion and advancing
playback clock. Exit 2, timeout, absent evidence and stalled media are GAP.

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

## Standing job proposal — not installed

Proposed slot: **00:45 UTC**, outside the 03:30 UTC estate-wide suite. The first
version exits 2 for the four documented gaps; keep those red/incomplete.
Watson should retain the cycle JSON and dispatch work on a specific miss,
requiring red-on-defect / green-on-restoration evidence for every added check.
Do not schedule concurrently with another browser worker on this repo.

Exact dispatch line, **after these changes are available in the named checkout**:

```sh
systemd-run --user --unit=cs-test-loop --slice=cs-workers.slice --on-calendar='*-*-* 00:45:00 UTC' --timer-property=Persistent=true --property=Nice=15 --property=RuntimeMaxSec=900 --working-directory=/home/tomcassidy/SSi/ssi-learning-app /bin/bash -lc 'export CS_SCRATCH="$HOME/.cache/ssi-test-loop"; mkdir -p "$CS_SCRATCH/tmp"; exec node tools/test-loop/run.mjs'
```

The source checkout is read only to the runner; every mutation and build occurs
in its scratch clone. The timer is a proposal, not installed: this session can
write only the private worktree and scratch paths. No promotion is implied.
