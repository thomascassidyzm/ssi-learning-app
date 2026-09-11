import { describe, it, expect } from 'vitest'
import { sortFindings, SILENT_AFTER_HOURS } from './findings'

// The findings become cards on the question they concern, and a feed that has
// gone quiet says so — the nightly job runs off a Mac outside this estate and
// its silence must never be silent on the page.
describe('findings sorted onto their questions', () => {
  const raw = [
    { title: 'audio failures are almost all desktop', story: 'x', tone: 'warn', metric: 'health' },
    { title: 'Chinese has the steepest fall-off', story: 'y', tone: 'alarm', metric: 'retention' },
    { title: 'French owns twice the friction', story: 'z', tone: 'warn', metric: 'contentFriction' },
    { title: 'no metric named', story: '', tone: 'neutral' },
    { story: 'untitled, dropped' },
  ]

  it('hands each finding to the question its metric answers, and the homeless one to the pulse', () => {
    const { byQuestion } = sortFindings(raw, Date.now(), new Date().toISOString())
    expect(Object.keys(byQuestion).sort()).toEqual(['leaving', 'pulse', 'weak-points', 'working'])
    expect(byQuestion.working[0].title).toMatch(/desktop/)
    expect(byQuestion.leaving[0].tone).toBe('alarm')
    expect(byQuestion.pulse[0].title).toBe('no metric named')
  })

  it('is fresh within two nightly runs and silent past them', () => {
    const now = Date.parse('2026-09-10T20:00:00Z')
    const fresh = sortFindings(raw, now, '2026-09-10T02:10:00Z')
    expect(fresh.silent).toBe(false)
    const stale = sortFindings(raw, now, '2026-08-31T02:10:20Z')
    expect(stale.silent).toBe(true)
    expect(stale.ageHours).toBeGreaterThan(SILENT_AFTER_HOURS)
    expect(stale.ageHours).toBeGreaterThan(24 * 10)
  })

  it('treats a feed that has never run as silent', () => {
    expect(sortFindings([], Date.now(), null).silent).toBe(true)
  })
})
