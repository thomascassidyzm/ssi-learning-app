# Practising mode: a door you can tap

*2026-08-31. Live on staging.*

## What you tap

1. Start playing as normal.
2. Tap the **bottom pill** to open **Settings**.
3. Scroll to **Developer** — it only appears for you, because it is gated to ssi_admin.
4. Bottom of that section: **Practising Mode (test)**. Tap it.
5. Tap **close** on Settings. You are back in the same session, still playing.

Within a second or two the **Practising** pill appears. Audio never stops.

To come back out: same three taps, same switch, tap it off. Forward play resumes
and your position is exactly where it was — because while it held, nothing about
your position was written down.

It turns itself off when the app restarts. That is deliberate, and the next
section says why.

## Why it is not a fake

The old door was `?practising=1`, and two things were wrong with it.

It was a query string, and you run the installed PWA, which has no address bar.
So it was shut to the one person most likely to need it.

And it was a lie. It set the practising flag directly, which shows you the banner
whether or not the feature works. It proved a pixel.

This one does not touch the mode at all. It takes the **content** away — the
fetch for the next new LEGO fails the way a dead network fails it — and then gets
out of the way. The app's own trigger notices, raises the mode itself, suppresses
the progress writes itself, and starts its own once-a-minute recovery heartbeat.
Everything you see is the feature.

Turning it off is the same honesty backwards. Nothing is reset by hand: the next
probe simply succeeds, the app decides on its own that the material is reachable,
and it leaves the mode. **That half has never been watched by anybody.** It is
half the behaviour and it is now a tap away.

## Two doors had to be closed, and one of them is a finding in its own right

**The bundle.** Fifteen courses — spa, fra, jpn, zho, cym_s and ten others —
answer every question about upcoming content from one whole-course file already
sitting in the phone's storage. No network involved at all, ever.

That has a consequence nobody had written down: **on those courses, airplane mode
cannot show you practising mode.** The next new LEGO is always reachable, because
it is already on the device. The radio being off changes nothing. If your course
is one of those fifteen, you could sit in airplane mode all evening and see
nothing, and the feature would be working perfectly the whole time.

So the switch declines the bundle too, or it would have been a no-op on exactly
the courses that matter most.

**Our own prefetch.** The app fetches one round ahead, so the round the check asks
about has usually already been cached — the switch would have said "reachable"
and looked broken until you had played through another round. It declines that
cache as well, which is what makes the switch mean what it says.

## What it cannot touch

Nothing is written about your progress while it holds. That is not a promise this
switch makes — it is the mode's own gate, the same one that protects a real
learner who genuinely loses their connection, and it sits in front of every write
primitive rather than at their twenty-odd call sites.

It is held in memory only and is off at every app start. A blackout that survived
a restart would sit in front of the app's boot fetch and leave it unable to start
at all — and a test switch that can brick the app is worse than no switch. The
cost is one tap after a restart.

## Tonight, without any of this

**Airplane mode is not a reliable way in, and on your likely course it is not a
way in at all.** Verified rather than assumed:

- If you are on any of the fifteen bundle courses, it will never fire. Don't wait
  for it.
- On any other course it is a real test, but you would play for roughly **8–12
  minutes** before the app next needs material it hasn't got — the buffer sits
  about three to four rounds ahead and does not grow the longer you play. Deep in
  a course, where rounds run longer, it could stretch to sixteen.

One correction to the number that was in circulation: the "57 rounds ahead"
figure came from job #473, which was probing the *older* trigger — a
cache-and-audio-exhaustion condition that was replaced the same day. It is not
the current buffer depth.

So: use the switch. It is two taps and about two seconds.

## The general case: fourteen doors, all of them shut to you

Every test door, debug flag and diagnostic mode in the player is a query string.
There are fourteen of them, and **all fourteen are unreachable from the installed
PWA** — every one is read once at boot from a URL you have no way to type.

| Family | Doors |
|---|---|
| Playback / scheduling | `preview`, `fullscript`, `l1`, `pod`, `podview`, `l1test` |
| Cache / audio path | `stream`, `wedge` |
| UI state / diagnostic | `qa_mode`, `practising`(+`consolidating`), `fc`(+`enc`) |
| Bootstrap override | `bundle` |
| Data / demo | `standing`, `demo` |
| Devtools | `debug` |

Three of them (`l1`, `pod`, `podview`) are limited to non-production hostnames and
already have in-app buttons in the tester panel. One (`qa_mode`) has a Settings
toggle that works alongside it. **The other ten are wide open on production to
anyone who knows the string.**

There is also a fully-built deep-link parser — `lego`, `round`, `cycle`,
`cycleText` — that would drop you into an exact playback state, wired to nothing
but its own tests. A ready-made support tool sitting unused.

### What one door for all of them would look like

A single hidden entry — a seven-tap on the belt badge, say — opening an
admin-gated panel that lists every door as a toggle. The underlying cheats do not
move; only where they read their input from does, so `?l1=1` in a bug report keeps
working. Two visible tiers: the ones that take effect immediately, and the ones
that need a reload, which the panel offers as a button rather than leaving you to
find one.

Two cannot move, and should be named rather than quietly dropped: `debug` and
`wedge` both run before the app exists, so there is no panel and no role to check
at the moment they fire. Those stay as they are.

That would make twelve of fourteen reachable from a phone with no address bar.
**Not built — this is the report you asked for, not a second job done unasked.**

## Where it is

- Landed on `dev` (`e49f5160`), promoted to `staging` (`859436f7`), **`main`
  untouched**.
- Gates green on both trees: typecheck, 2,750 player tests, lint at zero errors,
  API typecheck, 1,487 API tests. Nine of those tests are new and cover this
  switch, including one that kills the network entirely and proves the bundle
  answers "reachable" with the switch off and "unreachable" with it on.
- Verified live: the string `Practising Mode (test)` is in the deployed
  `SettingsScreen` chunk on staging.

## One thing that needs you, not tonight

The three branches have genuinely diverged, and I have reported rather than
resolved it:

- `staging` is 31 commits ahead of `dev`.
- **`main` carries 7 commits that are in neither `staging` nor `dev`** — hotfixes
  that were never back-merged, including two practising-mode fixes
  (`CONSOLIDATING writes nothing`, `a weak connection is CONSOLIDATING, not the
  end of the course`) and the class-join rate-limit fix.

The next `staging → main` promotion would be merging *over* those seven. They
almost certainly have newer equivalents on dev under the renamed mode, but
"almost certainly" is not something to fast-track into production, and untangling
it is a decision rather than a chore.
