/**
 * OFFLINE: a clip the device hasn't got is never requested, and never retried.
 *
 * Tom, 2026-08-31: "There must be no path that retries an unavailable asset."
 * Caught live on the dev deployment the same night: six cycles whose audio the
 * cache INDEX claimed but whose bytes resolved to the network proxy, giving
 * eighteen consecutive skipped clips — `code=4`, retry, `code=4`, skip, per
 * clip — while genuinely offline.
 */
import { describe, it, expect } from 'vitest'
import { SimplePlayer } from './SimplePlayer'

const cycle = (id: string) => ({
  id,
  legoId: 'S0001L01',
  type: 'debut',
  known: { text: 'hello', audioUrl: '/api/audio/known-1' },
  target: { text: 'ciao', voice1Url: '/api/audio/v1', voice2Url: '/api/audio/v2' },
})

const round = (n: number, id: string) => ({ roundNumber: n, legoId: 'S0001L01', cycles: [cycle(id)] })

/**
 * Drive playAudio directly — that is the single choke point every clip goes
 * through, and calling it is the honest unit for "what did the engine do with
 * this url".
 */
const runPlay = (offline: boolean, url: string) => {
  const assigned: string[] = []
  const failures: any[] = []
  const player: any = new SimplePlayer([round(1, 'c1')] as any, { isOfflinePlayback: () => offline })
  Object.defineProperty(player.audio, 'src', {
    configurable: true,
    get: () => '',
    set: (v: string) => { assigned.push(v) },
  })
  player.audio.play = () => Promise.resolve()
  player.audio.load = () => {}
  player.on('audio_failed', (c: any) => failures.push(c))
  player.playAudio(url)
  return { assigned, failures, player }
}

describe('SimplePlayer offline clip gate', () => {
  it('OFFLINE: never assigns a network URL the device cannot fetch', () => {
    const { assigned, failures } = runPlay(true, '/api/audio/known-1')
    expect(assigned.filter((u) => u.startsWith('/api/audio/'))).toEqual([])
    // It still reports the clip as failed and moves on — the session continues.
    expect(failures.length).toBe(1)
  })

  it('OFFLINE: a resolved BLOB url still plays — this gate is about reachability, not caution', () => {
    const { assigned } = runPlay(true, 'blob:local-bytes')
    expect(assigned).toContain('blob:local-bytes')
  })

  it('ONLINE: the network URL is played exactly as before', () => {
    const { assigned } = runPlay(false, '/api/audio/known-1')
    expect(assigned).toContain('/api/audio/known-1')
  })

  it('data: clips (the silent pause/gap clips) are always local', async () => {
    const p: any = new SimplePlayer([] as any)
    expect(p.isLocalUrl('data:audio/wav;base64,AAAA')).toBe(true)
    expect(p.isLocalUrl('blob:x')).toBe(true)
    expect(p.isLocalUrl('/api/audio/x')).toBe(false)
  })

  it('unavailableOffline is FALSE online, whatever the url', () => {
    const p: any = new SimplePlayer([] as any, { isOfflinePlayback: () => false })
    expect(p.unavailableOffline('/api/audio/x')).toBe(false)
    p.setRuntimeOverrides({ isOfflinePlayback: () => true })
    expect(p.unavailableOffline('/api/audio/x')).toBe(true)
    expect(p.unavailableOffline('blob:x')).toBe(false)
  })

  it('with no isOfflinePlayback override at all, nothing changes', () => {
    const p: any = new SimplePlayer([] as any)
    expect(p.unavailableOffline('/api/audio/x')).toBe(false)
  })
})
