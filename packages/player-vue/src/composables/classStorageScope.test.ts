import { describe, it, expect } from 'vitest'
import { classStorageScope, deviceStorageScope } from './classStorageScope'

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

describe('deviceStorageScope — the belt/position cache is per ACCOUNT, per course', () => {
  it('separates two accounts practising the same course on one device', () => {
    const a = deviceStorageScope(null, 'learner-a')
    const b = deviceStorageScope(null, 'learner-b')
    expect(a).toBe(':u:learner-a')
    expect(b).toBe(':u:learner-b')
    expect(a).not.toBe(b)
  })

  it('refuses a scope while the identity is unresolved, so nothing is cached under a placeholder', () => {
    expect(deviceStorageScope(null, null)).toBeNull()
    expect(deviceStorageScope(null, '')).toBeNull()
    expect(deviceStorageScope(null, 'demo-learner')).toBeNull()
  })

  it('scopes a class session to the class learner, never to the driving teacher', () => {
    expect(deviceStorageScope({ id: 'c1', class_learner_id: 'class-learner-1' }, 'teacher-1'))
      .toBe(':class:c1:u:class-learner-1')
    // Two teachers driving the SAME class land on the same class cache…
    expect(deviceStorageScope({ id: 'c1', class_learner_id: 'class-learner-1' }, 'teacher-2'))
      .toBe(':class:c1:u:class-learner-1')
    // …and the class never borrows the teacher's own cache before its learner exists.
    expect(deviceStorageScope({ id: 'c1', class_learner_id: null }, 'teacher-1')).toBeNull()
  })
})
