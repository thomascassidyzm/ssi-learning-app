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

/**
 * A JUMP MUST LAND SOMEWHERE PLAYABLE (Tom, 2026-08-31: "the availability
 * check happens too late. Move it ahead of the render if that is where it
 * belongs.")
 *
 * jumpToRound used to land wherever it was aimed even when the live cull
 * played nothing there — putting an unplayable cycle into `currentCycle`,
 * which is what the learner reads on screen a beat before the app discovers
 * it has no sound for it. That is the belt-skip half of his report.
 */
describe('SimplePlayer jump lands on playable content', () => {
  const r = (n: number, ids: string[]) => ({
    roundNumber: n,
    legoId: `L${n}`,
    cycles: ids.map((id) => ({
      id,
      legoId: `L${n}`,
      type: 'debut',
      known: { text: id, audioUrl: `/api/audio/${id}-k` },
      target: { text: id, voice1Url: `/api/audio/${id}-1`, voice2Url: `/api/audio/${id}-2` },
    })),
  })

  const playerWith = (skipIds: string[]) => {
    const p: any = new SimplePlayer(
      [r(1, ['a1']), r(2, ['dead1', 'dead2']), r(3, ['c1'])] as any,
      { shouldSkipCycle: (c: any) => skipIds.includes(c.id) },
    )
    p.audio.play = () => Promise.resolve()
    p.audio.load = () => {}
    return p
  }

  it('walks past a round whose every cycle is culled', () => {
    const p = playerWith(['dead1', 'dead2'])
    p.jumpToRound(1) // round 2 — entirely unplayable
    expect(p.state.roundIndex).toBe(2) // landed on round 3
    expect(p.currentCycle?.id).toBe('c1')
  })

  it('lands normally when the target round has something playable', () => {
    const p = playerWith(['dead1']) // dead2 still playable
    p.jumpToRound(1)
    expect(p.state.roundIndex).toBe(1)
    expect(p.currentCycle?.id).toBe('dead2')
  })

  it('emits no_playable_content when nothing ahead can play, and still lands', () => {
    const p = playerWith(['dead1', 'dead2', 'c1'])
    const seen: any[] = []
    p.on('no_playable_content', (d: any) => seen.push(d))
    p.jumpToRound(1)
    expect(seen.length).toBe(1)
    // Never a silent no-op: it still lands, so the app can recycle from here.
    expect(p.state.roundIndex).toBe(1)
  })

  it('does not fire when there is no cull at all', () => {
    const p: any = new SimplePlayer([r(1, ['a1']), r(2, ['b1'])] as any, {})
    p.audio.play = () => Promise.resolve()
    p.audio.load = () => {}
    const seen: any[] = []
    p.on('no_playable_content', () => seen.push(1))
    p.jumpToRound(1)
    expect(seen.length).toBe(0)
    expect(p.state.roundIndex).toBe(1)
  })
})
