/**
 * CourseDataProvider - Load course data from Supabase or manifest fallback
 *
 * Provides abstraction for loading learning items with backwards compatibility.
 *
 * Audio Architecture (v13.1 - January 2026):
 * - course_audio: Flat, course-owned audio (one row per course+text+language+role)
 * - shared_audio: Template table - copied to course_audio at import time
 * - S3 storage: s3_key contains full path (e.g., "uuid.mp3" or "mastered/ABC123.mp3")
 * - Learning app ONLY queries course_audio - shared_audio is an authoring concern
 *
 * Audio IDs stored directly on course_legos and course_practice_phrases.
 * No views or text-based joins needed - simple, robust, can't desync.
 *
 * Roles: known, target1, target2, presentation, encouragement, instruction
 *
 * Key v13.1 changes:
 * - courses.course_code (renamed from 'code' 2026-01-18), voice_config JSONB (not separate voice columns)
 * - Order phrases by target1_duration_ms (not word_count) for cognitive load
 * - Use s3_key from database for URLs (not id with .mp3 appended)
 * - audio_samples table is DEPRECATED - do not use
 *
 * @see apml/core/audio-registry-v13.apml for full schema specification
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import type {
  ClassifiedBasket,
  PracticePhrase,
  AudioRef,
  LegoPair,
} from '@ssi/core'

export interface LearningItem {
  lego: {
    id: string
    type: string
    new: boolean
    lego: { known: string; target: string }
    audioRefs: {
      known: { id: string; url: string }
      target: {
        voice1: { id: string; url: string }
        voice2: { id: string; url: string }
      }
    }
  }
  phrase: {
    id: string
    phraseType: string
    phrase: { known: string; target: string }
    audioRefs: {
      known: { id: string; url: string }
      target: {
        voice1: { id: string; url: string }
        voice2: { id: string; url: string }
      }
    }
    wordCount: number
    containsLegos: string[]
  }
  seed: {
    seed_id: string
    seed_pair: { known: string; target: string }
    legos: string[]
  }
  thread_id: number
  mode: string
  audioDurations?: {
    source: number
    target1: number
    target2: number
  }
}

export interface CourseDataProviderConfig {
  supabaseClient?: SupabaseClient
  audioBaseUrl: string
  courseId?: string
}

// Set to true to enable verbose logging (for debugging only)
const DEBUG_LOGGING = false

/**
 * Parse legoId (SXXXXLYY) into seed_number and lego_index
 * Returns null if format is invalid
 */
function parseLegoId(legoId: string): { seedNumber: number; legoIndex: number } | null {
  const match = legoId.match(/^S(\d+)L(\d+)$/)
  if (!match) return null
  return { seedNumber: parseInt(match[1], 10), legoIndex: parseInt(match[2], 10) }
}

export class CourseDataProvider {
  private client?: SupabaseClient
  private audioBaseUrl: string
  private courseId: string
  private loggedOnce = new Set<string>()  // Prevent console spam
  private warnedOnce = new Set<string>()  // Prevent warning spam

  constructor(config: CourseDataProviderConfig) {
    this.client = config.supabaseClient
    this.audioBaseUrl = config.audioBaseUrl
    this.courseId = config.courseId || 'demo'
  }

  /** Log once per unique key - prevents spam. Respects DEBUG_LOGGING flag. */
  private logOnce(key: string, level: 'log' | 'warn' | 'error', ...args: any[]): void {
    if (!DEBUG_LOGGING) return  // Silent mode
    if (this.loggedOnce.has(key)) return
    this.loggedOnce.add(key)
    console[level](...args)
  }

  /**
   * Get the Supabase client (for use by generateLearningScript)
   * This ensures all database access uses the same client instance
   */
  getClient(): SupabaseClient | undefined {
    return this.client
  }

  /**
   * Get the audio base URL
   */
  getAudioBaseUrl(): string {
    return this.audioBaseUrl
  }

  /**
   * Get the course ID
   */
  getCourseId(): string {
    return this.courseId
  }

