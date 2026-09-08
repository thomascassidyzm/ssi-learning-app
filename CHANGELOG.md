# Changelog

All notable changes to the SSi Learning App, newest first. This file tracks `staging → main` promotions.

## 2026-09-08 — SSi Family, a purchase path that holds together, and per-voice pace

Covers the whole gap since the 7 September promotion: seven promotions to `main` in a day and a
half, plus a run of loose security work. The headline is money — SSi Family is buyable, invitable
and livable-in, a Premium subscriber can move to Family and back on the same subscription, and the
moment after somebody pays is no longer a blank screen. Alongside it, the player stopped taking its
speaking speed from a blunt belt ladder and started taking it from the voice that actually recorded
the clip, a confirmed account-takeover route on the purchase path was closed, and the schools estate
gained domain-based identity and a compiled Handbook.

Note that this file had gone unwritten since 27 July; this entry covers the 8 September span only
and does not backfill the six weeks before it.

### Learner-facing
- **SSi Family, end to end.** Buy it, invite the adults you want on it, and create a child account
  that signs in with a parent-minted link. Child creation had never once succeeded on the live
  database — the auth trigger already wrote the learner row, so the endpoint's own insert collided
  every time; it now adopts that row. An invite records when it was emailed and can be sent again.
  Removing somebody changes only what they can reach: a removed child's sign-in link still mints,
  and nothing anyone learned is touched.
- **Premium to Family, and Family back to Premium, on the same subscription.** Both directions run
  as a plan change on the existing Paddle subscription rather than a second checkout. Going back to
  Premium is held for the end of the paid period, the owner sees every affected person by name
  before confirming, and members keep their cover for thirty days past the plan-name flip — derived
  from the one date already on the row. The webhook now files plan changes off the billed price in
  both directions; before this it rejected the Premium-priced event outright and the row froze, so a
  family went dark while £15 a month kept being charged.
- **An existing subscriber can no longer open a second subscription.** Live since the day Family went
  on sale: a paying learner who tapped Family was charged twice and got neither plan, because the
  webhook then correctly refused the row. Guarded at the front door and at the funnel, failing open.
- **An upgrade taken days from renewal no longer dead-ends.** Paddle refuses the whole update when
  the prorated delta falls under its 55p minimum; on that one error, and only that one, we ask again
  unbilled.
- **Buying signed out: verify, then pay, and land back on the plan you chose.** The morning's
  "pay first, verify later" build was reversed the same night on Tom's own call — the ball-ache was
  losing your place, not the verification. The code screen now says why it is asking, and Paddle
  opens on the plan already chosen. No password field anywhere in the flow.
- **The moment after paying has a state of its own.** Paid-not-yet-landed is recorded, survives the
  success redirect and a phone tearing down a backgrounded PWA, polls on a decaying cadence and ends
  by landing the buyer in what they bought. Separately, Paddle's in-page completion event is now the
  cue, so a purchase converges even where the success redirect never lands — a standalone PWA, an
  Apple Pay sheet, a buyer who taps away from the receipt.
- **Per-voice pace in the player.** Speaking speed is now the intent for the slot divided by the
  measured pace of the voice that rendered that slot's clips, clamped, keyed on the artefact rather
  than the casting config. The four-step belt ladder is retired from the speaking path.
- **Easy stopped sounding the same prompt four times in a row.** A BUILD and a USE phrase carrying
  identical text are two lawful adjacent items, and since the repeat decision moved to the walker
  each got its own two plays. The player now remembers the prompt identity of its last two plays.
  The set of cycles played is unchanged; only the surplus hearings go.
- **Sign-in copy that does not accuse.** The wait quoted on a refused resend is now derived from the
  limiter's own window rather than asserted, the 429 carries Retry-After, and the code screen says a
  code can take a couple of minutes.
- **The purchase screens speak all 24 locales**, with the German rewritten informally to match the
  register of the rest of `deu.json`.

### Schools & admin
- **School identity on the domain.** The first admin claims their email domain; the links a school
  sends vouch for arrivals on it; a shared tenant is derived from who lives on the domain rather
  than from a list, with suppression as the un-claim. Existing schools were backfilled from their
  founding admin, and the door now says who signed up first.
- A teacher can add a student to a class from the class page; an add that half-happened can be
  finished; setup opens in the language the school chose at sign-up.
