/**
 * THE BRANCH MUST NOT COME BACK EMPTY WHERE IT MATTERS.
 *
 * A branch that resolves on Vercel and comes back blank in the Android
 * wrapper build is worse than nothing: a silently-zero value looks exactly
 * like a working one, and the Settings row would quietly go back to saying
 * only what it said before. So the fallback chain is pinned in every shape,
 * including the two that come back with no branch at all — a detached HEAD
 * and no git — both of which are real: the nightly CI checkout and the deploy
 * sentinel's are force-checked-out and detached.
 *
 * The git-touching cases run against a throwaway repo this file builds, never
 * against the ambient checkout. Asserting the working tree you happen to be
 * standing in is on a branch tests the machine, not the code, and it was red
 * on the first nightly after this module landed for exactly that reason.
 */
import { execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { localGitBranch, resolveBuildBranch } from '../../scripts/buildBranch.mjs'

const git = (cwd: string, args: string[]) =>
  execFileSync('git', args, {
    cwd,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'ignore'],
    env: {
      ...process.env,
      GIT_AUTHOR_NAME: 'ssi',
      GIT_AUTHOR_EMAIL: 'ssi@example.com',
      GIT_COMMITTER_NAME: 'ssi',
      GIT_COMMITTER_EMAIL: 'ssi@example.com',
      GIT_CONFIG_GLOBAL: '/dev/null',
      GIT_CONFIG_SYSTEM: '/dev/null',
    },
  })

const never = () => {
  throw new Error('git should not have been consulted')
}

describe('resolveBuildBranch', () => {
  it("prefers Vercel's branch and never touches git", () => {
    expect(resolveBuildBranch({ env: { VERCEL_GIT_COMMIT_REF: 'dev' }, gitBranch: never })).toBe('dev')
  })

  it('trims whitespace off the Vercel value', () => {
    expect(resolveBuildBranch({ env: { VERCEL_GIT_COMMIT_REF: ' staging \n' }, gitBranch: never })).toBe('staging')
  })

  it('falls through to the working tree when Vercel says nothing', () => {
    expect(resolveBuildBranch({ env: {}, gitBranch: () => 'cs/596-build-stamp' })).toBe('cs/596-build-stamp')
  })

  it('treats an empty Vercel variable as absent', () => {
    expect(resolveBuildBranch({ env: { VERCEL_GIT_COMMIT_REF: '  ' }, gitBranch: () => 'dev' })).toBe('dev')
  })

  it('returns null on a detached HEAD rather than printing "HEAD" at a learner', () => {
    expect(resolveBuildBranch({ env: {}, gitBranch: () => 'HEAD' })).toBeNull()
  })

  it('returns null when git cannot answer at all', () => {
    expect(resolveBuildBranch({ env: {}, gitBranch: () => null })).toBeNull()
  })

  it('never throws when git itself blows up — a build must not die for a stamp', () => {
    expect(
      resolveBuildBranch({ env: {}, gitBranch: () => { throw new Error('no git here') } })
    ).toBeNull()
  })

  it('reads a real branch name out of a real git checkout, running git for real', () => {
    // The wrapper/local path, exercised end-to-end against actual git — the
    // flags, the cwd, the stdio config. It runs against a repo this test
    // builds, NOT the ambient checkout: a detached checkout (CI, the deploy
    // sentinel) legitimately has no branch, and asserting otherwise tests the
    // machine rather than the code.
    const repo = mkdtempSync(join(tmpdir(), 'ssi-build-branch-'))
    try {
      git(repo, ['init', '--initial-branch=cs/596-build-stamp'])
      git(repo, ['commit', '--allow-empty', '-m', 'first'])

      expect(localGitBranch(repo)).toBe('cs/596-build-stamp')
      expect(resolveBuildBranch({ env: {}, gitBranch: () => localGitBranch(repo) })).toBe('cs/596-build-stamp')
    } finally {
      rmSync(repo, { recursive: true, force: true })
    }
  })

  it('comes back null on a real detached checkout, which is what CI and the deploy sentinel are', () => {
    const repo = mkdtempSync(join(tmpdir(), 'ssi-build-branch-'))
    try {
      git(repo, ['init', '--initial-branch=main'])
      git(repo, ['commit', '--allow-empty', '-m', 'first'])
      git(repo, ['checkout', '--detach', 'HEAD'])

      expect(localGitBranch(repo)).toBe('HEAD')
      expect(resolveBuildBranch({ env: {}, gitBranch: () => localGitBranch(repo) })).toBeNull()
    } finally {
      rmSync(repo, { recursive: true, force: true })
    }
  })

  it('comes back null where there is no git repository at all', () => {
    const notARepo = mkdtempSync(join(tmpdir(), 'ssi-build-branch-nogit-'))
    try {
      expect(resolveBuildBranch({ env: {}, gitBranch: () => localGitBranch(notARepo) })).toBeNull()
    } finally {
      rmSync(notARepo, { recursive: true, force: true })
    }
  })
})