  /**
   * Get the maximum seed number that has PLAYABLE content (LEGOs with audio).
   * A seed is playable if it has at least one LEGO with all required audio UUIDs.
   * Used to determine course length for priority loading and end-of-course detection.
   * Returns null if unable to determine.
   */
  async getMaxSeedNumber(): Promise<number | null> {
    if (!this.client) return null

    try {
      // Query for the highest seed_number that has complete audio data
      // A LEGO is playable if it has known, target1, AND target2 audio
      const { data, error } = await this.client
        .from('course_legos')
        .select('seed_number')
        .eq('course_code', this.courseId)
        .not('known_audio_id', 'is', null)
        .not('target1_audio_id', 'is', null)
        .not('target2_audio_id', 'is', null)
        .order('seed_number', { ascending: false })
        .limit(1)
        .single()

      if (error || !data) {
        // Could not determine max playable seed
        return null
      }

      return data.seed_number
    } catch (err) {
      console.warn('[CourseDataProvider] Error getting max seed:', err)
      return null
    }
  }

  /**
   * Load learning items for a session
   * Tries database first, falls back to demo items if not available
   */
  async loadSessionItems(startSeed: number = 1, count: number = 30): Promise<LearningItem[]> {
    // If no Supabase client, return empty array (caller will use demo fallback)
    if (!this.client) {
      // console.warn('[CourseDataProvider] No Supabase client configured, using demo mode')
      return []
    }

    try {
      // Query course_legos table directly - audio IDs stored on each row
      // Note: Supabase JS client defaults to 1000 rows - we set explicit limit for large courses
      // Invariant: a cycle must never present without all three audio IDs,
      // or the player fails mid-cycle (partial-import courses like Greek).
      const { data, error } = await this.client
        .from('course_legos')
        .select('*')
        .eq('course_code', this.courseId)
        .gte('seed_number', startSeed)
        .lt('seed_number', startSeed + count)
        .not('known_audio_id', 'is', null)
        .not('target1_audio_id', 'is', null)
        .not('target2_audio_id', 'is', null)
        .order('seed_number', { ascending: true })
        .order('lego_index', { ascending: true })
        .limit(10000)  // Override default 1000 row limit

      if (error) {
        console.error('[CourseDataProvider] Query error:', error)
        return []
      }

      if (!data || data.length === 0) {
        return []
      }

      // Transform database records to LearningItem format
      return this.transformToLearningItems(data)
    } catch (err) {
      // console.error('[CourseDataProvider] Failed to load items:', err)
      return []
    }
  }

  /**
   * Transform database records to LearningItem format
   * Maps course_legos fields to LearningItem structure
   * v2.2: Uses proxy URLs via /api/audio/{audioId} for CORS bypass
   */
  private transformToLearningItems(records: any[]): LearningItem[] {
    return records.map((record) => {
      const legoId = record.lego_id
      const seedId = `S${String(record.seed_number).padStart(4, '0')}`

      // v2.2: Build proxy URLs from audio IDs (bypasses CORS)
      const knownAudioUrl = this.buildProxyUrl(record.known_audio_id)
      const target1AudioUrl = this.buildProxyUrl(record.target1_audio_id)
      const target2AudioUrl = this.buildProxyUrl(record.target2_audio_id)

      // Parse M-LEGO components from JSONB: [{known: "with", target: "con"}, ...]
      const components = record.type === 'M' && Array.isArray(record.components)
        ? record.components.map((c: any) => ({ known: c.known || '', target: c.target || '' }))
        : undefined

      return {
        lego: {
          id: legoId,
          type: record.type || 'A',
          new: record.is_new,
          lego: {
            known: record.known_text,
            target: record.target_text,
          },
          components,
          audioRefs: {
            known: {
              id: record.known_audio_id,
              url: knownAudioUrl
            },
            target: {
              voice1: {
                id: record.target1_audio_id,
                url: target1AudioUrl
              },
              voice2: {
                id: record.target2_audio_id,
                url: target2AudioUrl
              },
            },
          },
        },
        phrase: {
          id: `${legoId}_P1`,
          phraseType: record.is_new ? 'debut' : 'practice',
          phrase: {
            known: record.known_text,
            target: record.target_text,
          },
          audioRefs: {
            known: {
              id: record.known_audio_id,
              url: knownAudioUrl
            },
            target: {
              voice1: {
                id: record.target1_audio_id,
                url: target1AudioUrl
              },
              voice2: {
                id: record.target2_audio_id,
                url: target2AudioUrl
              },
            },
          },
          wordCount: record.target_text ? record.target_text.split(/\s+/).length : 1,
          containsLegos: [legoId],
        },
        seed: {
          seed_id: seedId,
          seed_pair: {
            known: record.known_text,  // For now, use LEGO text (seed text would come from seed_cycles)
            target: record.target_text,
          },
          legos: [legoId],
        },
        thread_id: (record.seed_number % 3) + 1,  // Card-deal distribution: 1→A, 2→B, 3→C, 4→A...
        mode: record.is_new ? 'introduction' : 'practice',
        audioDurations: {
          source: record.known_duration_ms ? record.known_duration_ms / 1000 : 2.0,
          target1: record.target1_duration_ms ? record.target1_duration_ms / 1000 : 2.5,
          target2: record.target2_duration_ms ? record.target2_duration_ms / 1000 : 2.5,
        },
      }
    })
  }

