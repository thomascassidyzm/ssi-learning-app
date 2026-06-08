/**
 * Script Cache - Simple localStorage + Cache API approach
 *
 * Architecture:
 * - localStorage: Script data (rounds, items, text) ~300-500KB per course
 * - Cache API: Audio files (MP3s) ~5MB per 30 mins of learning
 *
 * No IndexedDB - it's overkill for key-value + HTTP response caching.
 */

import { ref, type Ref } from 'vue'
import { openDB, deleteDB, type IDBPDatabase } from 'idb'
import type { SupabaseClient } from '@supabase/supabase-js'

// Cache configuration
// Scripts live in IndexedDB. localStorage's ~5MB cap overflowed on big
// courses (Irish = 943 LEGOs → QuotaExceededError on write, which also broke
// cold offline reopen — no cached script to play). IndexedDB has GBs of room.
// Bump SCRIPT_VERSION to invalidate — it's part of the key, so old entries
// orphan and regenerate. This is the ONLY invalidation (no TTL).
const SCRIPT_VERSION = 'v9' // v9: carry display_tiling (authored {n,r,salient} tiles) on phrase items
const SCRIPT_DB_NAME = 'ssi-script-cache'
const SCRIPT_STORE = 'scripts'
const AUDIO_CACHE_NAME = 'ssi-audio-v1'
const CONTENT_VERSION_PREFIX = 'ssi-content-version-'

let scriptDbPromise: Promise<IDBPDatabase> | null = null
const scriptDb = (): Promise<IDBPDatabase> => {
  if (!scriptDbPromise) {
    const open = () => openDB(SCRIPT_DB_NAME, 1, {
      upgrade(db) {
        if (!db.objectStoreNames.contains(SCRIPT_STORE)) db.createObjectStore(SCRIPT_STORE)
      },
    })
    scriptDbPromise = (async () => {
      let db = await open()
      // Self-heal a storeless DB: an interrupted upgrade or a ?reset that
      // opened the DB without recreating stores can leave it at v1 with no
      // object store → "NotFoundError: object stores was not found" on every
      // transaction. Delete and recreate so the store exists.
      if (!db.objectStoreNames.contains(SCRIPT_STORE)) {
        db.close()
        await deleteDB(SCRIPT_DB_NAME)
        db = await open()
      }
      return db
    })()
  }
  return scriptDbPromise
}

// Versioned key so a SCRIPT_VERSION bump orphans old entries (→ regenerate).
const idbKey = (courseCode: string): string => `${SCRIPT_VERSION}:${courseCode}`

// One-time migration: scripts used to live in localStorage and overflowed the
// 5MB quota. Purge those stale copies on load to reclaim the space.
try {
  if (typeof localStorage !== 'undefined') {
    const stale: string[] = []
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i)
      if (k?.startsWith('ssi-script-v')) stale.push(k)
    }
    stale.forEach((k) => localStorage.removeItem(k))
    if (stale.length) console.log('[ScriptCache] Migrated', stale.length, 'scripts off localStorage')
  }
} catch { /* noop */ }

// Types
export interface ScriptItem {
  roundNumber: number
  legoId: string
  legoIndex: number
  seedId: string
  knownText: string
  targetText: string
  type: 'intro' | 'debut' | 'debut_phrase' | 'spaced_rep' | 'consolidation'
  reviewOf?: number
  fibonacciPosition?: number
  audioRefs?: any
  audioDurations?: any
}

export interface Round {
  roundNumber: number
  legoId: string
  seedId: string
  items: ScriptItem[]
  spacedRepReviews?: number[]
}

export interface CourseWelcome {
  id: string
  role?: string
  cadence?: string
  duration?: number
}

