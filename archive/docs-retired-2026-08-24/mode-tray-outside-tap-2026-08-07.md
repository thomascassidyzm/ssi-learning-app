# The mode tray now closes when you tap anywhere outside it

*2026-08-07 — the bug Tom reported about ten times.*

## What was wrong

With the mode tray open, the only way to close it was pressing the mode button again.

The tray **already had** a backdrop element whose whole job was outside-tap dismiss —
`position: fixed; inset: 0`, which reads as "covers the whole screen". It does not.
`.bottom-nav` carries `transform: translateX(-50%)` to centre the nav pill, and a
transformed ancestor becomes the **containing block** for any `position: fixed`
descendant. So `inset: 0` resolves to the nav pill, not the viewport.

Measured live, in a real browser, on a real build:

```
backdrop: 358 x 72 px, top: 760      viewport: 390 x 844
```

A 358×72 strip sitting on the nav. Everything above it — the entire screen the learner
is actually looking at — was not covered by anything. Tapping there hit nothing, and the
tray stayed open. Exactly what Tom saw.

## Why the earlier attempt didn't fix it

There *was* an earlier pass at this area — `1c41b1d2`, 16 July. It went the other way.

The backdrop used to be `Teleport`ed to `<body>`, which does escape the transformed
containing block and does cover the viewport. But in embedded play — play-as-class and
the staff Learn button, where `.player-container.is-teach-embedded` is *also*
transformed — a body-level teleport rejoins the **root** stacking context, paints
*above* the locally z-indexed tray, and silently swallowed every tap on the
Listening/Offline rows. So that fix removed the teleport, which gave the rows back and
left the outside-tap dismiss dead.

That is the state Tom has been testing. It is a genuine source bug on staging, not a
cache one — his fresh PWA reinstall was right to rule caching out.

Both positions lose because the question is framed as "where should the backdrop live?"
Any answer is wrong: local and it's the size of a nav pill; teleported and it eats the
tray's own taps.

## The fix

Stop asking the backdrop to do it. The dismiss is now a **document-level `pointerdown`
listener**, attached only while the tray is open, in capture phase. No containing block
can shrink a document listener and it paints nothing, so it cannot swallow a tap meant
for anything. The backdrop stays exactly where it is, purely as the dim.

Three details that stop this becoming the next bug report:

- **No close-then-reopen race.** The trigger button sits *inside* the watched root, so
  its pointerdown is ignored — only its click toggles. The classic backdrop failure
  (outside-close fires, then the button's own click reopens what just closed) can't
  happen.
- **The dismissing tap doesn't do anything else.** After an outside pointerdown closes
  the tray, the click that same press produces is swallowed once. Otherwise dismissing
  mid-session would double as a tap on the transport underneath — an accidental pause,
  which reads as a new bug. It's scoped to that press's own target and expires after
  700 ms, so if the press was a scroll or drag and no click follows, nothing is left
  armed to eat someone's next tap.
- **Escape closes it too**, on desktop.

## Verification

Same probe, same real browser, same real build, before and after:

| Check | Before | After |
|---|---|---|
| tap in the middle of the screen closes the tray | **FAIL** | PASS |
| tap near the top of the screen closes the tray | **FAIL** | PASS |
| tap in the nav row outside the tray closes it | PASS | PASS |
| trigger still closes it, no reopen race | PASS | PASS |
| reopens immediately afterwards | PASS | PASS |
| nothing intercepts a tap on a tray row *(the `1c41b1d2` regression guard)* | PASS | PASS |

The two failures before are Tom's report, reproduced mechanically.

Also 8 unit tests (`src/components/ModeTray.outsideTap.test.ts`) — 5 of which fail
against the unfixed component, so they're pinning the behaviour rather than describing
it. Full suite green: 1832 tests, typecheck clean, lint 0 errors.

## Where it is

- Branch `claude/tray-outside-tap-close`, commit `5fb43de1`
- Merged to `dev` (`0e0f4eb7`)
- Merged to `staging` (`52ab52c9`) — rides today's weekly train
- Probe: `packages/player-vue/e2e/mode-tray-outside-tap-probe.mjs` (prints the backdrop
  geometry as its own evidence)