  /**
   * Build proxy URL from audio UUID
   * v2.2: Routes through /api/audio/{audioId} for CORS bypass and analytics
   */
  private buildProxyUrl(audioId: string): string {
    if (!audioId || audioId === 'undefined' || audioId === 'null') {
      // Only warn once per type to prevent console spam
      const warnKey = `invalid-audioId-${audioId}`
      if (!this.warnedOnce.has(warnKey)) {
        this.warnedOnce.add(warnKey)
        // console.warn('[CourseDataProvider] Invalid audioId for proxy URL:', audioId, '(further occurrences suppressed)')
      }
      return ''
    }
    return `/api/audio/${audioId}?courseId=${encodeURIComponent(this.courseId)}`
  }

  /**
   * Get course metadata (uses 'course_code' - renamed from 'code' 2026-01-18)
   */
  async getCourseMetadata() {
    if (!this.client) return null

    try {
      const { data, error } = await this.client
        .from('courses')
        .select('*')
        .eq('course_code', this.courseId)
        .single()

      if (error) {
        // console.error('[CourseDataProvider] Failed to get course metadata:', error)
        return null
      }

      return data
    } catch (err) {
      // console.error('[CourseDataProvider] Error fetching metadata:', err)
      return null
    }
  }

  /**
   * Get welcome audio for the course (plays once on first load)
   * Welcome audio is in course_audio with role='welcome'
   */
  async getWelcomeAudio(): Promise<AudioRef & { text?: string } | null> {
    if (!this.client) return null

    try {
      // Query course_audio for welcome audio (role='welcome')
      const { data, error } = await this.client
        .from('course_audio')
        .select('id, s3_key, duration_ms, text')
        .eq('course_code', this.courseId)
        .eq('role', 'welcome')
        .limit(1)
        .maybeSingle()

      if (error || !data || !data.id) return null

      return {
        id: data.id,
        url: this.buildProxyUrl(data.id),  // v2.2: use proxy for CORS bypass
        duration_ms: data.duration_ms || null,
        text: data.text || null,
      }
    } catch (err) {
      // console.error('[CourseDataProvider] Error loading welcome audio:', err)
      return null
    }
  }

  /**
   * Check if a learner ID is a guest (not stored in database)
   */
  private isGuestLearner(learnerId: string | null | undefined): boolean {
    return !learnerId || learnerId === 'demo-learner' || learnerId.startsWith('guest-')
  }

  /**
   * Check if learner has already heard the welcome audio
   */
  async hasPlayedWelcome(learnerId: string): Promise<boolean> {
    // Guests don't have persistent welcome tracking - always play
    if (!this.client || this.isGuestLearner(learnerId)) return false

    try {
      const { data, error } = await this.client
        .from('course_enrollments')
        .select('welcome_played')
        .eq('learner_id', learnerId)
        .eq('course_id', this.courseId)
        .single()

      if (error || !data) return false // Not enrolled = hasn't played
      return data.welcome_played === true
    } catch (err) {
      // console.error('[CourseDataProvider] Error checking welcome status:', err)
      return true // Assume played on error
    }
  }

  /**
   * Mark welcome audio as played (or skipped) for a learner
   */
  async markWelcomePlayed(learnerId: string): Promise<void> {
    // Guests don't have persistent welcome tracking - skip silently
    if (!this.client || this.isGuestLearner(learnerId)) return

    try {
      const { error } = await this.client
        .from('course_enrollments')
        .update({ welcome_played: true })
        .eq('learner_id', learnerId)
        .eq('course_id', this.courseId)

      if (error) {
        // console.error('[CourseDataProvider] Error marking welcome played:', error)
      }
    } catch (err) {
      // console.error('[CourseDataProvider] Error updating welcome status:', err)
    }
  }

