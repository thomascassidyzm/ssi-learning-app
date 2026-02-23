/**
 * @deprecated Strategy adopted into progressive loading in LearningPlayer.vue.
 * Implementation replaced by `generateLearningScript` with `emitFromRound` + background extension.
 * Retained for backwards compatibility.
 *
 * PriorityRoundLoader - Smart background loading based on user intent probability
 *
 * Users can only skip ONE belt ahead. Loading priority mirrors intent:
 *
 * Priority 1: Round N          ← BLOCKING (instant play)
 * Priority 2: Round N+1        ← seamless continuation
 * Priority 3: First of NEXT belt  ← belt-skip ready
 * Priority 4: Rest of current belt
 * Priority 5: Rest of next belt
 * Priority 6: Belt-by-belt forward
 *
 * Belt thresholds (seeds):
 * White (0-7) → Yellow (8-19) → Orange (20-39) → Green (40-79) →
 * Blue (80-149) → Purple (150-279) → Brown (280-399) → Black (400+)
 */

import type { LegoPair, SeedPair, ClassifiedBasket } from '@ssi/core'
import type { CourseDataProvider, LearningItem } from '../providers/CourseDataProvider'
import type { SessionController } from './SessionController'
import type { RoundTemplate, RoundItem, Round } from './types'
import type { PlaybackConfig } from './PlaybackConfig'
import { buildRound, type BuildRoundOptions } from './RoundBuilder'
import { scriptItemToCycle } from '../utils/scriptItemToCycle'
import { applyConfig } from './types'

// Belt thresholds (seed numbers)
export const BELT_THRESHOLDS = [0, 8, 20, 40, 80, 150, 280, 400]
export const BELT_NAMES = ['White', 'Yellow', 'Orange', 'Green', 'Blue', 'Purple', 'Brown', 'Black']

export interface Belt {
  index: number
  name: string
  start: number  // First seed in this belt (inclusive)
  end: number    // Last seed in this belt (inclusive)
}

export interface LoaderConfig {
  provider: CourseDataProvider
  sessionController: SessionController
  currentSeed: number
  config: PlaybackConfig
  /** Optional: total number of LEGOs in course (for progress tracking) */
  totalLegos?: number
}

export interface LoaderProgress {
  loaded: number
  total: number
  currentBelt: Belt
  nextBelt: Belt | null
}

type RoundReadyCallback = (roundIndex: number, round: RoundTemplate) => void
type BeltReadyCallback = (belt: Belt) => void
type ErrorCallback = (error: Error, seedNumber: number) => void

export class PriorityRoundLoader {
  private provider: CourseDataProvider
  private sessionController: SessionController
  private config: PlaybackConfig
  private currentSeed: number
  private totalLegos: number

  // Loading state
  private loadingQueue: number[] = []
  private loadedSeeds = new Set<number>()
  private loadingSeeds = new Set<number>()
  private isRunning = false
  private abortController: AbortController | null = null

  // Course end detection
  private courseEndDetected = false
  private detectedCourseEnd: number | null = null

  // Log deduplication - track logged error types
  private loggedErrors = new Set<string>()

  // Cached data for round building
  private legoMap = new Map<string, LegoPair>()
  private seedMap = new Map<string, SeedPair>()
  private basketMap = new Map<string, ClassifiedBasket>()
  private seedToLegoId = new Map<number, string>()

  // Event callbacks
  private roundReadyCallbacks = new Set<RoundReadyCallback>()
  private beltReadyCallbacks = new Set<BeltReadyCallback>()
  private errorCallbacks = new Set<ErrorCallback>()

  // Track belt completion
  private completedBelts = new Set<number>()

  constructor(config: LoaderConfig) {
    this.provider = config.provider
    this.sessionController = config.sessionController
    this.config = config.config
    this.currentSeed = config.currentSeed
    this.totalLegos = config.totalLegos ?? 1000
  }

