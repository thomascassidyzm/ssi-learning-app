import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { assertScope } from './rlsGuard'

describe('assertScope', () => {
  const ctx = { table: 'classes', caller: 'test.caller' }

  let errorSpy: ReturnType<typeof vi.spyOn>
  beforeEach(() => {
    errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
  })
  afterEach(() => {
    errorSpy.mockRestore()
  })

  it('passes through rows when every school_id is allowed', () => {
    const rows = [
      { id: 'a', school_id: 's1' },
      { id: 'b', school_id: 's2' },
    ]
    // In dev/test mode the function throws on violations, so a clean pass
    // proves nothing was wrong.
    const result = assertScope(rows, 'school_id', ['s1', 's2'], ctx)
    expect(result).toEqual(rows)
    expect(errorSpy).not.toHaveBeenCalled()
  })

  it('throws in test mode when a row falls outside the allowed scope', () => {
    const rows = [
      { id: 'a', school_id: 's1' },
      { id: 'b', school_id: 's-other' },
    ]
    expect(() => assertScope(rows, 'school_id', ['s1'], ctx)).toThrow(/RLS_VIOLATION/)
    expect(errorSpy).toHaveBeenCalled()
  })

  it('returns [] for an empty allowed set (every row is out of scope)', () => {
    const rows = [{ id: 'a', school_id: 's1' }]
    expect(() => assertScope(rows, 'school_id', [], ctx)).toThrow(/RLS_VIOLATION/)
  })

  it('handles null / undefined rows gracefully', () => {
    expect(assertScope(null, 'school_id', ['s1'], ctx)).toEqual([])
    expect(assertScope(undefined, 'school_id', ['s1'], ctx)).toEqual([])
    expect(assertScope([], 'school_id', ['s1'], ctx)).toEqual([])
    expect(errorSpy).not.toHaveBeenCalled()
  })

  it('treats rows with a null scope column as a violation', () => {
    const rows = [
      { id: 'a', school_id: 's1' },
      { id: 'b', school_id: null },
    ]
    expect(() => assertScope(rows, 'school_id', ['s1'], ctx)).toThrow(/RLS_VIOLATION/)
  })
})