  /**
   * Load a ClassifiedBasket for a LEGO
   * Contains all phrases for the LEGO organized by type
   * v13: Orders by target1_duration_ms (audio duration = cognitive load)
   */
  async getLegoBasket(legoId: string, lego?: LegoPair): Promise<ClassifiedBasket | null> {
    if (!this.client) {
      // console.warn('[CourseDataProvider] No Supabase client, returning empty basket')
      return this.createEmptyBasket(legoId, lego)
    }

    try {
      // Parse legoId (SXXXXLYY) into seed_number + lego_index
      // course_practice_phrases table has no lego_id column — query by seed_number + lego_index
      const parsed = parseLegoId(legoId)
      if (!parsed) {
        return this.createEmptyBasket(legoId, lego)
      }

      // v13: Sort by target1_duration_ms for cognitive load (shortest audio = easiest)
      // Same audio-completeness invariant as course_legos — skip phrases with
      // any missing audio ID so the basket never contains un-playable cycles.
      const { data, error } = await this.client
        .from('course_practice_phrases')
        .select('*')
        .eq('seed_number', parsed.seedNumber)
        .eq('lego_index', parsed.legoIndex)
        .eq('course_code', this.courseId)
        .not('known_audio_id', 'is', null)
        .not('target1_audio_id', 'is', null)
        .not('target2_audio_id', 'is', null)
        .order('target1_duration_ms', { ascending: true, nullsFirst: false })

      if (error) {
        // console.error('[CourseDataProvider] Failed to load basket:', error)
        return this.createEmptyBasket(legoId, lego)
      }

      if (!data || data.length === 0) {
        // Only warn once per LEGO to prevent console spam
        const warnKey = `no-phrases-${legoId}`
        if (!this.warnedOnce.has(warnKey)) {
          this.warnedOnce.add(warnKey)
          // console.warn('[CourseDataProvider] No phrases found for LEGO:', legoId)
        }
        return this.createEmptyBasket(legoId, lego)
      }

      // Transform to ClassifiedBasket
      return this.transformToBasket(legoId, data, lego)
    } catch (err) {
      // console.error('[CourseDataProvider] Error loading basket:', err)
      return this.createEmptyBasket(legoId, lego)
    }
  }

  /**
   * Load baskets for multiple LEGOs at once (more efficient)
   * v13: Orders by target1_duration_ms (audio duration = cognitive load)
   */
  async getLegoBasketsForSeed(seedId: string): Promise<Map<string, ClassifiedBasket>> {
    const baskets = new Map<string, ClassifiedBasket>()

    if (!this.client) return baskets

    try {
      // Convert seed_id (e.g., "S0001") to seed_number (e.g., 1)
      const seedNumber = parseInt(seedId.replace(/^S0*/, ''), 10)
      if (isNaN(seedNumber)) {
        // console.warn('[CourseDataProvider] Invalid seed_id format:', seedId)
        return baskets
      }

      // Query practice_cycles for all LEGOs in this seed
      // v13: Sort by target1_duration_ms for cognitive load (shortest audio = easiest)
      // Audio-completeness invariant — see getLegoBasket.
      const { data, error } = await this.client
        .from('course_practice_phrases')
        .select('*')
        .eq('seed_number', seedNumber)
        .eq('course_code', this.courseId)
        .not('known_audio_id', 'is', null)
        .not('target1_audio_id', 'is', null)
        .not('target2_audio_id', 'is', null)
        .order('lego_index', { ascending: true })
        .order('target1_duration_ms', { ascending: true, nullsFirst: false })

      if (error) {
        // console.error('[CourseDataProvider] Failed to load seed baskets:', error)
        return baskets
      }

      if (!data || data.length === 0) return baskets

      // Group by constructed lego_id (table has seed_number + lego_index, not lego_id)
      const grouped = new Map<string, any[]>()
      for (const row of data) {
        const legoId = `S${String(row.seed_number).padStart(4, '0')}L${String(row.lego_index).padStart(2, '0')}`
        if (!grouped.has(legoId)) {
          grouped.set(legoId, [])
        }
        grouped.get(legoId)!.push(row)
      }

      // Transform each group to a basket
      for (const [legoId, rows] of grouped) {
        const basket = this.transformToBasket(legoId, rows)
        if (basket) {
          baskets.set(legoId, basket)
        }
      }

      // Suppress frequent progress logs during loading
      // this.logOnce('baskets-loaded', 'log', '[CourseDataProvider] Loaded baskets for', baskets.size, 'LEGOs')
      return baskets
    } catch (err) {
      // console.error('[CourseDataProvider] Error loading seed baskets:', err)
      return baskets
    }
  }

