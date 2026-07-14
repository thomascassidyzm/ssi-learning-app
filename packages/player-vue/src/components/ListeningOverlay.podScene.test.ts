/**
 * ListeningOverlay openScene() phrase-card flattening — dedup for
 * fusion-glued continuation rows.
 *
 * Mirrors the turn→phrase-card flattening loop from openScene() in
 * ListeningOverlay.vue (the function lives inside <script setup> so we
 * can't import it directly — same inline-equivalent approach as
 * ListeningOverlay.prefetch.test.ts). Pins the contract fixed 2026-07-14
 * (hrv pod-0 gloss-fidelity audit, ssi-dashboard-v7-clean): a fusion-glued
 * continuation row's material already plays fused inside its anchor row's
 * card, so it must NOT also render as its own separate (dimmed) card.
 */

import { describe, it, expect } from 'vitest'

interface SceneSentence {
  targetText: string
  knownText: string
  fusionGroups: unknown[] | null
  fusionContinuation: boolean
}

interface SceneTurn {
  id: string
  speaker: string
  speakerName: string
  sentences: SceneSentence[]
  globalOrder: number
}

// Inline-equivalent of openScene()'s turn→phrase-card flattening loop.
function buildPhraseCards(turns: SceneTurn[]): Array<{ id: string; targetText: string; fusionContinuation: boolean }> {
  const phrases: Array<{ id: string; targetText: string; fusionContinuation: boolean }> = []
  let prevSpeakerKey: string | null = null
  for (const t of turns) {
    const chunks = t.sentences
    const curKey = (t.speakerName || t.speaker || '').trim().toLowerCase()
    prevSpeakerKey = curKey
    chunks.forEach((s, idx) => {
      if (s.fusionContinuation) return
      phrases.push({ id: `${t.id}-c${idx}`, targetText: s.targetText, fusionContinuation: s.fusionContinuation })
    })
  }
  return phrases
}

const turn = (id: string, targetText: string, fusionContinuation: boolean, fusionGroups: unknown[] | null = null): SceneTurn => ({
  id,
  speaker: 'Barista',
  speakerName: 'Barista',
  globalOrder: 0,
  sentences: [{ targetText, knownText: '', fusionGroups, fusionContinuation }],
})

describe('openScene phrase-card flattening — fusion-continuation dedup', () => {
  it('drops the continuation row entirely — only the fused anchor card renders', () => {
    // Real shape: hrv "Hej! Žao mi je, ali sad ne mogu razgovarati." — "Hej!"
    // is the anchor (carries the glued fusionGroup), the second sentence is
    // the continuation whose material already plays inside the anchor.
    const turns = [
      turn('s0', 'Hej!', false, [{ rowFirst: 0, rowLast: 1 }]),
      turn('s1', 'Žao mi je, ali sad ne mogu razgovarati.', true),
    ]
    const phrases = buildPhraseCards(turns)
    expect(phrases).toHaveLength(1)
    expect(phrases[0].targetText).toBe('Hej!')
  })

  it('unglued turns (fusionContinuation false throughout) all render their own card', () => {
    const turns = [
      turn('s0', 'Zovem se Anna.', false, [{ rowFirst: 0, rowLast: 0 }]),
      turn('s1', 'Drago mi je.', false, [{ rowFirst: 1, rowLast: 1 }]),
    ]
    const phrases = buildPhraseCards(turns)
    expect(phrases).toHaveLength(2)
    expect(phrases.map((p) => p.targetText)).toEqual(['Zovem se Anna.', 'Drago mi je.'])
  })

  it('turns with no fusion data at all render every card (fallback path)', () => {
    const turns = [turn('s0', 'Dobro jutro.', false), turn('s1', 'Kako ste?', false)]
    expect(buildPhraseCards(turns)).toHaveLength(2)
  })
})
