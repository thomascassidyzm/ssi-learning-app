import { describe, it, expect } from 'vitest'
import { roundsCarryNativeScript } from './roundsCarryNativeScript'

// The shape these assertions use is toSimpleRounds' output — the same objects
// that go into (and come back out of) the IndexedDB script cache verbatim.
const cycle = (text: string, textNative?: string) => ({
  id: 'c1', type: 'debut', legoId: 'S0001L01',
  known: { text: 'I want', audioUrl: '' },
  target: { text, ...(textNative ? { textNative } : {}), voice1Url: '', voice2Url: '' },
})

describe('roundsCarryNativeScript', () => {
  it('is false for a Latin-script course (no native fields anywhere)', () => {
    expect(roundsCarryNativeScript([
      { roundNumber: 1, legoId: 'S0001L01', legoTargetText: 'quiero', cycles: [cycle('quiero')] },
    ])).toBe(false)
  })

  it('is true when a cycle carries native script beside the romanisation', () => {
    expect(roundsCarryNativeScript([
      { roundNumber: 1, legoId: 'S0001L01', cycles: [cycle('wǒ xiǎng', '我想')] },
    ])).toBe(true)
  })

  it('is true from the round-level LEGO text alone', () => {
    expect(roundsCarryNativeScript([
      { roundNumber: 1, legoId: 'S0001L01', legoTargetText: 'wǒ xiǎng', legoTargetTextNative: '我想', cycles: [] },
    ])).toBe(true)
  })

  it('finds native script in a later round, not just the first', () => {
    expect(roundsCarryNativeScript([
      { roundNumber: 1, legoId: 'S0001L01', cycles: [cycle('wǒ')] },
      { roundNumber: 2, legoId: 'S0002L01', cycles: [cycle('xiǎng', '想')] },
    ])).toBe(true)
  })

  it('tolerates empty, null and malformed input rather than throwing', () => {
    expect(roundsCarryNativeScript([])).toBe(false)
    expect(roundsCarryNativeScript(null as any)).toBe(false)
    expect(roundsCarryNativeScript([null, {}, { cycles: null }, { cycles: [{}] }] as any)).toBe(false)
  })
})
