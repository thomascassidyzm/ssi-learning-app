/**
 * THE BOUNDARY between the two audio-delivery paths, enforced by source scan.
 *
 * Tom's ruling, 2026-09-01:
 *   "Should be progressively loaded, yes. Never upfront loaded."
 *   "Because people still have the option if they choose to select the
 *    Offline Mode itself."
 *
 * PATH 1 — PROGRESSIVE (automatic). Warms content scoped to the learner's
 *   CURSOR and rolls forward with it: the next cycle (SimplePlayer), the head
 *   rounds and the span ahead (LearningPlayer's rolling filler), the next pod
 *   / Layer-1 lap. Bounded, gentle, position-scoped.
 *
 * PATH 2 — DELIBERATE (Offline Mode). Course-scale and corpus-scale downloads,
 *   run only because the learner asked for them.
 *
 * A unit test can't watch a browser, so it watches the SOURCE for the two ways
 * the boundary has actually been crossed before:
 *   (a) the bulk downloader being imported somewhere new;
 *   (b) a corpus-wide collector being spliced into the automatic warm.
 *
 * If you are here because this test failed: it is probably right. Read the
 * ruling above before you edit the allowlist.
 */
import { describe, expect, it } from 'vitest'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative, resolve } from 'node:path'

const SRC = resolve(__dirname, '..')

function sourceFiles(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) {
      if (entry === 'node_modules' || entry === 'dist') continue
      sourceFiles(full, out)
    } else if (/\.(ts|vue)$/.test(entry) && !/\.test\.ts$/.test(entry)) {
      out.push(full)
    }
  }
  return out
}

/**
 * The ONLY module allowed to reach the bulk downloader. LearningPlayer holds
 * the three Offline Mode entry points (downloadForOffline, its INF PLAY
 * variant, and the background straggler retry for a download already
 * consented to). Adding a file here means you are claiming it is an explicit
 * learner opt-in — be sure that it is.
 */
const BULK_IMPORT_ALLOWLIST = ['components/LearningPlayer.vue']

describe('progressive-prefetch boundary (Tom 2026-09-01)', () => {
  it('only the Offline Mode entry point imports the bulk downloader', () => {
    const importers = sourceFiles(SRC)
      .filter((f) => /from ['"][^'"]*bulkAudioDownload['"]/.test(readFileSync(f, 'utf-8')))
      .map((f) => relative(SRC, f).split('\\').join('/'))
      .filter((f) => !f.startsWith('playback/bulkAudioDownload'))

    expect(importers.sort()).toEqual(BULK_IMPORT_ALLOWLIST.sort())
  })

  it('every bulkDownloadAudio call declares its Offline Mode opt-in', () => {
    const src = readFileSync(join(SRC, 'components/LearningPlayer.vue'), 'utf-8')
    const calls = [...src.matchAll(/bulkDownloadAudio\(/g)]
    expect(calls.length).toBeGreaterThan(0)
    for (const call of calls) {
      // The deps object literal follows within a few lines; the gate must be
      // in it, wired to the learner's own offlineActive selection.
      const window = src.slice(call.index!, call.index! + 700)
      expect(window).toMatch(/offlineModeOptIn:\s*\(\)\s*=>\s*offlineActive\.value/)
    }
  })

  it('the automatic rolling filler warms only cursor-scoped content', () => {
    const src = readFileSync(join(SRC, 'components/LearningPlayer.vue'), 'utf-8')
    const start = src.indexOf('const fillBuffer = async (')
    expect(start).toBeGreaterThan(-1)
    const end = src.indexOf('const fillRollingBuffer', start)
    expect(end).toBeGreaterThan(start)
    // Strip comments before asserting: this file's prose NAMES the collectors
    // it forbids (that is the point of the comments), and a scan that can't
    // tell code from commentary would flag its own explanation.
    const fillBuffer = src
      .slice(start, end)
      .split('\n')
      .filter((line) => !line.trim().startsWith('//'))
      .join('\n')

    // The bulk downloader must never be reachable from the automatic warm.
    expect(fillBuffer).not.toMatch(/bulkDownloadAudio/)

    // Corpus-wide collectors take no cursor and no span, so they cannot roll
    // forward with the learner. collectAllListeningAudioIds was spliced in
    // here until 2026-09-01 and pulled ~100 MB before the first cycle played.
    expect(fillBuffer).not.toMatch(/collectAllListeningAudioIds/)
    expect(fillBuffer).not.toMatch(/collectInfPlayUseAudioIds/)
    expect(fillBuffer).not.toMatch(/collectAuxiliaryAudioIds/)
    expect(fillBuffer).not.toMatch(/collectRoundsAudioIds/)

    // …and what it DOES warm is span- or cursor-scoped. These are the shapes
    // the ruling calls correct; losing them is how a learner hits silence.
    expect(fillBuffer).toMatch(/collectHeadRoundsAudioIds\(PREFETCH_HEAD_ROUNDS\)/)
    expect(fillBuffer).toMatch(/collectSpanAudioIds\(spanMs\)/)
    expect(fillBuffer).toMatch(/collectPodSpanAudioIds\(spanMs\)/)
    expect(fillBuffer).toMatch(/collectLayer1SpanAudioIds\(spanMs\)/)
  })

  it('the corpus-wide listening collector is used by Offline Mode alone', () => {
    const src = readFileSync(join(SRC, 'components/LearningPlayer.vue'), 'utf-8')
    // One definition, one call — and the call sits inside downloadForOffline.
    const calls = [...src.matchAll(/collectAllListeningAudioIds\(\)/g)]
    expect(calls).toHaveLength(1)
    const dl = src.indexOf('const downloadForOffline = async (')
    const after = src.indexOf('const OFFLINE_BG_RETRY_DELAYS_MS', dl)
    expect(calls[0].index!).toBeGreaterThan(dl)
    expect(calls[0].index!).toBeLessThan(after)
  })
})
