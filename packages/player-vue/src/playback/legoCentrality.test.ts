import { describe, it, expect } from 'vitest'
import { computeCentralityFromScript } from './legoCentrality'
import type { ScriptItem } from '../providers/generateLearningScript'

function item(overrides: Partial<ScriptItem>): ScriptItem {
  return {
    uuid: 'u',
    cycleNum: 1,
    roundNumber: 1,
    seedId: 'S0001',
    legoKey: 'S0001L01',
    seedCode: 'S0001',
    legoCode: '01',
    type: 'build',
    knownText: 'k',
    targetText: 't',
    isNew: false,
    ...overrides,
  } as ScriptItem
}

describe('computeCentralityFromScript', () => {
  it('derives introduction ordinals from debut order and counts forward reuse from build/use phrases', () => {
    const items: ScriptItem[] = [
      item({ type: 'debut', legoKey: 'S0001L01', targetText: 'quiero' }),
      item({ type: 'use', legoKey: 'S0001L01', targetText: 'quiero uno' }), // own phrase, not forward
      item({ type: 'debut', legoKey: 'S0002L01', targetText: 'hablar' }),
      item({ type: 'build', legoKey: 'S0002L01', targetText: 'quiero hablar' }), // forward for L1
      item({ type: 'use', legoKey: 'S0002L01', targetText: 'quiero hablar contigo' }), // forward for L1
    ]
    const { percentileByLego, detail } = computeCentralityFromScript(items)
    expect(detail.get('S0001L01')!.forwardReuse).toBe(2) // both later phrases contain "quiero"; own USE never counts
    expect(detail.get('S0002L01')!.forwardReuse).toBe(0)
    expect(percentileByLego['S0001L01']).toBe(1)
    expect(percentileByLego['S0002L01']).toBe(0)
  })

  it('ignores spaced_rep replays and dedupes revival-tail USE re-emissions', () => {
    const items: ScriptItem[] = [
      item({ type: 'debut', legoKey: 'S0001L01', targetText: 'quiero' }),
      item({ type: 'debut', legoKey: 'S0002L01', targetText: 'mañana' }),
      item({ type: 'use', legoKey: 'S0002L01', targetText: 'quiero verte mañana' }),
      // Spaced-rep replay of the same content — a schedule artefact, not a new edge.
      item({ type: 'spaced_rep', legoKey: 'S0002L01', targetText: 'quiero verte mañana' }),
      // Revival-tail re-emission (same owner, same target) — deduped.
      item({ type: 'use', legoKey: 'S0002L01', targetText: 'quiero verte mañana', roundNumber: 400 }),
    ]
    const { detail } = computeCentralityFromScript(items)
    expect(detail.get('S0001L01')!.forwardReuse).toBe(1)
  })

  it('a re-emitted debut keeps its first (introduction) ordinal', () => {
    const items: ScriptItem[] = [
      item({ type: 'debut', legoKey: 'S0001L01', targetText: 'quiero' }),
      item({ type: 'debut', legoKey: 'S0002L01', targetText: 'quiero hablar' }),
      item({ type: 'debut', legoKey: 'S0001L01', targetText: 'quiero', roundNumber: 300 }),
    ]
    const { detail } = computeCentralityFromScript(items)
    // L1 introduced first: the later M-lego counts forward for it; the
    // re-emission must not move L1 past L2 and zero that edge out.
    expect(detail.get('S0001L01')!.forwardReuse).toBe(1)
  })
})
