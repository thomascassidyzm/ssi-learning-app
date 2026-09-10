# Release automation stopped at the first evidence prerequisite

10 September 2026. This branch is a feasibility probe, **not the six-step
automated release runner**. No pass file, timer, promotion or bypass was added.

## Reproduced false positive

The existing journeys `instrument` classified a one-second WAV containing
16,000 entirely zero PCM samples as lesson audio. The first independent run
reported `firstLessonAudible=547.2ms`. The clip was a Blob URL, exactly the form
observed in the live staging lesson. URL exclusions cannot identify silent
content behind a Blob URL. `currentTime > 0.05` establishes playback progress;
it does not establish non-silent samples.

Reproduce without accounts or staging requests:

```sh
nice -n 15 ionice -c 3 node packages/player-vue/e2e/release-audible-control.mjs
```

Exit 1 is the reproduced detector defect. Exit 2 means the control could not
run. The JSON lands under `$CS_SCRATCH/tmp/release-audible-control/`. A stalled
control cannot falsely pass: silence refusal also requires clock advancement.

This finding does **not** establish that staging lessons are silent. It proves
that this instrument cannot distinguish that defect from successful playback.
The shared journeys library was left unchanged. Its other consumers have not
been fixed by this branch.

The new first-belt evidence evaluator now requires nonzero decoded frames as
well as the clock, paint, screenshot and build evidence. The driver does not
yet measure those frames and consequently cannot emit pass. The focused
regression was observed failing before this requirement and passing after it.
Synthetic positive data in that unit test is not live application evidence.

The probe's ordinary command now refuses before any fixture mutation or browser
launch. Explicit `--observe-first-belt` permits further incomplete observations;
it does not bypass qualification or the release gate. Do not spend an hour on
natural playback expecting this prototype to certify a pass.

## Live staging observations

The `fresh` fixture signed in by its stored password. Its Spanish enrolment
was cleared using the seeder's scoped reset, after verifying `is_internal`.
No password or entitlement was changed. The initial screen showed White Belt.
The short run measured normal lesson clock advancement. The longer run used
the app's Fast option, measured a painted player start at 83ms, and played
naturally for five minutes with no uncaught page error in the captured record.
It was interrupted to qualify the audio detector. Neither run observed a belt
transition. White Belt contains 22 LEGOs before seed 8 in the live course data;
these were not skipped. No full-run duration has been established.

The served build was `6758bba`, corresponding to staging
`6758bbafbe4be895edc95e30f0ddb7fdac159897`. A complete running-bundle identity
check was not reached. These are observations, not a release pass.

## Coverage: zero of twelve completed cells

| Sheet step | Web | Android |
| --- | --- | --- |
| first-belt-change | not checked: sign-in/reset/start observed; transition and non-silent output unproven | not checked: no real app run |
| subscription-wall-and-maybe-later | not checked: not attempted after prerequisite failed | not checked: no real app run |
| past-the-wall-pause-and-resume | not checked: not attempted | not checked: no real app run |
| settings-page | not checked: no Settings screenshots or address readout | not checked: no real app run |
| background-five-minutes | not checked: not attempted | not checked: native OS lifecycle unavailable |
| wifi-off-mid-round | not checked: not attempted | not checked: real app/network recovery unavailable |

There is no `/dev/kvm`. The existing WebView-origin Chromium fallback was read
but not run. It can support cross-origin network findings; it cannot certify
any complete Android sheet cell here. No web/app comparison was performed.
Two Chromium runs would not establish native parity, even with a different
user-agent. The useful next platform is a dedicated physical Android device
running the actual staging APK, with audio capture and OS lifecycle control.

## Delivery and next actions

The commission explicitly requires stopping before the other five steps when
step 1 cannot yet produce evidence to sign. Milestone 1 is complete; milestone
2 failed qualification. Milestones 3–7 are not complete. The remaining runner,
recorder integration, state/history reporting and nightly installation are not
implemented, and should not be inferred from the plan.

First strengthen and qualify the audio measurement using both silent and
non-silent decoded output controls, preserving the shared clock/paint probes.
Then complete the natural belt run before implementing the remaining sheet.
Keep the sibling-runner design, a 00:45 UTC nightly slot, and explicit
`automated:<runner>@<sha>` tester/recorded_by markers when recording is built.
These are proposed defaults, not installed behaviour.

The gate already on dev should ride a reviewed ordinary dev-to-staging
integration. Confirm the gate block, human-pass.mjs, record-pass.mjs, fixed
sheet and passes directory all arrive together. No such integration was run.
Once present on staging, **the very next staging-to-main promotion is blocked
until a complete committed two-run pass exists**. This partial work supplies
no pass and does not remove that block.

Explicit workspace gaps: crontab access denied; the user systemd bus was
inaccessible even with its actual address; no conversation token was supplied
for job-progress or internal publishing. Credentials were readable. Git's
original shared metadata was read-only, so delivery used a separate writable
Git repository with read-only object reuse and the same base/branch, then
pushed normally with the identity hook enabled. The original metadata was not
modified. Nothing was merged or deployed.