  /**
   * Get introduction audio for a LEGO ("The German for X is...")
   * Queries course_audio directly where role='presentation' and lego_id matches.
   */
  async getIntroductionAudio(legoId: string): Promise<{
    id: string
    url: string  // Presentation audio URL
    duration_ms?: number
    origin?: string
  } | null> {
    if (!this.client) return null

    try {
      // Query course_audio directly for presentation audio by lego_id
      const { data, error } = await this.client
        .from('course_audio')
        .select('id, s3_key, duration_ms, origin')
        .eq('course_code', this.courseId)
        .eq('role', 'presentation')
        .eq('lego_id', legoId)
        .maybeSingle()

      if (error) {
        // console.warn('[CourseDataProvider] Presentation audio query error:', error.message)
        return null
      }

      if (data?.id) {
        return {
          id: data.id,
          url: this.buildProxyUrl(data.id),  // v2.2: use proxy for CORS bypass
          duration_ms: data.duration_ms,
          origin: data.origin || 'tts',
        }
      }

      return null
    } catch (err) {
      // console.error('[CourseDataProvider] Error loading intro audio:', err)
      return null
    }
  }

  /**
   * Batch load introduction audio for multiple LEGOs
   * More efficient than individual getIntroductionAudio calls (one query instead of N)
   * @param legoIds - Array of LEGO IDs to load intro audio for
   * @returns Map of legoId -> intro audio ref
   */
  async getIntroductionAudioBatch(legoIds: string[]): Promise<Map<string, {
    id: string
    url: string
    duration_ms?: number
  }>> {
    const result = new Map<string, { id: string; url: string; duration_ms?: number }>()

    if (!this.client || legoIds.length === 0) return result

    try {
      const { data, error } = await this.client
        .from('course_audio')
        .select('id, s3_key, duration_ms, lego_id')
        .eq('course_code', this.courseId)
        .eq('role', 'presentation')
        .in('lego_id', legoIds)

      if (error || !data) {
        return result
      }

      for (const row of data) {
        if (row.lego_id && row.id) {
          result.set(row.lego_id, {
            id: row.id,
            url: this.buildProxyUrl(row.id),
            duration_ms: row.duration_ms,
          })
        }
      }

      return result
    } catch (err) {
      return result
    }
  }

  /**
   * Get all instruction audio for the course (played in sequence)
   * v13.1: Instructions are meta-cognitive content about the learning journey
   * These are copied from shared_audio at import time
   *
   * @returns Array of AudioRef in sequence order
   */
  async getInstructions(): Promise<Array<AudioRef & { text: string; position: number }>> {
    if (!this.client) return []

    // Instructions are meta-cognitive (about the learning method itself),
    // not course-specific. Query the cross-course template table directly
    // rather than the per-course copy — eliminates the import-time text
    // duplication that caused the "instructionIndex points at different
    // messages on different courses" bug. Known-language filter routes
    // each learner to the right translation.
    const knownLang = this.courseId.split('_for_')[1] || ''
    if (!knownLang) return []

    try {
      const { data, error } = await this.client
        .from('shared_audio')
        .select('id, s3_key, duration_ms, text, sequence')
        .eq('audio_type', 'instruction')
        .eq('language', knownLang)
        .order('sequence', { ascending: true, nullsFirst: false })
        .order('id', { ascending: true })

      if (error || !data) {
        // console.warn('[CourseDataProvider] No instructions found:', error?.message)
        return []
      }

      return data.map((row, index) => ({
        id: row.id,
        url: this.buildProxyUrl(row.id),  // v2.2: use proxy for CORS bypass
        duration_ms: row.duration_ms,
        text: row.text,
        position: index, // 0-based position in sequence
      }))
    } catch (err) {
      // console.error('[CourseDataProvider] Error loading instructions:', err)
      return []
    }
  }

  /**
   * Get all encouragement audio (random pool, cross-course)
   * Encouragements are motivational messages — same as instructions, they
   * live in shared_audio rather than being copied per-course. Filtered by
   * the learner's known language so they hear their own translation.
   */
  async getEncouragements(): Promise<Array<AudioRef & { text: string }>> {
    if (!this.client) return []

    const knownLang = this.courseId.split('_for_')[1] || ''
    if (!knownLang) return []

    try {
      const { data, error } = await this.client
        .from('shared_audio')
        .select('id, s3_key, duration_ms, text')
        .eq('audio_type', 'encouragement')
        .eq('language', knownLang)

      if (error || !data) {
        // console.warn('[CourseDataProvider] No encouragements found:', error?.message)
        return []
      }

      return data.map(row => ({
        id: row.id,
        url: this.buildProxyUrl(row.id),  // v2.2: use proxy for CORS bypass
        duration_ms: row.duration_ms,
        text: row.text,
      }))
    } catch (err) {
      // console.error('[CourseDataProvider] Error loading encouragements:', err)
      return []
    }
  }