export interface CachedScript {
  courseCode: string
  rounds: Round[]
  totalSeeds: number
  totalLegos: number
  totalCycles: number
  estimatedMinutes?: number
  audioMapObj: Record<string, any>
  cachedAt: number
  courseWelcome?: CourseWelcome
  loadedLegos?: number // For CourseExplorer pagination
  scriptOffset?: number // Track the starting offset (completedRounds at generation time)
  contentVersion?: string // courses.content_version — used to detect audio regeneration
  // The audio-aware main-loop extent from the generateScript run that produced
  // this cache (its mainLoopRoundCount = count of distinct playable main-loop
  // rounds). Persisted so a warm cache-fast-path hydration single-sources the
  // INF-PLAY boundary on this count rather than the (stale, non-audio-filtered)
  // course_round_index matview. Optional for backward-compat with caches written
  // before this field existed (they fall back to the matview, as before).
  mainLoopRoundCount?: number
}

// ============================================================================
// SCRIPT CACHE (localStorage)
// ============================================================================

export const getCachedScript = async (courseCode: string): Promise<CachedScript | null> => {
  try {
    const db = await scriptDb()
    const data = (await db.get(SCRIPT_STORE, idbKey(courseCode))) as CachedScript | undefined
    if (!data) return null
    // No TTL — cache persists until version bump or explicit clear (PWA: the
    // cache is the source of truth).
    console.log('[ScriptCache] Loaded from IndexedDB')
    return data
  } catch (err) {
    console.warn('[ScriptCache] Read failed:', (err as any)?.name, '—', (err as any)?.message, err)
    return null
  }
}

export const setCachedScript = async (
  courseCode: string,
  data: Omit<CachedScript, 'courseCode' | 'cachedAt'>
): Promise<void> => {
  try {
    const fullData: CachedScript = {
      courseCode,
      ...data,
      cachedAt: Date.now(),
      // audio UUIDs live in audioRefs per item — drop the redundant map
      audioMapObj: {},
    }
    // The script object often arrives as a Vue reactive proxy (rounds/items
    // come straight from refs). IndexedDB's structured-clone rejects proxies
    // with DataCloneError — localStorage's JSON.stringify silently flattened
    // them, this doesn't. Round-trip to a plain object before the write.
    // CachedScript is pure data (no Dates/functions), so JSON is lossless here.
    const plain = JSON.parse(JSON.stringify(fullData)) as CachedScript
    const db = await scriptDb()
    await db.put(SCRIPT_STORE, plain, idbKey(courseCode))
    console.log('[ScriptCache] Saved to IndexedDB')
  } catch (err) {
    // IndexedDB has GBs of room, so this should be rare (quota pressure only).
    console.warn('[ScriptCache] Write failed:', (err as any)?.name, '—', (err as any)?.message, err)
  }
}

export const resetCacheState = async (): Promise<void> => {
  try {
    const db = await scriptDb()
    await db.clear(SCRIPT_STORE)
    await caches.delete(AUDIO_CACHE_NAME)
    console.log('[ScriptCache] All caches cleared')
  } catch (err) {
    console.warn('[ScriptCache] Reset failed:', err)
  }
}

// ============================================================================
// CONTENT VERSION CHECK (detects audio regeneration)
// ============================================================================

/**
 * Check if course content_version has changed since last load.
 * If it has, clear the script cache and Service Worker audio cache so
 * stale audio (e.g. old TTS voice) doesn't persist.
 *
 * Call this early — before getCachedScript or audio playback.
 * Returns true if the cache was invalidated.
 */
