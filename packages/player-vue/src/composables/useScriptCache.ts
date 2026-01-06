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
// Bump version when script generation logic or database schema changes
const SCRIPT_KEY_PREFIX = 'ssi-script-v5-' // v5: fixed phrase loading - uses provider's internal client
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
export const loadIntroAudio = async (
  supabase: SupabaseClient,
  courseCode: string,
  legoIds: Set<string>,
  audioMap: Map<string, any>
): Promise<void> => {
  if (legoIds.size === 0) return

  try {
    // Query lego_introductions
    const { data: introData, error } = await supabase
      .from('lego_introductions')
      .select('lego_id, presentation_audio_id, audio_uuid')
      .eq('course_code', courseCode)
      .in('lego_id', [...legoIds])

    if (error) {
      console.warn('[ScriptCache] Could not load intro audio:', error)
      return
    }

    if (!introData || introData.length === 0) {
      console.log('[ScriptCache] No intro audio found for LEGOs')
      return
    }

    // Separate v13 (has presentation_audio_id) from legacy (only audio_uuid)
    const v13Entries = introData.filter(i => i.presentation_audio_id)
    const legacyEntries = introData.filter(i => !i.presentation_audio_id && i.audio_uuid)

    // Handle v13 entries: lookup s3_key from course_audio
    if (v13Entries.length > 0) {
      const audioIds = v13Entries.map(i => i.presentation_audio_id)
      const { data: audioData } = await supabase
        .from('course_audio')
        .select('id, s3_key')
        .in('id', audioIds)

      const s3KeyMap = new Map<string, string>()
      for (const audio of (audioData || [])) {
        if (audio.id && audio.s3_key) {
          s3KeyMap.set(audio.id, audio.s3_key)
        }
      }

      for (const intro of v13Entries) {
        const s3Key = s3KeyMap.get(intro.presentation_audio_id)
        if (s3Key) {
          audioMap.set(`intro:${intro.lego_id}`, { intro: s3Key })
        }
      }
      console.log('[ScriptCache] Loaded', v13Entries.length, 'intro audio entries (v13)')
    }

    // Handle legacy entries: use audio_uuid directly (URL: mastered/{UUID}.mp3)
    for (const intro of legacyEntries) {
      audioMap.set(`intro:${intro.lego_id}`, { intro: intro.audio_uuid })
    }
    if (legacyEntries.length > 0) {
      console.log('[ScriptCache] Loaded', legacyEntries.length, 'intro audio entries (legacy)')
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