  /**
   * Transform database records to ClassifiedBasket
   * Records should be pre-sorted by target1_duration_ms ascending (v13)
   *
   * Classification:
   * - Components: position 0 (M-type LEGO parts, NEW courses only)
   * - Debut phrases: shortest 7 practice phrases by duration (position >= 1)
   * - Eternal phrases: longest 5 practice phrases by duration
   *
   * v13.1: Uses s3_key fields for URLs (known_s3_key, target1_s3_key, target2_s3_key)
   */
  private transformToBasket(
    legoId: string,
    records: any[],
    lego?: LegoPair
  ): ClassifiedBasket {
    const components: PracticePhrase[] = []
    const buildPhrases: PracticePhrase[] = []
    const usePhrases: PracticePhrase[] = []

    // Build phrase objects and classify by phrase_role
    // This matches the dashboard's learning-script-generator logic
    for (const record of records) {
      const phrase: PracticePhrase = {
        id: record.phrase_id || `${legoId}_P${record.position}`,
        phraseType: record.phrase_role === 'component' ? 'component' : 'practice',
        phrase: {
          known: record.known_text,
          target: record.target_text,
        },
        audioRefs: {
          known: {
            id: record.known_audio_id,
            url: this.buildProxyUrl(record.known_audio_id),  // v2.2: use proxy for CORS bypass
            duration_ms: record.known_duration_ms,
          },
          target: {
            voice1: {
              id: record.target1_audio_id,
              url: this.buildProxyUrl(record.target1_audio_id),  // v2.2: use proxy for CORS bypass
              duration_ms: record.target1_duration_ms,
            },
            voice2: {
              id: record.target2_audio_id,
              url: this.buildProxyUrl(record.target2_audio_id),  // v2.2: use proxy for CORS bypass
              duration_ms: record.target2_duration_ms,
            },
          },
        },
        wordCount: record.target_word_count || (record.target_text?.split(/\s+/).length || 1),
        containsLegos: [legoId],
      }

      // Classify by phrase_role (matching dashboard logic)
      // Database constraint: ('component', 'practice', 'eternal_eligible')
      const role = record.phrase_role
      if (role === 'component') {
        components.push(phrase)
      } else if (role === 'build' || role === 'practice') {
        // 'practice' = BUILD phrases (played once in BUILD section)
        buildPhrases.push(phrase)
      } else if (role === 'use' || role === 'eternal_eligible') {
        // 'eternal_eligible' = USE phrases (eligible for BUILD fill, REVIEW, CONSOLIDATE)
        usePhrases.push(phrase)
      }
    }

    // BUILD phase: up to 7 phrases - BUILD first, then USE to fill
    // Sort by duration (shortest first for easier cognitive load)
    const sortedBuild = [...buildPhrases].sort((a, b) =>
      (a.audioRefs?.target?.voice1?.duration_ms || 0) - (b.audioRefs?.target?.voice1?.duration_ms || 0)
    )
    const sortedUse = [...usePhrases].sort((a, b) =>
      (a.audioRefs?.target?.voice1?.duration_ms || 0) - (b.audioRefs?.target?.voice1?.duration_ms || 0)
    )

    // Take BUILD phrases first, then top up with USE phrases to reach 7
    const debutPhrases: PracticePhrase[] = []
    for (const phrase of sortedBuild) {
      if (debutPhrases.length >= 7) break
      debutPhrases.push(phrase)
    }
    for (const phrase of sortedUse) {
      if (debutPhrases.length >= 7) break
      debutPhrases.push(phrase)
    }

    // ETERNAL phrases: USE phrases only (for REVIEW and CONSOLIDATE)
    // These are the phrases eligible for spaced repetition
    const eternalPhrases = sortedUse

    // Create debut from lego if provided
    let debut: PracticePhrase | null = null
    if (lego) {
      debut = {
        id: `${legoId}_debut`,
        phraseType: 'debut',
        phrase: lego.lego,
        audioRefs: lego.audioRefs,
        wordCount: lego.lego.target.split(/\s+/).length,
        containsLegos: [legoId],
      }
    }

    return {
      lego_id: legoId,
      components,
      debut,
      debut_phrases: debutPhrases,
      eternal_phrases: eternalPhrases,
      introduction_audio: null, // Loaded separately via getIntroductionAudio
    }
  }

