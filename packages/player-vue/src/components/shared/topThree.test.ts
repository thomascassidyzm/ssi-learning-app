import { describe, it, expect } from 'vitest'
import { topThree } from './topThree'

describe('topThree — three rows then show all', () => {
  it('a list of 14 renders 3 and names 11 hidden; showing all renders 14', () => {
    const rows = Array.from({ length: 14 }, (_, i) => i)
    const collapsed = topThree(rows, false)
    expect(collapsed.shown).toHaveLength(3)
    expect(collapsed.hidden).toBe(11)
    expect(collapsed.collapsible).toBe(true)
    const expanded = topThree(rows, true)
    expect(expanded.shown).toHaveLength(14)
    expect(expanded.hidden).toBe(0)
    expect(expanded.collapsible).toBe(true)
  })

  it('three rows or fewer hide nothing and carry no control', () => {
    for (const n of [0, 1, 2, 3]) {
      const r = topThree(Array.from({ length: n }, (_, i) => i), false)
      expect(r.shown).toHaveLength(n)
      expect(r.hidden).toBe(0)
      expect(r.collapsible).toBe(false)
    }
  })
})