  /**
   * Start priority-based background loading
   */
  start(): void {
    if (this.isRunning) return

    this.isRunning = true
    this.abortController = new AbortController()
    this.loadingQueue = this.buildLoadingQueue(this.currentSeed)

    // console.log('[PriorityRoundLoader] Starting with queue:', this.loadingQueue.slice(0, 10), '...')
    this.processQueue()
  }

  /**
   * Stop loading
   */
  stop(): void {
    this.isRunning = false
    this.abortController?.abort()
    this.abortController = null
    // console.log('[PriorityRoundLoader] Stopped')
  }

  /**
   * Force-load a specific seed (for belt skip)
   * Returns when the seed is loaded
   */
  async prioritize(seedNumber: number): Promise<RoundTemplate | null> {
    if (this.loadedSeeds.has(seedNumber)) {
      const roundIndex = seedNumber - 1  // Convert to 0-based
      const round = this.sessionController.rounds.value[roundIndex]
      return round ?? null
    }

    // Move to front of queue
    this.loadingQueue = this.loadingQueue.filter(s => s !== seedNumber)
    this.loadingQueue.unshift(seedNumber)

    // Wait for it to load (with 30s timeout)
    return new Promise((resolve) => {
      const deadline = Date.now() + 30_000
      const checkLoaded = () => {
        if (this.loadedSeeds.has(seedNumber)) {
          const roundIndex = seedNumber - 1
          const round = this.sessionController.rounds.value[roundIndex]
          resolve(round ?? null)
        } else if (Date.now() > deadline || this.courseEndDetected) {
          resolve(null)
        } else {
          setTimeout(checkLoaded, 50)
        }
      }
      checkLoaded()

      // Kick the queue if not running
      if (!this.isRunning) {
        this.isRunning = true
        this.processQueue()
      }
    })
  }

  /**
   * Build the loading queue based on priority
   */
  buildLoadingQueue(currentSeed: number): number[] {
    const queue: number[] = []
    const currentBelt = this.getBeltForSeed(currentSeed)
    const nextBelt = this.getNextBelt(currentBelt)

    // Priority 1: Current round (already loaded by caller)
    // Priority 2: Next round (N+1)
    if (currentSeed + 1 <= this.totalLegos) {
      queue.push(currentSeed + 1)
    }

    // Priority 3: First of next belt (belt-skip ready)
    if (nextBelt && nextBelt.start <= this.totalLegos) {
      queue.push(nextBelt.start)
    }

    // Priority 4: Rest of current belt
    for (let s = currentSeed + 2; s <= Math.min(currentBelt.end, this.totalLegos); s++) {
      if (!queue.includes(s)) {
        queue.push(s)
      }
    }

    // Priority 5: Rest of next belt
    if (nextBelt) {
      for (let s = nextBelt.start + 1; s <= Math.min(nextBelt.end, this.totalLegos); s++) {
        if (!queue.includes(s)) {
          queue.push(s)
        }
      }
    }

    // Priority 6: Continue belt-by-belt forward
    let beltIndex = nextBelt ? nextBelt.index + 1 : currentBelt.index + 1
    while (beltIndex < BELT_THRESHOLDS.length) {
      const belt = this.getBeltByIndex(beltIndex)
      if (!belt || belt.start > this.totalLegos) break

      for (let s = belt.start; s <= Math.min(belt.end, this.totalLegos); s++) {
        if (!queue.includes(s)) {
          queue.push(s)
        }
      }
      beltIndex++
    }

    return queue
  }

