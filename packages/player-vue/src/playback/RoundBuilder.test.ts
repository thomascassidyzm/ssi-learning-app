/**
 * RoundBuilder Tests
 */

import { describe, it, expect } from 'vitest'
import { buildRound, buildRounds, calculateSpacedRepReviews, type BuildRoundOptions } from './RoundBuilder'
import { DEFAULT_PLAYBACK_CONFIG, createPlaybackConfig } from './PlaybackConfig'
import type { LegoPair, SeedPair, ClassifiedBasket, PracticePhrase } from '@ssi/core'

describe('RoundBuilder', () => {
  const buildAudioUrl = (id: string) => `/api/audio/${id}`

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

  describe('buildRound', () => {
    it('should create a round with correct structure', () => {
      const round = buildRound({
        lego: mockLego,
        seed: mockSeed,
        basket: mockBasket,
        legoIndex: 1,
        roundNumber: 1,
        config: DEFAULT_PLAYBACK_CONFIG,
        buildAudioUrl,
      })

      expect(round.legoId).toBe('L1')
      expect(round.legoIndex).toBe(1)
      expect(round.seedId).toBe('S1')
      expect(round.roundNumber).toBe(1)
      expect(round.items.length).toBeGreaterThan(0)
    })

    it('should include intro when basket has introduction_audio', () => {
      const round = buildRound({
        lego: mockLego,
        seed: mockSeed,
        basket: mockBasket,
        legoIndex: 1,
        roundNumber: 1,
        config: DEFAULT_PLAYBACK_CONFIG,
        buildAudioUrl,
      })

      const introItem = round.items.find(item => item.type === 'intro')
      expect(introItem).toBeDefined()
      expect(introItem?.presentationAudio?.url).toBe('/api/audio/intro-audio')
    })

    it('should skip intro when skipIntros is true', () => {
      const config = createPlaybackConfig({ skipIntros: true })
      const round = buildRound({
        lego: mockLego,
        seed: mockSeed,
        basket: mockBasket,
        legoIndex: 1,
        roundNumber: 1,
        config,
        buildAudioUrl,
      })

      const introItem = round.items.find(item => item.type === 'intro')
      expect(introItem).toBeUndefined()
    })

    it('should skip intro when turboMode is true', () => {
      const config = createPlaybackConfig({ turboMode: true })
      const round = buildRound({
        lego: mockLego,
        seed: mockSeed,
        basket: mockBasket,
        legoIndex: 1,
        roundNumber: 1,
        config,
        buildAudioUrl,
      })

      const introItem = round.items.find(item => item.type === 'intro')
      expect(introItem).toBeUndefined()
    })

    it('should include debut item', () => {
      const round = buildRound({
        lego: mockLego,
        seed: mockSeed,
        basket: mockBasket,
        legoIndex: 1,
        roundNumber: 1,
        config: DEFAULT_PLAYBACK_CONFIG,
        buildAudioUrl,
      })

      const debutItem = round.items.find(item => item.type === 'debut')
      expect(debutItem).toBeDefined()
      expect(debutItem?.knownText).toBe('hello')
      expect(debutItem?.targetText).toBe('hola')
    })

    it('should include debut_phrase (BUILD) items', () => {
      const round = buildRound({
        lego: mockLego,
        seed: mockSeed,
        basket: mockBasket,
        legoIndex: 1,
        roundNumber: 1,
        config: DEFAULT_PLAYBACK_CONFIG,
        buildAudioUrl,
      })

      const buildItems = round.items.filter(item => item.type === 'debut_phrase')
      expect(buildItems.length).toBe(3)
    })

    it('should respect maxBuildPhrases config', () => {
      const config = createPlaybackConfig({ maxBuildPhrases: 2 })
      const round = buildRound({
        lego: mockLego,
        seed: mockSeed,
        basket: mockBasket,
        legoIndex: 1,
        roundNumber: 1,
        config,
        buildAudioUrl,
      })

      const buildItems = round.items.filter(item => item.type === 'debut_phrase')
      expect(buildItems.length).toBe(2)
    })

    it('should include consolidation items', () => {
      const round = buildRound({
        lego: mockLego,
        seed: mockSeed,
        basket: mockBasket,
        legoIndex: 1,
        roundNumber: 1,
        config: DEFAULT_PLAYBACK_CONFIG,
        buildAudioUrl,
      })

      const consolidationItems = round.items.filter(item => item.type === 'consolidation')
      expect(consolidationItems.length).toBe(2)
    })

    it('should build audio URLs correctly', () => {
      const round = buildRound({
        lego: mockLego,
        seed: mockSeed,
        basket: mockBasket,
        legoIndex: 1,
        roundNumber: 1,
        config: DEFAULT_PLAYBACK_CONFIG,
        buildAudioUrl,
      })

      const debutItem = round.items.find(item => item.type === 'debut')
      expect(debutItem?.audioRefs.known.url).toMatch(/^\/api\/audio\//)
      expect(debutItem?.audioRefs.target.voice1.url).toMatch(/^\/api\/audio\//)
    })

    it('should work without basket (fallback mode)', () => {
      const round = buildRound({
        lego: mockLego,
        seed: mockSeed,
        basket: null,
        legoIndex: 1,
        roundNumber: 1,
        config: DEFAULT_PLAYBACK_CONFIG,
        buildAudioUrl,
      })

      expect(round.items.length).toBe(1) // Just debut
      expect(round.items[0].type).toBe('debut')
      expect(round.items[0].knownText).toBe('hello')
    })
  })

  describe('calculateSpacedRepReviews', () => {
    it('should return empty array for round 1', () => {
      const reviews = calculateSpacedRepReviews(1)
      expect(reviews.length).toBe(0)
    })

    it('should return LEGO 1 for round 2 (N-1)', () => {
      const reviews = calculateSpacedRepReviews(2)
      expect(reviews.length).toBe(1)
      expect(reviews[0].legoIndex).toBe(1)
      expect(reviews[0].fibPosition).toBe(0) // First Fibonacci position
    })

    it('should return multiple LEGOs for later rounds', () => {
      const reviews = calculateSpacedRepReviews(5)
      // N-1=4, N-2=3, N-3=2
      expect(reviews.length).toBe(3)
      expect(reviews.map(r => r.legoIndex)).toContain(4)
      expect(reviews.map(r => r.legoIndex)).toContain(3)
      expect(reviews.map(r => r.legoIndex)).toContain(2)
    })

    it('should not include duplicates', () => {
      const reviews = calculateSpacedRepReviews(10)
      const indices = reviews.map(r => r.legoIndex)
      const uniqueIndices = [...new Set(indices)]
      expect(indices.length).toBe(uniqueIndices.length)
    })
  })

  describe('buildRounds', () => {
    it('should build multiple rounds', () => {
      const legos = [mockLego, { ...mockLego, id: 'L2' }, { ...mockLego, id: 'L3' }]
      const baskets = new Map<string, ClassifiedBasket>()
      baskets.set('L1', mockBasket)

      const rounds = buildRounds(
        legos,
        [mockSeed],
        baskets,
        DEFAULT_PLAYBACK_CONFIG,
        buildAudioUrl
      )

      expect(rounds.length).toBe(3)
      expect(rounds[0].legoId).toBe('L1')
      expect(rounds[1].legoId).toBe('L2')
      expect(rounds[2].legoId).toBe('L3')
    })

    it('should include spaced rep in later rounds', () => {
      const legos = [
        mockLego,
        { ...mockLego, id: 'L2' },
        { ...mockLego, id: 'L3' },
      ]
      const baskets = new Map<string, ClassifiedBasket>()
      baskets.set('L1', mockBasket)
      baskets.set('L2', { ...mockBasket, lego_id: 'L2' })
      baskets.set('L3', { ...mockBasket, lego_id: 'L3' })

      const rounds = buildRounds(
        legos,
        [mockSeed],
        baskets,
        DEFAULT_PLAYBACK_CONFIG,
        buildAudioUrl
      )

      // Round 3 should have spaced rep for LEGOs 1 and 2
      const round3 = rounds[2]
      const spacedRepItems = round3.items.filter(item => item.type === 'spaced_rep')
      expect(spacedRepItems.length).toBeGreaterThan(0)
      expect(round3.spacedRepReviews.length).toBeGreaterThan(0)
    })

    it('should use startRound parameter', () => {
      const legos = [mockLego]
      const rounds = buildRounds(
        legos,
        [mockSeed],
        new Map(),
        DEFAULT_PLAYBACK_CONFIG,
        buildAudioUrl,
        10 // Start at round 10
      )

      expect(rounds[0].roundNumber).toBe(10)
    })
  })
})