- **The Handbook compiles from the capabilities themselves.** Prose lives beside the capability it
  describes, pinned to a fingerprint of it, and the build gate teaches its own repair.
- **The schools surface is keyed for translation** — dashboards, class detail, students, progress,
  setup wizard, tutor surfaces, walkthroughs — and 15,152 translation slots were harvested from the
  old localisation branch by matching on source text rather than merging it.
- An admin seed_progress timeout no longer wipes every course statistic.

### Under the hood
- **A confirmed live account-takeover route on the purchase path was closed.** Credentials planted
  against an unclaimed address now die when the real mailbox owner arrives; the minting endpoint that
  allowed a caller-supplied password was deleted outright rather than patched.
- A run of DEFINER-function hardening: `find_learner_by_email` is a self-lookup rather than an email
  oracle, the practice-minutes oracle reads through the caller's own scope, `is_class_teacher` and
  four server-only functions lose their browser grants, two anon-reachable content-config writes lose
  theirs, and the session guard's `search_path` is pinned. A standing check now catches the whole
  class.
- The mint throttle buckets on the peer Vercel attests rather than the one the caller claims.
- The pace derivation was made to fit Supabase's 8s statement timeout — a covering index swap, the
  slot carried rather than looked up — and a failed derivation shortens the bundle cache to five
  minutes instead of poisoning a day.
- The Android shell became a WebView onto production rather than a bundle, so a deploy reaches it at
  once. It remains a dev wrapper with a dev package id, and is deliberately absent from the learner
  release notes.
- Several nightly test reds were shown to be stale tests rather than broken code, and two i18n gates
  that had been silently inert were turned back on.

## 2026-07-27 — Playback control, Layer-2 pods, remembered interludes, self-healing content

Covers the gap since the last entry: the 14 July, 20 July and 27 July promotions to `main`. The headline is that the player finally does what its controls promise — skips work at every level and playback no longer stalls between rounds — alongside the new Layer-2 pod listening experience, interludes that are remembered per learner instead of replayed forever, and a content-freshness mechanism that lets devices heal their own stale caches. On the schools side, invitations became links, a region tier landed above schools, and the separate analytics pages collapsed into one recursive insights surface that now explains itself.

Two things deliberately **not** in this entry, because they are not live: the "land in your own player" course-chooser change was reverted after it broke the chooser in production, and view-as ended the period net-removed after a restore and re-revert.

