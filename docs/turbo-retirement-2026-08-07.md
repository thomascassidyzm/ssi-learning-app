# Turbo, properly retired — 2026-08-07

Turbo stopped being a learner CHOICE on 2026-08-06 (Aran's two-mode ruling: there
is exactly Easy and Fast). What was left after that was residue — a config row
nothing read, a preference key on every learner, dead methods with no caller, and
comments still describing machinery that no longer exists. This is the pass that
removed it.

**Zero learners were ever stranded.** `turbo_mode_enabled` was FALSE on all 1,092
learner rows that carried it, censused live before anything was written. That is
the whole safety argument: every change here is behaviourally a no-op.

---

## The headline

| | |
|---|---|
| Learners on Turbo | **0** — false on 1,092 / 1,092 rows |
| Learner rows swept | **1,092** → 0 carrying the key, reconciled exactly |
| Config rows deleted | **1** (`turbo_boost`) |
| Code deleted | 3 dead limbs (a method, a test block, an e2e block) |
| Comments rewritten | 9, all describing mechanisms that no longer exist |
| Comments deliberately kept | 8, genuine history explaining live decisions |
| Gates | all six green |
| Live-verified | yes, driven in a real browser on the dev alias |

---

## Two things you should know that the brief didn't

### 1. There are TWO live defaults, not one — and that's deliberate

The brief said the default is `fast`. That is true but incomplete, and the
distinction matters:

- `DEFAULT_LEARNING_MODE = 'fast'` — the module fallback. This is what an
  **existing** learner gets, and what everything gets before progress resolves.
- `NEW_LEARNER_DEFAULT_MODE = 'easy'` — applied once progress resolves, **only**
  to a learner with no play history and no explicit choice.

That asymmetry is Aran's 2026-08-06 ruling, built as ruled: a brand-new learner
starts on Easy; anyone already playing stays on Fast so nothing slows down
mid-course. The code comment notes you flagged this default as yours to overturn.

**Consequence for the acceptance test:** "a learner with no stored preference
lands on Fast" is only true for a learner *with play history*. A genuinely fresh
learner lands on **Easy** — correctly. I verified this by driving the app, and
the screenshot shows Easy selected on a fresh context.

### 2. The mode tray never carried Easy/Fast

The brief expected the tray to "offer exactly Easy and Fast". It doesn't, and
shouldn't. The tray carries **Listening mode** and **Offline mode**. Easy/Fast is
a separate two-position switch on the player's resting screen — the mode you pick
before you start. Both surfaces are Turbo-free; verified visually.

---

## What I deleted

**Dead scaffolding with no caller:**

- `usePodLapScheduler.skipAhead()` and its test. Turbo was its only caller; the
  APML already recorded it as no longer called from the player. The pod counter
  now only ever advances by a *played* lap.
- The `speedRampSync` "Turbo cancellation" test block. There is no speed override
  left to guard — `SimplePlayerRuntimeOverrides` exposes no speed callback and
  playback rate comes from exactly one source, the baked `cycle.playbackSpeed`.
  The block was testing a helper defined inside its own `describe`, so it could
  not have caught a regression anyway.
- The Turbo-clicking block in the schools-nav modetray e2e probe, which drove a
  tray row and an exposed `turboActive` that no longer exist.

**Database:**

- The `turbo_boost` row from `algorithm_config`. Verified nothing reads it first:
  `useAlgorithmConfig` resolves only `fast_mode`/`easy_mode`, and
  `learningModes.test.ts` pins that the key is never read *even when the row is
  present* — so that test stays valid after the delete, since it injects the row
  itself. The row's full config is saved in the applied log and is recoverable.
- The `turbo_mode_enabled` key from all 1,092 `learners.preferences` blobs.

## What I rewrote

Nine comments described mechanisms that no longer exist. The worst offenders were
two in `SimplePlayer` that said "skip `turboOmit` cycles when Turbo is on" —
`turboOmit` is gone entirely and adaptation v2 is the only caller of that hook,
so the comments were actively misleading about who owns the cull. Also: two
"dynamic/Turbo pause duration" comments, `useSimplePlayer`'s "Turbo-aware"
override descriptions, `useAlgorithmConfig`'s scriptShape comment that explained
itself by reference to `turboOmit`, and three UI comments naming a tray row that
no longer exists.

## What I deliberately KEPT — and why

- **`turbo_toggle` in `MANUAL_DIAL_EVENT_TYPES`.** Your reading is right and I
  kept it. It is historical *analytics* on events already sitting in the table;
  dropping it would silently rewrite past behavioural evidence. The same argument
  keeps the `turbo_toggle` count in the `player_events` rollup function in
  `schema.sql`, which I also left alone.
- **`normal_mode`.** Confirmed live and left untouched. It is NOT Turbo residue —
  it is `fast_mode`'s promotion-window fallback alias, and removing it would break
  the window. Verified still present after the sweep.
- **Eight history comments** explaining live decisions: why `sessionMultiplier` is
  a flat 1.0, why a skip never bumps the pod ratchet, why Easy sets
  `manualOverrideActive`, why a retired listening key falls back to default, and
  why the tray has no mode row. These explain *why the code is as it is* — that
  has value and it stays.
