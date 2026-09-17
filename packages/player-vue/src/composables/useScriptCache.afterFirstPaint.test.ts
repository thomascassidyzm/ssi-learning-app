/**
 * Job #119 — the listening-metadata snapshot is written AFTER first paint, not
 * during the boot fetches.
 *
 * What it costs is the point: `ensureListeningMetaSnapshot` pulls three
 * paginated `course_practice_phrases` pages plus every seed of the course —
 * 313 KB measured on a cold class Overview at phone width on 4G, roughly a
 * third of that load — on a page that renders none of it. It was going out down
 * the same pipe as the page's own first-paint requests. Nothing about WHAT is
 * written changes here; only when, so the offline guarantee (job #379: the
 * Dialogues list exists offline on a device that only ever had the automatic
 * download-ahead) is untouched — this test proves the write still happens.
 */

import 'fake-indexeddb/auto'
import { describe, expect, it, vi } from 'vitest'

vi.mock('./listeningMetaCache', () => ({
  refreshListeningMetaIfStale: vi.fn(async () => false),
  ensureListeningMetaSnapshot: vi.fn(async () => false),
}))

import { checkContentVersion, afterFirstPaint } from './useScriptCache'
import { ensureListeningMetaSnapshot, refreshListeningMetaIfStale } from './listeningMetaCache'

function fakeClient(row: Record<string, string>) {
  return {
    from: () => ({
      select: () => ({
        eq: () => ({ single: async () => ({ data: row, error: null }) }),
      }),
    }),
  } as any
}

describe('the listening snapshot runs after first paint', () => {
  it('is NOT dispatched while checkContentVersion is still resolving, and IS dispatched afterwards', async () => {
    vi.mocked(ensureListeningMetaSnapshot).mockClear()
    vi.mocked(refreshListeningMetaIfStale).mockClear()

    await checkContentVersion(
      fakeClient({ content_version: 'v1', content_stamp: '2026-09-17T00:00:00Z' }),
      'afp-test-1',
    )

    // The boot path is done and the pipe is free — nothing has been asked for
    // yet. (Pre-fix this was already called, synchronously, right here.)
    expect(ensureListeningMetaSnapshot).not.toHaveBeenCalled()
    expect(refreshListeningMetaIfStale).not.toHaveBeenCalled()

    // …and it is not dropped: it lands once the page is idle.
    await vi.waitFor(
      () => expect(ensureListeningMetaSnapshot).toHaveBeenCalledWith(expect.anything(), 'afp-test-1'),
      { timeout: 3000 },
    )
    expect(refreshListeningMetaIfStale).toHaveBeenCalled()
  })
})

describe('afterFirstPaint', () => {
  it('waits for the load event when the document is still loading', async () => {
    const spy = vi.fn()
    const readyState = Object.getOwnPropertyDescriptor(Document.prototype, 'readyState')
    Object.defineProperty(document, 'readyState', { value: 'loading', configurable: true })
    try {
      afterFirstPaint(spy)
      expect(spy).not.toHaveBeenCalled()
      window.dispatchEvent(new Event('load'))
      await vi.waitFor(() => expect(spy).toHaveBeenCalled(), { timeout: 3000 })
    } finally {
      if (readyState) Object.defineProperty(document, 'readyState', readyState)
      else Object.defineProperty(document, 'readyState', { value: 'complete', configurable: true })
    }
  })

  it('still runs the work when the page has already loaded', async () => {
    const spy = vi.fn()
    afterFirstPaint(spy)
    await vi.waitFor(() => expect(spy).toHaveBeenCalled(), { timeout: 3000 })
  })
})