  /**
   * Process the loading queue
   */
  private async processQueue(): Promise<void> {
    let errorCount = 0

    while (this.isRunning && this.loadingQueue.length > 0) {
      const seedNumber = this.loadingQueue.shift()!

      // Skip if already loaded or currently loading
      if (this.loadedSeeds.has(seedNumber) || this.loadingSeeds.has(seedNumber)) {
        continue
      }

      // Skip if we've detected course end and this seed is beyond it
      if (this.courseEndDetected && this.detectedCourseEnd !== null && seedNumber > this.detectedCourseEnd) {
        continue
      }

      try {
        await this.loadSeed(seedNumber)
      } catch (err) {
        errorCount++
        // Only log the first error of each type
        const errorKey = err instanceof Error ? err.message : String(err)
        if (!this.loggedErrors.has(errorKey)) {
          this.loggedErrors.add(errorKey)
          // console.error('[PriorityRoundLoader] Error loading seed:', errorKey)
        }
        this.emitError(err instanceof Error ? err : new Error(String(err)), seedNumber)
        // Continue with next seed - don't stop the queue
      }

      // Small delay to prevent overwhelming the database
      if (this.isRunning) {
        await this.delay(50)
      }
    }

    // Log summary at the end
    const courseEndMsg = this.courseEndDetected ? ` (course ends at seed ${this.detectedCourseEnd})` : ''
    // console.log(`[PriorityRoundLoader] Queue complete, loaded ${this.loadedSeeds.size} seeds${courseEndMsg}${errorCount > 0 ? `, ${errorCount} errors` : ''}`)
    this.isRunning = false
  }

  /**
   * Load a single seed and build its round
   */
  private async loadSeed(seedNumber: number): Promise<void> {
    this.loadingSeeds.add(seedNumber)

    try {
      // 1. Load LEGO at this position
      const learningItem = await this.provider.loadLegoAtPosition(seedNumber)
      if (!learningItem) {
        // Detect end of course - log ONCE then stop the queue
        if (!this.courseEndDetected) {
          this.courseEndDetected = true
          this.detectedCourseEnd = seedNumber - 1
          // console.log(`[PriorityRoundLoader] Course end detected at seed ${seedNumber - 1} (no LEGO at seed ${seedNumber})`)
          // Clear the queue - no point trying to load seeds beyond course end
          this.loadingQueue = []
        }
        this.loadingSeeds.delete(seedNumber)
        return
      }

      // 2. Convert to LegoPair and store
      const legoPair = this.convertToLegoPair(learningItem)
      this.legoMap.set(legoPair.id, legoPair)
      this.seedToLegoId.set(seedNumber, legoPair.id)

      // 3. Create SeedPair
      const seedPair = this.createSeedPair(learningItem, legoPair)
      this.seedMap.set(seedPair.seed_id, seedPair)

      // 4. Load basket for this LEGO
      const basket = await this.provider.getLegoBasket(legoPair.id, legoPair)
      if (basket) {
        // 4b. Load introduction audio ("The Spanish for X is...")
        const introAudio = await this.provider.getIntroductionAudio(legoPair.id)
        if (introAudio) {
          basket.introduction_audio = introAudio
        }
        this.basketMap.set(legoPair.id, basket)
      }

      // 5. Build the round
      const round = this.buildRoundTemplate(legoPair, seedPair, basket, seedNumber)

      // 6. Add to session controller
      this.sessionController.addRound(round)

      this.loadedSeeds.add(seedNumber)
      this.loadingSeeds.delete(seedNumber)

      // 7. Emit events
      const roundIndex = seedNumber - 1
      this.emitRoundReady(roundIndex, round)

      // Check if belt is complete
      this.checkBeltCompletion(seedNumber)

    } catch (err) {
      this.loadingSeeds.delete(seedNumber)
      throw err
    }
  }

