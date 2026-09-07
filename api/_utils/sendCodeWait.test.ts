import { describe, it, expect } from 'vitest'
import { retryAfterMs, describeWait } from './sendCodeWait'

const WINDOW = 15 * 60 * 1000
const NOW = Date.parse('2026-09-07T12:00:00Z')

describe('retryAfterMs', () => {
  it('is the remaining life of the OLDEST counted attempt', () => {
    // Sent three minutes ago, fifteen-minute window: twelve minutes to go.
    expect(retryAfterMs(NOW - 3 * 60_000, WINDOW, NOW)).toBe(12 * 60_000)
  })

  it('never promises longer than the window, or a negative wait', () => {
    expect(retryAfterMs(NOW + 60_000, WINDOW, NOW)).toBe(WINDOW)
    expect(retryAfterMs(NOW - 60 * 60_000, WINDOW, NOW)).toBe(0)
  })

  it('falls back to the whole window when the timestamp is unknown', () => {
    expect(retryAfterMs(null, WINDOW, NOW)).toBe(WINDOW)
    expect(retryAfterMs(NaN, WINDOW, NOW)).toBe(WINDOW)
  })
})

describe('describeWait', () => {
  it('rounds up, and never says "0 minutes"', () => {
    expect(describeWait(0)).toBe('in about a minute')
    expect(describeWait(59_000)).toBe('in about a minute')
    expect(describeWait(11 * 60_000 + 1)).toBe('in about 12 minutes')
    expect(describeWait(15 * 60_000)).toBe('in about 15 minutes')
  })
})