### Learner-facing
- **Skip controls work properly at all three levels — cycle, round and belt.** Round-skip had gone completely dead once you moved past the initial preload window: the engine's round queue grew but the component's mirror of it didn't, so the next length check re-read the stale mirror and permanently concluded "nothing there". Cycle-skip could leave the displayed text out of sync with the audio, and belt-skip left the player audibly running mid-cycle after a tap — both because the skip started loading before stopping the engine, which then kept playing (and advancing on its own) underneath a wait that can run several seconds on a cold cache. Every skip path now stops playback and invalidates the in-flight cycle *before* repositioning, and belt targets are resolved atomically rather than by cross-indexing a diverged mirror. Round-skip forward now honestly no-ops at the loaded edge instead of appearing broken.
- **Playback flows continuously through round boundaries again.** An ordinary boundary — no commentary, no pod lap, no listening cup due — was leaving the engine paused: the next round's first prompt started, then got cut, then nothing until the learner manually tapped play about seven seconds later. Round transitions are seamless again.
- **Layer-2 pod listening — dialogues you can follow.** Pods now play as scenes: the conversation scrolls in time with the audio (word-by-word meaning alongside), and each lap of a scene debuts a new *exchange* — a speaker turn plus its reply — extending the same scene until it completes before the next one begins. That replaced a whole-scene-per-lap intake that was far too much at first exposure: scene one now debuts three sentences instead of eight, and a long scene builds over about seven laps rather than landing ~108 new plays at once. Adjacency pairs never straddle a lap, so you never lose the shape of a question and its answer. Existing learners' scene positions carried over with no reset.
- **Layer-1 listening is deliberately text-free.** Layer-1 seed plays are audio-only by design — they share the pod playback pipeline, and could previously render the text of an unrelated pod sentence. Now nothing is shown, so Layer-1 is a pure listening exercise as intended. Layer-2 pods are unaffected.
- **Interludes are remembered per learner.** Instructions and the "science bits" now play once ever and stay played — they survive a device wipe, a reinstall, or signing in on a new browser, because exposure is keyed to the learner on the server rather than to a device. Encouragements now taper with experience: frequent early on, progressively rarer, and off past a threshold, so they stay welcome instead of becoming wallpaper. Instructions never taper.
- **Audio quality sweep (content-side, already live).** Voices that sounded like children were blocked at the synthesis chokepoint and the already-stored ones healed — 230 affected clips down to 36 unreachable stragglers. End-of-clip clicks are gone: a tail-click detector plus DSP repair healed 153 clips, and both checks are now permanent gates on generation rather than one-off cleanups, so neither class of defect can come back.
- **Welsh courses are back to 100% human voices.** `cym_*` courses are hard-excluded from synthesis, and 32 legacy synthetic clips across 17 rows have been unlinked and queued for human recording — so nothing synthetic is served, and those specific phrases are awaiting their human recordings.
- **Courses now heal their own stale content.** Content fixed in the database could previously stay stale on a device for months, because invalidation was a version string somebody had to remember to bump — one Italian gloss was corrected in March and still being served in July. Now a database write *is* the invalidation: a content stamp is maintained automatically, and a device that boots online with a mismatch quietly drops the stale script cache and refreshes listening metadata in the background. Play is never blocked, offline is never disrupted, and devices from before the mechanism existed heal once, retroactively.
- **A public methodology section.** The explainers behind how SSi works — the listening layers, the 30-cup wheel, conversational flow, class-as-learner, the measurement philosophy and adaptation — are now readable without a login. Today's promotion also fixed a real dead end: opening one of those pages from an installed PWA left you with no way back into the app, and now there's a one-tap return.
- **Every invitation is now a link.** Invites resolved into two honest species: a *personal* link, where the link itself is the login and there is no screen to fill in, and an *open capture* link for handing to a room. That removed the ghost accounts the old flow created, and took the emailed one-time code out of the critical path — so joining works even where a school's mail filter eats verification emails. Class joining keeps a short code as the whiteboard-friendly fallback.
- **Trials and entitlements got simpler.** Access is now binary — a trial on a specific course, or paid access to everything — and a trial's length comes from the course itself rather than a generic tier, so what a learner gets is decided by what they were actually invited to.
- **Invite links no longer lock out a whole office.** The sign-in throttle counted successful personal-link sign-ins and its own refusals as suspicious attempts, so ten legitimate people clicking their own invite links from one shared IP could 429 the link — and every retry re-armed the block, so it never drained. Only genuine enumeration attempts count now; the anti-abuse purpose is untouched.
- **A faster, more reliable cold start.** Unbounded Supabase and fetch calls on the boot path are now bounded, capping the worst-case wait when opening the app cold on a phone. Signing out no longer leaves a zombie session behind, and a session left over from before a deploy now recovers gracefully instead of failing hard.

### Schools & admin
- **Self-explaining dashboard v1.** A "How this works" reference card (persona × place) and gentle, dismissible noticing invitations now sit on the node home surface for admins and leaders — surfacing things worth attention (a silent class, a quiet subtree, a school with no teachers, students quiet for a week) with correct deep links for the viewer's role. The explanations are *compiled* from the surfaces' own source code, with a drift gate that fails the build the moment an explanation would misdescribe the product — so it cannot rot. Zero runtime tokens; the learner level deliberately shows nothing.
- **Role-shaped invite links and the leader surface** were promoted to production on 20 July, along with a repair to demo class links.
- **Identity-first navigation and the Structure surface.** The navbar was redesigned around hierarchy and responsiveness, and Setup was dissolved into Structure — the org tree *is* the page. Follow-ups stopped schools accounts being hijacked to `/schools` on login and fixed a dead search in the Structure tree.
- **One insights surface for every level of the organisation.** The separate analytics and teacher-insights pages were replaced by a single recursive node home that works identically at every level — organisation, region, group, school, class, learner — backed by one node-scoped comparison engine instead of several parallel ones. This is the substrate the self-explaining dashboard above sits on.
- **Insights that stay alive and load faster.** Comparison lenses went from ~7.7s to ~2.4s cold, via waved fetches, region-pinned functions and killing an echo refetch. The course default is now a node's busiest by recent activity everywhere, compare falls back to a ladder so a node whose peers share none of its courses still opens with something real, and demo entities hold a k-floor of 1 — a privacy floor protects nobody in a demo world.
- **A region tier above schools.** Organisations can now have a layer between the top and individual schools: region and group leaders can name their group, mint invite links, and create schools beneath them. Shipped in three slices with an end-to-end audit pass that caught and fixed a live bug on the way.
- Class-write failures now surface instead of showing a false "Saved".
- Admin role checks are now enforced per request on the server; the 60-second client-side role poll it replaced was only ever cosmetic.

