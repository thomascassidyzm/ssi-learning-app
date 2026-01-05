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
 * The cycle views (lego_cycles, practice_cycles, seed_cycles) join with
 * course_audio directly. No more texts/audio_files indirection.
 *
 * Roles: known, target1, target2, presentation, encouragement, instruction
 *
 * Key v13.1 changes:
 * - courses.code (not course_code), voice_config JSONB (not separate voice columns)
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

export class CourseDataProvider {
  private client?: SupabaseClient
  private audioBaseUrl: string
  private courseId: string

  constructor(config: CourseDataProviderConfig) {
    this.client = config.supabaseClient
    this.audioBaseUrl = config.audioBaseUrl
    this.courseId = config.courseId || 'demo'
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
   * Load learning items for a session
   * Tries database first, falls back to demo items if not available
   */
  async loadSessionItems(startSeed: number = 1, count: number = 30): Promise<LearningItem[]> {
    // If no Supabase client, return empty array (caller will use demo fallback)
    if (!this.client) {
      console.warn('[CourseDataProvider] No Supabase client configured, using demo mode')
      return []
    }

    try {
      // Query lego_cycles view for the session range
      // This view contains LEGOs with their audio UUIDs
      const { data, error } = await this.client
        .from('lego_cycles')
        .select('*')
        .eq('course_code', this.courseId)
        .gte('seed_number', startSeed)
        .lt('seed_number', startSeed + count)
        .order('seed_number', { ascending: true })
        .order('lego_index', { ascending: true })

      if (error) {
        console.error('[CourseDataProvider] Query error:', error)
        return []
      }

      if (!data || data.length === 0) {
        console.warn('[CourseDataProvider] No data found for course:', this.courseId)
        return []
      }

      console.log('[CourseDataProvider] Loaded', data.length, 'items for', this.courseId)

      // Transform database records to LearningItem format
      return this.transformToLearningItems(data)
    } catch (err) {
      console.error('[CourseDataProvider] Failed to load items:', err)
      return []
    }
  }

  /**
   * Transform database records to LearningItem format
   * Maps lego_cycles view fields to LearningItem structure
   * v13.1: Uses s3_key fields for URLs (known_s3_key, target1_s3_key, target2_s3_key)
   */
  private transformToLearningItems(records: any[]): LearningItem[] {
    return records.map((record) => {
      const legoId = record.lego_id
      const seedId = `S${String(record.seed_number).padStart(4, '0')}`

      // v13.1: Resolve audio URLs from s3_keys (not UUIDs)
      const knownAudioUrl = this.resolveAudioUrl(record.known_s3_key)
      const target1AudioUrl = this.resolveAudioUrl(record.target1_s3_key)
      const target2AudioUrl = this.resolveAudioUrl(record.target2_s3_key)

      return {
        lego: {
          id: legoId,
          type: record.type || 'A',
          new: record.is_new,
          lego: {
            known: record.known_text,
            target: record.target_text,
          },
          audioRefs: {
            known: {
              id: record.known_audio_uuid,
              url: knownAudioUrl
            },
            target: {
              voice1: {
                id: record.target1_audio_uuid,
                url: target1AudioUrl
              },
              voice2: {
                id: record.target2_audio_uuid,
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
              id: record.known_audio_uuid,
              url: knownAudioUrl
            },
            target: {
              voice1: {
                id: record.target1_audio_uuid,
                url: target1AudioUrl
              },
              voice2: {
                id: record.target2_audio_uuid,
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
   * Resolve S3 key to full URL
   * v13.1: s3_key contains the full path (e.g., "uuid.mp3" or "mastered/ABC123.mp3")
   * The key already includes the file extension - don't append .mp3
   *
   * IMPORTANT: Handles case where audioBaseUrl may contain "/mastered" suffix
   * but s3_key also starts with "mastered/" - prevents double path issue
   */
  private resolveAudioUrl(s3Key: string): string {
    if (!s3Key) return ''

    // Strip any path suffix from base URL (e.g., "/mastered") since s3_key is the full path
    let baseUrl = this.audioBaseUrl
    // Remove trailing slash if present
    if (baseUrl.endsWith('/')) {
      baseUrl = baseUrl.slice(0, -1)
    }
    // Remove /mastered suffix if present (s3_key already includes it)
    if (baseUrl.endsWith('/mastered')) {
      baseUrl = baseUrl.slice(0, -9) // Remove "/mastered" (9 chars)
    }

    return `${baseUrl}/${s3Key}`
  }

  /**
   * Get course metadata (v13: uses 'code' not 'course_code')
   */
  async getCourseMetadata() {
    if (!this.client) return null

    try {
      const { data, error } = await this.client
        .from('courses')
        .select('*')
        .eq('code', this.courseId)
        .single()

      if (error) {
        console.error('[CourseDataProvider] Failed to get course metadata:', error)
        return null
      }

      return data
    } catch (err) {
      console.error('[CourseDataProvider] Error fetching metadata:', err)
      return null
    }
  }

  /**
   * Get welcome audio for the course (plays once on first load)
   * v13.1: Welcome audio is in course_audio with role='presentation'
   */
  async getWelcomeAudio(): Promise<AudioRef | null> {
    if (!this.client) return null

    try {
      // v13.1: Look up welcome audio in course_audio (role='presentation', text matches welcome pattern)
      const { data, error } = await this.client
        .from('course_audio')
        .select('id, s3_key, duration_ms')
        .eq('course_code', this.courseId)
        .eq('role', 'presentation')
        .ilike('text', '%welcome%')
        .limit(1)
        .maybeSingle()

      if (error || !data || !data.s3_key) return null

      return {
        id: data.id,
        url: this.resolveAudioUrl(data.s3_key),  // v13.1: use s3_key for URL
        duration_ms: data.duration_ms || null,
      }
    } catch (err) {
      console.error('[CourseDataProvider] Error loading welcome audio:', err)
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
      console.error('[CourseDataProvider] Error checking welcome status:', err)
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
        console.error('[CourseDataProvider] Error marking welcome played:', error)
      }
    } catch (err) {
      console.error('[CourseDataProvider] Error updating welcome status:', err)
    }
  }

  /**
   * Load a ClassifiedBasket for a LEGO
   * Contains all phrases for the LEGO organized by type
   * v13: Orders by target1_duration_ms (audio duration = cognitive load)
   */
  async getLegoBasket(legoId: string, lego?: LegoPair): Promise<ClassifiedBasket | null> {
    if (!this.client) {
      console.warn('[CourseDataProvider] No Supabase client, returning empty basket')
      return this.createEmptyBasket(legoId, lego)
    }

    try {
      // Query practice_cycles view for all phrases containing this LEGO
      // v13: Sort by target1_duration_ms for cognitive load (shortest audio = easiest)
      const { data, error } = await this.client
        .from('practice_cycles')
        .select('*')
        .eq('lego_id', legoId)
        .eq('course_code', this.courseId)
        .order('target1_duration_ms', { ascending: true, nullsFirst: false })

      if (error) {
        console.error('[CourseDataProvider] Failed to load basket:', error)
        return this.createEmptyBasket(legoId, lego)
      }

      if (!data || data.length === 0) {
        console.warn('[CourseDataProvider] No phrases found for LEGO:', legoId)
        return this.createEmptyBasket(legoId, lego)
      }

      // Transform to ClassifiedBasket
      return this.transformToBasket(legoId, data, lego)
    } catch (err) {
      console.error('[CourseDataProvider] Error loading basket:', err)
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
        console.warn('[CourseDataProvider] Invalid seed_id format:', seedId)
        return baskets
      }

      // Query practice_cycles for all LEGOs in this seed
      // v13: Sort by target1_duration_ms for cognitive load (shortest audio = easiest)
      const { data, error } = await this.client
        .from('practice_cycles')
        .select('*')
        .eq('seed_number', seedNumber)
        .eq('course_code', this.courseId)
        .order('lego_id', { ascending: true })
        .order('target1_duration_ms', { ascending: true, nullsFirst: false })

      if (error) {
        console.error('[CourseDataProvider] Failed to load seed baskets:', error)
        return baskets
      }

      if (!data || data.length === 0) return baskets

      // Group by lego_id
      const grouped = new Map<string, any[]>()
      for (const row of data) {
        const legoId = row.lego_id
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

      console.log('[CourseDataProvider] Loaded baskets for', baskets.size, 'LEGOs')
      return baskets
    } catch (err) {
      console.error('[CourseDataProvider] Error loading seed baskets:', err)
      return baskets
    }
  }

  /**
   * Get introduction audio for a LEGO ("The Spanish for X is...")
   *
   * v14.1: Queries lego_introductions table which maps:
   *   lego_id → presentation_audio_id, target1_audio_id, target2_audio_id
   *
   * Returns all audio URLs needed for introduction playback:
   * - origin='human' (Welsh): Single pre-recorded file - play presentationUrl only
   * - origin='tts': Sequence - presentationUrl → target1Url → target2Url
   */
  async getIntroductionAudio(legoId: string): Promise<{
    id: string
    url: string  // Presentation audio URL
    duration_ms?: number
    origin?: string
    target1Url?: string  // For TTS sequence
    target2Url?: string  // For TTS sequence
  } | null> {
    if (!this.client) return null

    try {
      // Query lego_introductions - get the raw columns (no FK joins)
      const { data, error } = await this.client
        .from('lego_introductions')
        .select('lego_id, audio_uuid, presentation_audio_id, target1_audio_id, target2_audio_id')
        .eq('lego_id', legoId)
        .eq('course_code', this.courseId)
        .maybeSingle()

      if (error) {
        console.warn('[CourseDataProvider] lego_introductions query error:', error.message)
        return null
      }

      if (!data) {
        return null
      }

      // Legacy fallback: use audio_uuid if no presentation_audio_id
      const presentationId = data.presentation_audio_id || data.audio_uuid
      if (!presentationId) {
        console.warn('[CourseDataProvider] No presentation audio ID for:', legoId)
        return null
      }

      // Look up audio files separately from course_audio
      const audioIds = [presentationId, data.target1_audio_id, data.target2_audio_id].filter(Boolean)
      const { data: audioData, error: audioError } = await this.client
        .from('course_audio')
        .select('id, s3_key, duration_ms, origin')
        .in('id', audioIds)

      if (audioError || !audioData) {
        console.warn('[CourseDataProvider] Audio lookup error:', audioError?.message)
        return null
      }

      // Build lookup map
      const audioMap = new Map(audioData.map(a => [a.id, a]))
      const presentation = audioMap.get(presentationId)
      const target1 = data.target1_audio_id ? audioMap.get(data.target1_audio_id) : null
      const target2 = data.target2_audio_id ? audioMap.get(data.target2_audio_id) : null

      if (!presentation?.s3_key) {
        console.warn('[CourseDataProvider] No presentation audio s3_key for:', legoId)
        return null
      }

      return {
        id: presentation.id,
        url: this.resolveAudioUrl(presentation.s3_key),
        duration_ms: presentation.duration_ms,
        origin: presentation.origin || 'tts',
        target1Url: target1?.s3_key ? this.resolveAudioUrl(target1.s3_key) : undefined,
        target2Url: target2?.s3_key ? this.resolveAudioUrl(target2.s3_key) : undefined,
      }
    } catch (err) {
      console.error('[CourseDataProvider] Error loading intro audio:', err)
      return null
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

    try {
      // Query course_audio for all instructions, ordered by id (preserves import order)
      const { data, error } = await this.client
        .from('course_audio')
        .select('id, s3_key, duration_ms, text')
        .eq('course_code', this.courseId)
        .eq('role', 'instruction')
        .order('id', { ascending: true })

      if (error || !data) {
        console.warn('[CourseDataProvider] No instructions found:', error?.message)
        return []
      }

      return data.map((row, index) => ({
        id: row.id,
        url: this.resolveAudioUrl(row.s3_key),
        duration_ms: row.duration_ms,
        text: row.text,
        position: index, // 0-based position in sequence
      }))
    } catch (err) {
      console.error('[CourseDataProvider] Error loading instructions:', err)
      return []
    }
  }

  /**
   * Get all encouragement audio for the course (random pool)
   * v13.1: Encouragements are motivational messages, randomly selected
   * These are copied from shared_audio at import time
   *
   * @returns Array of AudioRef (unordered pool)
   */
  async getEncouragements(): Promise<Array<AudioRef & { text: string }>> {
    if (!this.client) return []

    try {
      const { data, error } = await this.client
        .from('course_audio')
        .select('id, s3_key, duration_ms, text')
        .eq('course_code', this.courseId)
        .eq('role', 'encouragement')

      if (error || !data) {
        console.warn('[CourseDataProvider] No encouragements found:', error?.message)
        return []
      }

      return data.map(row => ({
        id: row.id,
        url: this.resolveAudioUrl(row.s3_key),
        duration_ms: row.duration_ms,
        text: row.text,
      }))
    } catch (err) {
      console.error('[CourseDataProvider] Error loading encouragements:', err)
      return []
    }
  }

  /**
   * Look up audio by text content using v13 course_audio table
   * This is the canonical way to find audio for a phrase.
   *
   * v13: Direct lookup in course_audio (flat, course-owned)
   * No more audio_registry or audio_samples fallback
   *
   * @param text - The text content to look up
   * @param role - 'known' | 'target1' | 'target2' - determines voice selection
   * @returns AudioRef or null if not found
   */
  async lookupAudioByText(
    text: string,
    role: 'known' | 'target1' | 'target2'
  ): Promise<AudioRef | null> {
    if (!this.client) return null

    try {
      // Get course language configuration (v13: 'code' not 'course_code')
      const { data: course, error: courseError } = await this.client
        .from('courses')
        .select('known_lang, target_lang')
        .eq('code', this.courseId)
        .single()

      if (courseError || !course) {
        console.warn('[CourseDataProvider] Course not found for audio lookup:', this.courseId)
        return null
      }

      // Determine language based on role
      const language = role === 'known' ? course.known_lang : course.target_lang

      // v13: Direct lookup in course_audio (flat, course-owned)
      const { data: audio, error: audioError } = await this.client
        .from('course_audio')
        .select('id, s3_key, duration_ms')
        .eq('course_code', this.courseId)
        .eq('text_normalized', text.toLowerCase().trim())
        .eq('language', language)
        .eq('role', role)
        .maybeSingle()

      if (!audioError && audio && audio.s3_key) {
        return {
          id: audio.id,
          url: this.resolveAudioUrl(audio.s3_key),  // v13.1: use s3_key for URL
          duration_ms: audio.duration_ms,
        }
      }

      console.warn('[CourseDataProvider] No audio found for', role, ':', text)
      return null
    } catch (err) {
      console.error('[CourseDataProvider] Error in lookupAudioByText:', err)
      return null
    }
  }

  /**
   * Batch lookup audio for multiple texts
   * More efficient than individual lookups
   * v13: Uses course_audio directly (flat, course-owned)
   */
  async batchLookupAudio(
    texts: Array<{ text: string; role: 'known' | 'target1' | 'target2' }>
  ): Promise<Map<string, AudioRef>> {
    const results = new Map<string, AudioRef>()
    if (!this.client || texts.length === 0) return results

    try {
      // Get course language configuration once (v13: 'code' not 'course_code')
      const { data: course, error: courseError } = await this.client
        .from('courses')
        .select('known_lang, target_lang')
        .eq('code', this.courseId)
        .single()

      if (courseError || !course) return results

      // Group by role for efficient queries
      const byRole = {
        known: [] as string[],
        target1: [] as string[],
        target2: [] as string[],
      }

      for (const { text, role } of texts) {
        byRole[role].push(text.toLowerCase().trim())
      }

      // v13: Query course_audio for each role
      for (const [role, textList] of Object.entries(byRole)) {
        if (textList.length === 0) continue

        const language = role === 'known' ? course.known_lang : course.target_lang

        const { data: audioData } = await this.client
          .from('course_audio')
          .select('id, s3_key, text_normalized, duration_ms')  // v13.1: include s3_key
          .eq('course_code', this.courseId)
          .in('text_normalized', textList)
          .eq('language', language)
          .eq('role', role)

        if (audioData) {
          for (const audio of audioData) {
            const key = `${audio.text_normalized}:${role}`
            results.set(key, {
              id: audio.id,
              url: this.resolveAudioUrl(audio.s3_key),  // v13.1: use s3_key for URL
              duration_ms: audio.duration_ms,
            })
          }
        }
      }

      return results
    } catch (err) {
      console.error('[CourseDataProvider] Error in batchLookupAudio:', err)
      return results
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
    const practicePhrases: PracticePhrase[] = []

    // Build phrase objects and separate components from practice phrases
    for (const record of records) {
      const phrase: PracticePhrase = {
        id: record.phrase_id || `${legoId}_P${record.position}`,
        phraseType: record.position === 0 ? 'component' : 'practice',
        phrase: {
          known: record.known_text,
          target: record.target_text,
        },
        audioRefs: {
          known: {
            id: record.known_audio_uuid,
            url: this.resolveAudioUrl(record.known_s3_key),  // v13.1: use s3_key
            duration_ms: record.known_duration_ms,
          },
          target: {
            voice1: {
              id: record.target1_audio_uuid,
              url: this.resolveAudioUrl(record.target1_s3_key),  // v13.1: use s3_key
              duration_ms: record.target1_duration_ms,
            },
            voice2: {
              id: record.target2_audio_uuid,
              url: this.resolveAudioUrl(record.target2_s3_key),  // v13.1: use s3_key
              duration_ms: record.target2_duration_ms,
            },
          },
        },
        wordCount: record.target_word_count || (record.target_text?.split(/\s+/).length || 1),
        containsLegos: [legoId],
      }

      if (record.position === 0) {
        components.push(phrase)
      } else {
        // Position >= 1 are practice phrases (already sorted by syllable count)
        practicePhrases.push(phrase)
      }
    }

    // Split practice phrases: shortest 7 = debut, longest 5 = eternal
    const debutPhrases = practicePhrases.slice(0, 7)
    const eternalPhrases = practicePhrases.slice(-5).reverse() // Longest first

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
   * Map database phrase_type/position to PhraseType
   */
  private mapPhraseType(
    position: number,
    dbType?: string
  ): 'component' | 'debut' | 'practice' | 'eternal' {
    if (position === 0) return 'component'
    if (position === 1) return 'debut'
    if (dbType === 'eternal') return 'eternal'
    if (position <= 4) return 'debut' // Short phrases still debut
    return 'eternal'
  }

  /**
   * Load all unique LEGOs for a course (without spaced repetition cycles)
   * Used by Course Explorer for QA script view
   */
  async loadAllUniqueLegos(limit: number = 1000, offset: number = 0): Promise<LearningItem[]> {
    if (!this.client) {
      console.warn('[CourseDataProvider] No Supabase client, returning empty array')
      return []
    }

    try {
      // Query lego_cycles view (which has audio UUIDs) then dedupe by lego_id
      const { data, error } = await this.client
        .from('lego_cycles')
        .select('*')
        .eq('course_code', this.courseId)
        .order('seed_number', { ascending: true })
        .order('lego_index', { ascending: true })

      if (error) {
        console.error('[CourseDataProvider] Query error:', error)
        return []
      }

      if (!data || data.length === 0) {
        console.warn('[CourseDataProvider] No LEGOs found for course:', this.courseId)
        return []
      }

      // Deduplicate by lego_id - keep only first occurrence of each LEGO
      const seenLegos = new Set<string>()
      const uniqueRecords = data.filter(record => {
        if (seenLegos.has(record.lego_id)) {
          return false
        }
        seenLegos.add(record.lego_id)
        return true
      })

      console.log('[CourseDataProvider] Loaded', uniqueRecords.length, 'unique LEGOs for', this.courseId)

      // Transform to LearningItem format (with pagination)
      // v13.1: Use s3_key fields for URLs
      return uniqueRecords.slice(offset, offset + limit).map((record) => {
        const legoId = record.lego_id
        const seedId = `S${String(record.seed_number).padStart(4, '0')}`

        const knownAudioUrl = this.resolveAudioUrl(record.known_s3_key)
        const target1AudioUrl = this.resolveAudioUrl(record.target1_s3_key)
        const target2AudioUrl = this.resolveAudioUrl(record.target2_s3_key)

        return {
          lego: {
            id: legoId,
            type: record.type || 'A',
            new: false, // All shown in explorer, no "new" distinction
            lego: {
              known: record.known_text,
              target: record.target_text,
            },
            audioRefs: {
              known: {
                id: record.known_audio_uuid,
                url: knownAudioUrl
              },
              target: {
                voice1: {
                  id: record.target1_audio_uuid,
                  url: target1AudioUrl
                },
                voice2: {
                  id: record.target2_audio_uuid,
                  url: target2AudioUrl
                },
              },
            },
          },
          phrase: {
            id: `${legoId}_P1`,
            phraseType: 'debut',
            phrase: {
              known: record.known_text,
              target: record.target_text,
            },
            audioRefs: {
              known: {
                id: record.known_audio_uuid,
                url: knownAudioUrl
              },
              target: {
                voice1: {
                  id: record.target1_audio_uuid,
                  url: target1AudioUrl
                },
                voice2: {
                  id: record.target2_audio_uuid,
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
              known: record.known_text,
              target: record.target_text,
            },
            legos: [legoId],
          },
          thread_id: (record.seed_number % 3) + 1,
          mode: 'introduction',
          audioDurations: {
            source: record.known_duration_ms ? record.known_duration_ms / 1000 : 2.0,
            target1: record.target1_duration_ms ? record.target1_duration_ms / 1000 : 2.5,
            target2: record.target2_duration_ms ? record.target2_duration_ms / 1000 : 2.5,
          },
        }
      })
    } catch (err) {
      console.error('[CourseDataProvider] Failed to load unique LEGOs:', err)
      return []
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
 * Fibonacci-based skip numbers for spaced repetition
 * Review LEGO at position (N - skip) for each skip value
 */
const FIBONACCI = [1, 2, 3, 5, 8, 13, 21, 34, 55, 89]

/**
 * ScriptItem - one item in the learning script
 */
export interface ScriptItem {
  type: 'intro' | 'component' | 'debut' | 'debut_phrase' | 'spaced_rep' | 'consolidation'
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
}

/**
 * RoundData - one ROUND in the learning journey
 */
export interface RoundData {
  roundNumber: number
  legoId: string
  legoIndex: number
  seedId: string
  items: ScriptItem[]
  spacedRepReviews: number[] // LEGO indices being reviewed
}

/**
 * Calculate which previous LEGOs to review during ROUND N
 * Based on formula: N - fibonacci[i] >= 1
 *
 * Each LEGO only appears once per round (deduplicated in case of edge cases).
 */
function calculateSpacedRepReviews(roundNumber: number): Array<{ legoIndex: number; fibPosition: number }> {
  const reviews: Array<{ legoIndex: number; fibPosition: number }> = []
  const seenLegos = new Set<number>()

  for (let i = 0; i < FIBONACCI.length; i++) {
    const skip = FIBONACCI[i]
    const reviewLego = roundNumber - skip

    if (reviewLego < 1) {
      // N - x < 1, stop
      break
    }

    // Skip if we've already added this LEGO to this round's reviews
    if (seenLegos.has(reviewLego)) {
      continue
    }

    seenLegos.add(reviewLego)
    reviews.push({
      legoIndex: reviewLego,
      fibPosition: i
    })
  }

  return reviews
}

/**
 * Factory function
 */
export function createCourseDataProvider(config: CourseDataProviderConfig): CourseDataProvider {
  return new CourseDataProvider(config)
}

/**
 * Phrase data for eternal pool selection
 */
interface EternalPhrase {
  knownText: string
  targetText: string
  syllableCount: number
  audioRefs: {
    known: { id: string; url: string }
    target: {
      voice1: { id: string; url: string }
      voice2: { id: string; url: string }
    }
  }
}

/**
 * Load ALL practice phrases for all LEGOs, ordered by audio duration.
 * Returns both debut (shortest 7) and eternal (longest 5) maps.
 *
 * Works for both OLD and NEW course formats:
 * - OLD courses: position 1+ are all practice phrases
 * - NEW courses: position 0=components, position 1=debut, position 2+=practice
 *
 * We include ALL phrases (position >= 1) and sort by target1_duration_ms to ensure:
 * - Debut phrases = 7 shortest (easier combinations first)
 * - Eternal phrases = 5 longest (more complex for spaced rep)
 *
 * v13: Uses target1_duration_ms (audio duration = cognitive load)
 * This works across ALL languages including non-Roman scripts.
 */
async function loadAllPracticePhrasesGrouped(
  supabase: any,
  courseId: string,
  audioBaseUrl: string
): Promise<{ debutMap: Map<string, EternalPhrase[]>; eternalMap: Map<string, EternalPhrase[]> }> {
  const debutMap = new Map<string, EternalPhrase[]>()
  const eternalMap = new Map<string, EternalPhrase[]>()

  if (!supabase) return { debutMap, eternalMap }

  // Helper to resolve audio URL (v13.1: s3_key contains full path including extension)
  // Handles case where audioBaseUrl may contain "/mastered" suffix
  const resolveAudioUrl = (s3Key: string | null): string => {
    if (!s3Key) return ''
    // Strip /mastered suffix from base URL if present (s3_key already includes it)
    let baseUrl = audioBaseUrl
    if (baseUrl.endsWith('/')) baseUrl = baseUrl.slice(0, -1)
    if (baseUrl.endsWith('/mastered')) baseUrl = baseUrl.slice(0, -9)
    return `${baseUrl}/${s3Key}`
  }

  try {
    // Load ALL practice phrases for all LEGOs (position > 1)
    // Order by duration so we can split into debut (shortest) and eternal (longest)
    // Position structure:
    //   0 = Components (for M-type LEGOs, e.g., "estoy", "intentando")
    //   1 = LEGO debut (the LEGO itself, e.g., "estoy intentando")
    //   2+ = Practice phrases (e.g., "estoy intentando hablar español")

    // Paginate to handle Supabase's 1000 row limit
    let allData: any[] = []
    let offset = 0
    const pageSize = 1000

    while (true) {
      // Include ALL practice phrases (position >= 1) for both OLD and NEW courses
      // v13: Sort by target1_duration_ms (audio duration = cognitive load)
      const { data: page, error } = await supabase
        .from('practice_cycles')
        .select('*')
        .eq('course_code', courseId)
        .gte('position', 1) // Include position 1 (OLD courses have practice phrases there)
        .order('lego_id', { ascending: true })
        .order('target1_duration_ms', { ascending: true, nullsFirst: false })
        .range(offset, offset + pageSize - 1)

      if (error) {
        console.error('[loadAllPracticePhrasesGrouped] Query error:', error)
        return { debutMap, eternalMap }
      }

      if (!page || page.length === 0) break

      allData = allData.concat(page)
      if (page.length < pageSize) break
      offset += pageSize
    }

    const data = allData
    if (data.length === 0) return { debutMap, eternalMap }

    console.log(`[loadAllPracticePhrasesGrouped] Loaded ${data.length} practice phrases from practice_cycles`)

    // Group by lego_id
    const grouped = new Map<string, any[]>()
    for (const row of data) {
      const legoId = row.lego_id
      if (!grouped.has(legoId)) {
        grouped.set(legoId, [])
      }
      grouped.get(legoId)!.push(row)
    }

    // Transform and split into debut (first 7) and eternal (last 5)
    for (const [legoId, rows] of grouped) {
      // Rows are already sorted by target1_duration_ms ascending (v13)
      // v13.1: Use s3_key fields for URLs
      const allPhrases: EternalPhrase[] = rows.map(row => ({
        knownText: row.known_text,
        targetText: row.target_text,
        syllableCount: row.target1_duration_ms || 0, // v13: Use duration as cognitive load proxy
        audioRefs: {
          known: {
            id: row.known_audio_uuid || '',
            url: resolveAudioUrl(row.known_s3_key)
          },
          target: {
            voice1: {
              id: row.target1_audio_uuid || '',
              url: resolveAudioUrl(row.target1_s3_key)
            },
            voice2: {
              id: row.target2_audio_uuid || '',
              url: resolveAudioUrl(row.target2_s3_key)
            }
          }
        }
      }))

      // Debut = shortest 7 (already sorted by duration ascending)
      const debutPhrases = allPhrases.slice(0, 7)
      if (debutPhrases.length > 0) {
        debutMap.set(legoId, debutPhrases)
      }

      // Eternal = longest 5 (take from end, reverse so longest is first)
      const eternalPhrases = allPhrases.slice(-5).reverse()
      if (eternalPhrases.length > 0) {
        eternalMap.set(legoId, eternalPhrases)
      }
    }

    console.log(`[loadAllPracticePhrasesGrouped] Grouped into ${debutMap.size} LEGOs with debut phrases, ${eternalMap.size} with eternal phrases`)
    return { debutMap, eternalMap }
  } catch (err) {
    console.error('[loadAllPracticePhrasesGrouped] Error:', err)
    return { debutMap, eternalMap }
  }
}

// Legacy wrapper for eternal phrases (for backwards compatibility)
async function loadEternalPhrases(
  supabase: any,
  courseId: string,
  audioBaseUrl: string
): Promise<Map<string, EternalPhrase[]>> {
  const { eternalMap } = await loadAllPracticePhrasesGrouped(supabase, courseId, audioBaseUrl)
  return eternalMap
}

/**
 * Pick a random phrase from the pool, avoiding the last used phrase
 */
function pickRandomPhrase(
  phrases: EternalPhrase[],
  lastUsed: string | null
): EternalPhrase | null {
  if (!phrases || phrases.length === 0) return null

  // If only one phrase, must use it
  if (phrases.length === 1) return phrases[0]

  // Filter out the last used phrase to prevent consecutive duplicates
  const available = lastUsed
    ? phrases.filter(p => p.targetText !== lastUsed)
    : phrases

  // If all were filtered (shouldn't happen with >1 phrase), fall back to all
  const pool = available.length > 0 ? available : phrases

  const idx = Math.floor(Math.random() * pool.length)
  return pool[idx]
}

// Legacy wrapper for debut phrases (for backwards compatibility)
async function loadDebutPhrases(
  supabase: any,
  courseId: string,
  audioBaseUrl: string
): Promise<Map<string, EternalPhrase[]>> {
  const { debutMap } = await loadAllPracticePhrasesGrouped(supabase, courseId, audioBaseUrl)
  return debutMap
}

/**
 * Generate the complete learning script with ROUNDs and spaced repetition
 * This shows exactly what the learner will experience
 *
 * ROUND Structure (per APML spec):
 * 1. INTRO - Introduction audio ("The Chinese for X is...")
 * 2. COMPONENTS - For M-type LEGOs only
 * 3. DEBUT - The LEGO phrase itself
 * 4. DEBUT PHRASES - Up to 7 shortest phrases by syllable count
 * 5. SPACED REP - Fibonacci-based reviews:
 *    - N-1 (first revisit) gets 3x eternal phrases
 *    - N-2, N-3, N-5, N-8, etc. get 1x each
 * 6. CONSOLIDATION - 2 eternal phrases for the new LEGO
 *
 * RULE: No duplicate phrases within a ROUND (except consolidation can reuse debut phrases)
 * Early rounds will be SHORT - learners don't have vocabulary yet, and that's fine!
 */
export async function generateLearningScript(
  provider: CourseDataProvider,
  maxLegos: number = 50,
  offset: number = 0
): Promise<{ rounds: RoundData[]; allItems: ScriptItem[] }> {
  // Use provider's client - single source of truth (eliminates parameter mismatch bugs)
  const supabase = provider.getClient()
  const courseId = provider.getCourseId()
  const audioBaseUrl = provider.getAudioBaseUrl()

  if (!supabase) {
    console.warn('[generateLearningScript] No Supabase client available')
    return { rounds: [], allItems: [] }
  }

  // Load unique LEGOs with pagination
  const legos = await provider.loadAllUniqueLegos(maxLegos, offset)

  if (legos.length === 0) {
    return { rounds: [], allItems: [] }
  }

  // Load ALL practice phrases and split into debut (shortest 7) and eternal (longest 5)
  // Single query for efficiency
  const { debutMap: debutPhrases, eternalMap: eternalPhrases } = await loadAllPracticePhrasesGrouped(
    supabase,
    courseId,
    audioBaseUrl
  )

  const rounds: RoundData[] = []
  const allItems: ScriptItem[] = []

  // Create a lookup map for LEGOs by index
  const legoMap = new Map<number, typeof legos[0]>()
  legos.forEach((lego, idx) => {
    legoMap.set(idx + 1, lego) // 1-based indexing
  })

  // Generate each ROUND
  for (let n = 1; n <= legos.length; n++) {
    const currentLego = legos[n - 1]
    const currentDebuts = debutPhrases.get(currentLego.lego.id) || []
    const currentEternals = eternalPhrases.get(currentLego.lego.id) || []
    const roundItems: ScriptItem[] = []

    // Track ALL phrases used in this round (no duplicates within a round!)
    // Normalize: lowercase, trim, strip punctuation for matching
    const usedPhrasesInRound = new Set<string>()
    const normalizePhrase = (text: string) =>
      text.toLowerCase().trim().replace(/[.,!?;:¡¿'"]+/g, '')

    // Proper nouns to preserve when normalizing display text
    const properNouns = new Set([
      // English pronoun
      'I',
      // Languages
      'English', 'Spanish', 'Chinese', 'Welsh', 'French', 'German', 'Italian',
      'Portuguese', 'Japanese', 'Korean', 'Arabic', 'Russian', 'Dutch', 'Greek',
      'Hebrew', 'Hindi', 'Polish', 'Swedish', 'Turkish', 'Vietnamese',
      // Countries/regions
      'England', 'Spain', 'China', 'Wales', 'France', 'Germany', 'Italy',
      'Portugal', 'Japan', 'Korea', 'Mexico', 'Brazil', 'Argentina',
      'America', 'Britain', 'Ireland', 'Scotland',
    ])
    const properNounsLower = new Map([...properNouns].map(n => [n.toLowerCase(), n]))

    // Normalize display text: lowercase but preserve proper nouns
    const normalizeDisplay = (text: string): string => {
      return text.split(/(\s+)/).map(word => {
        // Handle "I" and "I'" contractions (I'm, I'll, I've, I'd)
        if (/^i$/i.test(word) || /^i['']/i.test(word)) {
          // Capitalize the I, keep rest as-is
          return 'I' + word.slice(1).toLowerCase()
        }

        const stripped = word.replace(/[.,!?;:¡¿''"]+/g, '')
        const proper = properNounsLower.get(stripped.toLowerCase())
        if (proper) {
          // Restore proper noun, keeping any punctuation
          return word.replace(stripped, proper)
        }
        return word.toLowerCase()
      }).join('')
    }

    const baseItem: Omit<ScriptItem, 'type' | 'reviewOf' | 'fibonacciPosition'> = {
      roundNumber: n,
      legoId: currentLego.lego.id,
      legoIndex: n,
      seedId: currentLego.seed.seed_id,
      knownText: normalizeDisplay(currentLego.phrase?.phrase?.known || ''),
      targetText: normalizeDisplay(currentLego.phrase?.phrase?.target || ''),
      audioRefs: currentLego.phrase?.audioRefs,
      audioDurations: currentLego.audioDurations,
    }

    // Phase 1: Introduction Audio (not a phrase, doesn't count)
    roundItems.push({
      ...baseItem,
      type: 'intro',
    })

    // Phase 2: Components (for M-type LEGOs - skipped for now)

    // Phase 3: LEGO Debut
    roundItems.push({
      ...baseItem,
      type: 'debut',
    })
    usedPhrasesInRound.add(normalizePhrase(baseItem.targetText))

    // Phase 4: Debut Phrases - up to 7 shortest phrases by syllable count
    for (let i = 0; i < Math.min(currentDebuts.length, 7); i++) {
      const phrase = currentDebuts[i]
      // Skip if already used in this round (case-insensitive)
      if (usedPhrasesInRound.has(normalizePhrase(phrase.targetText))) continue

      roundItems.push({
        ...baseItem,
        type: 'debut_phrase',
        knownText: normalizeDisplay(phrase.knownText),
        targetText: normalizeDisplay(phrase.targetText),
        audioRefs: phrase.audioRefs,
      })
      usedPhrasesInRound.add(normalizePhrase(phrase.targetText))
    }

    // Phase 5: Interleaved Spaced Rep - select from ETERNAL phrases
    const reviews = calculateSpacedRepReviews(n)
    const reviewIndices: number[] = []

    for (const review of reviews) {
      const reviewLego = legoMap.get(review.legoIndex)
      if (!reviewLego) continue

      reviewIndices.push(review.legoIndex)
      const reviewEternals = eternalPhrases.get(reviewLego.lego.id) || []

      // N-1 (first revisit) gets 3x phrases, others get 1x
      const isFirstRevisit = review.legoIndex === n - 1
      const targetPhraseCount = isFirstRevisit ? 3 : 1

      // Find unused phrases from the eternal pool (case-insensitive)
      const availablePhrases = reviewEternals.filter(p => !usedPhrasesInRound.has(normalizePhrase(p.targetText)))

      // Add as many as we can (up to target), but don't duplicate!
      const phrasesToAdd = Math.min(targetPhraseCount, availablePhrases.length)

      for (let p = 0; p < phrasesToAdd; p++) {
        // Pick randomly from remaining available phrases (case-insensitive)
        const remainingAvailable = availablePhrases.filter(ph => !usedPhrasesInRound.has(normalizePhrase(ph.targetText)))
        if (remainingAvailable.length === 0) break

        const idx = Math.floor(Math.random() * remainingAvailable.length)
        const selectedPhrase = remainingAvailable[idx]

        roundItems.push({
          roundNumber: n,
          legoId: reviewLego.lego.id,
          legoIndex: review.legoIndex,
          seedId: reviewLego.seed.seed_id,
          knownText: normalizeDisplay(selectedPhrase.knownText),
          targetText: normalizeDisplay(selectedPhrase.targetText),
          audioRefs: selectedPhrase.audioRefs,
          audioDurations: reviewLego.audioDurations,
          type: 'spaced_rep',
          reviewOf: review.legoIndex,
          fibonacciPosition: review.fibPosition,
        })
        usedPhrasesInRound.add(normalizePhrase(selectedPhrase.targetText))
      }
    }

    // Phase 6: Consolidation (2 eternal phrases for the new LEGO)
    // Must also check usedPhrasesInRound to avoid repeating LEGO/DEBUT phrases
    const usedConsolidation = new Set<string>()

    for (let c = 0; c < 2; c++) {
      // Find phrases not yet used in round OR consolidation
      const availableForConsolidation = currentEternals.filter(p =>
        !usedPhrasesInRound.has(normalizePhrase(p.targetText)) &&
        !usedConsolidation.has(normalizePhrase(p.targetText))
      )

      if (availableForConsolidation.length === 0) {
        // Fall back to debut if no eternals available AND not already used in round
        const baseNormalized = normalizePhrase(baseItem.targetText)
        if (!usedPhrasesInRound.has(baseNormalized) && !usedConsolidation.has(baseNormalized)) {
          roundItems.push({
            ...baseItem,
            type: 'consolidation',
          })
          usedConsolidation.add(baseNormalized)
        }
        continue
      }

      const idx = Math.floor(Math.random() * availableForConsolidation.length)
      const consolidation = availableForConsolidation[idx]

      roundItems.push({
        ...baseItem,
        type: 'consolidation',
        knownText: normalizeDisplay(consolidation.knownText),
        targetText: normalizeDisplay(consolidation.targetText),
        audioRefs: consolidation.audioRefs,
      })
      usedConsolidation.add(normalizePhrase(consolidation.targetText))
    }

    // CRITICAL: Remove consecutive identical phrases (case-insensitive)
    // INTRO is always kept - it plays introduction audio ("The Spanish for X is Y")
    // All other items: skip if same known+target text as previous non-INTRO item
    const dedupedItems: ScriptItem[] = []
    let lastPracticeItem: ScriptItem | null = null // Track last non-INTRO item

    for (const item of roundItems) {
      // INTRO is always added (plays different audio - the explanation)
      if (item.type === 'intro') {
        dedupedItems.push(item)
        continue
      }

      // For practice items, check for consecutive duplicates (normalized)
      if (lastPracticeItem) {
        const sameKnown = normalizePhrase(item.knownText) === normalizePhrase(lastPracticeItem.knownText)
        const sameTarget = normalizePhrase(item.targetText) === normalizePhrase(lastPracticeItem.targetText)
        if (sameKnown && sameTarget) {
          // Skip this duplicate - don't update lastPracticeItem
          continue
        }
      }

      dedupedItems.push(item)
      lastPracticeItem = item
    }

    rounds.push({
      roundNumber: n,
      legoId: currentLego.lego.id,
      legoIndex: n,
      seedId: currentLego.seed.seed_id,
      items: dedupedItems,
      spacedRepReviews: reviewIndices,
    })

    allItems.push(...dedupedItems)
  }

  console.log(`[generateLearningScript] Generated ${rounds.length} rounds with ${allItems.length} total items`)

  return { rounds, allItems }
}
