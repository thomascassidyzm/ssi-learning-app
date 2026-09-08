import { describe, expect, it } from 'vitest'
import { appStateOnThisOrigin, isAppStateKey, shellStorageIsFresh } from './shellOriginState'

/** A localStorage stand-in built from a plain object. */
function store(entries: Record<string, string>) {
  const keys = Object.keys(entries)
  return {
    get length() { return keys.length },
    key: (i: number) => keys[i] ?? null,
    getItem: (k: string) => entries[k] ?? null,
  }
}

describe('shellOriginState — what the origin switch took with it', () => {
  it('recognises the app\'s own keys and nobody else\'s', () => {
    expect(isAppStateKey('ssi-has-played')).toBe(true)
    expect(isAppStateKey('ssi_checkout_intent_v1')).toBe(true)
    expect(isAppStateKey('sb-swfvymspfxmnfhevgdkg-auth-token')).toBe(true)
    expect(isAppStateKey('learner_speed')).toBe(false)
    expect(isAppStateKey('some-other-site')).toBe(false)
  })

  it('says the shell is fresh when the new origin holds nothing', () => {
    // The old install's state is keyed to https://localhost and is invisible
    // here. This is the case the line exists for.
    expect(shellStorageIsFresh(true, store({}))).toBe(true)
    expect(shellStorageIsFresh(true, store({ 'unrelated-key': '1' }))).toBe(true)
  })

  it('goes quiet as soon as anything is saved on this origin', () => {
    expect(shellStorageIsFresh(true, store({ 'ssi-last-course': 'spa_for_eng' }))).toBe(false)
    expect(shellStorageIsFresh(true, store({ 'sb-abc-auth-token': '{}' }))).toBe(false)
  })

  it('never fires on the web — a tab did not change origin', () => {
    expect(shellStorageIsFresh(false, store({}))).toBe(false)
  })

  it('stays silent rather than wrong when the store will not answer', () => {
    const hostile = {
      get length(): number { throw new Error('denied') },
      key: () => null,
      getItem: () => null,
    }
    expect(appStateOnThisOrigin(hostile)).toBe('unknown')
    expect(shellStorageIsFresh(true, hostile)).toBe(false)
  })
})
