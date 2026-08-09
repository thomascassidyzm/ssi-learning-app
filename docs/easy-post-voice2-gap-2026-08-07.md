# Easy holds a beat after voice 2 — landed dev + staging, 2026-08-07

**Your ruling:** add 1 second of extra pause AFTER voice 2 in Easy mode only — "this is to stop
the next cycle just coming in and taking over". Voice 2 is the phase with the target text on
screen, so the same beat leaves that text up for longer (Aran's musing today).

## What it does now

- **Easy**: voice 2 ends → 1 second of silence → the next cycle's prompt. The target text stays on
  screen for that second, because the player is still in the voice-2 phase throughout it.
- **Fast**: unchanged. Its config holds a 0 gap, so the next cycle follows voice 2 in tens of
  milliseconds, exactly as before.

## Config or code?

Both, in that order. There was **no existing knob** — the only post-voice-2 hold in the player was
the intro-tile linger, baked per cycle when the script is built, not readable from mode config. So
the code change adds one runtime override alongside the mode's existing pause and speed ones, and
the **length is a mode-config field**: `algorithm_config.easy_mode.post_voice2_gap_ms`, default
1000. Retuning it (1.5s? 750ms?) is a Supabase edit, not a deploy. Fast's row holds 0.

The DB rows don't carry the key yet, so the code default of 1000 is what's live. Adding
`post_voice2_gap_ms` to the `easy_mode` row overrides it from that point on — no deploy needed.

## One thing I changed beyond the ask

The old intro linger ran on a bare `setTimeout`. iOS freezes JS timers on a locked screen, which is
the exact bug the pause phase was fixed for back in June — it now sounds a genuinely-silent clip and
advances on the audio 'ended' event, which iOS does not freeze. A 1s bare timer on **every** Easy
cycle would have put that stall back in the middle of every cycle, and Easy is the default mode for
new learners. So the hold uses the same silent-clip protocol as the pause phase. The intro linger
now rides that protection too.

## Verified in a real browser, on the real deploys

A probe (`packages/player-vue/e2e/easy-post-voice2-gap-probe.mjs`) wraps the audio element and
records the actual clip timeline a learner hears, in each mode, for ~70s of play.

| | dev | staging |
|---|---|---|
| Easy gaps measured | 1119 / 1056 / 1311 ms | 1125 / 1056 / 1077 ms |
| Fast gaps measured | none | none |
| Fast cycle-to-cycle | 3–145 ms | 2–113 ms |
| Page errors | none | none |

(The measured figure is a touch over 1000ms because it includes the next clip's fetch, which used to
sit inside the gap-free transition.) The pre-existing ~2s intro linger still fires in both modes —
asserted separately so it can't be mistaken for the new gap.

Unit tests cover the rest: the hold's own 'ended' advances when timers are frozen, the backstop
timer can't double-advance, a failure to sound the silence never halts the cycle, pausing mid-hold
stops it, and a 0 gap is byte-identical to the old path. Full gates green (typecheck, 1821 tests,
0 lint errors).

## Where it is

- `dev` — commits `4abff608`, `10cf5a3c`; live and verified on the dev deploy.
- `staging` — merged as `004b1b92`; live and verified on staging.saysomethingin.app.
- **Made it before the weekly staging→main train.** `main` untouched.
