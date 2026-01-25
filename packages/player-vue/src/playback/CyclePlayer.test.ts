/**
 * CyclePlayer Tests
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { createCyclePlayer, type CyclePlayer } from './CyclePlayer'
import type { Cycle } from '../types/Cycle'
import type { CycleEventData, AudioSource } from './types'

// Mock Audio element
const mockAudio = {
  play: vi.fn().mockResolvedValue(undefined),
  pause: vi.fn(),
  load: vi.fn(),
  addEventListener: vi.fn(),
  removeEventListener: vi.fn(),
  src: '',
  currentTime: 0,
}

// Replace global Audio
vi.stubGlobal('Audio', vi.fn(() => mockAudio))
vi.stubGlobal('URL', {
  createObjectURL: vi.fn(() => 'blob:mock'),
  revokeObjectURL: vi.fn(),
})

describe('CyclePlayer', () => {
  let player: CyclePlayer

  const mockCycle: Cycle = {
    id: 'test-cycle-1',
    seedId: 'S001',
    legoId: 'L001',
    type: 'practice',
    known: {
      text: 'Hello',
      audioId: 'audio-known-1',
      durationMs: 1000,
    },
    target: {
      text: 'Hola',
      voice1AudioId: 'audio-target-1a',
      voice1DurationMs: 1500,
      voice2AudioId: 'audio-target-1b',
      voice2DurationMs: 1500,
    },
    pauseDurationMs: 3000,
  }

  const mockGetAudioSource = vi.fn().mockImplementation((audioId: string): Promise<AudioSource | null> => {
    return Promise.resolve({ type: 'blob', blob: new Blob(['audio']) })
  })

  beforeEach(() => {
    vi.clearAllMocks()
    player = createCyclePlayer()
  })

  afterEach(() => {
    player.dispose()
  })

  it('should initialize in idle state', () => {
    expect(player.state.value.phase).toBe('idle')
    expect(player.state.value.isPlaying).toBe(false)
    expect(player.state.value.error).toBeNull()
  })

  it('should emit events in correct order', async () => {
    const events: CycleEventData[] = []
    player.on((event) => events.push(event))

    // Simulate audio ending immediately for testing
    mockAudio.addEventListener.mockImplementation((event: string, handler: () => void, options?: any) => {
      if (event === 'ended') {
        // Call handler immediately to simulate instant audio
        setTimeout(() => handler(), 0)
      }
    })

    // Start cycle playback but don't await (it will hang on pause)
    const playPromise = player.playCycle(mockCycle, mockGetAudioSource)

    // Wait a tick for first events
    await new Promise(resolve => setTimeout(resolve, 10))

    // Should have started with prompt phase
    expect(events[0]?.type).toBe('phase:prompt')
    expect(events[0]?.phase).toBe('prompt')

    // Stop playback to clean up
    player.stop()
  })

  it('should handle stop during playback', () => {
    // Start playback
    player.playCycle(mockCycle, mockGetAudioSource)

    // Immediately stop
    player.stop()

    expect(player.state.value.phase).toBe('idle')
    expect(player.state.value.isPlaying).toBe(false)
  })

  it('should handle audio source errors', async () => {
    const failingGetAudio = vi.fn().mockResolvedValue(null)
    const events: CycleEventData[] = []
    player.on((event) => events.push(event))

    await expect(player.playCycle(mockCycle, failingGetAudio)).rejects.toThrow('Known audio not found')

    const errorEvent = events.find(e => e.type === 'cycle:error')
    expect(errorEvent).toBeDefined()
    expect(player.state.value.error).toContain('not found')
  })

  it('should allow subscribing and unsubscribing from events', () => {
    const handler = vi.fn()

    player.on(handler)
    expect(handler).not.toHaveBeenCalled()

    player.off(handler)
    // Handler removed, no assertions needed - just verifying no error
  })

  it('should cleanup blob URLs', async () => {
    // Start playback to create blob URL
    player.playCycle(mockCycle, mockGetAudioSource)

    // Wait a tick
    await new Promise(resolve => setTimeout(resolve, 10))

    // Stop should cleanup
    player.stop()

    // URL.revokeObjectURL should have been called
    expect(URL.revokeObjectURL).toHaveBeenCalled()
  })
})

describe('CyclePlayer - State Transitions', () => {
  let player: CyclePlayer

  const mockCycle: Cycle = {
    id: 'test-cycle',
    seedId: 'S001',
    legoId: 'L001',
    type: 'practice',
    known: { text: 'Hello', audioId: 'a1', durationMs: 1000 },
    target: { text: 'Hola', voice1AudioId: 'a2', voice1DurationMs: 1000, voice2AudioId: 'a3', voice2DurationMs: 1000 },
    pauseDurationMs: 2000,
  }

  beforeEach(() => {
    vi.clearAllMocks()
    player = createCyclePlayer()
  })

  afterEach(() => {
    player.dispose()
  })

  it('should set isPlaying to true when starting', async () => {
    const mockGetAudio = vi.fn().mockResolvedValue({ type: 'blob', blob: new Blob([]) })

    // Start playback
    player.playCycle(mockCycle, mockGetAudio)

    // Should be playing (phase may vary based on timing)
    await new Promise(resolve => setTimeout(resolve, 5))
    expect(player.state.value.isPlaying).toBe(true)

    player.stop()
  })

  it('should store current cycle in state', async () => {
    const mockGetAudio = vi.fn().mockResolvedValue({ type: 'blob', blob: new Blob([]) })

    player.playCycle(mockCycle, mockGetAudio)
    await new Promise(resolve => setTimeout(resolve, 5))

    // Use toStrictEqual for deep equality comparison
    expect(player.state.value.currentCycle).toStrictEqual(mockCycle)

    player.stop()
  })
})
