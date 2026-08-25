/**
 * Behavioural cover for the SEC25 INPUT-12 fix. The reconcile suite pins the
 * SHAPE of the fix in source text; this pins what it actually does.
 */
import { describe, it, expect, afterEach } from 'vitest'
import { checkCronAuth, cronBearerMatches } from './cronAuth'

const originalVercelEnv = process.env.VERCEL_ENV
const originalNodeEnv = process.env.NODE_ENV

afterEach(() => {
  if (originalVercelEnv === undefined) delete process.env.VERCEL_ENV
  else process.env.VERCEL_ENV = originalVercelEnv
  process.env.NODE_ENV = originalNodeEnv
})

describe('cronBearerMatches', () => {
  it('accepts the exact bearer', () => {
    expect(cronBearerMatches('Bearer s3cret', 's3cret')).toBe(true)
  })
  it('rejects a wrong secret of the same length', () => {
    expect(cronBearerMatches('Bearer s3crXt', 's3cret')).toBe(false)
  })
  it('rejects a prefix, a suffix and an empty header without throwing', () => {
    expect(cronBearerMatches('Bearer s3cre', 's3cret')).toBe(false)
    expect(cronBearerMatches('Bearer s3crets', 's3cret')).toBe(false)
    expect(cronBearerMatches('', 's3cret')).toBe(false)
  })
})

describe('checkCronAuth', () => {
  it('refuses to run on a PREVIEW deployment with no CRON_SECRET (the INPUT-12 gap)', () => {
    process.env.VERCEL_ENV = 'preview'
    const result = checkCronAuth('', '')
    expect(result.ok).toBe(false)
    expect(result.status).toBe(500)
  })

  it('refuses to run in production with no CRON_SECRET', () => {
    process.env.VERCEL_ENV = 'production'
    expect(checkCronAuth('Bearer anything', '').ok).toBe(false)
  })

  it('401s a wrong bearer on any deployed environment', () => {
    process.env.VERCEL_ENV = 'preview'
    const result = checkCronAuth('Bearer wrong', 'right')
    expect(result.ok).toBe(false)
    expect(result.status).toBe(401)
  })

  it('accepts the right bearer on a deployed environment', () => {
    process.env.VERCEL_ENV = 'production'
    expect(checkCronAuth('Bearer right', 'right')).toEqual({ ok: true })
  })

  it('allows a LOCAL run with no secret configured, with a warning', () => {
    delete process.env.VERCEL_ENV
    process.env.NODE_ENV = 'test'
    const result = checkCronAuth('', '')
    expect(result.ok).toBe(true)
    expect(result.warning).toBeTruthy()
  })
})
