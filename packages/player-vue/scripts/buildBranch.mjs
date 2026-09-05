/**
 * WHICH BRANCH did this build freeze? (2026-09-05)
 *
 * The sha already in the build stamp answers "which commit", but nobody
 * holding a phone can turn a sha into "is this the dev build with the fix, or
 * the production one without it?". Three people were describing three
 * different builds in the same words.
 *
 * Same derivation discipline as the sha: read it from git at build time, never
 * from a field anyone maintains by hand — a hand-bumped field lies in the
 * flattering direction the first time somebody forgets, a stale build claiming
 * to be current.
 *
 * It lives in its own module, rather than inline in vite.config.js beside
 * `localGitBuildNumber()`, for one reason: the fallback chain has cases a real
 * build cannot reach (a detached HEAD, no git at all) and those are exactly
 * the cases where a silently-empty value would look identical to a working
 * one. Injectable dependencies make them testable.
 */
import { execFileSync } from 'node:child_process'

/** The checked-out branch, or null. Never throws. */
export function localGitBranch(cwd) {
  try {
    return execFileSync('git', ['rev-parse', '--abbrev-ref', 'HEAD'], {
      cwd,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim()
  } catch {
    // No git, no .git (a tarball, a slim container), git refused. Never let
    // build-stamp bookkeeping break the build.
    return null
  }
}

/**
 * Vercel's branch first (it is authoritative for a deployed build), then the
 * working tree's own. Null is a legitimate answer, and the row simply omits
 * the branch when it comes back null.
 *
 * `HEAD` is what `--abbrev-ref` returns on a detached checkout. It is not a
 * branch name, and printing "HEAD" at a learner would be worse than printing
 * nothing.
 */
export function resolveBuildBranch({ env = process.env, gitBranch = localGitBranch } = {}) {
  const vercel = String(env.VERCEL_GIT_COMMIT_REF ?? '').trim()
  if (vercel && vercel !== 'HEAD') return vercel
  let local = ''
  try {
    local = String(gitBranch(import.meta.dirname) ?? '').trim()
  } catch {
    // Belt as well as braces: localGitBranch already swallows its own
    // failures, but a build must never die because a stamp could not be read.
    local = ''
  }
  if (local && local !== 'HEAD') return local
  return null
}
