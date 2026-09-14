import { describe, it, expect } from 'vitest'
import { classStorageScope } from './classStorageScope'

describe('classStorageScope', () => {
  it('is empty outside a class session so self-practice keys are unchanged', () => {
    expect(classStorageScope(null)).toBe('')
    expect(classStorageScope(undefined)).toBe('')
    expect(classStorageScope({ id: null })).toBe('')
  })

  it('is a class-specific suffix inside a class session', () => {
    expect(classStorageScope({ id: 'd52efceb' })).toBe(':class:d52efceb')
  })
})
