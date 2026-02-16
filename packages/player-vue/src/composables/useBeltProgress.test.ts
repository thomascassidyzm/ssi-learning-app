/**
 * Tests for WI-1: Cross-Device Resume
 *
 * Verifies that useBeltProgress correctly syncs lastLegoId to/from Supabase
 * and merges local + remote progress taking the furthest position.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { useBeltProgress, getSeedFromLegoId, getBeltIndexForSeed } from './useBeltProgress'

// Mock localStorage
const localStorageMock = (() => {
  let store: Record<string, string> = {}
  return {
    getItem: vi.fn((key: string) => store[key] ?? null),
    setItem: vi.fn((key: string, value: string) => { store[key] = value }),
    removeItem: vi.fn((key: string) => { delete store[key] }),
    clear: vi.fn(() => { store = {} }),
  }
})()

Object.defineProperty(globalThis, 'localStorage', { value: localStorageMock })

// ============================================================================
// HELPER TESTS
// ============================================================================

describe('getSeedFromLegoId', () => {
  it('parses seed number from LEGO ID', () => {
    expect(getSeedFromLegoId('S0045L03')).toBe(45)
    expect(getSeedFromLegoId('S0001L01')).toBe(1)
    expect(getSeedFromLegoId('S0668L05')).toBe(668)
  })

  it('returns null for invalid/null input', () => {
    expect(getSeedFromLegoId(null)).toBeNull()
    expect(getSeedFromLegoId('')).toBeNull()
    expect(getSeedFromLegoId('invalid')).toBeNull()
  })
})

describe('getBeltIndexForSeed', () => {
  it('returns correct belt for seed thresholds', () => {
    expect(getBeltIndexForSeed(0)).toBe(0)   // White
    expect(getBeltIndexForSeed(7)).toBe(0)   // Still white
    expect(getBeltIndexForSeed(8)).toBe(1)   // Yellow
    expect(getBeltIndexForSeed(19)).toBe(1)  // Still yellow
    expect(getBeltIndexForSeed(20)).toBe(2)  // Orange
    expect(getBeltIndexForSeed(40)).toBe(3)  // Green
    expect(getBeltIndexForSeed(80)).toBe(4)  // Blue
    expect(getBeltIndexForSeed(150)).toBe(5) // Purple
    expect(getBeltIndexForSeed(280)).toBe(6) // Brown
    expect(getBeltIndexForSeed(400)).toBe(7) // Black
  })
})

// ============================================================================
// useBeltProgress (localStorage-only, no Supabase)
// ============================================================================

describe('useBeltProgress - local only', () => {
  beforeEach(() => {
    localStorageMock.clear()
    vi.clearAllMocks()
  })

  it('initializes with empty state', () => {
    const bp = useBeltProgress('test_course')
    bp.initializeSync()

    expect(bp.highestBeltIndex.value).toBe(0)
    expect(bp.lastLegoId.value).toBeNull()
    expect(bp.highestLegoId.value).toBeNull()
    expect(bp.currentBelt.value.name).toBe('white')
  })

  it('updates lastLegoId and highestLegoId on setLastLegoId', () => {
    const bp = useBeltProgress('test_course')
    bp.initializeSync()

    bp.setLastLegoId('S0005L02')
    expect(bp.lastLegoId.value).toBe('S0005L02')
    expect(bp.highestLegoId.value).toBe('S0005L02')
  })

  it('highestLegoId only goes forward', () => {
    const bp = useBeltProgress('test_course')
    bp.initializeSync()

    bp.setLastLegoId('S0020L01')
    bp.setLastLegoId('S0010L01') // Go backwards

    expect(bp.lastLegoId.value).toBe('S0010L01')  // lastLegoId tracks current position
    expect(bp.highestLegoId.value).toBe('S0020L01') // highestLegoId stays at high-water mark
  })

  it('triggers belt promotion when crossing threshold', () => {
    const bp = useBeltProgress('test_course')
    bp.initializeSync()

    expect(bp.highestBeltIndex.value).toBe(0) // White

    bp.setLastLegoId('S0008L01') // Seed 8 = yellow belt
    expect(bp.highestBeltIndex.value).toBe(1) // Yellow

    bp.setLastLegoId('S0020L01') // Seed 20 = orange belt
    expect(bp.highestBeltIndex.value).toBe(2) // Orange
  })

  it('persists and loads from localStorage', () => {
    const bp1 = useBeltProgress('test_persist')
    bp1.initializeSync()
    bp1.setLastLegoId('S0045L03')

    // Create a new instance — should load from localStorage
    const bp2 = useBeltProgress('test_persist')
    bp2.initializeSync()

    expect(bp2.lastLegoId.value).toBe('S0045L03')
    expect(bp2.highestLegoId.value).toBe('S0045L03')
  })

  it('currentSeedNumber computed returns correct seed', () => {
    const bp = useBeltProgress('test_course')
    bp.initializeSync()
    bp.setLastLegoId('S0045L03')

    expect(bp.currentSeedNumber.value).toBe(45)
  })
})

// ============================================================================
// useBeltProgress - Supabase sync
// ============================================================================

describe('useBeltProgress - Supabase sync', () => {
  let mockSupabase: any

  beforeEach(() => {
    localStorageMock.clear()
    vi.clearAllMocks()
    vi.useFakeTimers()

    mockSupabase = {
      from: vi.fn().mockReturnThis(),
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      maybeSingle: vi.fn(),
      upsert: vi.fn(),
      update: vi.fn().mockReturnThis(),
    }
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('fetchRemoteProgress returns belt index and lastLegoId', async () => {
    mockSupabase.maybeSingle.mockResolvedValue({
      data: { highest_completed_seed: 45, last_completed_lego_id: 'S0045L03' },
      error: null,
    })

    const bp = useBeltProgress('test_sync', {
      supabase: mockSupabase,
      learnerId: 'user-123',
    })
    bp.initializeSync()

    // mergeProgress calls fetchRemoteProgress internally
    await bp.mergeProgress()

    // Remote was at seed 45 (green belt), local is at 0 — remote wins
    expect(bp.highestLegoId.value).toBe('S0045L03')
    expect(bp.lastLegoId.value).toBe('S0045L03')
  })

  it('mergeProgress takes highest of local vs remote belt', async () => {
    // Local: seed 60 (green, belt index 3)
    localStorageMock.setItem(
      'ssi_belt_progress_test_merge',
      JSON.stringify({
        highestBeltIndex: 3,
        lastLegoId: 'S0060L01',
        highestLegoId: 'S0060L01',
        lastUpdated: Date.now(),
      })
    )

    // Remote: seed 20 (orange, belt index 2) — behind local
    mockSupabase.maybeSingle.mockResolvedValue({
      data: { highest_completed_seed: 20, last_completed_lego_id: 'S0020L01' },
      error: null,
    })
    mockSupabase.upsert.mockResolvedValue({ error: null })

    const bp = useBeltProgress('test_merge', {
      supabase: mockSupabase,
      learnerId: 'user-123',
    })
    bp.initializeSync()

    await bp.mergeProgress()

    // Local was ahead — should keep local values
    expect(bp.highestBeltIndex.value).toBe(3) // Green (local)
    expect(bp.highestLegoId.value).toBe('S0060L01') // Local legoId
  })

  it('mergeProgress takes remote legoId when remote is ahead', async () => {
    // Local: seed 20
    localStorageMock.setItem(
      'ssi_belt_progress_test_remote_ahead',
      JSON.stringify({
        highestBeltIndex: 2,
        lastLegoId: 'S0020L01',
        highestLegoId: 'S0020L01',
        lastUpdated: Date.now(),
      })
    )

    // Remote: seed 100 — ahead of local
    mockSupabase.maybeSingle.mockResolvedValue({
      data: { highest_completed_seed: 100, last_completed_lego_id: 'S0100L02' },
      error: null,
    })

    const bp = useBeltProgress('test_remote_ahead', {
      supabase: mockSupabase,
      learnerId: 'user-123',
    })
    bp.initializeSync()

    await bp.mergeProgress()

    expect(bp.highestLegoId.value).toBe('S0100L02')
    expect(bp.lastLegoId.value).toBe('S0100L02')
    expect(bp.highestBeltIndex.value).toBe(4) // Blue (seed 100 > 80 threshold)
  })

  it('syncToRemote includes last_completed_lego_id', async () => {
    mockSupabase.upsert.mockResolvedValue({ error: null })

    const bp = useBeltProgress('test_sync_out', {
      supabase: mockSupabase,
      learnerId: 'user-123',
    })
    bp.initializeSync()
    bp.setLastLegoId('S0045L03')

    await bp.syncToRemote(bp.highestBeltIndex.value)

    // Verify upsert was called with last_completed_lego_id
    expect(mockSupabase.from).toHaveBeenCalledWith('course_enrollments')
    const upsertCall = mockSupabase.upsert.mock.calls[0][0]
    expect(upsertCall.last_completed_lego_id).toBe('S0045L03')
    expect(upsertCall.learner_id).toBe('user-123')
    expect(upsertCall.course_id).toBe('test_sync_out')
  })

  it('setLastLegoId triggers debounced remote sync', async () => {
    mockSupabase.upsert.mockResolvedValue({ error: null })

    const bp = useBeltProgress('test_debounce', {
      supabase: mockSupabase,
      learnerId: 'user-123',
    })
    bp.initializeSync()

    bp.setLastLegoId('S0005L01')
    bp.setLastLegoId('S0006L01')
    bp.setLastLegoId('S0007L01')

    // Should NOT have synced yet (debounced 30s)
    expect(mockSupabase.upsert).not.toHaveBeenCalled()

    // Advance 30 seconds
    vi.advanceTimersByTime(30000)

    // Now it should have synced once (not three times)
    expect(mockSupabase.from).toHaveBeenCalledWith('course_enrollments')
  })

  it('endSession flushes debounced sync immediately', async () => {
    mockSupabase.upsert.mockResolvedValue({ error: null })

    const bp = useBeltProgress('test_flush', {
      supabase: mockSupabase,
      learnerId: 'user-123',
    })
    bp.initializeSync()

    bp.startSession(1)
    bp.setLastLegoId('S0010L01')

    // End session — should flush immediately without waiting 30s
    bp.endSession(10, 5)

    expect(mockSupabase.from).toHaveBeenCalledWith('course_enrollments')
  })

  it('does not sync for guest users', () => {
    const bp = useBeltProgress('test_guest', {
      supabase: mockSupabase,
      learnerId: 'guest-abc123',
    })
    bp.initializeSync()

    expect(bp.canSync()).toBe(false)

    bp.setLastLegoId('S0005L01')
    vi.advanceTimersByTime(30000)

    // No Supabase calls for guests
    expect(mockSupabase.from).not.toHaveBeenCalled()
  })
})