  /**
   * Build a RoundTemplate from loaded data
   */
  private buildRoundTemplate(
    lego: LegoPair,
    seed: SeedPair,
    basket: ClassifiedBasket | null,
    seedNumber: number
  ): RoundTemplate {
    const buildAudioUrl = (audioId: string): string => {
      return `/api/audio/${audioId}`
    }

    // Get spaced rep LEGOs from already loaded data
    const getSpacedRepLegos = () => {
      const reviews: Array<{
        lego: LegoPair
        seed: SeedPair
        basket: ClassifiedBasket | null
        legoIndex: number
        fibonacciPosition: number
        phraseCount: number
      }> = []

      // Fibonacci: review at positions (roundNumber - fib[i])
      const FIBONACCI = [1, 2, 3, 5, 8, 13, 21, 34, 55, 89]
      const seen = new Set<number>()

      for (let i = 0; i < FIBONACCI.length; i++) {
        const reviewSeed = seedNumber - FIBONACCI[i]
        if (reviewSeed < 1) break
        if (seen.has(reviewSeed)) continue
        seen.add(reviewSeed)

        const reviewLegoId = this.seedToLegoId.get(reviewSeed)
        if (!reviewLegoId) continue

        const reviewLego = this.legoMap.get(reviewLegoId)
        if (!reviewLego) continue

        const reviewSeedPair = Array.from(this.seedMap.values()).find(s =>
          s.legos.some(l => l.id === reviewLegoId)
        )
        if (!reviewSeedPair) continue

        reviews.push({
          lego: reviewLego,
          seed: reviewSeedPair,
          basket: this.basketMap.get(reviewLegoId) ?? null,
          legoIndex: reviewSeed,
          fibonacciPosition: i,
          // N-1 (fib[0]=1) gets 3 phrases, all others get 1
          phraseCount: FIBONACCI[i] === 1 ? 3 : 1,
        })

        if (reviews.length >= this.config.spacedRepCount) break
      }

      return reviews
    }

    const round = buildRound({
      lego,
      seed,
      basket,
      legoIndex: seedNumber,
      roundNumber: seedNumber,
      config: this.config,
      buildAudioUrl,
      getSpacedRepLegos: seedNumber > 1 ? getSpacedRepLegos : undefined,
    })

    // Convert Round to RoundTemplate (add cycle to each item)
    const roundTemplate: RoundTemplate = {
      roundNumber: round.roundNumber,
      legoId: round.legoId,
      legoIndex: round.legoIndex,
      seedId: round.seedId,
      spacedRepReviews: round.spacedRepReviews,
      items: round.items.map((item): RoundItem => ({
        ...item,
        cycle: item.type !== 'intro' ? scriptItemToCycle(item) : null,
        playable: true,
      })),
    }

    // Apply config to set playable flags
    return applyConfig(roundTemplate, this.config)
  }

  /**
   * Convert LearningItem.lego to LegoPair
   */
  private convertToLegoPair(item: LearningItem): LegoPair {
    return {
      id: item.lego.id,
      type: item.lego.type as 'A' | 'M',
      new: item.lego.new,
      lego: item.lego.lego,
      audioRefs: {
        known: { id: item.lego.audioRefs.known.id, url: item.lego.audioRefs.known.url },
        target: {
          voice1: { id: item.lego.audioRefs.target.voice1.id, url: item.lego.audioRefs.target.voice1.url },
          voice2: { id: item.lego.audioRefs.target.voice2.id, url: item.lego.audioRefs.target.voice2.url },
        },
      },
    }
  }

  /**
   * Create SeedPair from LearningItem
   */
  private createSeedPair(item: LearningItem, lego: LegoPair): SeedPair {
    return {
      seed_id: item.seed.seed_id,
      seed_pair: item.seed.seed_pair,
      legos: [lego],
    }
  }

  /**
   * Check if a belt is now complete
   */
  private checkBeltCompletion(seedNumber: number): void {
    const belt = this.getBeltForSeed(seedNumber)

    // Check if all seeds in this belt are loaded
    for (let s = belt.start; s <= Math.min(belt.end, this.totalLegos); s++) {
      if (!this.loadedSeeds.has(s)) {
        return  // Belt not complete
      }
    }

    // Belt is complete
    if (!this.completedBelts.has(belt.index)) {
      this.completedBelts.add(belt.index)
      this.emitBeltReady(belt)
    }
  }

  // ============================================
  // Belt utility methods
  // ============================================

  /**
   * Get the belt containing a seed number
   */
  getBeltForSeed(seedNumber: number): Belt {
    for (let i = BELT_THRESHOLDS.length - 1; i >= 0; i--) {
      if (seedNumber >= BELT_THRESHOLDS[i]) {
        return this.getBeltByIndex(i)!
      }
    }
    return this.getBeltByIndex(0)!
  }

