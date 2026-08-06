/**
 * Tests for descendantIds — subtree membership by parent_id.
 *
 * Replaced slug-path prefix matching on 2026-08-06 after two orgs both named
 * "Deborah Testing" both got `path = 'deborah-testing'` in the live DB, so every
 * `path LIKE '<root>%'` resolver folded one tenant into the other: each org's
 * dashboard counted the other's people, and the scope resolver behind the
 * schools endpoints did the same for schools.
 */
import { describe, it, expect } from 'vitest'
import { descendantIds } from './groupSubtree'

const FOREST = [
  { id: 'org', parent_id: null },
  { id: 'region', parent_id: 'org' },
  { id: 'district', parent_id: 'region' },
  { id: 'school-node', parent_id: 'district' },
  { id: 'sideways', parent_id: 'org' },
  { id: 'other-org', parent_id: null },
  { id: 'twin-org', parent_id: null }, // same name/slug as 'org', no relation
]

describe('descendantIds', () => {
  it('returns the root plus every descendant at any depth', () => {
    expect(descendantIds(FOREST, 'org').sort()).toEqual(
      ['district', 'org', 'region', 'school-node', 'sideways'].sort(),
    )
  })

  it('excludes an unrelated root — including one that would share a slug', () => {
    const ids = descendantIds(FOREST, 'org')
    expect(ids).not.toContain('other-org')
    expect(ids).not.toContain('twin-org')
  })

  it('a leaf is its own subtree', () => {
    expect(descendantIds(FOREST, 'school-node')).toEqual(['school-node'])
  })

  it('never walks upwards', () => {
    expect(descendantIds(FOREST, 'district').sort()).toEqual(['district', 'school-node'])
  })

  it('caps at maxDepth, root being depth 0', () => {
    expect(descendantIds(FOREST, 'org', 0)).toEqual(['org'])
    expect(descendantIds(FOREST, 'org', 1).sort()).toEqual(['org', 'region', 'sideways'].sort())
  })

  it('falls back to the id alone when the root is not in the forest', () => {
    expect(descendantIds(FOREST, 'ghost')).toEqual(['ghost'])
  })

  it('terminates on a corrupt parent cycle instead of hanging', () => {
    const cyclic = [
      { id: 'a', parent_id: 'b' },
      { id: 'b', parent_id: 'a' },
    ]
    expect(descendantIds(cyclic, 'a').sort()).toEqual(['a', 'b'])
  })

  it('handles an empty forest', () => {
    expect(descendantIds([], 'anything')).toEqual(['anything'])
  })
})