export const checkContentVersion = async (
  supabase: SupabaseClient,
  courseCode: string
): Promise<boolean> => {
  try {
    const versionKey = `${CONTENT_VERSION_PREFIX}${courseCode}`
    const storedVersion = localStorage.getItem(versionKey)

    const { data: course, error } = await supabase
      .from('courses')
      .select('content_version')
      .eq('course_code', courseCode)
      .single()

    if (error || !course?.content_version) return false

    const currentVersion = course.content_version

    if (storedVersion && storedVersion !== currentVersion) {
      console.log(`[ScriptCache] Content version changed: ${storedVersion} → ${currentVersion} — clearing caches`)

      // Clear script cache for this course (now in IndexedDB)
      try { await (await scriptDb()).delete(SCRIPT_STORE, idbKey(courseCode)) } catch { /* noop */ }

      // Clear Service Worker audio cache (CacheFirst entries with old UUIDs)
      try {
        await caches.delete(AUDIO_CACHE_NAME)
        console.log('[ScriptCache] Audio cache cleared')
      } catch {
        // Cache API may not be available
      }

      localStorage.setItem(versionKey, currentVersion)
      return true
    }

    // First visit or version unchanged — store current version
    if (!storedVersion) {
      localStorage.setItem(versionKey, currentVersion)
    }

    return false
  } catch (err) {
    // Offline or Supabase unavailable — use cached data, don't invalidate
    return false
  }
}

// ============================================================================
// AUDIO CACHE (Cache API)
// ============================================================================

// Cache an audio file for offline use
export const cacheAudio = async (url: string): Promise<void> => {
  try {
    const cache = await caches.open(AUDIO_CACHE_NAME)

    // Check if already cached
    const existing = await cache.match(url)
    if (existing) return

    // Fetch and cache
    const response = await fetch(url)
    if (response.ok) {
      await cache.put(url, response.clone())
    }
  } catch (err) {
    // Don't log - audio caching is best-effort
  }
}

// Get cached audio (returns cached version if available, else fetches)
export const getCachedAudio = async (url: string): Promise<Response | null> => {
  try {
    const cache = await caches.open(AUDIO_CACHE_NAME)
    const cached = await cache.match(url)
    if (cached) return cached

    // Not cached, fetch it (and cache for next time)
    const response = await fetch(url)
    if (response.ok) {
      await cache.put(url, response.clone())
      return response
    }
    return null
  } catch (err) {
    return null
  }
}

// Preload audio for upcoming items (call this during learning)
export const preloadAudioBatch = async (urls: string[]): Promise<void> => {
  try {
    const cache = await caches.open(AUDIO_CACHE_NAME)

    // Check what's already cached
    const uncached = await Promise.all(
      urls.map(async (url) => {
        const existing = await cache.match(url)
        return existing ? null : url
      })
    )

    // Fetch uncached URLs in parallel
    const toFetch = uncached.filter(Boolean) as string[]
    if (toFetch.length === 0) return

    await Promise.all(
      toFetch.map(async (url) => {
        try {
          const response = await fetch(url)
          if (response.ok) {
            await cache.put(url, response.clone())
          }
        } catch {
          // Individual failures don't block others
        }
      })
    )

    console.log('[ScriptCache] Preloaded', toFetch.length, 'audio files')
  } catch (err) {
    console.warn('[ScriptCache] Audio preload failed:', err)
  }
}

// Get cache stats
export const getAudioCacheStats = async (): Promise<{ count: number; estimatedMB: number }> => {
  try {
    const cache = await caches.open(AUDIO_CACHE_NAME)
    const keys = await cache.keys()
    // Estimate ~25KB per audio file
    return {
      count: keys.length,
      estimatedMB: Math.round(keys.length * 25 / 1024 * 10) / 10
    }
  } catch {
    return { count: 0, estimatedMB: 0 }
  }
}

// ============================================================================
// LAZY AUDIO LOOKUP (Supabase)
// ============================================================================

/**
 * Lazy audio lookup using v13 schema (course_audio table)
 * Returns s3_key which can be used to construct the full URL
 *
 * v13 schema: course_audio has text_normalized, role, s3_key
 * The s3_key contains the full path (e.g., "mastered/UUID.mp3")
 */
