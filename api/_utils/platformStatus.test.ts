import { describe, it, expect } from 'vitest'
import { isPlatformActive } from './platformStatus'

const FUTURE = new Date(Date.now() + 1000 * 60 * 60).toISOString()
const PAST = new Date(Date.now() - 1000 * 60 * 60).toISOString()

describe('isPlatformActive', () => {
  it('fails open on a null/absent status (legacy / pre-migration)', () => {
    expect(isPlatformActive(null, null)).toBe(true)
    expect(isPlatformActive(undefined, undefined)).toBe(true)
  })

  it('treats active as always active regardless of expiry', () => {
    expect(isPlatformActive('active', null)).toBe(true)
    expect(isPlatformActive('active', PAST)).toBe(true)
  })

  it('treats an unexpired trial as active', () => {
    expect(isPlatformActive('trial', FUTURE)).toBe(true)
  })

  it('fails open on a trial with no expiry set yet', () => {
    expect(isPlatformActive('trial', null)).toBe(true)
  })

  it('locks an elapsed trial', () => {
    expect(isPlatformActive('trial', PAST)).toBe(false)
  })

  it('locks past_due, expired, and cancelled', () => {
    expect(isPlatformActive('past_due', null)).toBe(false)
    expect(isPlatformActive('expired', null)).toBe(false)
    expect(isPlatformActive('cancelled', null)).toBe(false)
  })
})