  /**
   * Get belt by index
   */
  getBeltByIndex(index: number): Belt | null {
    if (index < 0 || index >= BELT_THRESHOLDS.length) return null

    const start = BELT_THRESHOLDS[index]
    const end = index < BELT_THRESHOLDS.length - 1
      ? BELT_THRESHOLDS[index + 1] - 1
      : Infinity  // Black belt has no upper limit

    return {
      index,
      name: BELT_NAMES[index],
      start: start === 0 ? 1 : start,  // Seeds are 1-based
      end: end === Infinity ? this.totalLegos : end,
    }
  }

  /**
   * Get the next belt after a given belt
   */
  getNextBelt(belt: Belt): Belt | null {
    return this.getBeltByIndex(belt.index + 1)
  }

  /**
   * Get current belt based on current seed
   */
  getCurrentBelt(): Belt {
    return this.getBeltForSeed(this.currentSeed)
  }

  // ============================================
  // Status methods
  // ============================================

  /**
   * Check if a round is ready
   */
  isRoundReady(roundIndex: number): boolean {
    const seedNumber = roundIndex + 1  // Convert to 1-based
    return this.loadedSeeds.has(seedNumber)
  }

  /**
   * Get loading progress
   */
  getProgress(): LoaderProgress {
    return {
      loaded: this.loadedSeeds.size,
      total: this.totalLegos,
      currentBelt: this.getCurrentBelt(),
      nextBelt: this.getNextBelt(this.getCurrentBelt()),
    }
  }

  // ============================================
  // Event methods
  // ============================================

  onRoundReady(callback: RoundReadyCallback): () => void {
    this.roundReadyCallbacks.add(callback)
    return () => this.roundReadyCallbacks.delete(callback)
  }

  onBeltReady(callback: BeltReadyCallback): () => void {
    this.beltReadyCallbacks.add(callback)
    return () => this.beltReadyCallbacks.delete(callback)
  }

  onError(callback: ErrorCallback): () => void {
    this.errorCallbacks.add(callback)
    return () => this.errorCallbacks.delete(callback)
  }

  private emitRoundReady(roundIndex: number, round: RoundTemplate): void {
    for (const cb of this.roundReadyCallbacks) {
      try {
        cb(roundIndex, round)
      } catch (e) {
        // console.error('[PriorityRoundLoader] Round ready callback error:', e)
      }
    }
  }

  private emitBeltReady(belt: Belt): void {
    // console.log('[PriorityRoundLoader] Belt complete:', belt.name)
    for (const cb of this.beltReadyCallbacks) {
      try {
        cb(belt)
      } catch (e) {
        // console.error('[PriorityRoundLoader] Belt ready callback error:', e)
      }
    }
  }

  private emitError(error: Error, seedNumber: number): void {
    for (const cb of this.errorCallbacks) {
      try {
        cb(error, seedNumber)
      } catch (e) {
        // console.error('[PriorityRoundLoader] Error callback error:', e)
      }
    }
  }

  // ============================================
  // Utility methods
  // ============================================

  private delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms))
  }

  /**
   * Clean up resources
   */
  dispose(): void {
    this.stop()
    this.roundReadyCallbacks.clear()
    this.beltReadyCallbacks.clear()
    this.errorCallbacks.clear()
    this.loadedSeeds.clear()
    this.loadingSeeds.clear()
    this.legoMap.clear()
    this.seedMap.clear()
    this.basketMap.clear()
    this.seedToLegoId.clear()
    this.completedBelts.clear()
    this.loggedErrors.clear()
    this.courseEndDetected = false
    this.detectedCourseEnd = null
  }
}

/**
 * Create a new PriorityRoundLoader
 */
export function createPriorityRoundLoader(config: LoaderConfig): PriorityRoundLoader {
  return new PriorityRoundLoader(config)
}
