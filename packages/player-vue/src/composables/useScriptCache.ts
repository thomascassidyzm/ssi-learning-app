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
import type { SupabaseClient } from '@supabase/supabase-js'

// Cache configuration
const SCRIPT_KEY_PREFIX = 'ssi-script-v2-' // v2: fixed DEBUT items in rounds
const AUDIO_CACHE_NAME = 'ssi-audio-v1'
const CACHE_TTL_MS = 24 * 60 * 60 * 1000 // 24 hours

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
}

// ============================================================================
// SCRIPT CACHE (localStorage)
// ============================================================================

export const getCachedScript = async (courseCode: string): Promise<CachedScript | null> => {
  try {
    const key = `${SCRIPT_KEY_PREFIX}${courseCode}`
    const stored = localStorage.getItem(key)
    if (!stored) return null

    const data = JSON.parse(stored) as CachedScript

    // Check TTL
    if (Date.now() - data.cachedAt < CACHE_TTL_MS) {
      console.log('[ScriptCache] Loaded from localStorage')
      return data
    }

    // Expired
    localStorage.removeItem(key)
    return null
  } catch (err) {
    console.warn('[ScriptCache] Read failed:', err)
    return null
  }
}

export const setCachedScript = async (
  courseCode: string,
  data: Omit<CachedScript, 'courseCode' | 'cachedAt'>
): Promise<void> => {
  try {
    const key = `${SCRIPT_KEY_PREFIX}${courseCode}`
    const fullData: CachedScript = {
      courseCode,
      ...data,
      cachedAt: Date.now()
    }

    // Strip audioMapObj to save space - audio UUIDs are in audioRefs per item
    const slimData = { ...fullData, audioMapObj: {} }
    localStorage.setItem(key, JSON.stringify(slimData))
    console.log('[ScriptCache] Saved to localStorage')
  } catch (err) {
    // localStorage might be full (5MB limit)
    console.warn('[ScriptCache] Write failed:', err)
    // Try to clear old scripts to make room
    clearOldScripts(courseCode)
  }
}

// Clear scripts for other courses to make room
const clearOldScripts = (keepCourseCode: string) => {
  try {
    const keysToRemove: string[] = []
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i)
      if (key?.startsWith(SCRIPT_KEY_PREFIX) && key !== `${SCRIPT_KEY_PREFIX}${keepCourseCode}`) {
        keysToRemove.push(key)
      }
    }
    keysToRemove.forEach(key => localStorage.removeItem(key))
    console.log('[ScriptCache] Cleared', keysToRemove.length, 'old scripts')
  } catch (err) {
    console.warn('[ScriptCache] Failed to clear old scripts:', err)
  }
}

export const resetCacheState = async (): Promise<void> => {
  try {
    // Clear all script caches from localStorage
    const keysToRemove: string[] = []
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i)
      if (key?.startsWith(SCRIPT_KEY_PREFIX)) {
        keysToRemove.push(key)
      }
    }
    keysToRemove.forEach(key => localStorage.removeItem(key))

    // Clear audio cache
    await caches.delete(AUDIO_CACHE_NAME)

    console.log('[ScriptCache] All caches cleared')
  } catch (err) {
    console.warn('[ScriptCache] Reset failed:', err)
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

export const lookupAudioLazy = async (
  supabase: SupabaseClient,
  courseCode: string,
  text: string,
  role: string,
  audioMap: Map<string, any>
): Promise<string | null> => {
  // Check in-memory cache first
  const cached = audioMap.get(text)
  const cacheRole = role === 'source' ? 'source' : role
  if (cached?.[cacheRole]) {
    return cached[cacheRole]
  }

  // Query Supabase: texts → audio_files → course_audio
  try {
    const { data: textsData } = await supabase
      .from('texts')
      .select('id')
      .eq('content', text)
      .limit(1)

    if (!textsData || textsData.length === 0) return null

    const textId = textsData[0].id

    const { data: audioData } = await supabase
      .from('audio_files')
      .select('id')
      .eq('text_id', textId)

    if (!audioData || audioData.length === 0) return null

    const audioIds = audioData.map((a: any) => a.id)
    const dbRole = role === 'source' ? 'known' : role

    const { data: courseAudio } = await supabase
      .from('course_audio')
      .select('audio_id, role')
      .eq('course_code', courseCode)
      .in('audio_id', audioIds)

    for (const ca of (courseAudio || [])) {
      if (ca.role === dbRole) {
        if (!audioMap.has(text)) {
          audioMap.set(text, {})
        }
        const storeRole = role === 'source' ? 'source' : role
        audioMap.get(text)[storeRole] = ca.audio_id
        return ca.audio_id
      }
    }

    return null
  } catch (err) {
    console.warn('[ScriptCache] Lazy audio lookup failed:', err)
    return null
  }
}

// Load intro audio UUIDs for LEGOs
export const loadIntroAudio = async (
  supabase: SupabaseClient,
  courseCode: string,
  legoIds: Set<string>,
  audioMap: Map<string, any>
): Promise<void> => {
  if (legoIds.size === 0) return

  try {
    const { data: introData, error } = await supabase
      .from('lego_introductions')
      .select('lego_id, audio_uuid')
      .eq('course_code', courseCode)
      .in('lego_id', [...legoIds])

    if (error) {
      console.warn('[ScriptCache] Could not load intro audio:', error)
      return
    }

    for (const intro of (introData || [])) {
      audioMap.set(`intro:${intro.lego_id}`, { intro: intro.audio_uuid })
    }

    console.log('[ScriptCache] Loaded', introData?.length || 0, 'intro audio entries')
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

  const getAudioUrl = async (
    supabase: SupabaseClient | null,
    text: string,
    role: string,
    item?: ScriptItem | null,
    audioBaseUrl: string = 'https://ssi-audio-stage.s3.eu-west-1.amazonaws.com/mastered'
  ): Promise<string | null> => {
    // For INTRO items, look up by lego_id
    if (role === 'intro' && item?.legoId) {
      const introEntry = audioMap.value.get(`intro:${item.legoId}`)
      if (introEntry?.intro) {
        return `${audioBaseUrl}/${introEntry.intro.toUpperCase()}.mp3`
      }
      return null
    }

    // Check in-memory cache
    const audioEntry = audioMap.value.get(text)
    let uuid = audioEntry?.[role]

    // Lazy load from Supabase if not cached
    if (!uuid && supabase && currentCourseCode.value) {
      uuid = await lookupAudioLazy(supabase, currentCourseCode.value, text, role, audioMap.value)
    }

    if (!uuid) return null

    return `${audioBaseUrl}/${uuid.toUpperCase()}.mp3`
  }

  return {
    audioMap,
    currentCourseCode,
    getCachedScript,
    setCachedScript,
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
