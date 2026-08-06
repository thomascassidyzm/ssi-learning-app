# Easy / Fast — where the toggle sits

Aran's ruling, built on the learner-app side. Two modes now, not three: **Easy** and **Fast**.
Turbo is gone. **Fast is exactly what the app does today**, and it stays the default for
everyone — nobody's experience changes unless they choose Easy.

---

## Where I put it, and why

**On the player's resting screen** — the screen you land on before you press play, under the
belt badge. A small two-way switch: `Easy | Fast`.

That is the closest honest reading of Aran's "front page". It is also the right *kind* of
control: Easy vs Fast is a decision you make before you start, not a dial you hunt for
mid-sentence. It sits with the other "which course, where am I" identity, which is what that
screen is for.

The alternative you floated was the bottom nav / sliders tray. I did not put it there, and I
took the Turbo entry *out* of that tray while I was in it. The tray is for things you flip
during a session — offline, pronunciation guide. Burying a before-you-start choice one tap
deep behind a sliders icon is where Turbo lived, and almost nobody found it.

**This is the one thing I'd like your eye on.** If you'd rather it sat in the tray, or on the
library screen, or somewhere else entirely, say so and it's a small move.

---

## What Easy actually does

Three things, matching what you said — "doubling time, doubling the reps, having the longest
possible phrase":

1. **Double the thinking time.** Every part of the pause is 2× the Fast value. I also switched
   off the belt taper in Easy, so the gap does *not* shrink as you climb belts — an Easy
   learner keeps the full gentle pause the whole way.
2. **Double the repetitions.** Every phrase-count knob doubled.
3. **The longest phrase available**, rather than the shortest-first order Fast uses.

The voice speed is unchanged at normal — "doubling time" I read as your thinking gap, not
slowing the speaker down. Say if you meant the other thing.

**When each half lands:** the pause change is immediate, on the very next gap. The reps and
phrase-length change land on the next script build — so next session, or when you switch
course. That is deliberate: forcing a rebuild mid-round would stall you for several seconds
in the middle of a sentence, which is a worse trade than the reps arriving next time.

---

## Every knob, so you can retune from the admin side

Nothing here is hardcoded-and-stuck. All of it reads from `algorithm_config`, and anything you
set there wins over these built-in fallbacks.

The player now reads two keys: **`fast_mode`** and **`easy_mode`**. It still falls back to the
old `normal_mode` row for Fast if the new rows don't exist yet, so it can't break while the
Popty side catches up.

### Pause / timing

| Knob | Fast | Easy |
|---|---|---|
| `pause_boot_ms` | 1000 | **2000** |
| `pause_assembly_lin` | 2.5 | **5.0** |
| `pause_multiplier` | 1.05 | **2.1** |
| `min_pause_ms` | 700 | **1400** |
| `max_pause_ms` | 15000 | **30000** |
| `pause_assembly_threshold_ms` | 1000 | 1000 (same) |
| `pause_belt_boot` | 1.0 | 1.0 |
| `pause_belt_assembly` | 0.8 | **1.0** (taper off) |
| `playback_speed` | 1.0 | 1.0 |

### Repetitions

| Knob | Fast | Easy |
|---|---|---|
| `maxBuildPhrases` | 7 | **14** |
| `useConsolidationCount` | 2 | **4** |
| `maxSpacedRepPhrases` | 12 | **24** |
| `n1PhraseCount` | 3 | **6** |
| `spacedRepOffsets` | unchanged | **unchanged** |

I deliberately did *not* double the Fibonacci ladder. That ladder is the schedule of *when* a
review fires, not how many reps it gives — the four counts above are the reps.

### Phrase length

| Knob | Fast | Easy |
|---|---|---|
| `phrase_length_preference` | `shortest` | **`longest`** |

---

## Two things that genuinely need you

**1. The placement above.** Resting screen, or somewhere else?

**2. Should Easy be the default for brand-new learners?** I have made **Fast** the default for
everyone, existing and new, because that is the safe call — it means this change moves nobody.
But there is a real argument that a complete beginner's first ever session should be the gentle
one. That is a taste call about the first impression of the product, so it is yours, not mine.

---

## Smaller calls I made, flagged rather than hidden

- **The Turbo points bonus is gone.** Turbo used to quietly multiply your session points (1.5×
  if you used it for most of a session). Easy is a gentler mode, so there is nothing to reward,
  and rewarding Fast would be pushing people to rush. The multiplier is a flat 1.0 now — which
  is exactly what every learner who never used Turbo already got, so no one's points change.
- **"Longest possible phrase" for an *easy* mode reads slightly against the grain** — a longer
  phrase is usually the harder one. I built it exactly as you said it, and it is a single knob,
  so if it turns out you meant something else it is a one-word change.
- **Skipping a listening stretch no longer skips it for good.** Turbo used to let a skip count
  as done. Now, in both modes, the listening work still has to be done — which is the behaviour
  every non-Turbo learner already had.

---

## Have a look at it yourself

**<https://ssi-learning-app-git-dev-zenjin.vercel.app>** — open it on your phone, let the
player screen settle, and look **just under the White Belt pill**. That is the switch:
`Easy | Fast`, with Fast lit by default.

I could not embed the screenshots in this page, so that link is the real thing rather than a
picture of it.

### What I actually checked on dev, in a real browser at phone size

Passing: the switch is there, it offers Easy and Fast, **Fast is selected by default**,
tapping Easy selects it, the choice survives a full reload, Turbo is gone from the sliders
tray, and no page errors.

**Two cosmetic faults the probe caught, both since fixed:** at White Belt the selected pill
was rendering white-on-white, so you could not see which mode you were on; and the buttons
came out at 41px, under the 44px thumb-target floor. Both fixes are merged and green, and I
re-measured the corrected control in a browser at 44px with white-on-dark text. **Dev's
deploy was lagging by the time I finished, so those last two fixes may not be on that URL
yet when you look** — if the selected mode looks blank, that is the deploy catching up, not
the fix missing.

---

*Built 2026-08-06 on the learner-app side. The Popty/admin side — authoring the actual
`easy_mode` and `fast_mode` rows and deleting `turbo_boost` — is the separate piece of work and
is not covered here.*
