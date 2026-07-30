/**
 * nodeHomeCache — WHERE-YOU-ARE stability between sibling views of a node
 * (founder finding 2026-07-30). Pins the two tiers and the honesty rule:
 * full payloads are page-lifetime + exact node/lens; the rail subset alone
 * survives reload via sessionStorage; a non-OK fetch drops the node.
 */
import { describe, it, expect, beforeEach } from 'vitest'
import { cacheNodeHome, cachedNodeHome, cachedRail, dropCachedNode, clearNodeHomeCache } from './nodeHomeCache'

function payload(id = 'node-1', extra: Record<string, unknown> = {}) {
  return {
    kind: 'node',
    node: { id, name: 'Seaside Model School', label: 'school' },
    ancestors: [{ id: 'root', name: 'India', label: 'nation' }],
    siblings: [{ id: 'sib', name: 'Other School', label: 'school' }],
    children: [{ id: 'class-1', name: 'Year 6', label: 'class' }],
    practiceHours: 12,
    rollup: { learnerCount: 40 },
    ...extra,
  }
}

beforeEach(() => clearNodeHomeCache())

describe('nodeHomeCache', () => {
  it('round-trips the full payload by route id + lens', () => {
    cacheNodeHome('school-1', payload())
    expect(cachedNodeHome('school-1')).toEqual(payload())
    // A different lens is a different payload shape — never cross-served.
    expect(cachedNodeHome('school-1', 'teachers')).toBeNull()
    cacheNodeHome('school-1', payload('node-1', { teachers: [] }), 'teachers')
    expect(cachedNodeHome('school-1', 'teachers')).toEqual(payload('node-1', { teachers: [] }))
    // The default lens and 'children' are the same key.
    expect(cachedNodeHome('school-1', 'children')).toEqual(payload())
  })

  it('cachedRail is lens-agnostic and carries only the tree subset', () => {
    cacheNodeHome('school-1', payload(), 'teachers')
    const rail = cachedRail('school-1')
    expect(rail?.node.name).toBe('Seaside Model School')
    expect(rail?.ancestors).toHaveLength(1)
    expect(rail?.children).toHaveLength(1)
    expect((rail as any).rollup).toBeUndefined()
    expect((rail as any).practiceHours).toBeUndefined()
  })

  it('the rail subset survives a reload (sessionStorage), full payloads do not', () => {
    cacheNodeHome('school-1', payload())
    // Simulate reload: page-lifetime memory gone, sessionStorage kept.
    const kept = sessionStorage.getItem('ssi-node-rail:school-1')
    clearNodeHomeCache()
    sessionStorage.setItem('ssi-node-rail:school-1', kept!)
    expect(cachedNodeHome('school-1')).toBeNull()
    expect(cachedRail('school-1')?.node.name).toBe('Seaside Model School')
  })

  it('dropCachedNode clears both tiers so a stale rail cannot outlive access', () => {
    cacheNodeHome('school-1', payload())
    cacheNodeHome('school-1', payload('node-1', { teachers: [] }), 'teachers')
    dropCachedNode('school-1')
    expect(cachedNodeHome('school-1')).toBeNull()
    expect(cachedNodeHome('school-1', 'teachers')).toBeNull()
    expect(cachedRail('school-1')).toBeNull()
  })

  it('never serves another node id', () => {
    cacheNodeHome('school-1', payload())
    expect(cachedNodeHome('school-2')).toBeNull()
    expect(cachedRail('school-2')).toBeNull()
  })
})
