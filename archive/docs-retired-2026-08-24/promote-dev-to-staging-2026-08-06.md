# Promotion: dev → staging, 2026-08-06

**Status: landed and verified live.** Production and `main` were not touched.

Staging is serving build `003cc2e`, up from `be19c75`. The build went green, the site
serves, staging's own CI run passed, and both headline fixes were confirmed working in a
real browser **against staging specifically** — not inferred from the code.

---

## What shipped

Forty-seven commits, covering:

- **The never-stall player fix.** A clip that 404s, fails to load or hangs is now skipped so
  the session continues. Previously a circuit breaker halted the whole session after three
  failures — the behaviour Aran hit on German, on the item "with you", where playback
  hard-stopped and would not restart.
- **The audio-stamping fix for returning learners.** This is the one that matters for the
  German audio repair. Repaired clips now actually reach someone who has already used the
  app, rather than being masked forever by their own cache.
- **The India demo VAD top-up**, org invite email work, removal of the listening-mode popup,
  and other work riding along.

The German audio promotion itself was a live database change, not code, so this promotion
neither carried nor affected it.

---

## Pre-flight: one thing worth knowing

The expectation was that staging held nothing dev didn't. It held **sixteen commits** dev
lacked — the branded org invite email work and the player deep-link work.

A merge preserves those either way, but rather than trust that, the merge was checked
against the outcome: **the merged tree came out byte-for-byte identical to dev's tree.**
That is the strongest available proof that nothing staging-only was lost and nothing
unexpected added. Those sixteen were already present in dev's content under different
commit identities.

**All five CI gates were run locally against the exact tree being promoted**, because the
dev tip was a merge commit that had no CI run of its own: player typecheck, tests and lint,
plus API typecheck and API tests. All green.

The promotion itself was a standard merge, matching every previous promotion in this
repository. No cherry-picking, no force.

---

## Live verification

### The never-stall fix — confirmed

The probe did not merely watch a healthy session. It **reproduced the failure**: it picked a
clip mid-session and made it fail permanently, then watched what the player did.

| Observation | Result |
|---|---|
| Retried the dead clip, then moved on | 2 retries, then skipped |
| Other clips loaded after the failure | **134** |
| On-screen text kept advancing | 3 distinct phrases |
| Phase cycle intact | prompt → speak → voice_1 → voice_2 |
| Uncaught errors | none |

Under the old behaviour the session would have halted. A baseline check alongside it
confirmed an ordinary learner can play on staging: telemetry posting cleanly, no errors.

### The returning-learner audio fix — confirmed

This one needed care, because seeing "fresh" audio requests is not by itself proof. One of
the app's server routes has always served correctly versioned audio. The question was
whether the *returning-learner path* — which bypasses that route entirely and is where the
staleness was actually living — now serves versioned audio too.

So the probe separated the two possible explanations, on staging, on the German course:

- First visit: play, letting the app build and store its session plan.
- Then reload, which is what puts a returning learner on the fast path.
- On that second visit: **zero requests to the server route that could have done the
  stamping**, yet the player still requested **five correctly versioned clips**, and the
  client itself fetched the revision list.

With the server route out of the picture entirely, those versioned requests can only have
come from the fix. A versioned request is precisely what forces a fresh download instead of
replaying the stale bytes already sitting in the device's cache — which is the whole point.

No JavaScript errors in either visit.

**One finding worth recording for future probes:** production builds strip debug logging, so
the internal "cache fast path" log line is not observable on a live site and cannot be used
as evidence. The network signals above are the reliable ones.

---

## Housekeeping

A stale duplicate checkout of the repository, a week old, was sitting at a path that
shadowed the `origin/dev` reference — it made ordinary git commands fail with "ambiguous
argument" for anyone working in the repo. It was clean, with no unique work in it, so it was
removed. Git reads straight again.

---

## What is where

- **staging** — carries the promotion, deployed and verified live at staging.saysomethingin.app.
- **dev** — carries the two verification probes written for this promotion. Not merged
  onward, not deployed.
- **main / production** — untouched, as instructed. No further promotion was run.
