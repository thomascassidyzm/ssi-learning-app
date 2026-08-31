# PRACTISING mode — live verification on the dev alias

**2026-08-31.** Everything below was observed in a real driven browser session against
`https://ssi-learning-app-git-dev-zenjin.vercel.app`, on the deployed build, not locally
and not in a unit test. Probe: `packages/player-vue/e2e/_verify-practising-trigger-2026-08-31.mjs`.

## The rule

Tom, in his own words: *"we should just keep playing as always, whether network is good or
bad, UNTIL we cant fetch the next NEW LEGO, the LEGO whose turn it is. At THAT point we go
into practising mode. We keep playing from the cache from that point onwards."*

## What the probe does

It fails **one fetch** — the tier-3 `/cycles` call that walks the round-map to the round
after the one playing, which is the next new LEGO per the learner's cursor. The connection
stays perfectly healthy throughout: no offline window, no throttle, no black hole. That is
the point. Nothing about connectivity may move the mode, so nothing about connectivity is
simulated.

## What was observed

| | Result |
|---|---|
| Entry on the real trigger | Banner up **5 seconds** after the failed fetch |
| Banner on screen | `.practising-banner`, bounding box **349 × 52** at (21, 182) |
| Banner text | **Practising** / New material comes back when your connection does. |
| Playback under the banner | Never stopped — timer ran to 6:05, phrases kept advancing |
| Learner position during the stretch | **Byte-identical** before and after: `S0001L01`, cycle `S0001L01_intro` |
| Recovery, unaided | Mode cleared **45 seconds** after the fetch was healthy again, no tap and no reload |

Screenshots — the pill in place under the hero card, above the phase strip:

- http://localhost:4317/practising-2026-08-31/entered-on-real-trigger.png — reached by failing the fetch
- http://localhost:4317/practising-2026-08-31/banner-on-dev-alias.png — the same pill via the `?practising=1` door

## What this run found and fixed

The first live run entered correctly and then **never left**: six minutes of healthy
network, a forced round advance, and not one re-attempt on the wire. Recovery rode the
near-edge watcher, which only fires on a round advance — but the queue cannot grow until
the fetch works, and the fetch was not retried until the queue advanced. A learner entering
the mode at boot, with a shallow queue, waits for an event their own state prevents.

Fixed by giving the mode one slow heartbeat of its own: one attempt a minute, started on
entry, cleared on exit and on unmount. The table above is the re-run after that fix.

## Gaps, stated

- **Bundle-enabled courses.** The nine free + six premium courses on the bundle cutover
  compute their next new LEGO from one cached bundle, so that fetch never touches the wire
  and the trigger is correspondingly rare there. That is correct — the LEGO *is* reachable
  — but it means this mode will be seen mostly on network-path courses. The probe blocks
  `/bundle` to force the network path.
- **English only.** The banner is not localised into the other 20 shipped locales, on
  purpose, until Tom has seen it on a real screen.
