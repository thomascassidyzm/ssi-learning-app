import { describe, it, expect } from 'vitest'
import { courseMaxSeed, isPastCourseBoundary, MVP_MAX_SEED } from './courseBoundary'

describe('courseBoundary', () => {
  it('caps the two Arabic dialects at the MVP boundary', () => {
    expect(courseMaxSeed('ara_lb_for_eng')).toBe(MVP_MAX_SEED)
    expect(courseMaxSeed('ara_eg_for_eng')).toBe(MVP_MAX_SEED)
  })

  it('leaves fully-built courses uncapped', () => {
    // ita/spa are populated to seed 668 — capping them would black out
    // content learners can already play.
    expect(courseMaxSeed('ita_for_eng')).toBeNull()
    expect(courseMaxSeed('spa_for_eng')).toBeNull()
    expect(courseMaxSeed('ara_for_eng')).toBeNull()
  })

  it('unknown courses are uncapped', () => {
    expect(courseMaxSeed('not_a_course')).toBeNull()
    expect(isPastCourseBoundary('not_a_course', 99999)).toBe(false)
  })

  it('boundary is inclusive of the boundary seed itself', () => {
    expect(isPastCourseBoundary('ara_lb_for_eng', 300)).toBe(false)
    expect(isPastCourseBoundary('ara_lb_for_eng', 301)).toBe(true)
    expect(isPastCourseBoundary('ara_lb_for_eng', 1)).toBe(false)
  })
})