### Under the hood
- **PlayerConductor — one owner for every playback transition.** Play, pause, resume, stop, skip, jump and round-append all route through a single conductor with explicit states, serialization, a timeout backstop and failure recovery. Most of the skip and stall fixes above are consequences of having one place that owns these transitions rather than several racing callers. The round-boundary regression above was itself a conductor-migration bug, found and fixed within it.
- **Content freshness is structural**, not a hand-bumped constant: a timestamp column maintained by exception-safe database triggers across all six learner-facing content tables, read from a query the client already makes on boot — no new request, no new call sites. The old manual version strings shrink back to their honest job of signalling schema-shape changes.
- **API hardening.** Invite codes now use a CSPRNG with a per-IP throttle on validation; entitlement claims are claim-first, closing a cap bypass, and redeems are idempotent; entitlement tokens use a dedicated secret with no service-role fallback; player-events identity and input are validated. Typechecking was widened from the audio proxy to all of `api/`.
- **Adaptation engine v2 — shadow mode only, nothing switched on.** The evidence stream, rate policy and envelope producers are wired into the player but only observe and log; they do not alter what any learner hears. Groundwork for later, not a behaviour change now.
- Offline fixes from a real field report (2026-07-21), including retrying listening metadata reads before falling back to stale cache, plus SimplePlayer correctness work — a stale-play guard, `addRounds` reactivity, and a stall-detector safety timer.

### Docs & specs
- `docs/self-explaining-dashboard.md` sets out the compile-not-cache, drift-gated approach; decision journals landed for the audio rulings (block child voices at the synthesis chokepoint and heal stored casts; declick by DSP repair rather than TTS re-roll).
- A gated migration to backfill interlude exposure for pre-July learners is parked in `supabase/migrations/` with an executable spec — **not applied**; it needs the canary runbook before it runs.

## 2026-07-11 — PWA self-heal + position authority + bundle groundwork

The app can no longer get permanently wedged after a deploy, and a learner's resume point is now trusted correctly across devices. Underneath, the script-generation engine took its first step toward living in the shared core package.

### Learner-facing
- **The app can no longer get stuck on a blank/broken screen after a deploy.** An inline boot watchdog (armed only when a service worker controls the page) detects a wedged load and runs a 2-attempt self-heal — clearing only service-worker caches, never a learner's saved progress — before falling back to a single "Fix the app" button with no jargon or instructions to follow.
- **Resuming a course now trusts the right source.** For a signed-in learner, the server's enrollment record is authoritative; the on-device cached position is only used when it's genuinely fresher (e.g. offline progress not yet synced). This fixes guests being silently restarted at round 1 after every deploy, and closes a race where opening Settings mid-session could resurrect a just-reset course from a stale local cache.
- Resetting a course from Settings now stamps a real "last practiced" freshness signal instead of clearing it, so the reset can't be undone by an old cached position syncing back in.

### Under the hood
- **Bundle-cutover Phase 1 — groundwork only, nothing switched on.** The shared script-generation logic (`generateScript`, `CourseBundle` types, pause-duration calculation) moved from `player-vue` into `@ssi/core` as a new `script` subpath, with the old player-vue import paths kept as re-exports so nothing else had to change. The course bundle endpoint (still unused in production) gained a version-identity block (script shape, generator version, content version) and seed-level spaced-repetition parity. No learner-facing behaviour changed — the bundle endpoint remains fetched by nobody in production.

### Docs & specs
- **SSi Family Plan — spec only, no implementation shipped.** `FAMILY-PLAN-SPEC.md` lays out the design: one umbrella subscription on the payer's row, a single `family_members` table, resolver-join entitlement checks, and magic-grade joining (QR codes for child accounts, claim-moment email invites for others). Scoped into six ordered PRs (~1.7k lines) for future work — none of that behaviour is live yet.
- Design docs and decision journals for the PWA lifecycle work and bundle-cutover landed alongside the code (`docs/pwa-lifecycle-design.md`, `docs/bundle-cutover-design.md`, `docs/DECISIONS.md`), capturing rejected alternatives and the rationale for each ruling.
