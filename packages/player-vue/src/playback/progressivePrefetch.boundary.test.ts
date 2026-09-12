/**
 * THE BOUNDARY between the two audio-delivery paths, enforced by source scan.
 *
 * Tom's ruling, 2026-09-01, as amended 2026-09-12 (job #379):
 *   "Should be progressively loaded, yes. Never upfront loaded." — for the
 *   COURSE. Listening exercises are the exception he ruled on 2026-09-12:
 *   every pod slot's list, metadata and audio are fetched FIRST, on both
 *   paths, so an unexpectedly offline learner can always play them.
 *
 * PATH 1 — PROGRESSIVE (automatic). Head rounds, then EVERY pod, then the
 *   Layer-1 cups and the span ahead, rolling forward with the cursor. The
 *   course part stays position-scoped; the pods do not.
 *
 * PATH 2 — DELIBERATE ("fetch more ahead"). Course-scale downloads the
 *   learner asked for, in the same order: head, pods, course.
 *
 * A unit test can't watch a browser, so it watches the SOURCE for the ways
 * the boundary has actually been crossed before:
 *   (a) the bulk downloader being imported somewhere new;
 *   (b) a course-wide cycle collector being spliced into the automatic warm;
 *   (c) the pod corpus dropping OUT of the automatic warm again.
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

  it('the automatic rolling filler warms head, then every pod, then the cursor-scoped span', () => {
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

    // Course-wide CYCLE collectors take no cursor and no span, so they cannot
    // roll forward with the learner. Those stay out.
    expect(fillBuffer).not.toMatch(/collectInfPlayUseAudioIds/)
    expect(fillBuffer).not.toMatch(/collectAuxiliaryAudioIds/)
    expect(fillBuffer).not.toMatch(/collectRoundsAudioIds/)

    // …and the order is pinned through the one builder both paths share:
    // head, then every pod slot (Tom 2026-09-12), then Layer-1, then the span.
    const call = fillBuffer.match(/buildFetchAheadOrder\(\{([\s\S]*?)\}\)/)
    expect(call, 'fillBuffer must order through buildFetchAheadOrder').not.toBeNull()
    const tiers = call![1]
    const at = (re: RegExp) => { const i = tiers.search(re); expect(i, String(re)).toBeGreaterThan(-1); return i }
    const head = at(/head:\s*collectHeadRoundsAudioIds\(PREFETCH_HEAD_ROUNDS\)/)
    const pods = at(/pods:\s*await collectAllPodAudioIds\(\)/)
    const layer1 = at(/layer1:\s*collectLayer1SpanAudioIds\(spanMs\)/)
    const span = at(/span:\s*collectSpanAudioIds\(spanMs\)/)
    expect(head).toBeLessThan(pods)
    expect(pods).toBeLessThan(layer1)
    expect(layer1).toBeLessThan(span)
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
