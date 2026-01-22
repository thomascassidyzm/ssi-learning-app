import { describe, it, expect } from 'vitest'
import { validateCycle, validateSession } from './validateCycle'
import type { Cycle, CachedAudio } from '../types/Cycle'

describe('validateCycle', () => {
  const mockCycle: Cycle = {
    id: 'cycle-1',
    seedId: 'S0001',
    legoId: 'S0001L01',
    type: 'debut',
    known: {
      text: 'I want to learn',
      audioId: 'audio-known-1',
      durationMs: 2000
    },
    target: {
      text: 'Quiero aprender',
      voice1AudioId: 'audio-target1-1',
      voice1DurationMs: 1800,
      voice2AudioId: 'audio-target2-1',
      voice2DurationMs: 1900
    },
    pauseDurationMs: 3600
  }

  const mockAudioCache = new Map<string, CachedAudio>([
    ['audio-known-1', { id: 'audio-known-1', durationMs: 2000, checksum: 'abc123' }],
    ['audio-target1-1', { id: 'audio-target1-1', durationMs: 1800, checksum: 'def456' }],
    ['audio-target2-1', { id: 'audio-target2-1', durationMs: 1900, checksum: 'ghi789' }]
  ])

  it('should return ready: true when all audio files are cached', () => {
    const result = validateCycle(mockCycle, mockAudioCache)
    expect(result).toEqual({ ready: true })
  })

  it('should return missing audio IDs when known audio is not cached', () => {
    const cacheWithoutKnown = new Map(mockAudioCache)
    cacheWithoutKnown.delete('audio-known-1')

    const result = validateCycle(mockCycle, cacheWithoutKnown)
    expect(result).toEqual({
      ready: false,
      missing: ['audio-known-1']
    })
  })

  it('should return missing audio IDs when target voice 1 is not cached', () => {
    const cacheWithoutTarget1 = new Map(mockAudioCache)
    cacheWithoutTarget1.delete('audio-target1-1')

    const result = validateCycle(mockCycle, cacheWithoutTarget1)
    expect(result).toEqual({
      ready: false,
      missing: ['audio-target1-1']
    })
  })

  it('should return missing audio IDs when target voice 2 is not cached', () => {
    const cacheWithoutTarget2 = new Map(mockAudioCache)
    cacheWithoutTarget2.delete('audio-target2-1')

    const result = validateCycle(mockCycle, cacheWithoutTarget2)
    expect(result).toEqual({
      ready: false,
      missing: ['audio-target2-1']
    })
  })

  it('should return all missing audio IDs when multiple are not cached', () => {
    const emptyCache = new Map<string, CachedAudio>()

    const result = validateCycle(mockCycle, emptyCache)
    expect(result).toEqual({
      ready: false,
      missing: ['audio-known-1', 'audio-target1-1', 'audio-target2-1']
    })
  })
})

describe('validateSession', () => {
  const mockCycles: Cycle[] = [
    {
      id: 'cycle-1',
      seedId: 'S0001',
      legoId: 'S0001L01',
      type: 'debut',
      known: {
        text: 'I want to learn',
        audioId: 'audio-known-1',
        durationMs: 2000
      },
      target: {
        text: 'Quiero aprender',
        voice1AudioId: 'audio-target1-1',
        voice1DurationMs: 1800,
        voice2AudioId: 'audio-target2-1',
        voice2DurationMs: 1900
      },
      pauseDurationMs: 3600
    },
    {
      id: 'cycle-2',
      seedId: 'S0002',
      legoId: 'S0002L01',
      type: 'practice',
      known: {
        text: 'I need',
        audioId: 'audio-known-2',
        durationMs: 1500
      },
      target: {
        text: 'Necesito',
        voice1AudioId: 'audio-target1-2',
        voice1DurationMs: 1400,
        voice2AudioId: 'audio-target2-2',
        voice2DurationMs: 1450
      },
      pauseDurationMs: 2800
    }
  ]

  const completeCache = new Map<string, CachedAudio>([
    ['audio-known-1', { id: 'audio-known-1', durationMs: 2000, checksum: 'abc123' }],
    ['audio-target1-1', { id: 'audio-target1-1', durationMs: 1800, checksum: 'def456' }],
    ['audio-target2-1', { id: 'audio-target2-1', durationMs: 1900, checksum: 'ghi789' }],
    ['audio-known-2', { id: 'audio-known-2', durationMs: 1500, checksum: 'jkl012' }],
    ['audio-target1-2', { id: 'audio-target1-2', durationMs: 1400, checksum: 'mno345' }],
    ['audio-target2-2', { id: 'audio-target2-2', durationMs: 1450, checksum: 'pqr678' }]
  ])

  it('should return ready: true when all cycles have complete audio', () => {
    const result = validateSession(mockCycles, completeCache)
    expect(result).toEqual({ ready: true })
  })

  it('should return all missing audio IDs when one cycle is incomplete', () => {
    const incompleteCache = new Map(completeCache)
    incompleteCache.delete('audio-target1-2')
    incompleteCache.delete('audio-target2-2')

    const result = validateSession(mockCycles, incompleteCache)
    expect(result).toEqual({
      ready: false,
      missing: ['audio-target1-2', 'audio-target2-2']
    })
  })

  it('should aggregate missing IDs from multiple incomplete cycles', () => {
    const sparseCache = new Map<string, CachedAudio>([
      ['audio-known-1', { id: 'audio-known-1', durationMs: 2000, checksum: 'abc123' }],
      ['audio-target1-1', { id: 'audio-target1-1', durationMs: 1800, checksum: 'def456' }]
    ])

    const result = validateSession(mockCycles, sparseCache)
    expect(result).toEqual({
      ready: false,
      missing: ['audio-target2-1', 'audio-known-2', 'audio-target1-2', 'audio-target2-2']
    })
  })

  it('should return ready: true for empty session', () => {
    const result = validateSession([], completeCache)
    expect(result).toEqual({ ready: true })
  })

  it('should not duplicate missing audio IDs', () => {
    const cycleWithDuplicateAudio: Cycle[] = [
      mockCycles[0],
      {
        ...mockCycles[0],
        id: 'cycle-1-repeat'
      }
    ]

    const incompleteCache = new Map<string, CachedAudio>([
      ['audio-known-1', { id: 'audio-known-1', durationMs: 2000, checksum: 'abc123' }]
    ])

    const result = validateSession(cycleWithDuplicateAudio, incompleteCache)
    expect(result).toEqual({
      ready: false,
      missing: ['audio-target1-1', 'audio-target2-1']
    })
  })
})
