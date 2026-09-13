// @vitest-environment node
/**
 * Job #591 — a pod line never spoken in the target language shows its known
 * text AS the line. Before this, the Senedd pod's two English-only lines
 * (scene 15 line 79, scene 17 line 82) lit an EMPTY card in Immersion for the
 * length of their English clip on production, 2026-09-13.
 */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { podLineShown } from './podLineText'

const overlay = readFileSync(resolve(__dirname, '../components/ListeningOverlay.vue'), 'utf8')

describe('podLineShown', () => {
  it('a line with target text shows the target, and the known stays a gloss', () => {
    expect(podLineShown('Prynhawn da.', 'Good afternoon.')).toEqual({ text: 'Prynhawn da.', side: 'target', hasTarget: true })
  })
  it('a line with NO target text shows the known text as the line, in the known language, with no gloss', () => {
    expect(podLineShown('', "But I think it's better if I just answer quickly in English.")).toEqual({ text: "But I think it's better if I just answer quickly in English.", side: 'known', hasTarget: false })
    expect(podLineShown('   ', 'x')).toEqual({ text: 'x', side: 'known', hasTarget: false })
    expect(podLineShown(null, 'x').side).toBe('known')
    expect(podLineShown(undefined, undefined)).toEqual({ text: '', side: 'known', hasTarget: false })
  })
})

describe('ListeningOverlay — every dialogue card branch shows the words in the ear', () => {
  it('the current-row gloss-pair branch and the plain-row branch both render through podLineShown', () => {
    expect(overlay).toContain("import { podLineShown } from '../playback/podLineText'")
    // Current row, per-sentence pairs.
    expect(overlay).toContain('{{ podLineShown(pair.target, pair.known).text }}')
    expect(overlay).toContain('v-if="podLineShown(pair.target, pair.known).hasTarget && (glossVisible || revealedRowId === phrase.id) && pair.known"')
    // Every other row.
    expect(overlay).toContain('{{ podLineShown(phrase.targetText, phrase.knownText).text }}')
    // The pre-#591 blank-card renders are gone from the Dialogues teleprompter
    // (the Core / All list below it is untouched — a seed row always has target text).
    const pods = overlay.slice(overlay.indexOf('<div v-if="view === \'pods\'" class="teleprompter">'), overlay.indexOf('<!-- Core / All: belt headers'))
    expect(pods.length).toBeGreaterThan(1000)
    expect(pods).not.toContain('<div :lang="courseTargetLang" class="phrase-target">{{ pair.target }}</div>')
    expect(pods).not.toContain('<div :lang="courseTargetLang" class="phrase-target">{{ phrase.targetText }}</div>')
  })
})