export const lookupAudioLazy = async (
  supabase: SupabaseClient,
  courseCode: string,
  text: string,
  role: string,
  audioMap: Map<string, any>
): Promise<string | null> => {
  // Check in-memory cache first
  const cached = audioMap.get(text)
  if (cached?.[role]) {
    return cached[role]
  }

  // v13: Query course_audio directly by text_normalized and role
  try {
    const { data: audio, error } = await supabase
      .from('course_audio')
      .select('id, s3_key')
      .eq('course_code', courseCode)
      .eq('text_normalized', text.toLowerCase().trim())
      .eq('role', role)
      .maybeSingle()

    if (error) {
      console.warn('[ScriptCache] Audio lookup query error:', error.message)
      return null
    }

    if (!audio || !audio.s3_key) {
      // No audio found for this text/role combination
      return null
    }

    // Cache for future use - store s3_key directly
    if (!audioMap.has(text)) {
      audioMap.set(text, {})
    }
    audioMap.get(text)[role] = audio.s3_key
    return audio.s3_key
  } catch (err) {
    console.warn('[ScriptCache] Lazy audio lookup failed:', err)
    return null
  }
}

// Load intro audio for LEGOs from lego_introductions table
// Handles both v13 (presentation_audio_id → course_audio) and legacy (audio_uuid)
// Uses batched queries to avoid Supabase URL length limits (400 error)
export const loadIntroAudio = async (
  supabase: SupabaseClient,
  courseCode: string,
  legoIds: Set<string>,
  audioMap: Map<string, any>
): Promise<void> => {
  if (legoIds.size === 0) return

  const BATCH_SIZE = 100
  const legoIdArray = [...legoIds]

  try {
    // Batch query lego_introductions to avoid URL length limits
    let allIntroData: any[] = []
    for (let i = 0; i < legoIdArray.length; i += BATCH_SIZE) {
      const batchIds = legoIdArray.slice(i, i + BATCH_SIZE)
      const { data: batchData, error } = await supabase
        .from('lego_introductions')
        .select('lego_id, presentation_audio_id, audio_uuid')
        .eq('course_code', courseCode)
        .in('lego_id', batchIds)

      if (error) {
        console.warn('[ScriptCache] Could not load intro audio batch:', error)
        continue
      }
      if (batchData) {
        allIntroData = allIntroData.concat(batchData)
      }
    }

    const introData = allIntroData

    // Track which LEGOs have intro audio from lego_introductions
    const foundLegoIds = new Set<string>()

    // Separate v13 (has presentation_audio_id) from legacy (only audio_uuid)
    const v13Entries = introData.filter(i => i.presentation_audio_id)
    const legacyEntries = introData.filter(i => !i.presentation_audio_id && i.audio_uuid)

    // Handle v13 entries: lookup s3_key from course_audio (also batched)
    if (v13Entries.length > 0) {
      const audioIds = v13Entries.map(i => i.presentation_audio_id)
      const s3KeyMap = new Map<string, string>()

      // Batch the course_audio queries
      for (let i = 0; i < audioIds.length; i += BATCH_SIZE) {
        const batchAudioIds = audioIds.slice(i, i + BATCH_SIZE)
        const { data: audioData } = await supabase
          .from('course_audio')
          .select('id, s3_key')
          .in('id', batchAudioIds)

        for (const audio of (audioData || [])) {
          if (audio.id && audio.s3_key) {
            s3KeyMap.set(audio.id, audio.s3_key)
          }
        }
      }

      for (const intro of v13Entries) {
        const s3Key = s3KeyMap.get(intro.presentation_audio_id)
        if (s3Key) {
          audioMap.set(`intro:${intro.lego_id}`, { intro: s3Key })
          foundLegoIds.add(intro.lego_id)
        }
      }
      console.log('[ScriptCache] Loaded', v13Entries.length, 'intro audio entries (v13)')
    }

    // Handle legacy entries: use audio_uuid directly (URL: mastered/{UUID}.mp3)
    for (const intro of legacyEntries) {
      audioMap.set(`intro:${intro.lego_id}`, { intro: intro.audio_uuid })
      foundLegoIds.add(intro.lego_id)
    }
    if (legacyEntries.length > 0) {
      console.log('[ScriptCache] Loaded', legacyEntries.length, 'intro audio entries (legacy)')
    }

    // FALLBACK: Query course_audio for LEGOs not in lego_introductions
    // This handles courses (like Portuguese) where intro audio is in course_audio
    // but not linked via lego_introductions table
    const missingLegoIds = legoIdArray.filter(id => !foundLegoIds.has(id))
    if (missingLegoIds.length > 0) {
      console.log('[ScriptCache] Looking for', missingLegoIds.length, 'missing intro audios in course_audio')

      for (let i = 0; i < missingLegoIds.length; i += BATCH_SIZE) {
        const batchIds = missingLegoIds.slice(i, i + BATCH_SIZE)
        const { data: presentationAudio, error: presError } = await supabase
          .from('course_audio')
          .select('id, lego_id, s3_key')
          .eq('course_code', courseCode)
          .eq('role', 'presentation')
          .in('lego_id', batchIds)

        if (presError) {
          console.warn('[ScriptCache] Presentation audio query error:', presError.message)
          continue
        }

        if (presentationAudio && presentationAudio.length > 0) {
          for (const audio of presentationAudio) {
            if (audio.lego_id && audio.s3_key && !audioMap.has(`intro:${audio.lego_id}`)) {
              audioMap.set(`intro:${audio.lego_id}`, { intro: audio.s3_key })
              foundLegoIds.add(audio.lego_id)
            }
          }
        }
      }

      const foundFromFallback = missingLegoIds.filter(id => foundLegoIds.has(id)).length
      if (foundFromFallback > 0) {
        console.log('[ScriptCache] Found', foundFromFallback, 'intro audios from course_audio fallback')
      }
    }

  } catch (err) {
    console.warn('[ScriptCache] Intro audio load failed:', err)
  }
}

