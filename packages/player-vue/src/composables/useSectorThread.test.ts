/**
 * useSectorThread — the client-side laws.
 *
 * An empty walk list is CORRECT (the shell ships before the registrations do),
 * exactly one walk is active at a time, and parking is never destructive.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { useSectorThread, type SectorThread } from './useSectorThread'

function thread(over: Partial<SectorThread> = {}): SectorThread {
  return {
    sectorCourseCode: 'spa_for_eng_health',
    role: 'general',
    active: true,
    lastCompletedRoundIndex: null,
    currentCycleIndex: 0,
    highestCompletedRoundIndex: null,
    highestCompletedLegoId: null,
    completedPodRounds: 0,
    podActivationRound: null,
    ...over,
  }
}

let fetchMock: ReturnType<typeof vi.fn>

beforeEach(() => {
  fetchMock = vi.fn()
  vi.stubGlobal('fetch', fetchMock)
})

afterEach(() => {
  vi.unstubAllGlobals()
})

function ok(body: any) {
  return { ok: true, status: 200, json: async () => body }
}

describe('useSectorThread — the walk list', () => {
  it('an empty list is a correct answer, not an error', async () => {
    fetchMock.mockResolvedValue(ok({ sectors: [] }))
    const s = useSectorThread(async () => 'tok')
    await s.loadSectors('spa_for_eng')
    expect(s.sectors.value).toEqual([])
    expect(s.sectorsError.value).toBeNull()
    expect(s.loadingSectors.value).toBe(false)
  })

  it('carries the anchor through as content in both languages', async () => {
    fetchMock.mockResolvedValue(ok({
      sectors: [{
        slug: 'health',
        sectorCourseCode: 'spa_for_eng_health',
        roles: ['general', 'nurse'],
        status: 'live',
        anchor: { legoId: 'S0042L03', known: 'I wanted to speak to you', target: 'quería hablar contigo' },
      }],
    }))
    const s = useSectorThread(async () => 'tok')
    await s.loadSectors('spa_for_eng')
    expect(s.sectors.value[0].anchor?.known).toBe('I wanted to speak to you')
    expect(s.sectors.value[0].anchor?.target).toBe('quería hablar contigo')
  })

  it('surfaces a failed list as an error and an empty list', async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 500, json: async () => ({}) })
    const s = useSectorThread(async () => 'tok')
    await s.loadSectors('spa_for_eng')
    expect(s.sectors.value).toEqual([])
    expect(s.sectorsError.value).toBeTruthy()
  })
})

describe('useSectorThread — activeThread', () => {
  it('is null with no threads', async () => {
    const s = useSectorThread(async () => 'tok')
    expect(s.activeThread.value).toBeNull()
  })

  it('is the one active row, ignoring parked ones', async () => {
    fetchMock.mockResolvedValue(ok({
      enrollmentId: 'enrol-1',
      threads: [
        thread({ sectorCourseCode: 'spa_for_eng_health', active: false, currentCycleIndex: 7 }),
        thread({ sectorCourseCode: 'spa_for_eng_trades', active: true }),
      ],
    }))
    const s = useSectorThread(async () => 'tok')
    await s.loadThreads('spa_for_eng')
    expect(s.activeThread.value?.sectorCourseCode).toBe('spa_for_eng_trades')
  })

  it('a missing thread read means "no walk chosen", never an error wall', async () => {
    fetchMock.mockRejectedValue(new Error('offline'))
    const s = useSectorThread(async () => 'tok')
    await s.loadThreads('spa_for_eng')
    expect(s.threads.value).toEqual([])
    expect(s.activeThread.value).toBeNull()
  })
})

describe('useSectorThread — one walk at a time', () => {
  it('choosing a walk parks the other locally: flag flipped, state intact, nothing deleted', async () => {
    fetchMock.mockResolvedValueOnce(ok({
      enrollmentId: 'enrol-1',
      threads: [thread({ sectorCourseCode: 'spa_for_eng_health', active: true, currentCycleIndex: 9, completedPodRounds: 2 })],
    }))
    const s = useSectorThread(async () => 'tok')
    await s.loadThreads('spa_for_eng')

    fetchMock.mockResolvedValueOnce(ok({
      enrollmentId: 'enrol-1',
      thread: thread({ sectorCourseCode: 'spa_for_eng_trades', active: true }),
    }))
    const chosen = await s.chooseSector('spa_for_eng', 'spa_for_eng_trades')

    expect(chosen.sectorCourseCode).toBe('spa_for_eng_trades')
    expect(s.threads.value).toHaveLength(2)
    const parked = s.threads.value.find((t) => t.sectorCourseCode === 'spa_for_eng_health')!
    expect(parked.active).toBe(false)
    expect(parked.currentCycleIndex).toBe(9)
    expect(parked.completedPodRounds).toBe(2)
    expect(s.activeThread.value?.sectorCourseCode).toBe('spa_for_eng_trades')
  })

  it('defaults the role to general', async () => {
    fetchMock.mockResolvedValue(ok({ enrollmentId: 'enrol-1', thread: thread() }))
    const s = useSectorThread(async () => 'tok')
    await s.chooseSector('spa_for_eng', 'spa_for_eng_health')
    const body = JSON.parse(fetchMock.mock.calls[0][1].body)
    expect(body.role).toBe('general')
    expect(body.active).toBe(true)
  })

  it('setThreadActive(false) parks without losing the chosen role', async () => {
    fetchMock.mockResolvedValueOnce(ok({
      enrollmentId: 'enrol-1',
      threads: [thread({ role: 'nurse', active: true })],
    }))
    const s = useSectorThread(async () => 'tok')
    await s.loadThreads('spa_for_eng')

    fetchMock.mockResolvedValueOnce(ok({
      enrollmentId: 'enrol-1',
      thread: thread({ role: 'nurse', active: false }),
    }))
    await s.setThreadActive('spa_for_eng', 'spa_for_eng_health', false)

    const body = JSON.parse(fetchMock.mock.calls[1][1].body)
    expect(body.role).toBe('nurse')
    expect(body.active).toBe(false)
    expect(s.activeThread.value).toBeNull()
    expect(s.threads.value).toHaveLength(1)
  })

  it('a failed write throws — a silently-unsaved choice is worse than a visible failure', async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 400, json: async () => ({ error: 'Unknown sector for this course' }) })
    const s = useSectorThread(async () => 'tok')
    await expect(s.chooseSector('spa_for_eng', 'nope')).rejects.toThrow('Unknown sector for this course')
  })

  it('sends the bearer token on the learner-scoped calls only', async () => {
    fetchMock.mockResolvedValue(ok({ sectors: [] }))
    const s = useSectorThread(async () => 'tok')
    await s.loadSectors('spa_for_eng')
    expect(fetchMock.mock.calls[0][1]).toBeUndefined()

    fetchMock.mockResolvedValue(ok({ enrollmentId: null, threads: [] }))
    await s.loadThreads('spa_for_eng')
    expect(fetchMock.mock.calls[1][1].headers.Authorization).toBe('Bearer tok')
  })
})
