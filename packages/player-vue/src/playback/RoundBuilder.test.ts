/**
 * RoundBuilder Tests
 */

import { describe, it, expect, beforeEach } from 'vitest'
import { buildRound, buildSimpleRound, applyConfig, getPlayableItems } from './RoundBuilder'
import { createThreadManager } from './ThreadManager'
import { DEFAULT_PLAYBACK_CONFIG, createPlaybackConfig } from './PlaybackConfig'
import type { LegoPair, SeedPair, ClassifiedBasket, PracticePhrase } from '@ssi/core'

describe('RoundBuilder', () => {
  const createMockPhrase = (id: string, known: string, target: string): PracticePhrase => ({
    id,
    phraseType: 'practice',
    phrase: { known, target },
    audioRefs: {
      known: { id: `audio-known-${id}`, url: '', duration_ms: 1000 },
      target: {
        voice1: { id: `audio-t1-${id}`, url: '', duration_ms: 1500 },
        voice2: { id: `audio-t2-${id}`, url: '', duration_ms: 1500 },
      },
    },
    wordCount: target.split(' ').length,
    containsLegos: ['L1'],
  })

  const mockLego: LegoPair = {
    id: 'L1',
    type: 'A',
    new: true,
    lego: { known: 'hello', target: 'hola' },
    audioRefs: {
      known: { id: 'audio-known-L1', url: '', duration_ms: 1000 },
      target: {
        voice1: { id: 'audio-t1-L1', url: '', duration_ms: 1500 },
        voice2: { id: 'audio-t2-L1', url: '', duration_ms: 1500 },
      },
    },
  }

  const mockSeed: SeedPair = {
    seed_id: 'S1',
    seed_pair: { known: 'Hello, how are you?', target: 'Hola, como estas?' },
    legos: [mockLego],
  }

  const mockBasket: ClassifiedBasket = {
    lego_id: 'L1',
    components: [],
    debut: createMockPhrase('debut-1', 'hello', 'hola'),
    debut_phrases: [
      createMockPhrase('build-1', 'I say hello', 'Digo hola'),
      createMockPhrase('build-2', 'He says hello', 'El dice hola'),
      createMockPhrase('build-3', 'She says hello', 'Ella dice hola'),
    ],
    eternal_phrases: [
      createMockPhrase('eternal-1', 'We all say hello', 'Todos decimos hola'),
      createMockPhrase('eternal-2', 'They say hello', 'Ellos dicen hola'),
    ],
    introduction_audio: { id: 'intro-audio', url: '', duration_ms: 3000 },
  }

  let threadManager: ReturnType<typeof createThreadManager>

  beforeEach(() => {
    threadManager = createThreadManager()
    threadManager.initialize([mockLego], 'test-course')
  })

  describe('buildRound', () => {
    it('should create a round with all phases', () => {
      const round = buildRound(
        mockLego,
        mockSeed,
        mockBasket,
        'A',
        1,
        threadManager,
        DEFAULT_PLAYBACK_CONFIG
      )

      expect(round.legoId).toBe('L1')
      expect(round.thread).toBe('A')
      expect(round.roundNumber).toBe(1)
      expect(round.items.length).toBeGreaterThan(0)
    })

    it('should include intro when not skipped', () => {
      const round = buildRound(
        mockLego,
        mockSeed,
        mockBasket,
        'A',
        1,
        threadManager,
        DEFAULT_PLAYBACK_CONFIG
      )

      const introItem = round.items.find(item => item.type === 'intro')
      expect(introItem).toBeDefined()
      expect(introItem?.playable).toBe(true)
    })

    it('should mark intro as not playable when skipIntros is true', () => {
      const config = createPlaybackConfig({ skipIntros: true })
      const round = buildRound(mockLego, mockSeed, mockBasket, 'A', 1, threadManager, config)

      const introItem = round.items.find(item => item.type === 'intro')
      expect(introItem?.playable).toBe(false)
    })

    it('should include debut item', () => {
      const round = buildRound(
        mockLego,
        mockSeed,
        mockBasket,
        'A',
        1,
        threadManager,
        DEFAULT_PLAYBACK_CONFIG
      )

      const debutItem = round.items.find(item => item.type === 'debut')
      expect(debutItem).toBeDefined()
      expect(debutItem?.cycle).toBeDefined()
      expect(debutItem?.cycle?.known.text).toBe('hello')
    })

    it('should include practice (BUILD) items', () => {
      const round = buildRound(
        mockLego,
        mockSeed,
        mockBasket,
        'A',
        1,
        threadManager,
        DEFAULT_PLAYBACK_CONFIG
      )

      const practiceItems = round.items.filter(item => item.type === 'practice')
      expect(practiceItems.length).toBe(3) // All debut_phrases
    })

    it('should respect maxBuildPhrases config', () => {
      const config = createPlaybackConfig({ maxBuildPhrases: 2 })
      const round = buildRound(mockLego, mockSeed, mockBasket, 'A', 1, threadManager, config)

      const practiceItems = round.items.filter(item => item.type === 'practice')
      expect(practiceItems.length).toBe(2)
    })

    it('should include consolidation items', () => {
      const config = createPlaybackConfig({ consolidationCount: 2 })
      const round = buildRound(mockLego, mockSeed, mockBasket, 'A', 1, threadManager, config)

      const consolidationItems = round.items.filter(item => item.type === 'consolidation')
      expect(consolidationItems.length).toBe(2)
    })
  })

  describe('buildSimpleRound', () => {
    it('should create a minimal round without basket', () => {
      const round = buildSimpleRound(mockLego, mockSeed, 'A', 1)

      expect(round.legoId).toBe('L1')
      expect(round.items.length).toBe(1)
      expect(round.items[0].type).toBe('debut')
      expect(round.playableCount).toBe(1)
    })
  })

  describe('applyConfig', () => {
    it('should update playable flags based on config', () => {
      const round = buildRound(
        mockLego,
        mockSeed,
        mockBasket,
        'A',
        1,
        threadManager,
        DEFAULT_PLAYBACK_CONFIG
      )

      // Initially intro is playable
      expect(round.items.find(i => i.type === 'intro')?.playable).toBe(true)

      // Apply turbo config
      const turboConfig = createPlaybackConfig({ turboMode: true })
      const updatedRound = applyConfig(round, turboConfig)

      // Intro should now be not playable
      expect(updatedRound.items.find(i => i.type === 'intro')?.playable).toBe(false)
    })

    it('should update playableCount', () => {
      const round = buildRound(
        mockLego,
        mockSeed,
        mockBasket,
        'A',
        1,
        threadManager,
        DEFAULT_PLAYBACK_CONFIG
      )

      const originalCount = round.playableCount

      const turboConfig = createPlaybackConfig({ turboMode: true })
      const updatedRound = applyConfig(round, turboConfig)

      expect(updatedRound.playableCount).toBe(originalCount - 1) // Minus intro
    })
  })

  describe('getPlayableItems', () => {
    it('should return only playable items', () => {
      const round = buildRound(
        mockLego,
        mockSeed,
        mockBasket,
        'A',
        1,
        threadManager,
        DEFAULT_PLAYBACK_CONFIG
      )

      const playable = getPlayableItems(round)
      expect(playable.every(item => item.playable)).toBe(true)
    })

    it('should filter out non-playable items', () => {
      const config = createPlaybackConfig({ skipIntros: true })
      const round = buildRound(mockLego, mockSeed, mockBasket, 'A', 1, threadManager, config)

      const playable = getPlayableItems(round)
      expect(playable.find(item => item.type === 'intro')).toBeUndefined()
    })
  })
})
