/**
 * useBeltLoader - Progressive loading with belt-aware priority queue
 *
 * Implements a three-layer loading strategy:
 * 1. BLOCKING (P0): Current belt first 5 rounds - user can start in <2s
 * 2. SKIP PROTECTION (P1-P5): Background load of next belts first 5 rounds
 * 3. INFINITE PLAY: All cached content available for offline cycling
 *
 * Architecture:
 * - Script data loaded into memory (rounds, items)
 * - Audio cached via Cache API for offline playback
 * - Priority queue ensures most-needed content loads first
 */

import { ref, computed, watch, type Ref } from 'vue'
import type { SupabaseClient } from '@supabase/supabase-js'
import { preloadAudioBatch, cacheAudio, getAudioCacheStats } from './useScriptCache'
import type { Round, ScriptItem, CachedScript } from './useScriptCache'

// ============================================================================
// BELT CONFIGURATION
// ============================================================================

export interface BeltRange {
  name: string
  start: number
  end: number
}

export const BELT_RANGES: Record<string, BeltRange> = {
  white:  { name: 'white',  start: 1,   end: 7 },
  yellow: { name: 'yellow', start: 8,   end: 19 },
  orange: { name: 'orange', start: 20,  end: 39 },
  green:  { name: 'green',  start: 40,  end: 79 },
  blue:   { name: 'blue',   start: 80,  end: 149 },
  purple: { name: 'purple', start: 150, end: 279 },
  brown:  { name: 'brown',  start: 280, end: 399 },
  black:  { name: 'black',  start: 400, end: 668 },
}

export const BELT_ORDER = ['white', 'yellow', 'orange', 'green', 'blue', 'purple', 'brown', 'black']

// ============================================================================
// TYPES
// ============================================================================

export interface LoadTask {
  priority: number
  type: 'script' | 'audio'
  belt: string
  seedRange: [number, number]
  status: 'pending' | 'loading' | 'complete' | 'error'
}

export interface BeltLoaderState {
  /** Rounds ready to play (indexed by seed number for efficient lookup) */
  readyRounds: Map<number, Round>
  /** Belts that have their first 5 rounds ready */
  readyBelts: Set<string>
  /** Loading queue with prioritized tasks */
  queue: LoadTask[]
  /** Is background loading in progress */
  isLoading: boolean
  /** Is blocking (P0) load complete - user can start learning */
  isReady: boolean
  /** Total audio files cached */
  cachedAudioCount: number
  /** Total seeds with cached scripts */
  cachedScriptSeeds: number
  /** Current loading task description */
  loadingStatus: string
}

export interface BeltLoaderConfig {
  /** Supabase client for fetching data */
  supabase: Ref<SupabaseClient | null>
  /** Course code */
  courseCode: Ref<string>
  /** Audio base URL for S3 */
  audioBaseUrl?: string
  /** Function to generate script chunk */
  generateScriptChunk: (startSeed: number, count: number) => Promise<{ rounds: Round[]; nextSeed: number; hasMore: boolean }>
}

export interface DownloadProgress {
  /** Total seeds to download */
  totalSeeds: number
  /** Seeds completed */
  completedSeeds: number
  /** Total audio files to download */
  totalAudio: number
  /** Audio files downloaded */
  completedAudio: number
  /** Current phase: 'scripts' | 'audio' | 'complete' */
  phase: 'scripts' | 'audio' | 'complete' | 'cancelled'
  /** Percentage (0-100) */
  percent: number
}

export type DownloadProgressCallback = (progress: DownloadProgress) => void

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

/**
 * Get belt name for a given seed number
 */
export function getBeltForSeed(seed: number): string {
  for (let i = BELT_ORDER.length - 1; i >= 0; i--) {
    const belt = BELT_ORDER[i]
    if (seed >= BELT_RANGES[belt].start) {
      return belt
    }
  }
  return 'white'
}

/**
 * Get the next N belts after the given belt
 */