// ============================================================================
// COMPOSABLE
// ============================================================================

export function useScriptCache() {
  const audioMap: Ref<Map<string, any>> = ref(new Map())
  const currentCourseCode: Ref<string> = ref('')

  /**
   * Build full URL from audio key (handles both v13 s3_key and legacy UUID)
   */
  const buildAudioUrl = (audioKey: string, audioBaseUrl: string): string => {
    // v13: s3_key includes path (e.g., "mastered/UUID.mp3") - use as-is
    if (audioKey.includes('/') || audioKey.endsWith('.mp3')) {
      return `${audioBaseUrl}/${audioKey}`
    }
    // Legacy: raw UUID - build path as mastered/{UUID}.mp3
    return `${audioBaseUrl}/mastered/${audioKey.toUpperCase()}.mp3`
  }

  /**
   * Get audio URL for a text/role combination
   * Handles both v13 s3_keys and legacy UUIDs
   */
  const getAudioUrl = async (
    supabase: SupabaseClient | null,
    text: string,
    role: string,
    item?: ScriptItem | null,
    audioBaseUrl: string = 'https://ssi-audio-stage.s3.eu-west-1.amazonaws.com'
  ): Promise<string | null> => {
    // For INTRO items, look up by lego_id
    if (role === 'intro' && item?.legoId) {
      const introEntry = audioMap.value.get(`intro:${item.legoId}`)
      if (introEntry?.intro) {
        return buildAudioUrl(introEntry.intro, audioBaseUrl)
      }
      return null
    }

    // Check in-memory cache
    const audioEntry = audioMap.value.get(text)
    let audioKey = audioEntry?.[role]

    // Lazy load from Supabase if not cached
    if (!audioKey && supabase && currentCourseCode.value) {
      audioKey = await lookupAudioLazy(supabase, currentCourseCode.value, text, role, audioMap.value)
    }

    if (!audioKey) return null

    return buildAudioUrl(audioKey, audioBaseUrl)
  }

  return {
    audioMap,
    currentCourseCode,
    getCachedScript,
    setCachedScript,
    checkContentVersion,
    loadIntroAudio,
    lookupAudioLazy,
    getAudioUrl,
    resetCacheState,
    // New audio caching functions
    cacheAudio,
    getCachedAudio,
    preloadAudioBatch,
    getAudioCacheStats
  }
}