  /**
   * Load a single LEGO at a specific seed position
   * Used for fast startup - loads only what's needed for immediate play
   * @param seedNumber - The seed position (1-based)
   * @returns LearningItem or null if not found
   */
  async loadLegoAtPosition(seedNumber: number): Promise<LearningItem | null> {
    if (!this.client) {
      // console.warn('[CourseDataProvider] No Supabase client, cannot load LEGO at position')
      return null
    }

    try {
      // Same audio-completeness invariant as loadSessionItems — a seed with
      // missing audio IDs resolves to null here, and callers treat null as
      // "skip this seed" (not "course ended"). See PriorityRoundLoader.
      const { data, error } = await this.client
        .from('course_legos')
        .select('*')
        .eq('course_code', this.courseId)
        .eq('seed_number', seedNumber)
        .not('known_audio_id', 'is', null)
        .not('target1_audio_id', 'is', null)
        .not('target2_audio_id', 'is', null)
        .order('lego_index', { ascending: true })
        .limit(1)
        .maybeSingle()

      if (error) {
        // console.error('[CourseDataProvider] Query error:', error)
        return null
      }

      if (!data) {
        // console.warn('[CourseDataProvider] No LEGO found at seed position:', seedNumber)
        return null
      }

      // Transform to LearningItem
      const items = this.transformToLearningItems([data])
      return items[0] ?? null
    } catch (err) {
      // console.error('[CourseDataProvider] Failed to load LEGO at position:', err)
      return null
    }
  }

  /**
   * Load a range of LEGOs by seed position
   * Used for belt loading - loads multiple LEGOs efficiently
   * @param startSeed - Start seed number (inclusive)
   * @param endSeed - End seed number (inclusive)
   * @returns Array of LearningItems
   */
  async loadLegoRange(startSeed: number, endSeed: number): Promise<LearningItem[]> {
    if (!this.client) {
      // console.warn('[CourseDataProvider] No Supabase client, cannot load LEGO range')
      return []
    }

    try {
      const { data, error } = await this.client
        .from('course_legos')
        .select('*')
        .eq('course_code', this.courseId)
        .gte('seed_number', startSeed)
        .lte('seed_number', endSeed)
        .not('known_audio_id', 'is', null)
        .not('target1_audio_id', 'is', null)
        .not('target2_audio_id', 'is', null)
        .order('seed_number', { ascending: true })
        .order('lego_index', { ascending: true })

      if (error) {
        // console.error('[CourseDataProvider] Query error:', error)
        return []
      }

      if (!data || data.length === 0) {
        // console.warn('[CourseDataProvider] No LEGOs found in range:', startSeed, '-', endSeed)
        return []
      }

      // Deduplicate by seed_number (keep first LEGO per seed)
      const seenSeeds = new Set<number>()
      const uniqueRecords = data.filter(record => {
        if (seenSeeds.has(record.seed_number)) {
          return false
        }
        seenSeeds.add(record.seed_number)
        return true
      })

      // console.log(`[CourseDataProvider] Loaded ${uniqueRecords.length} LEGOs from range ${startSeed}-${endSeed}`)
      return this.transformToLearningItems(uniqueRecords)
    } catch (err) {
      // console.error('[CourseDataProvider] Failed to load LEGO range:', err)
      return []
    }
  }

