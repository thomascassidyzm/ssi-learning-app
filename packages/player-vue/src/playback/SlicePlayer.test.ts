import { describe, it, expect, vi, beforeEach } from 'vitest'
import { SlicePlayer } from './SlicePlayer'

// Minimal Web Audio mocks. Each SlicePlayer creates one AudioContext lazily
// on first use, so we stub the global constructor.
class MockAudioBufferSourceNode {
  buffer: unknown = null
  playbackRate = { value: 1 }
  onended: (() => void) | null = null
  connect = vi.fn()
  disconnect = vi.fn()
  start = vi.fn()
  stop = vi.fn()
}

class MockAudioContext {
  state: 'running' | 'suspended' | 'closed' = 'running'
  destination = {}
  resume = vi.fn().mockResolvedValue(undefined)
  close = vi.fn().mockResolvedValue(undefined)
  decodeAudioData = vi.fn().mockImplementation(async () => ({ duration: 5 }))
  createBufferSource = vi.fn().mockImplementation(() => new MockAudioBufferSourceNode())
}

let lastCtx: MockAudioContext

beforeEach(() => {
  vi.stubGlobal(
    'AudioContext',
    vi.fn().mockImplementation(() => {
      lastCtx = new MockAudioContext()
      return lastCtx
    })
  )
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue({
      arrayBuffer: () => Promise.resolve(new ArrayBuffer(8)),
    })
  )
})

// Flushes pending microtasks/macrotasks (fetch → decode → resume → createBufferSource
// all resolve across several ticks) so a source node exists to act on.
async function flush() {
  for (let i = 0; i < 5; i++) {
    await new Promise((resolve) => setTimeout(resolve, 0))
  }
}

// Fires onended for the most recently created source node, simulating playback completion.
function endLastSource() {
  const results = lastCtx.createBufferSource.mock.results
  const source = results[results.length - 1]?.value as MockAudioBufferSourceNode
  source.onended?.()
}

describe('SlicePlayer', () => {
  it('decodes each clip id only once across multiple playSlice calls', async () => {
    const player = new SlicePlayer({ courseCode: 'spa_for_eng_v2' })

    const p1 = player.playSlice('clip-1', 0, 1000)
    await flush()
    endLastSource()
    await p1

    const p2 = player.playSlice('clip-1', 1000, 2000)
    await flush()
    endLastSource()
    await p2

    expect(lastCtx.decodeAudioData).toHaveBeenCalledTimes(1)
    expect((fetch as ReturnType<typeof vi.fn>)).toHaveBeenCalledTimes(1)
  })

  it('sets playbackRate from the speed argument', async () => {
    const player = new SlicePlayer({ courseCode: 'spa_for_eng_v2' })

    const p = player.playSlice('clip-1', 0, 1000, 1.5)
    await flush()
    const results = lastCtx.createBufferSource.mock.results
    const source = results[results.length - 1]?.value as MockAudioBufferSourceNode
    expect(source.playbackRate.value).toBe(1.5)
    endLastSource()
    await p
  })

  it('stop() settles the in-flight promise without throwing', async () => {
    const player = new SlicePlayer({ courseCode: 'spa_for_eng_v2' })

    const p = player.playSlice('clip-1', 0, 1000)
    await flush()

    expect(() => player.stop()).not.toThrow()
    await expect(p).resolves.toBeUndefined()
  })

  it('preload() dedupes concurrent calls for the same clip id', async () => {
    const player = new SlicePlayer({ courseCode: 'spa_for_eng_v2' })

    await Promise.all([player.preload('clip-1'), player.preload('clip-1'), player.preload('clip-1')])

    expect(fetch).toHaveBeenCalledTimes(1)
    expect(lastCtx.decodeAudioData).toHaveBeenCalledTimes(1)
  })
})
