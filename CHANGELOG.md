# Changelog

All notable changes to the SSi Learning App, newest first. This file tracks `staging → main` promotions.

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