- **The tests asserting Turbo is absent** (`learnerExplainers`, `learningModes`,
  `easy-fast-toggle-probe`). Those are the guard rails, not residue.
- **Popty's `eleven_turbo_v2_5`** — an ElevenLabs TTS model name, unrelated. Not
  touched; I did not go near that repo.

---

## The sweep, in numbers

```
[census]    learners=1092  carrying 'turbo_mode_enabled'=1092  value-true=0
[DRY RUN]   rows_written=0
[reconcile] before=1092 after=1092 (expected 1092)   ← dry run changed nothing

[APPLIED]   rows_written=1092
[reconcile] before=1092 after=0 (expected 0)         ← exact
```

Discipline: DRY_RUN first; a per-row assertion that nothing *except* that one key
changes; a per-row re-read immediately before each write with abort-on-drift so a
concurrent writer is never clobbered; full before/after JSON logs committed. The
script **aborts rather than sweeping** if it ever sees a `true` value, because
that would mean the census was wrong and a real learner would be changed.

---

## ⚠️ One thing still needs doing — I was blocked

**The `learners.preferences` COLUMN DEFAULT still contains `turbo_mode_enabled`.**

Until that is changed, **every newly-created learner is born with the dead key
again**, and the row sweep undoes itself one learner at a time.

I could not apply it. It is DDL (`ALTER TABLE ... SET DEFAULT`), the service-role
REST client cannot issue DDL, there is no SQL-exec RPC in this database (I probed
six candidate names), and no `SUPABASE_DB_URL` was available to my session.

The migration is written and committed, ready to run by anyone with a direct
connection:

`supabase/migrations/20260807e_retire_turbo_residue.sql`

It is idempotent and re-asserts the row sweep, so it also cleans up any learner
created in the gap between my sweep and it running.

### Other explicit gaps

- **I could not read the live column default** to confirm it matches the checked-in
  `schema.sql` dump — same blocker, no SQL access. I am relying on the dump for
  that one fact and flagging it rather than asserting it.
- **`schema.sql` was left unedited.** It is a dump, and it currently reflects
  *live* state (default still carries the key). It should be regenerated after the
  migration runs.

---

## Two things for your ruling

1. **The `tip_speed_turbo` onboarding message.** Its copy tells learners to "try
   Turbo in the mode tray". I checked the **live** table, not just the seed file:
   `active = false`, so it is **not reaching anyone**. But it is a loaded gun — if
   someone flips it active it ships a lie about a feature that doesn't exist.
   Rewriting learner-facing prose is your call, so I flagged it rather than
   touching it. Options: repoint it at Easy/Fast, or delete it.

2. **A stale probe assertion on dev, not mine.** `easy-fast-toggle-probe.mjs`
   asserts "Fast is selected by default". That assertion **fails on dev today**,
   independently of my work — it contradicts the shipped new-learner default
   (fresh learner → Easy). I did not change it, because the speed-parity branch
   has been reconciling exactly these pins tonight and I did not want to collide.
   Someone should reconcile it with Aran's asymmetric ruling.

---

## Verified by driving, not by reading

Real browser, phone viewport, against the dev alias
`https://ssi-learning-app-git-dev-zenjin.vercel.app`:

```
PASS — mode switch present on resting screen
PASS — offers Easy                    :: Easy | Fast
PASS — offers Fast                    :: Easy | Fast
FAIL — Fast is selected by default    ← correct behaviour, stale assertion (see above)
PASS — mode buttons are at least 44px tall
PASS — tapping Easy selects Easy
PASS — choice persisted to localStorage
PASS — Easy still selected after reload
PASS — mode tray has no Turbo row
       :: Listening mode | Repeat sentences with passive listening
        | Offline mode | Free offline for 30 days
PASS — no uncaught page errors
```

**What I saw on screen.** The resting screen shows the Spanish course, White Belt,
and a two-position pill switch reading exactly **Easy | Fast** — Easy selected on
a fresh context with no play history. No Turbo anywhere. Opening the mode tray
gives exactly two rows: **Listening mode** ("Repeat sentences with passive
listening") and **Offline mode** ("Free offline for 30 days"). No Turbo row, no
Turbo toggle, no Turbo copy.

## Gates

All six green at HEAD:

| Gate | Result |
|---|---|
| `@ssi/core build` | pass |
| `player-vue typecheck` | pass |
| `player-vue test` | pass — 1867 passed, 3 skipped |
| `player-vue lint` | pass — **0 errors**, 151 warnings (pre-existing baseline) |
| `typecheck:api` | pass |
| `test:api` | pass — 1139 passed |

APML updated: `apml/interfaces/learning-player.apml` → v2.1.27, recording the
deleted `skipAhead`, the absent speed override, the deleted config row, the
learner-preference sweep, and — explicitly — why `turbo_toggle` and `normal_mode`
are kept.

---

## A note on the shared working tree

The `claude/easy-phrase-syllable-cap` worker was live-editing the *same working
directory*, and creating my branch moved that tree's HEAD off theirs. I restored
their branch and backed my edits out byte-exact, then did all my work in an
isolated git worktree so the two never touched again. Their work is intact and
they have since committed it (2 commits). Nothing of theirs was lost, and none of
it rode in on my commits.
