/**
 * The fallback is the feature. These tests exercise every way Popty can let us
 * down and assert the learner reads the shipped prose regardless — never an
 * empty panel, never raw markdown, never a thrown parse error.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { HOW_THIS_WORKS_LEARNER, WHY_THIS_WORKS } from './learnerExplainers'
import {
  usePublishedExplainers,
  __resetPublishedExplainers,
} from './usePublishedExplainers'
import ORIGINAL from './fixtures/htw-copy-original.md?raw'

/** Wait for the module's own background fetch to have settled. */
const settle = () => new Promise((r) => setTimeout(r, 0))

function respond(body: unknown, init: { ok?: boolean; status?: number; json?: () => unknown } = {}) {
  return vi.fn().mockResolvedValue({
    ok: init.ok ?? true,
    status: init.status ?? 200,
    json: init.json ?? (async () => body),
  })
}

beforeEach(() => {
  __resetPublishedExplainers()
})

afterEach(() => {
  vi.unstubAllGlobals()
  __resetPublishedExplainers()
})

describe('usePublishedExplainers', () => {
  it('renders the hardcoded prose on the very first read, before anything is fetched', () => {
    vi.stubGlobal('fetch', vi.fn(() => new Promise(() => {})))
    const { howThisWorks, whyThisWorks } = usePublishedExplainers()
    expect(howThisWorks.value).toEqual(HOW_THIS_WORKS_LEARNER)
    expect(whyThisWorks.value).toEqual(WHY_THIS_WORKS)
  })

  it('asks Popty for the published htw document, unauthenticated', async () => {
    const fetchMock = respond({ id: 'htw', content: ORIGINAL })
    vi.stubGlobal('fetch', fetchMock)
    usePublishedExplainers()
    await settle()
    const [url, opts] = fetchMock.mock.calls[0]
    expect(url).toMatch(/\/api\/copy-published\?doc=htw$/)
    expect(opts.credentials).toBe('omit')
  })

  it('swaps in the published words when they arrive', async () => {
    const edited = ORIGINAL.replace(
      'A go is one of those gaps where you opened your mouth and had a crack at it.',
      'A go is any time you had a crack at it.',
    )
    vi.stubGlobal('fetch', respond({ id: 'htw', content: edited }))
    const { howThisWorks } = usePublishedExplainers()
    await settle()
    const go = howThisWorks.value.blocks.find((b) => b.heading === 'What a go is')!
    expect(go.body[0]).toBe('A go is any time you had a crack at it.')
    // Everything the code owns is untouched by the swap.
    expect(go.figure).toBe('three-gaps')
    expect(howThisWorks.value.figure).toBe('player-screen')
  })

  const failures: Array<[string, () => unknown]> = [
    ['nothing published yet — a 404', () => respond({ error: 'Nothing published yet', id: 'htw' }, { ok: false, status: 404 })],
    ['a server error', () => respond({ error: 'boom' }, { ok: false, status: 500 })],
    ['a body that is not JSON', () => respond(null, { json: () => { throw new SyntaxError('not json') } })],
    ['a document with no content field', () => respond({ id: 'htw' })],
    ['a document whose content is empty', () => respond({ id: 'htw', content: '   ' })],
    ['a document that is not this document at all', () => respond({ id: 'htw', content: '# Something else\n\nnope.\n' })],
    ['the network refusing outright', () => vi.fn().mockRejectedValue(new TypeError('Failed to fetch'))],
    ['an aborted, timed-out request', () => vi.fn().mockRejectedValue(Object.assign(new Error('aborted'), { name: 'AbortError' }))],
  ]

  for (const [what, make] of failures) {
    it(`falls back silently to the shipped prose on ${what}`, async () => {
      vi.stubGlobal('fetch', make())
      const { howThisWorks, whyThisWorks } = usePublishedExplainers()
      await settle()
      expect(howThisWorks.value).toEqual(HOW_THIS_WORKS_LEARNER)
      expect(whyThisWorks.value).toEqual(WHY_THIS_WORKS)
      expect(howThisWorks.value.blocks.length).toBeGreaterThan(0)
      expect(whyThisWorks.value.blocks.length).toBeGreaterThan(0)
    })
  }

  it('fetches once per page load however many components ask', async () => {
    const fetchMock = respond({ id: 'htw', content: ORIGINAL })
    vi.stubGlobal('fetch', fetchMock)
    usePublishedExplainers()
    usePublishedExplainers()
    usePublishedExplainers()
    await settle()
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })
})
