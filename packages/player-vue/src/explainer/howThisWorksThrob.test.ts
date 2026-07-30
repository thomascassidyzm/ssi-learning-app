import { describe, it, expect, beforeEach } from 'vitest'
import { shouldThrob, markSeen, HTW_SEEN_KEY } from './howThisWorksThrob'

const VIEWER = 'user-1'
const NODE = 'node-a'

describe('howThisWorksThrob', () => {
  beforeEach(() => localStorage.removeItem(HTW_SEEN_KEY))

  it('throbs on first visit, even with no invitations', () => {
    expect(shouldThrob(VIEWER, NODE, [])).toBe(true)
  })

  it('stops throbbing once the panel has been opened', () => {
    markSeen(VIEWER, NODE, [])
    expect(shouldThrob(VIEWER, NODE, [])).toBe(false)
  })

  it('first-visit is per surface: seeing one node disarms other nodes with no invitations', () => {
    markSeen(VIEWER, NODE, [])
    expect(shouldThrob(VIEWER, 'node-b', [])).toBe(false)
  })

  it('re-arms when a new invitation appears after the last open', () => {
    markSeen(VIEWER, NODE, ['rule-1'])
    expect(shouldThrob(VIEWER, NODE, ['rule-1'])).toBe(false)
    expect(shouldThrob(VIEWER, NODE, ['rule-1', 'rule-2'])).toBe(true)
  })

  it('disarms again once the new invitation set is seen', () => {
    markSeen(VIEWER, NODE, ['rule-1'])
    markSeen(VIEWER, NODE, ['rule-1', 'rule-2'])
    expect(shouldThrob(VIEWER, NODE, ['rule-1', 'rule-2'])).toBe(false)
  })

  it('an invitation set shrinking (dismissal) does not re-arm', () => {
    markSeen(VIEWER, NODE, ['rule-1', 'rule-2'])
    expect(shouldThrob(VIEWER, NODE, ['rule-1'])).toBe(false)
  })

  it('a node never opened throbs when it carries invitations, even after another node was seen', () => {
    markSeen(VIEWER, NODE, [])
    expect(shouldThrob(VIEWER, 'node-b', ['rule-1'])).toBe(true)
  })

  it('seen state is per viewer', () => {
    markSeen(VIEWER, NODE, [])
    expect(shouldThrob('user-2', NODE, [])).toBe(true)
  })

  it('survives corrupt storage', () => {
    localStorage.setItem(HTW_SEEN_KEY, 'not-json')
    expect(shouldThrob(VIEWER, NODE, [])).toBe(true)
    markSeen(VIEWER, NODE, [])
    expect(shouldThrob(VIEWER, NODE, [])).toBe(false)
  })
})