  /**
   * Batch load baskets for multiple LEGOs at once
   * More efficient than individual getLegoBasket calls (one query instead of N)
   * @param legoIds - Array of LEGO IDs to load baskets for
   * @param legos - Optional map of LEGO data for creating debut phrases
   * @returns Map of legoId -> ClassifiedBasket
   */
  async getBasketsBatch(
    legoIds: string[],
    legos?: Map<string, LegoPair>
  ): Promise<Map<string, ClassifiedBasket>> {
    const baskets = new Map<string, ClassifiedBasket>()

    if (!this.client || legoIds.length === 0) return baskets

    try {
      // Parse legoIds into seed_number/lego_index pairs for query
      // course_practice_phrases table has no lego_id column
      const parsedIds = legoIds.map(id => parseLegoId(id)).filter((p): p is NonNullable<typeof p> => p !== null)
      if (parsedIds.length === 0) {
        for (const legoId of legoIds) {
          baskets.set(legoId, this.createEmptyBasket(legoId, legos?.get(legoId)))
        }
        return baskets
      }

      // Build OR filter for (seed_number, lego_index) pairs
      const seedNumbers = [...new Set(parsedIds.map(p => p.seedNumber))]

      // v13: Sort by target1_duration_ms for cognitive load
      // Audio-completeness invariant — see getLegoBasket.
      const { data, error } = await this.client
        .from('course_practice_phrases')
        .select('*')
        .eq('course_code', this.courseId)
        .in('seed_number', seedNumbers)
        .not('known_audio_id', 'is', null)
        .not('target1_audio_id', 'is', null)
        .not('target2_audio_id', 'is', null)
        .order('seed_number', { ascending: true })
        .order('lego_index', { ascending: true })
        .order('target1_duration_ms', { ascending: true, nullsFirst: false })

      if (error) {
        // console.error('[CourseDataProvider] Batch basket query error:', error)
        // Fall back to individual loading for failed batch
        for (const legoId of legoIds) {
          const basket = await this.getLegoBasket(legoId, legos?.get(legoId))
          if (basket) baskets.set(legoId, basket)
        }
        return baskets
      }

      if (!data || data.length === 0) {
        // console.warn('[CourseDataProvider] No practice phrases found for LEGOs:', legoIds)
        // Create empty baskets for each LEGO
        for (const legoId of legoIds) {
          baskets.set(legoId, this.createEmptyBasket(legoId, legos?.get(legoId)))
        }
        return baskets
      }

      // Group by constructed lego_id (table has seed_number + lego_index, not lego_id)
      const grouped = new Map<string, any[]>()
      for (const row of data) {
        const constructedLegoId = `S${String(row.seed_number).padStart(4, '0')}L${String(row.lego_index).padStart(2, '0')}`
        if (!grouped.has(constructedLegoId)) {
          grouped.set(constructedLegoId, [])
        }
        grouped.get(constructedLegoId)!.push(row)
      }

      // Transform each group to a basket
      for (const legoId of legoIds) {
        const rows = grouped.get(legoId)
        if (rows && rows.length > 0) {
          const basket = this.transformToBasket(legoId, rows, legos?.get(legoId))
          if (basket) {
            baskets.set(legoId, basket)
          }
        } else {
          // No phrases found - create empty basket
          baskets.set(legoId, this.createEmptyBasket(legoId, legos?.get(legoId)))
        }
      }

      // console.log(`[CourseDataProvider] Batch loaded ${baskets.size} baskets for ${legoIds.length} LEGOs`)
      return baskets
    } catch (err) {
      // console.error('[CourseDataProvider] Batch basket loading error:', err)
      return baskets
    }
  }

  /**
   * Create an empty basket when database isn't available
   */
  private createEmptyBasket(legoId: string, lego?: LegoPair): ClassifiedBasket {
    let debut: PracticePhrase | null = null

    if (lego) {
      debut = {
        id: `${legoId}_debut`,
        phraseType: 'debut',
        phrase: lego.lego,
        audioRefs: lego.audioRefs,
        wordCount: lego.lego.target.split(/\s+/).length,
        containsLegos: [legoId],
      }
    }

    return {
      lego_id: legoId,
      components: [],
      debut,
      debut_phrases: [],
      eternal_phrases: [],
      introduction_audio: null,
    }
  }
}

/**
 * ScriptItem - one item in the learning script
 */
export interface ScriptItem {
  type: 'intro' | 'component' | 'component_intro' | 'component_practice' | 'debut' | 'debut_phrase' | 'spaced_rep' | 'consolidation'
  roundNumber: number
  legoId: string
  legoIndex: number // 1-based position in course
  seedId: string
  knownText: string
  targetText: string
  audioRefs: {
    known: { id: string; url: string }
    target: {
      voice1: { id: string; url: string }
      voice2: { id: string; url: string }
    }
  }
  audioDurations?: {
    source: number
    target1: number
    target2: number
  }
  reviewOf?: number // For spaced_rep: which LEGO is being reviewed (1-based index)
  fibonacciPosition?: number // For spaced_rep: which Fibonacci position triggered this
  // For INTRO items: presentation audio ("The Welsh for X is...")
  presentationAudio?: { id: string; url: string }
  // For INTRO items on M-type LEGOs: visual component breakdown
  // Format: [{known: "after", target: "después de"}, {known: "that", target: "que"}, ...]
  components?: Array<{ known: string; target: string }>
}

// NOTE: generateLearningScript was removed from CourseDataProvider.
// The ONLY generateLearningScript lives in ./generateLearningScript.ts
// Import it from there: import { generateLearningScript } from '../providers/generateLearningScript'

/**
 * Factory function
 */
export function createCourseDataProvider(config: CourseDataProviderConfig): CourseDataProvider {
  return new CourseDataProvider(config)
}
