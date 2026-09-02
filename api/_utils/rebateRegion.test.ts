/**
 * Rebate region exclusion — Tom's ruling 2026-09-02: "no rebates for India".
 * India is a CONSTANT, not config; config may add further regions but can never
 * remove the ruled one.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

const addressGet = vi.fn()
vi.mock('./paddle', () => ({ paddle: { addresses: { get: (...a: any[]) => addressGet(...a) } } }))

import { excludedRebateCountries, isRebateExcludedCountry, rebateRegionDecision } from './rebateRegion'

describe('rebate region exclusion', () => {
  beforeEach(() => {
    addressGet.mockReset()
    delete process.env.REBATE_EXCLUDED_COUNTRIES
  })
  afterEach(() => {
    delete process.env.REBATE_EXCLUDED_COUNTRIES
  })

  it('excludes India by default, with no configuration at all', () => {
    expect(isRebateExcludedCountry('IN')).toBe(true)
    expect(isRebateExcludedCountry('in')).toBe(true)
    expect(isRebateExcludedCountry('GB')).toBe(false)
  })

  it('config cannot remove the ruled exclusion', () => {
    process.env.REBATE_EXCLUDED_COUNTRIES = ''
    expect(isRebateExcludedCountry('IN')).toBe(true)
    process.env.REBATE_EXCLUDED_COUNTRIES = 'BR'
    expect(isRebateExcludedCountry('IN')).toBe(true)
  })

  it('another region is added by configuration, not by a code change', () => {
    expect(isRebateExcludedCountry('BR')).toBe(false)
    process.env.REBATE_EXCLUDED_COUNTRIES = 'br, ID'
    expect(excludedRebateCountries()).toEqual(new Set(['IN', 'BR', 'ID']))
    expect(isRebateExcludedCountry('BR')).toBe(true)
  })

  it('resolves the billing country server-side from the Paddle address', async () => {
    addressGet.mockResolvedValue({ countryCode: 'IN' })
    const d = await rebateRegionDecision({ customerId: 'ctm_1', addressId: 'add_1' })
    expect(addressGet).toHaveBeenCalledWith('ctm_1', 'add_1')
    expect(d.excluded).toBe(true)
    expect(d.country).toBe('IN')
  })

  it('a UK transaction is not excluded', async () => {
    addressGet.mockResolvedValue({ countryCode: 'GB' })
    const d = await rebateRegionDecision({
      customerId: 'ctm_1',
      addressId: 'add_1',
      details: { totals: { currencyCode: 'GBP' } },
    })
    expect(d.excluded).toBe(false)
    expect(d.country).toBe('GB')
  })

  it('falls back to the billed currency when no address is available', async () => {
    const d = await rebateRegionDecision({ details: { totals: { currencyCode: 'INR' } } })
    expect(d.excluded).toBe(true)
    expect(d.country).toBe('IN')
  })

  it('propagates an address-lookup failure so the money path retries rather than pays', async () => {
    addressGet.mockRejectedValue(new Error('paddle down'))
    await expect(rebateRegionDecision({ customerId: 'ctm_1', addressId: 'add_1' })).rejects.toThrow('paddle down')
  })
})
