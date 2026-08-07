# Tonight: what is on dev, and whether it goes to staging

*State as of 18:15 UTC, Thursday 6 August 2026. If the listening-mode rework lands later tonight, a fresh version of this will be published.*

You are deciding one thing: whether the work sitting on `dev` goes to staging tonight, staging to main overnight, and the release lands Friday morning or lunchtime — leaving Friday afternoon to fix or roll back before close of play. Nothing below has been promoted, merged or deployed. This is a read.

---

## How big it actually is

**21 commits** are genuinely unlanded — none of them are work staging already has under a different hash. You will see **31** in this morning's Friday candidate report; that is a raw count that includes merge commits and the promotion bookkeeping. 21 is the real number of pieces of work, and it is now 32 raw because this document's own commit joined the pile.

The line count is **91,299 added, 443 removed across 81 files** — and that number is misleading unless you split it:

| | Files | Added | Removed |
|---|---|---|---|
| Shipping code | 47 | 798 | 395 |
| Tests and browser probes | 12 | 1,079 | 18 |
| Docs, census data, scripts | 22 | 89,422 | 30 |

One file — a German chopped-clip census dump — is **87,065** of those lines. The actual code that runs in front of a learner is **798 added and 395 removed**. That is a normal week.

**Gates, run just now on the current tree: core build green, typecheck green, tests green (1,602 passed), lint clean on everything on `dev`.** The single lint error in the run comes from an untracked probe file another agent is working on right now; it is not on `dev` and would not travel.

---

## What a learner would notice

- **There are now two learning modes, Easy and Fast, chosen on the player's resting screen before you start.** Turbo is gone.
- **Fast is exactly today's course.** It is wired as a deliberate identity override — same pauses, same phrases, same repetitions as before. Nobody currently learning gets a different experience unless they choose one.
- **Easy gives you longer to answer, more repetitions, and shorter phrases.** Roughly double the thinking time at the start of a pause, double the practice and review repetitions, and it drops the longest half of the phrases for each piece of vocabulary. It does *not* slow the audio down — speech stays at normal speed.
- **A brand-new learner now starts on Easy.** Anyone with any play history stays on Fast and is never moved silently.
- **Your chosen mode is now visible at White Belt.** It was being rendered invisibly against the white-belt colour, so learners on the first belt could not see which mode they were on.

## Fixes

- **A missing audio clip is now counted, not just skipped.** The player already refused to stall on a dead clip — it skips and carries on. It now counts how many it has skipped in a row and shouts when three go by, so a course with a hole in its audio shows up as one hollow session in the diagnostics instead of nine unrelated blips. No change to what starts, stops or pauses.
- **The mode toggle's tap target is now asserted at 44px** rather than inferred, so it cannot shrink below a thumb on a phone.

## Docs, tests and internal only

**Sixteen of the twenty-one commits carry no user-visible effect**: the German chopped-clip census, the Welsh silent-stub finding, the A-22 audio exposure map and its APML, the Easy/Fast writeups and screenshots, browser probes that verify last week's never-stalls fix and the audio-ref stamping on staging, and this morning's release-train report. They are inert — data files, specifications and test scripts. They ship no behaviour.

---

## Worth a second look before this goes out

1. **Easy/Fast is on `dev` and not on staging — so promoting tonight ships it.** You said your habit is to try a player change on dev yourself first; this is the one that deserves it. Open the dev build, look at the resting screen, switch between Easy and Fast, and listen to a couple of cycles of each. Worst case if it is wrong: existing learners are untouched, but every new learner lands in Easy and hears a noticeably slower, more repetitive, shorter-phrased course.
2. **The Easy phrase-length cap is set to a half, and that decision is now in the code.** The open question about whether Easy should cut at a half or nearer a third has effectively been answered by shipping 0.5. Nobody has changed it since, deliberately, because it changes what learners hear. If a half is not what you want, it is one number and one deploy — but it is easier to change before it is in front of anyone.
3. **New learners defaulting to Easy.** That is a product call, not a technical one, and it is riding in with the rest. Check on staging that a fresh account really does land on Easy and that an existing account really does stay on Fast.
4. **The silence counter touches the playback path.** It only adds a count to a message the player already sends, and adds nothing that can stop a session — but it is in the file that runs every cycle. On staging, play a few minutes and confirm audio still runs end to end without gaps.

Everything else — census data, documentation, probes — cannot affect a learner and does not need looking at.

---

## Still in flight

**The listening-mode rework has not landed on `dev` yet.** As of right now, `dev` behaves the same as staging does: listening mode is entered from Settings, and you leave it with the back button on the transport. The tray you open mid-session does not offer it. That is the placement you said was a misunderstanding, and it is still what is there.

The rework — putting listening back in the mode tray as an on/off row you can flick in and out of in one tap each way — is being written at this moment but is not committed. So it is **not** part of what you would promote tonight.

That means promoting tonight ships the Settings-only placement to production Friday. The alternative is to promote the rest tonight and let listening follow on its own; it is a self-contained change and does not depend on anything above.

---

## Recommendation

**Go — but try the Easy/Fast switch on the dev build yourself before you press it**, because it is the one thing here a learner meets on their first screen and it is not what staging has been soaking.
