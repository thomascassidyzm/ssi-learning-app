import { describe, it, expect, beforeEach } from 'vitest'
import { classStorageScope, deviceStorageScope, clearDeviceCache, deviceCacheKeysToClear, DEVICE_CACHE_KEY_PREFIXES } from './classStorageScope'

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

describe('clearDeviceCache — reset clears the ACCOUNT-suffixed keys, not just the legacy ones (job #811)', () => {
  const COURSE = 'cym_s_for_eng'
  const seed = (key: string) => localStorage.setItem(key, JSON.stringify({ lastLegoId: 'S0008L01' }))
  beforeEach(() => localStorage.clear())

  it('removes position, belt and session-history keys for the current scope and the legacy unsuffixed keys', () => {
    const scope = deviceStorageScope(null, 'learner-a')
    for (const prefix of DEVICE_CACHE_KEY_PREFIXES) { seed(`${prefix}${COURSE}`); seed(`${prefix}${COURSE}${scope}`) }
    seed('ssi_learning_position_spa_for_eng:u:learner-a')

    clearDeviceCache(COURSE, scope)

    for (const prefix of DEVICE_CACHE_KEY_PREFIXES) {
      expect(localStorage.getItem(`${prefix}${COURSE}`)).toBeNull()
      expect(localStorage.getItem(`${prefix}${COURSE}${scope}`)).toBeNull()
    }
    // Another course on the same account is untouched.
    expect(localStorage.getItem('ssi_learning_position_spa_for_eng:u:learner-a')).not.toBeNull()
  })

  it('leaves another account\'s cache on the same device alone', () => {
    seed(`ssi_belt_progress_${COURSE}:u:learner-b`)
    clearDeviceCache(COURSE, deviceStorageScope(null, 'learner-a'))
    expect(localStorage.getItem(`ssi_belt_progress_${COURSE}:u:learner-b`)).not.toBeNull()
  })

  it('clears a class session\'s keys under the class scope', () => {
    const scope = deviceStorageScope({ id: 'c1', class_learner_id: 'cl-1' }, 'teacher-1')
    seed(`ssi_learning_position_${COURSE}${scope}`)
    clearDeviceCache(COURSE, scope)
    expect(localStorage.getItem(`ssi_learning_position_${COURSE}${scope}`)).toBeNull()
  })

  it('with an unresolved identity still clears the legacy keys and nothing else', () => {
    expect(deviceCacheKeysToClear(COURSE, null)).toEqual(DEVICE_CACHE_KEY_PREFIXES.map((p) => `${p}${COURSE}`))
  })
})
