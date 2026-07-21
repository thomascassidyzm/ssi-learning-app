# Plan 014: Correct the stale file references in CLAUDE.md so agents stop chasing ghosts

> **Executor instructions**: Follow step by step; run every verification command.
> Honor STOP conditions. Update `plans/README.md` when done.
>
> **Drift check (run first)**: `git diff --stat 5fb4a42f..HEAD -- CLAUDE.md packages/player-vue/src/playback`
> If the playback dir changed, re-verify the real file names before editing the doc.

## Status

- **Priority**: P2
- **Effort**: S
- **Risk**: LOW (docs only)
- **Depends on**: none
- **Category**: docs
- **Planned at**: commit `5fb4a42f`, 2026-07-17

## Why this matters

This repo is agent-driven: every fresh session is onboarded by `CLAUDE.md`, and its
"Key Files Reference" is exactly what agents trust first. Several cited files **do not
exist** — the doc describes a phantom playback/cache architecture. Actively-wrong docs
are worse than missing ones: each phantom path costs every agent a failed lookup and
can produce wrong plans. Two independent audits flagged this, and the build plan itself
says "fix the stale CLAUDE.md file map so the next agent doesn't chase ghosts."

## Current state (verified against the tree)

Dead references in `CLAUDE.md`:
- `packages/player-vue/src/playback/SessionController.ts` — **missing**
- `packages/player-vue/src/playback/CyclePlayer.ts` — **missing**
- `packages/player-vue/src/playback/PriorityRoundLoader.ts` — **missing**
- `packages/player-vue/src/composables/usePrefetchManager.ts` — **missing**
- `packages/core/src/cache/AudioSource.ts`, `packages/core/src/cache/DownloadManager.ts`
  — **missing** (`packages/core/src/cache/` does not exist)
- Structure diagram / prose still list `vue-adapter` and `react-adapter` packages —
  **gone** — and `apps/schools-dashboard` as a live app (it's a single doc file).

The **real** current stack (verified):
- Playback engine: `packages/player-vue/src/playback/SimplePlayer.ts` (+ `SimplePlayer.test.ts`,
  `adaptationOverrides.ts`, `bulkAudioDownload.ts`, `computePauseDuration.ts`, `silentWav.ts`).
- Offline/cache stack: `packages/player-vue/src/cache/AudioCache.ts`,
  `composables/useScriptCache.ts`, `composables/useOfflinePlay.ts`,
  `composables/useOfflineLease.ts`, `composables/useOfflineDownloadStatus.ts`.
- `CLAUDE.md` already carries a partial correction note in its `packages/core` cache
  bullet ("stale — does NOT exist; real offline stack is in player-vue: …") — extend
  that honesty to the Key Files table and the Lazy Loading / Audio Caching sections.

The whole doc is stamped "Last updated: 2026-04-11".

## Commands you will need

| Purpose            | Command                                                            | Expected |
|--------------------|-------------------------------------------------------------------|----------|
| Confirm a path dead| `ls packages/player-vue/src/playback/PriorityRoundLoader.ts`     | no such file |
| Confirm real path  | `ls packages/player-vue/src/playback/SimplePlayer.ts`           | exists   |
| Find all path refs | `grep -nE "SessionController|CyclePlayer|PriorityRoundLoader|usePrefetchManager|core/src/cache|vue-adapter|react-adapter" CLAUDE.md` | the stale lines |

## Scope

**In scope**:
- `CLAUDE.md` — Key Files Reference table, the "Lazy Loading Architecture (v2.3.0)"
  section, the "Audio Caching Architecture" key-files table, the repo-structure
  diagram, and the "Last updated" stamp.

**Out of scope**:
- Rewriting the *architecture* of the doc or trimming its length (that's a bigger docs
  effort). Only correct paths that 404 and the structure diagram.
- `WORKLIST.md` (its grooming is a separate finding).
- `apml/` specs (verified current).
- Deleting the ghost packages themselves — that's plan 015. Here you only correct the
  doc's description of them; coordinate so the two land consistently.

## Git workflow

- Branch: `advisor/014-fix-stale-claude-md` from `dev`.
- Commit style: `docs: correct CLAUDE.md file map to the real playback/cache stack`.

## Steps

### Step 1: Enumerate every path reference and check it exists

Run the grep above plus a broader scan of the Key Files tables. For each `path`
mentioned, `ls` it. Build a list of dead → correct replacements.

**Verify**: a list of every dead path and its real counterpart.

### Step 2: Replace dead paths with the real stack

Update the Key Files table and both architecture sections:
- Playback: replace `SessionController.ts` / `CyclePlayer.ts` / `PriorityRoundLoader.ts`
  references with `SimplePlayer.ts` (and the sibling playback files where relevant).
  Rewrite the "Lazy Loading v2.3.0" section so it describes what exists, or mark it
  clearly as historical if the described APIs are gone. Do not invent behavior —
  describe only what the current files do (read `SimplePlayer.ts`'s exported methods to
  describe them accurately).
- Cache/prefetch: replace `usePrefetchManager.ts` and `core/src/cache/*` with
  `cache/AudioCache.ts`, `useOfflinePlay.ts`, `useScriptCache.ts`, `useOfflineLease.ts`.
- Structure diagram: remove `vue-adapter`/`react-adapter`; correct
  `apps/schools-dashboard`'s status (a doc-only dir; schools live in
  `player-vue/src/views/schools/`).

**Verify**: `grep -nE "SessionController|CyclePlayer|PriorityRoundLoader|usePrefetchManager|core/src/cache" CLAUDE.md`
returns no matches (or only matches inside an explicitly-labeled "historical" note).

### Step 3: Bump the timestamp

Update "Last updated" to today's date (2026-07-17) and the status line if it names the
lazy-loading version.

**Verify**: the stamp reflects today.

### Step 4 (optional but recommended): add a docs-path guard

Consider a tiny check (a script or a note) that greps CLAUDE.md's `packages/…`/`api/…`
path references against the tree so future drift is caught. Only add it if it's a few
lines and doesn't require new tooling; otherwise note it as a follow-up.

## Test plan

No automated test. Verification is the grep in Step 2 returning clean and a spot-check
that every path in the Key Files table now resolves (`ls` each).

## Done criteria

ALL must hold:

- [ ] Every `packages/…` and `api/…` path in CLAUDE.md's Key Files tables resolves
      (`ls` each — none 404).
- [ ] No live reference to `SessionController.ts`, `CyclePlayer.ts`,
      `PriorityRoundLoader.ts`, `usePrefetchManager.ts`, or `core/src/cache/*` (except
      inside an explicitly historical note).
- [ ] Structure diagram no longer lists `vue-adapter`/`react-adapter` as live.
- [ ] "Last updated" bumped to 2026-07-17.
- [ ] `plans/README.md` status row updated.

## STOP conditions

Stop and report if:
- A "dead" path actually exists (the tree drifted since this plan) — re-verify before
  editing.
- Rewriting the Lazy Loading section accurately requires understanding behavior you
  can't confirm from the current files — describe only what's verifiable and flag the
  rest as "needs owner confirmation" rather than inventing.

## Maintenance notes

- Coordinate with plan 015 (deletes the ghost packages) so the doc and the tree agree.
- The doc is large and partly stale beyond file paths; a fuller docs refresh is a
  separate effort — this plan only kills the ghost paths that misroute agents.
