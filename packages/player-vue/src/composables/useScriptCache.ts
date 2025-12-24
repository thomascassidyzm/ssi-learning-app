/**
 * Shared Script Cache - Used by both CourseExplorer and LearningPlayer
 *
 * Stores the learning script (rounds, items) in IndexedDB so:
 * - CourseExplorer can preview the full script
 * - LearningPlayer can play through rounds without re-fetching
 * - Audio is lazily loaded on-demand
 */

import { ref, type Ref } from 'vue'
import type { SupabaseClient } from '@supabase/supabase-js'

// Cache configuration
const DB_NAME = 'ssi-script-cache'
const DB_VERSION = 3 // Must match CourseExplorer
const STORE_NAME = 'scripts'
const CACHE_TTL_MS = 24 * 60 * 60 * 1000 // 24 hours
const LS_KEY_PREFIX = 'ssi-script-'

let dbInstance: IDBDatabase | null = null
let indexedDBFailed = false // Track if IndexedDB is broken, skip it next time

// Reset cache state - useful for debugging or recovering from corruption
export const resetCacheState = async (): Promise<void> => {
  indexedDBFailed = false
  dbInstance = null
  try {
    // Try to delete the corrupted database
    const deleteRequest = indexedDB.deleteDatabase(DB_NAME)
    await new Promise<void>((resolve) => {
      deleteRequest.onsuccess = () => resolve()
      deleteRequest.onerror = () => resolve() // Don't fail, just continue
      deleteRequest.onblocked = () => resolve()
    })
    console.log('[ScriptCache] Database reset complete')
  } catch (err) {
    console.warn('[ScriptCache] Database reset failed:', err)
  }
}

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
  estimatedMinutes: number
  audioMapObj: Record<string, any>
  cachedAt: number
  // Course-level welcome audio (plays once on first visit)
  courseWelcome?: CourseWelcome
}

// localStorage fallback functions (for when IndexedDB fails)
const getFromLocalStorage = (courseCode: string): CachedScript | null => {
  try {
    const key = `${LS_KEY_PREFIX}${courseCode}`
    const stored = localStorage.getItem(key)
    if (!stored) return null

    const data = JSON.parse(stored) as CachedScript
    // Check TTL
    if (Date.now() - data.cachedAt < CACHE_TTL_MS) {
      console.log('[ScriptCache] Loaded from localStorage fallback')
      return data
    }
    // Expired, remove it
    localStorage.removeItem(key)
    return null
  } catch (err) {
    console.warn('[ScriptCache] localStorage read failed:', err)
    return null
  }
}

const setToLocalStorage = (courseCode: string, data: CachedScript): boolean => {
  try {
    const key = `${LS_KEY_PREFIX}${courseCode}`
    // Strip audioMapObj to save space - it can be rebuilt
    const slimData = { ...data, audioMapObj: {} }
    localStorage.setItem(key, JSON.stringify(slimData))
    console.log('[ScriptCache] Saved to localStorage fallback')
    return true
  } catch (err) {
    // localStorage might be full (5MB limit)
    console.warn('[ScriptCache] localStorage write failed:', err)
    return false
  }
}

// Open IndexedDB
const openDB = (): Promise<IDBDatabase> => {
  return new Promise((resolve, reject) => {
    if (dbInstance) {
      resolve(dbInstance)
      return
    }

    const request = indexedDB.open(DB_NAME, DB_VERSION)

    request.onerror = () => reject(request.error)
    request.onsuccess = () => {
      dbInstance = request.result
      resolve(dbInstance)
    }

    request.onupgradeneeded = (event) => {
      const db = (event.target as IDBOpenDBRequest).result
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: 'courseCode' })
      }
    }
  })
}

// Get cached script
export const getCachedScript = async (courseCode: string): Promise<CachedScript | null> => {
  // If IndexedDB previously failed, go straight to localStorage
  if (indexedDBFailed) {
    return getFromLocalStorage(courseCode)
  }

  const timeoutPromise = new Promise<never>((_, reject) => {
    setTimeout(() => reject(new Error('Cache timeout after 500ms')), 500)
  })

  try {
    const db = await Promise.race([openDB(), timeoutPromise])

    const result = await Promise.race([
      new Promise<CachedScript | null>((resolve, reject) => {
        const tx = db.transaction(STORE_NAME, 'readonly')
        const store = tx.objectStore(STORE_NAME)
        const request = store.get(courseCode)
        request.onerror = () => reject(request.error)
        request.onsuccess = () => {
          const data = request.result
          // Check TTL
          if (data && Date.now() - data.cachedAt < CACHE_TTL_MS) {
            resolve(data)
          } else {
            resolve(null)
          }
        }
      }),
      timeoutPromise
    ])

    return result
  } catch (err) {
    console.warn('[ScriptCache] IndexedDB read failed, trying localStorage:', err)
    indexedDBFailed = true
    dbInstance = null // Reset so we don't keep a bad reference
    return getFromLocalStorage(courseCode)
  }
}

// Set cached script
export const setCachedScript = async (courseCode: string, data: Omit<CachedScript, 'courseCode' | 'cachedAt'>): Promise<void> => {
  const fullData: CachedScript = {
    courseCode,
    ...data,
    cachedAt: Date.now()
  }

  // If IndexedDB previously failed, go straight to localStorage
  if (indexedDBFailed) {
    setToLocalStorage(courseCode, fullData)
    return
  }

  const timeoutPromise = new Promise<never>((_, reject) => {
    setTimeout(() => reject(new Error('Cache write timeout after 2s')), 2000)
  })

  try {
    const db = await Promise.race([openDB(), timeoutPromise])

    await Promise.race([
      new Promise<void>((resolve, reject) => {
        const tx = db.transaction(STORE_NAME, 'readwrite')
        const store = tx.objectStore(STORE_NAME)
        const request = store.put(fullData)
        request.onerror = () => reject(request.error)
        request.onsuccess = () => resolve()
      }),
      timeoutPromise
    ])
    console.log('[ScriptCache] Saved to IndexedDB')
  } catch (err) {
    console.warn('[ScriptCache] IndexedDB write failed, trying localStorage:', err)
    indexedDBFailed = true
    dbInstance = null
    setToLocalStorage(courseCode, fullData)
  }
}

// Lazy audio lookup - queries DB on-demand and caches result
export const lookupAudioLazy = async (
  supabase: SupabaseClient,
  courseCode: string,
  text: string,
  role: string,
  audioMap: Map<string, any>
): Promise<string | null> => {
  // Check cache first
  const cached = audioMap.get(text)
  const cacheRole = role === 'source' ? 'source' : role
  if (cached?.[cacheRole]) {
    return cached[cacheRole]
  }

  // Query the v12 chain: texts → audio_files → course_audio
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

    // For known/source audio, look for 'known' role; for target, look for target1/target2
    const dbRole = role === 'source' ? 'known' : role

    const { data: courseAudio } = await supabase
      .from('course_audio')
      .select('audio_id, role')
      .eq('course_code', courseCode)
      .in('audio_id', audioIds)

    // Find matching role
    for (const ca of (courseAudio || [])) {
      if (ca.role === dbRole) {
        // Cache the result
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

// Load intro audio for a set of LEGOs
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

// Composable for using the script cache
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

    // Check cache first
    const audioEntry = audioMap.value.get(text)
    let uuid = audioEntry?.[role]

    // Lazy load if not in cache
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
    resetCacheState
  }
}
