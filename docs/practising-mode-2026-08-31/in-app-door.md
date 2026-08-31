# Practising mode: a door you can tap, opened by a privilege

*2026-08-31. Live on staging. Not on main — that is your call, and the gate is
what makes it safe to make.*

## What you tap

1. Start playing as normal.
2. Tap the **bottom pill** to open **Settings**.
3. Scroll to **Developer**.
4. Bottom of that section: **Practising Mode (test)**. Tap it.
5. Tap **close**. You are back in the same session, still playing.

Within a second or two the **Practising** pill appears. Audio never stops.

To come back out: same three taps, same switch, tap it off. Forward play resumes
and your position is exactly where it was — because while it held, nothing about
your position was written down.

It turns itself off when the app restarts, deliberately. A blackout that survived
a restart would sit in front of the app's boot fetch and leave it unable to start
at all, and a test switch that can brick the app is worse than no switch.

## The gate is a permission, and you were right to insist on the server half

You said a client-side-only admin check is not a permission, it is a suggestion.
That was not a general principle — it was a live hole, and here it is:
`useUserRole.restoreFromCache()` rehydrates `platformRole` **straight out of
localStorage**. Anyone could write `{"platformRole":"ssi_admin"}` into their own
browser storage and the admin-gated Developer section would render for them.

So the control now renders only when the **server** has confirmed the account:

- `GET /api/admin/test-doors` → the existing **`verifyAdmin`** helper that every
  other admin route already uses → `learners.platform_role`, read under the
  caller's own RLS. A learner cannot write that row, so they cannot grant
  themselves this.
- No new flag, no hardcoded email list, no build-time constant. Any ssi_admin
  account qualifies, not just yours.
- The grant is held **in memory only**. Persisting it would put the answer back
  under the control of the person being checked, which is the hole itself.
- A `401` or `403` closes it. **A `500` or a dropped connection does not** — the
  question not having been put is not a denial, and a blip must never strip a
  real admin of their controls mid-session.

Verified live on staging just now: no token → `401`, junk bearer token → `401`,
`POST` → `405`.

**Why this is better than the concealed switch, and worth keeping as the pattern:
it is a permission rather than a trick.** It cannot be stumbled into, it cannot be
shared around as a URL, and it therefore does not become a back door on any
environment it ships to. That is precisely why it can go to main later.

One honest limit, stated rather than oversold: a purely client-side effect cannot
be defended against somebody with devtools open on their own session. It does not
need to be. What sits behind this gate writes nothing on the server and touches
nobody else's data. What is worth preventing is an ordinary learner stumbling
into a test control, or forging a role to reach one — and that is exactly what is
now prevented.

## It is still not a fake

The old door was `?practising=1`, and it set the practising flag directly — it
showed you the banner whether or not the feature worked. It proved a pixel.

This one does not touch the mode. It takes the **content** away: the fetch for
the next new LEGO fails the way a dead network fails it. The app's own trigger
notices, raises the mode itself, suppresses the progress writes itself, and
starts its own once-a-minute recovery heartbeat. Everything you see is the
feature.

Turning it off is the same honesty backwards. Nothing is reset by hand — the next
probe simply succeeds, and the app leaves the mode on its own. **That half has
never been watched by anybody.**

Two doors had to be closed or the switch would be a lie. **The bundle**: fifteen
courses hold the whole course in one file on the device and never touch the
network for upcoming material — which is also why airplane mode cannot show you
practising mode on them at all. **Our own prefetch**: the app fetches one round
ahead, so the round the check asks about is usually already cached, and the
switch would have looked broken until you had played through another round.

## The general question: fourteen doors, and this is the route for all of them

Every test door, debug flag and diagnostic mode in the player is a query string.
There are **fourteen**, and **all fourteen are unreachable from the installed
PWA** — each is read once at boot from a URL you have no way to type.

| Family | Doors |
|---|---|
| Playback / scheduling | `preview`, `fullscript`, `l1`, `pod`, `podview`, `l1test` |
| Cache / audio path | `stream`, `wedge` |
| UI state / diagnostic | `qa_mode`, `practising`(+`consolidating`), `fc`(+`enc`) |
| Bootstrap override | `bundle` |
| Data / demo | `standing`, `demo` |
| Devtools | `debug` |

Three (`l1`, `pod`, `podview`) are limited to non-production hostnames and have
in-app buttons already. One (`qa_mode`) has a Settings toggle alongside it.
**The other ten are wide open on production to anyone who knows the string** —
which is the second half of the same problem, and the same privilege fixes it.

There is also a fully-built deep-link parser — `lego`, `round`, `cycle`,
`cycleText` — that would drop you into an exact playback state, wired to nothing
but its own tests. A ready-made support tool sitting unused.

**The route is already built.** `/api/admin/test-doors` is named for all the
doors, not for this one, and each remaining door becomes a one-line change: read
the grant instead of the URL, keeping the query string working alongside so
`?l1=1` in a bug report still does its job. Two of the fourteen genuinely cannot
move — `debug` and `wedge` both run before the app exists, so there is no panel
and no role to check at the moment they fire. Twelve of fourteen are reachable.

**Not built — you asked me to answer the question, not to do the job unasked.**

## Where it is

- `dev` `dcdf2ddf` → `staging` `b781a761`. **`main` untouched**, as instructed.
- Gates green on both: typecheck, 2,746 player tests, lint at zero errors, API
  typecheck, 1,493 API tests. Seventeen of those tests are new — the route's four
  answers, the grant's refusal to open on failure or persist itself, and the
  switch's proof that the bundle answers "reachable" with it off and
  "unreachable" with it on.
- Verified live on staging: the client gate is in the deployed bundle, and the
  route enforces from the outside.

## Two things that need you

**Main.** The gate is what makes it safe, so it can go — but you said confirm
first, so it waits.

**The branches have genuinely diverged**, and I have reported rather than
resolved it: **`main` carries 7 commits that are in neither `staging` nor `dev`**
— never-back-merged hotfixes, including two practising-mode fixes
(`CONSOLIDATING writes nothing`, `a weak connection is CONSOLIDATING, not the end
of the course`) and the class-join rate-limit fix. The next `staging → main`
promotion would merge *over* those seven. They almost certainly have newer
equivalents on dev under the renamed mode, but "almost certainly" is not
something to fast-track into production.
