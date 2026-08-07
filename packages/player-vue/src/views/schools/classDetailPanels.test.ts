/**
 * What the class-detail panels are allowed to SAY.
 *
 * Both rules pinned here come from one production screen (2026-08-07): a
 * non-lead co-teacher opened her class and was told there were no teachers on
 * a class taught by two people, and offered an invite link with no code in it.
 * Neither statement was observed — both were the fallout of an unrelated view
 * timing out.
 */
import { describe, it, expect } from 'vitest'
import { teacherPanelState, joinPanelState } from './classDetailPanels'

const ORIGIN = 'https://saysomethingin.app'

describe('teacherPanelState', () => {
  it('says "empty" ONLY when a clean read actually returned zero', () => {
    expect(teacherPanelState({ count: 0, loaded: true, error: null })).toBe('empty')
  })

  it('never claims empty while the read is still in flight', () => {
    expect(teacherPanelState({ count: 0, loaded: false, error: null })).toBe('loading')
  })

  it('never claims empty when the read FAILED — the production false negative', () => {
    expect(teacherPanelState({
      count: 0, loaded: false, error: 'canceling statement due to statement timeout',
    })).toBe('error')
    // Even if something marked it loaded, an error still wins.
    expect(teacherPanelState({ count: 0, loaded: true, error: 'boom' })).toBe('error')
  })

  it('renders the list whenever teachers were actually observed', () => {
    expect(teacherPanelState({ count: 2, loaded: true, error: null })).toBe('ready')
  })
})

describe('joinPanelState', () => {
  it('offers the link when the code is present', () => {
    expect(joinPanelState({ joinCode: 'RXQ-304', loading: false, error: null, origin: ORIGIN }))
      .toEqual({ state: 'ready', url: 'https://saysomethingin.app/redeem/RXQ-304', code: 'RXQ-304' })
  })

  it('offers NOTHING copyable when the code is missing after a failure', () => {
    const panel = joinPanelState({ joinCode: '', loading: false, error: 'Failed to fetch class detail', origin: ORIGIN })
    expect(panel.state).toBe('error')
    expect(panel.url).toBeNull()
    expect(panel.code).toBeNull()
  })

  it('holds back while the class is still loading rather than showing a bare /redeem/', () => {
    const panel = joinPanelState({ joinCode: '', loading: true, error: null, origin: ORIGIN })
    expect(panel.state).toBe('loading')
    expect(panel.url).toBeNull()
  })

  it('treats the "N/A" placeholder as no code at all', () => {
    const panel = joinPanelState({ joinCode: 'N/A', loading: false, error: null, origin: ORIGIN })
    expect(panel.state).toBe('empty')
    expect(panel.url).toBeNull()
  })

  it('never produces a url ending in /redeem/ in any state', () => {
    const cases = [
      { joinCode: '', loading: false, error: null },
      { joinCode: '', loading: true, error: null },
      { joinCode: '', loading: false, error: 'timeout' },
      { joinCode: undefined, loading: false, error: null },
      { joinCode: 'N/A', loading: true, error: 'timeout' },
    ]
    for (const c of cases) {
      const { url } = joinPanelState({ ...c, origin: ORIGIN })
      expect(url === null || !/\/redeem\/$/.test(url)).toBe(true)
    }
  })
})
