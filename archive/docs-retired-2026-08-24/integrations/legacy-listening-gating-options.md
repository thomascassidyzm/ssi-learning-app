# Feasibility: gating the legacy Welsh listening exercises with .app premium entitlement

*Recon date: 2026-07-16. Investigated by inspecting the live .com site and its shipped JS bundles (no source access to the .com codebase — it's a separate repo not present on this machine). Numbers/paths below are as observed live; verify against actual .com source before committing effort.*

## What's actually live on .com today (two separate systems, easy to conflate)

**1. The legacy webapp — `en.saysomethingin.com`** (own login/subscription, NOT the same as .app's Supabase auth)
- This is what the forum threads describe: Level 1 challenges at URLs like `en.saysomethingin.com/welsh/level1/challenge10`, with a play button for the main lesson and a separate play circle for the "listening exercise" (normal speed + 4 accelerated variants), on challenges 5/10/15/20/25.
- The public entry point (`/welsh/level1/intro`) is a login/signup landing with dialect choice (North/South) and a "Web app" link — this is almost certainly the **old, well-established content the founder means**.
- I could not fetch inside the logged-in experience (no test credentials), so I don't know the audio hosting mechanism for *this* system — it predates the newer bundle below and is very likely served from SSi's own S3/legacy storage, gated by SSi's own membership check, independent of `saysomethingin.app`.
- This app has its own membership/Paddle-based subscription and its own login — **not app entitlement today**.

**2. The new marketing shell — `www.saysomethingin.com`** (modern Vite/React SPA, ~27 routes: signup, `/pay`, `Sample.jsx`, `TeachersOnline.jsx`, etc.)
- Ships a lazy-loaded custom element, `<ssi-lesson-player course="..." duration="...">` (`/lesson-player/ssi-lesson-player.js`, also mirrored at `cdn.saysomethingin.com/lesson-player.js`), used only by the **Sample** and **Teachers Online** marketing pages — a preview/teaser player, not the "well-established" exercises.
- **This player already fetches its audio from `https://saysomethingin.app/api/audio/{audioId}`** — i.e. **a .com→.app audio bridge already exists in production**, unauthenticated, for sample/teaser content. It fetches its manifest from a local `./manifests/{course}.json` next to the script, not from a database.
- No entitlement/premium/gate logic exists anywhere in this player — it's deliberately open (it's a sales sample).

**API surface observed:** `api.saysomethingin.com/4/...` (versioned REST API, `.com`'s own backend) including `membership/users/check-access?email=...` → `{has_access: boolean}`. This is an **existing, live, email-keyed entitlement check** that `.com` already calls from its own signup flow (to avoid double-charging a returning customer). It's a real precedent for "ask the other side if this identity has access" — note it's spoofable by email alone, which is the same trust level `.com` already accepts for this exact purpose.

## Sketch: 3 integration options

### Option A — Mirror the existing email-check pattern (fastest)
`.app` exposes a new public endpoint (e.g. `api/entitlement/check-access?email=`) that looks up whether that email has an active premium learner account, mirroring `.com`'s own `membership/users/check-access`. The legacy webapp's listening-exercise button calls it client-side (or server-side, better) before unlocking play.
- **Effort: small.** One new read endpoint on `.app`, one client change on the `.com`/legacy side (owned by whoever maintains that codebase — not this repo).
- **Weakness:** email-only check is spoofable — same weakness `.com` already lives with for its own flow, so it's a consistent (not novel) risk, but it should not be the permanent answer if this becomes a real paywall rather than a soft gate.
- **BSC read:** cheap and simple today; not the long-term "better" if this content matters — treat as an interim/fast-follow, not the final shape.

### Option B — Signed short-lived token from `.app`
A signed-in premium learner in the app requests a short-lived signed token (JWT, few-minutes TTL) scoped to "listening exercises: yes." The legacy page redeems the token server-side against a new `.app` verify endpoint before serving the exercise (or before returning a signed S3 URL for the audio, if migrating hosting too).
- **Effort: medium.** Needs a token-issuance endpoint in `.app`, a redemption/verify endpoint, and non-trivial UX to get the learner from "premium in the app" to "carrying a token into the .com tab" (deep link with token in URL, or a "log in with SSi Learning App" button on .com).
- **Better** than Option A (real proof of entitlement, not just an email claim) but real integration work on both sides, and building auth plumbing for content whose audio may not even be reachable via `.app` yet (unknown — see below).

### Option C — Migrate the exercises natively into the app
Build a "Listening Practice" section in `player-vue` that plays this content directly, gated by the same premium-entitlement/RLS path as every other in-app feature. Retire the .com-side player for this content entirely.
- **Effort: largest up front** (need the actual audio assets + manifest data migrated/re-hosted, plus a UI) but **cheapest forever after** — no bridge, no dual-maintenance, no second entitlement system to keep in sync. This is the option that actually deletes something rather than adding a new cross-domain surface.
- **Key unknown that decides A/B vs C:** is the legacy Level-1-challenge listening audio the SAME underlying asset pool that the new `<ssi-lesson-player>` already streams from `saysomethingin.app/api/audio/`? If yes, the content is arguably *already* living in `.app`'s storage and Option C is nearly free — just build the player UI and point it at existing audio IDs. If no (it's older, separately-hosted S3 audio tied to the legacy webapp), Option C requires an actual asset migration first.

## Recommendation

Don't build any of these yet — the founder's ask ("to what extent could this work") is answered: **yes, feasible, and there's already a live precedent (`.com`'s sample player already calls `.app`'s audio proxy)**. But the deciding fact — whether the Level-1-challenge audio and the sample-player audio are the same pool — lives in the .com/legacy codebase, which isn't on this machine and wasn't reachable without login. That's the next concrete step: get eyes (or repo access) on the legacy webapp's audio-serving code, or get read access to `api.saysomethingin.com`'s membership/course endpoints, to settle it. Once that's known:
- If same pool → go straight to **Option C**, it's nearly free and is strictly better×simpler×cheaper long-term.
- If separate pool and there's real urgency to gate soon → ship **Option A** as an interim (hours, not days), then decide C later once the asset-migration cost is known.

Option B is the least attractive of the three: it carries real build cost without being the end-state (C) or the fast win (A) — only worth it if the founder specifically wants to keep the legacy webapp long-term rather than eventually retire it into the app.
