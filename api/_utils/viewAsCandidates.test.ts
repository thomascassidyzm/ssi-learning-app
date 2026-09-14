/**
 * Tom, 2026-09-14 16:20Z (job #683): the View As picker lands on real
 * numbers, most-active first. The old shortcut picked by newest last_active,
 * which put Mr Williams (0 min played as class) first. Red on that ordering,
 * green on rankByClassMinutes.
 */
import { describe, it, expect } from 'vitest'
import { rankByClassMinutes } from './viewAsCandidates'

const rows = [
  { user_id: 'williams', educational_role: 'teacher', last_active: '2026-09-14T15:00:00Z' },
  { user_id: 'angharad', educational_role: 'teacher', last_active: '2026-09-10T09:00:00Z' },
  { user_id: 'quiet', educational_role: 'teacher', last_active: null },
]
const minutes = new Map([
  ['williams', { class_minutes_7d: 0, school_name: 'Monmouth' }],
  ['angharad', { class_minutes_7d: 272, school_name: 'Chepstow' }],
])

describe('rankByClassMinutes', () => {
  it('the teacher whose classes played most this week comes first, not the most recently active', () => {
    const byLastActive = [...rows].sort((a, b) => String(b.last_active || '').localeCompare(String(a.last_active || '')))
    expect(byLastActive[0].user_id).toBe('williams')
    const ranked = rankByClassMinutes(rows, minutes)
    expect(ranked[0].user_id).toBe('angharad')
    expect(ranked[0].class_minutes_7d).toBe(272)
    expect(ranked[0].school_name).toBe('Chepstow')
  })
  it('no play reads 0 min and sorts last, ties by most recent activity', () => {
    const ranked = rankByClassMinutes(rows, minutes)
    expect(ranked.map((r) => r.user_id)).toEqual(['angharad', 'williams', 'quiet'])
    expect(ranked[2].class_minutes_7d).toBe(0)
  })
})
