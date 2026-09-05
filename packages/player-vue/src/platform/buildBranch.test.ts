/**
 * THE BRANCH MUST NOT COME BACK EMPTY WHERE IT MATTERS.
 *
 * A branch that resolves on Vercel and comes back blank in the Android
 * wrapper build is worse than nothing: a silently-zero value looks exactly
 * like a working one, and the Settings row would quietly go back to saying
 * only what it said before. So the fallback chain is pinned in every shape,
 * including the two a real build cannot reach on purpose — a detached HEAD
 * and no git at all.
 */
import { describe, expect, it } from 'vitest'
import { resolveBuildBranch } from '../../scripts/buildBranch.mjs'

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

  it('reads a real, non-empty branch from THIS working tree with no env at all', () => {
    // The wrapper/local path, run for real. If this comes back empty the
    // Android build's stamp is empty too, and that is the failure this test
    // exists to catch.
    const branch = resolveBuildBranch({ env: {} })
    expect(typeof branch).toBe('string')
    expect(branch).not.toBe('')
    expect(branch).not.toBe('HEAD')
  })
})