function getNextBelts(currentBelt: string, count: number): string[] {
  const currentIndex = BELT_ORDER.indexOf(currentBelt)
  if (currentIndex === -1) return []

  const result: string[] = []
  for (let i = currentIndex + 1; i < BELT_ORDER.length && result.length < count; i++) {
    result.push(BELT_ORDER[i])
  }
  return result
}

/**
 * Extract all audio URLs from rounds
 */
function extractAudioUrls(rounds: Round[], audioBaseUrl: string): string[] {
  const urls: string[] = []

  for (const round of rounds) {
    for (const item of round.items || []) {
      // Extract audio URLs from audioRefs
      if (item.audioRefs) {
        const refs = item.audioRefs as any
        if (refs.known?.url) urls.push(refs.known.url)
        if (refs.target?.voice1?.url) urls.push(refs.target.voice1.url)
        if (refs.target?.voice2?.url) urls.push(refs.target.voice2.url)
      }
    }
  }

  return urls
}

// ============================================================================
// COMPOSABLE
// ============================================================================

export function useBeltLoader(config: BeltLoaderConfig) {
  const { supabase, courseCode, audioBaseUrl = 'https://ssi-audio-stage.s3.eu-west-1.amazonaws.com', generateScriptChunk } = config

  // State
  const readyRounds = ref<Map<number, Round>>(new Map())
  const readyBelts = ref<Set<string>>(new Set())
  const queue = ref<LoadTask[]>([])
  const isLoading = ref(false)
  const isReady = ref(false)
  const loadingStatus = ref('')
  const cachedAudioCount = ref(0)
  const cachedScriptSeeds = ref(0)

  // Track processed seed ranges to avoid duplicate loads
  const loadedSeedRanges = ref<Set<string>>(new Set())

  // ============================================================================
  // QUEUE GENERATION
  // ============================================================================

  /**
   * Generate the loading queue based on current position
   * Priority 0 = blocking, must complete before start
   * Priority 1-5 = background, breadth-first across belts
   */
  function generateLoadQueue(currentSeed: number): LoadTask[] {
    const currentBelt = getBeltForSeed(currentSeed)
    const currentBeltRange = BELT_RANGES[currentBelt]
    const taskQueue: LoadTask[] = []

    // P0: BLOCKING - Current position + 4 more seeds (5 total)
    // This is what the user needs to START learning
    const blockingEnd = Math.min(currentSeed + 4, currentBeltRange.end)
    taskQueue.push({
      priority: 0,
      type: 'script',
      belt: currentBelt,
      seedRange: [currentSeed, blockingEnd],
      status: 'pending',
    })
    taskQueue.push({
      priority: 0,
      type: 'audio',
      belt: currentBelt,
      seedRange: [currentSeed, blockingEnd],
      status: 'pending',
    })

    // P1-P5: SKIP PROTECTION - Next belts first 5 seeds each
    // Breadth-first: load a little of each belt before loading more of current
    let priority = 1
    const nextBelts = getNextBelts(currentBelt, 5)

    for (const belt of nextBelts) {
      const range = BELT_RANGES[belt]
      const rangeEnd = Math.min(range.start + 4, range.end)

      taskQueue.push({
        priority,
        type: 'audio',
        belt,
        seedRange: [range.start, rangeEnd],
        status: 'pending',
      })
      taskQueue.push({
        priority,
        type: 'script',
        belt,
        seedRange: [range.start, rangeEnd],
        status: 'pending',
      })
      priority++
    }

    // P6+: Fill in current belt remainder
    if (blockingEnd < currentBeltRange.end) {
      taskQueue.push({
        priority: 6,
        type: 'script',
        belt: currentBelt,
        seedRange: [blockingEnd + 1, currentBeltRange.end],
        status: 'pending',
      })
      taskQueue.push({
        priority: 6,
        type: 'audio',
        belt: currentBelt,
        seedRange: [blockingEnd + 1, currentBeltRange.end],
        status: 'pending',
      })
    }

    // P7+: Fill in next belts remainder
    priority = 7
    for (const belt of nextBelts) {
      const range = BELT_RANGES[belt]
      const alreadyLoaded = range.start + 4

      if (alreadyLoaded < range.end) {
        taskQueue.push({
          priority,
          type: 'script',
          belt,
          seedRange: [alreadyLoaded + 1, range.end],
          status: 'pending',
        })
        taskQueue.push({
          priority,
          type: 'audio',
          belt,
          seedRange: [alreadyLoaded + 1, range.end],
          status: 'pending',
        })
      }
      priority++
    }

    return taskQueue.sort((a, b) => a.priority - b.priority)
  }

  // ============================================================================
  // TASK EXECUTION
  // ============================================================================

  /**
   * Execute a single load task
   */
  async function executeTask(task: LoadTask): Promise<void> {
    const rangeKey = `${task.belt}:${task.seedRange[0]}-${task.seedRange[1]}:${task.type}`

    // Skip if already loaded
    if (loadedSeedRanges.value.has(rangeKey)) {
      task.status = 'complete'
      return
    }

    task.status = 'loading'
    loadingStatus.value = `Loading ${task.belt} belt ${task.type}...`

    try {
      if (task.type === 'script') {
        // Load script data
        const count = task.seedRange[1] - task.seedRange[0] + 1
        const { rounds } = await generateScriptChunk(task.seedRange[0], count)

        // Store rounds by seed number
        for (const round of rounds) {
          // Use roundNumber as the seed index
          readyRounds.value.set(round.roundNumber, round)
        }

        cachedScriptSeeds.value = readyRounds.value.size

        // Check if belt's first 5 are ready
        const beltRange = BELT_RANGES[task.belt]
        let beltReady = true
        for (let seed = beltRange.start; seed <= Math.min(beltRange.start + 4, beltRange.end); seed++) {
          if (!readyRounds.value.has(seed)) {
            beltReady = false
            break
          }
        }
        if (beltReady) {
          readyBelts.value.add(task.belt)
        }

      } else if (task.type === 'audio') {
        // Load audio for the seed range
        const roundsInRange: Round[] = []
        for (let seed = task.seedRange[0]; seed <= task.seedRange[1]; seed++) {
          const round = readyRounds.value.get(seed)
          if (round) roundsInRange.push(round)
        }

        if (roundsInRange.length > 0) {
          const urls = extractAudioUrls(roundsInRange, audioBaseUrl)
          if (urls.length > 0) {
            await preloadAudioBatch(urls)
          }
        }

        // Update audio cache stats
        const stats = await getAudioCacheStats()
        cachedAudioCount.value = stats.count
      }

      task.status = 'complete'
      loadedSeedRanges.value.add(rangeKey)

    } catch (error) {
      console.warn(`[BeltLoader] Task failed:`, task, error)
      task.status = 'error'
    }
  }

  /**
   * Process the loading queue
   * P0 tasks are blocking, P1+ run in background
   */
  async function processQueue(): Promise<void> {
    if (isLoading.value) return
    isLoading.value = true

    try {
      // Process P0 (blocking) tasks first
      const blockingTasks = queue.value.filter(t => t.priority === 0 && t.status === 'pending')

      // Script tasks must complete before audio tasks (audio needs script data)
      const blockingScriptTasks = blockingTasks.filter(t => t.type === 'script')
      const blockingAudioTasks = blockingTasks.filter(t => t.type === 'audio')

      for (const task of blockingScriptTasks) {
        await executeTask(task)
      }

      for (const task of blockingAudioTasks) {
        await executeTask(task)
      }

      // Mark as ready after P0 completes
      isReady.value = true
      loadingStatus.value = 'Ready'

      // Continue with background tasks (P1+)
      const backgroundTasks = queue.value.filter(t => t.priority > 0 && t.status === 'pending')

      // Process script tasks first (audio depends on script)
      const bgScriptTasks = backgroundTasks.filter(t => t.type === 'script')
      const bgAudioTasks = backgroundTasks.filter(t => t.type === 'audio')

      for (const task of bgScriptTasks) {
        await executeTask(task)
      }

      for (const task of bgAudioTasks) {
        await executeTask(task)
      }

      loadingStatus.value = 'All content loaded'

    } finally {
      isLoading.value = false
    }
  }

  // ============================================================================
  // PUBLIC API
  // ============================================================================

  /**
   * Initialize loading from a specific seed position
   */
  async function initializeFromSeed(seed: number): Promise<void> {
    console.log(`[BeltLoader] Initializing from seed ${seed}`)

    // Reset state
    readyRounds.value.clear()
    readyBelts.value.clear()
    loadedSeedRanges.value.clear()
    isReady.value = false

    // Generate and start processing queue
    queue.value = generateLoadQueue(seed)
    await processQueue()
  }

  /**
   * Get rounds for a seed range (for playback)
   */
  function getRoundsForRange(startSeed: number, count: number): Round[] {
    const rounds: Round[] = []
    for (let seed = startSeed; seed < startSeed + count; seed++) {
      const round = readyRounds.value.get(seed)
      if (round) rounds.push(round)
    }
    return rounds
  }

  /**
   * Get a specific round by seed number
   */
  function getRoundBySeed(seed: number): Round | undefined {
    return readyRounds.value.get(seed)
  }

  /**
   * Get all cached items (for infinite play mode)
   */
  function getAllCachedItems(): ScriptItem[] {
    const items: ScriptItem[] = []
    for (const round of readyRounds.value.values()) {
      if (round.items) {
        items.push(...round.items)
      }
    }
    return items
  }

  /**
   * Check if a specific belt is ready to play
   */
  function isBeltReady(belt: string): boolean {
    return readyBelts.value.has(belt)
  }

  /**
   * Expand loading to include more content (call when approaching end)
   */
  async function expandFromSeed(seed: number): Promise<void> {
    // Generate new tasks for content beyond current position
    const belt = getBeltForSeed(seed)
    const beltRange = BELT_RANGES[belt]

    // Load next 20 seeds beyond current position
    const expandEnd = Math.min(seed + 20, 668)
    const rangeKey = `expand:${seed}-${expandEnd}`

    if (loadedSeedRanges.value.has(rangeKey)) return

    console.log(`[BeltLoader] Expanding from seed ${seed} to ${expandEnd}`)

    const task: LoadTask = {
      priority: 10, // Low priority
      type: 'script',
      belt,
      seedRange: [seed, expandEnd],
      status: 'pending',
    }

    await executeTask(task)

    // Also cache audio for new content
    const audioTask: LoadTask = {
      priority: 10,
      type: 'audio',
      belt,
      seedRange: [seed, expandEnd],
      status: 'pending',
    }

    await executeTask(audioTask)
    loadedSeedRanges.value.add(rangeKey)
  }

  /**
   * Clear all cached data
   */
  function clearCache(): void {
    readyRounds.value.clear()
    readyBelts.value.clear()
    loadedSeedRanges.value.clear()
    queue.value = []
    isReady.value = false
    cachedAudioCount.value = 0
    cachedScriptSeeds.value = 0
  }

  // ============================================================================
  // OFFLINE DOWNLOAD
  // ============================================================================

  /** Abort controller for cancelling downloads */
  let downloadAbortController: AbortController | null = null

  /**
   * Download content for offline use
   * @param option - 'current' (current belt), 'next50', 'next100', or 'entire'
   * @param currentSeed - current learner position
   * @param onProgress - progress callback
   */
  async function downloadForOffline(
    option: 'current' | 'next50' | 'next100' | 'entire',
    currentSeed: number,
    onProgress?: DownloadProgressCallback
  ): Promise<void> {
    downloadAbortController = new AbortController()

    // Calculate seed range based on option
    let startSeed: number
    let endSeed: number

    switch (option) {
      case 'current': {
        const belt = getBeltForSeed(currentSeed)
        const range = BELT_RANGES[belt]
        startSeed = currentSeed
        endSeed = range.end
        break
      }
      case 'next50':
        startSeed = currentSeed
        endSeed = Math.min(currentSeed + 49, 668)
        break
      case 'next100':
        startSeed = currentSeed
        endSeed = Math.min(currentSeed + 99, 668)
        break
      case 'entire':
        startSeed = 1
        endSeed = 668
        break
    }

    const totalSeeds = endSeed - startSeed + 1

    const progress: DownloadProgress = {
      totalSeeds,
      completedSeeds: 0,
      totalAudio: 0,
      completedAudio: 0,
      phase: 'scripts',
      percent: 0,
    }

    const updateProgress = () => {
      if (progress.phase === 'scripts') {
        progress.percent = Math.round((progress.completedSeeds / progress.totalSeeds) * 50)
      } else if (progress.phase === 'audio') {
        progress.percent = 50 + Math.round((progress.completedAudio / progress.totalAudio) * 50)
      }
      onProgress?.(progress)
    }

    try {
      // Phase 1: Download all scripts
      console.log(`[BeltLoader] Downloading scripts for seeds ${startSeed}-${endSeed}`)

      // Process in chunks of 20 seeds
      const chunkSize = 20
      for (let seed = startSeed; seed <= endSeed; seed += chunkSize) {
        if (downloadAbortController.signal.aborted) {
          progress.phase = 'cancelled'
          onProgress?.(progress)
          return
        }

        const count = Math.min(chunkSize, endSeed - seed + 1)
        const { rounds } = await generateScriptChunk(seed, count)

        // Store rounds
        for (const round of rounds) {
          readyRounds.value.set(round.roundNumber, round)
        }

        progress.completedSeeds += count
        updateProgress()
      }

      cachedScriptSeeds.value = readyRounds.value.size

      // Phase 2: Download all audio
      progress.phase = 'audio'

      // Collect all audio URLs from downloaded rounds
      const allRounds: Round[] = []
      for (let seed = startSeed; seed <= endSeed; seed++) {
        const round = readyRounds.value.get(seed)
        if (round) allRounds.push(round)
      }

      const audioUrls = extractAudioUrls(allRounds, audioBaseUrl)
      progress.totalAudio = audioUrls.length
      updateProgress()

      console.log(`[BeltLoader] Downloading ${audioUrls.length} audio files`)

      // Process audio in batches
      const audioBatchSize = 10
      for (let i = 0; i < audioUrls.length; i += audioBatchSize) {
        if (downloadAbortController.signal.aborted) {
          progress.phase = 'cancelled'
          onProgress?.(progress)
          return
        }

        const batch = audioUrls.slice(i, i + audioBatchSize)
        await preloadAudioBatch(batch)

        progress.completedAudio += batch.length
        updateProgress()
      }

      // Update stats
      const stats = await getAudioCacheStats()
      cachedAudioCount.value = stats.count

      progress.phase = 'complete'
      progress.percent = 100
      onProgress?.(progress)

      console.log(`[BeltLoader] Download complete: ${totalSeeds} seeds, ${audioUrls.length} audio files`)

    } catch (error) {
      console.error('[BeltLoader] Download error:', error)
      throw error
    } finally {
      downloadAbortController = null
    }
  }

  /**
   * Cancel an in-progress download
   */
  function cancelDownload(): void {
    if (downloadAbortController) {
      downloadAbortController.abort()
      downloadAbortController = null
    }
  }

  // ============================================================================
  // COMPUTED
  // ============================================================================

  const state = computed<BeltLoaderState>(() => ({
    readyRounds: readyRounds.value,
    readyBelts: readyBelts.value,
    queue: queue.value,
    isLoading: isLoading.value,
    isReady: isReady.value,
    cachedAudioCount: cachedAudioCount.value,
    cachedScriptSeeds: cachedScriptSeeds.value,
    loadingStatus: loadingStatus.value,
  }))

  return {
    // State
    state,
    isReady,
    isLoading,
    loadingStatus,
    cachedAudioCount,
    cachedScriptSeeds,
    readyBelts,

    // Actions
    initializeFromSeed,
    getRoundsForRange,
    getRoundBySeed,
    getAllCachedItems,
    isBeltReady,
    expandFromSeed,
    clearCache,

    // Offline download
    downloadForOffline,
    cancelDownload,

    // Utilities
    getBeltForSeed,
  }
}

export type BeltLoader = ReturnType<typeof useBeltLoader>
