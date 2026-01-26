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
   * v2.2: Uses proxy URLs via /api/audio/{audioId} for CORS bypass
   */
  private transformToLearningItems(records: any[]): LearningItem[] {
    return records.map((record) => {
      const legoId = record.lego_id
      const seedId = `S${String(record.seed_number).padStart(4, '0')}`

      // v2.2: Build proxy URLs from audio UUIDs (bypasses CORS)
      const knownAudioUrl = this.buildProxyUrl(record.known_audio_uuid)
      const target1AudioUrl = this.buildProxyUrl(record.target1_audio_uuid)
      const target2AudioUrl = this.buildProxyUrl(record.target2_audio_uuid)

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
   * Build proxy URL from audio UUID
   * v2.2: Routes through /api/audio/{audioId} for CORS bypass and analytics
   */
  private buildProxyUrl(audioId: string): string {
    if (!audioId || audioId === 'undefined' || audioId === 'null') {
      console.warn('[CourseDataProvider] Invalid audioId for proxy URL:', audioId)
      return ''  // Return empty but log the issue
    }
    return `/api/audio/${audioId}?courseId=${encodeURIComponent(this.courseId)}`
  }

  /**
   * Resolve S3 key to full URL (fallback for direct S3 access)
   * v13: s3_key IS the actual S3 object key. Use it as-is.
   * No normalization - the database stores the actual path.
   */
  private resolveAudioUrl(s3Key: string): string {
    if (!s3Key) return ''

    // Strip any trailing slash or /mastered suffix from base URL
    let baseUrl = this.audioBaseUrl
    if (baseUrl.endsWith('/')) {
      baseUrl = baseUrl.slice(0, -1)
    }
    if (baseUrl.endsWith('/mastered')) {
      baseUrl = baseUrl.slice(0, -9)
    }

    // s3_key is the actual S3 object key - use as-is
    return `${baseUrl}/${s3Key}`
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
        console.warn('[CourseDataProvider] Presentation audio query error:', error.message)
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
        url: this.buildProxyUrl(row.id),  // v2.2: use proxy for CORS bypass
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
        url: this.buildProxyUrl(row.id),  // v2.2: use proxy for CORS bypass
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
      // Get course language configuration (uses 'course_code' - renamed from 'code' 2026-01-18)
      const { data: course, error: courseError } = await this.client
        .from('courses')
        .select('known_lang, target_lang')
        .eq('course_code', this.courseId)
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

      if (!audioError && audio && audio.id) {
        return {
          id: audio.id,
          url: this.buildProxyUrl(audio.id),  // v2.2: use proxy for CORS bypass
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
      // Get course language configuration once (uses 'course_code' - renamed from 'code' 2026-01-18)
      const { data: course, error: courseError } = await this.client
        .from('courses')
        .select('known_lang, target_lang')
        .eq('course_code', this.courseId)
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
              url: this.buildProxyUrl(audio.id),  // v2.2: use proxy for CORS bypass
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
            url: this.buildProxyUrl(record.known_audio_uuid),  // v2.2: use proxy for CORS bypass
            duration_ms: record.known_duration_ms,
          },
          target: {
            voice1: {
              id: record.target1_audio_uuid,
              url: this.buildProxyUrl(record.target1_audio_uuid),  // v2.2: use proxy for CORS bypass
              duration_ms: record.target1_duration_ms,
            },
            voice2: {
              id: record.target2_audio_uuid,
              url: this.buildProxyUrl(record.target2_audio_uuid),  // v2.2: use proxy for CORS bypass
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
   * Load a single LEGO at a specific seed position
   * Used for fast startup - loads only what's needed for immediate play
   * @param seedNumber - The seed position (1-based)
   * @returns LearningItem or null if not found
   */
  async loadLegoAtPosition(seedNumber: number): Promise<LearningItem | null> {
    if (!this.client) {
      console.warn('[CourseDataProvider] No Supabase client, cannot load LEGO at position')
      return null
    }

    try {
      const { data, error } = await this.client
        .from('lego_cycles')
        .select('*')
        .eq('course_code', this.courseId)
        .eq('seed_number', seedNumber)
        .order('lego_index', { ascending: true })
        .limit(1)
        .maybeSingle()

      if (error) {
        console.error('[CourseDataProvider] Query error:', error)
        return null
      }

      if (!data) {
        console.warn('[CourseDataProvider] No LEGO found at seed position:', seedNumber)
        return null
      }

      // Transform to LearningItem
      const items = this.transformToLearningItems([data])
      return items[0] ?? null
    } catch (err) {
      console.error('[CourseDataProvider] Failed to load LEGO at position:', err)
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
      console.warn('[CourseDataProvider] No Supabase client, cannot load LEGO range')
      return []
    }

    try {
      const { data, error } = await this.client
        .from('lego_cycles')
        .select('*')
        .eq('course_code', this.courseId)
        .gte('seed_number', startSeed)
        .lte('seed_number', endSeed)
        .order('seed_number', { ascending: true })
        .order('lego_index', { ascending: true })

      if (error) {
        console.error('[CourseDataProvider] Query error:', error)
        return []
      }

      if (!data || data.length === 0) {
        console.warn('[CourseDataProvider] No LEGOs found in range:', startSeed, '-', endSeed)
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

      console.log(`[CourseDataProvider] Loaded ${uniqueRecords.length} LEGOs from range ${startSeed}-${endSeed}`)
      return this.transformToLearningItems(uniqueRecords)
    } catch (err) {
      console.error('[CourseDataProvider] Failed to load LEGO range:', err)
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
      // Query practice_cycles for all LEGOs in one batch
      // v13: Sort by target1_duration_ms for cognitive load
      const { data, error } = await this.client
        .from('practice_cycles')
        .select('*')
        .eq('course_code', this.courseId)
        .in('lego_id', legoIds)
        .order('lego_id', { ascending: true })
        .order('target1_duration_ms', { ascending: true, nullsFirst: false })

      if (error) {
        console.error('[CourseDataProvider] Batch basket query error:', error)
        // Fall back to individual loading for failed batch
        for (const legoId of legoIds) {
          const basket = await this.getLegoBasket(legoId, legos?.get(legoId))
          if (basket) baskets.set(legoId, basket)
        }
        return baskets
      }

      if (!data || data.length === 0) {
        console.warn('[CourseDataProvider] No practice phrases found for LEGOs:', legoIds)
        // Create empty baskets for each LEGO
        for (const legoId of legoIds) {
          baskets.set(legoId, this.createEmptyBasket(legoId, legos?.get(legoId)))
        }
        return baskets
      }

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

      console.log(`[CourseDataProvider] Batch loaded ${baskets.size} baskets for ${legoIds.length} LEGOs`)
      return baskets
    } catch (err) {
      console.error('[CourseDataProvider] Batch basket loading error:', err)
      return baskets
    }
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
      // IMPORTANT: offset is a SEED NUMBER (absolute position), not array index
      // Filter by seed_number >= offset to start from the correct belt position
      let query = this.client
        .from('lego_cycles')
        .select('*')
        .eq('course_code', this.courseId)

      // Filter by seed number if offset specified (belt skip uses absolute seed positions)
      if (offset > 0) {
        query = query.gte('seed_number', offset)
      }

      const { data, error } = await query
        .order('seed_number', { ascending: true })
        .order('lego_index', { ascending: true })

      if (error) {
        console.error('[CourseDataProvider] Query error:', error)
        return []
      }

      if (!data || data.length === 0) {
        console.warn('[CourseDataProvider] No LEGOs found for course:', this.courseId, 'from seed', offset)
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

      console.log('[CourseDataProvider] Loaded', uniqueRecords.length, 'unique LEGOs for', this.courseId, 'from seed', offset)

      // Transform to LearningItem format (apply limit for pagination)
      // v13.1: Use s3_key fields for URLs
      return uniqueRecords.slice(0, limit).map((record) => {
        const legoId = record.lego_id
        const seedId = `S${String(record.seed_number).padStart(4, '0')}`

        const knownAudioUrl = this.buildProxyUrl(record.known_audio_uuid)
        const target1AudioUrl = this.buildProxyUrl(record.target1_audio_uuid)
        const target2AudioUrl = this.buildProxyUrl(record.target2_audio_uuid)

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
  // For INTRO items: presentation audio ("The Welsh for X is...")
  presentationAudio?: { id: string; url: string }
  // For INTRO items on M-type LEGOs: visual component breakdown
  // Format: [{known: "after", target: "después de"}, {known: "that", target: "que"}, ...]
  components?: Array<{ known: string; target: string }>
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
 * @deprecated Use buildRounds from '@/playback/RoundBuilder' instead.
 * This function has been replaced by the new playback architecture.
 * Migration required: see packages/player-vue/src/playback/RoundBuilder.ts
 */
export async function generateLearningScript(
  _provider: CourseDataProvider,
  _maxLegos: number = 50,
  _offset: number = 0
): Promise<{ rounds: RoundData[]; allItems: ScriptItem[] }> {
  console.warn(
    '[DEPRECATED] generateLearningScript is deprecated. ' +
    'Use buildRounds from @/playback/RoundBuilder instead.'
  )
  // Return empty data - callers need to migrate to new playback architecture
  return { rounds: [], allItems: [] }
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
// Component breakdown for M-type LEGOs (visual display only)
/**
 * Load all practice phrases grouped by LEGO
 * v2.0: NO COMPONENTS - they're removed entirely from the learning flow
 *
 * Returns:
 * - debutMap: phrases for introduction (phrase_type = 'practice'), ordered by duration
 * - eternalMap: phrases for spaced rep / consolidation (phrase_type = 'eternal_eligible')
 */
async function loadAllPracticePhrasesGrouped(
  supabase: any,
  courseId: string,
  audioBaseUrl: string
): Promise<{
  debutMap: Map<string, EternalPhrase[]>
  eternalMap: Map<string, EternalPhrase[]>
}> {
  const debutMap = new Map<string, EternalPhrase[]>()
  const eternalMap = new Map<string, EternalPhrase[]>()

  if (!supabase) return { debutMap, eternalMap }

  // Helper to build proxy URL from audio UUID (v2.2 - CORS bypass)
  const buildProxyUrl = (audioId: string | null): string => {
    if (!audioId) return ''
    return `/api/audio/${audioId}?courseId=${encodeURIComponent(courseId)}`
  }

  // Helper to resolve S3 URL directly (fallback/deprecated)
  const resolveAudioUrl = (s3Key: string | null): string => {
    if (!s3Key) return ''
    let baseUrl = audioBaseUrl
    if (baseUrl.endsWith('/')) baseUrl = baseUrl.slice(0, -1)
    if (baseUrl.endsWith('/mastered')) baseUrl = baseUrl.slice(0, -9)
    return `${baseUrl}/${s3Key}`
  }

  try {
    // Load practice phrases using phrase_type for explicit categorization
    // phrase_type values:
    //   'component' - Parts of M-type LEGOs shown during introduction
    //   'practice' - Build-up phrases used during debut sequence
    //   'eternal_eligible' - Phrases eligible for spaced rep / consolidation

    // Helper to transform row to EternalPhrase
    // v2.2: Use proxy URLs for CORS bypass
    const toPhrase = (row: any): EternalPhrase => ({
      knownText: row.known_text,
      targetText: row.target_text,
      syllableCount: row.target1_duration_ms || 0,
      audioRefs: {
        known: {
          id: row.known_audio_uuid || '',
          url: buildProxyUrl(row.known_audio_uuid)
        },
        target: {
          voice1: {
            id: row.target1_audio_uuid || '',
            url: buildProxyUrl(row.target1_audio_uuid)
          },
          voice2: {
            id: row.target2_audio_uuid || '',
            url: buildProxyUrl(row.target2_audio_uuid)
          }
        }
      }
    })

    // Load debut phrases (phrase_type = 'practice')
    // Sorted by duration ascending for cognitive load progression
    let debutOffset = 0
    const pageSize = 1000

    while (true) {
      const { data: page, error } = await supabase
        .from('practice_cycles')
        .select('*')
        .eq('course_code', courseId)
        .eq('phrase_type', 'practice')
        .order('lego_id', { ascending: true })
        .order('target1_duration_ms', { ascending: true, nullsFirst: false })
        .range(debutOffset, debutOffset + pageSize - 1)

      if (error) {
        console.error('[loadAllPracticePhrasesGrouped] Query error (debut):', error)
        break
      }
      if (!page || page.length === 0) break

      for (const row of page) {
        if (!debutMap.has(row.lego_id)) {
          debutMap.set(row.lego_id, [])
        }
        debutMap.get(row.lego_id)!.push(toPhrase(row))
      }

      if (page.length < pageSize) break
      debutOffset += pageSize
    }

    // Load eternal phrases (phrase_type = 'eternal_eligible')
    let eternalOffset = 0

    while (true) {
      const { data: page, error } = await supabase
        .from('practice_cycles')
        .select('*')
        .eq('course_code', courseId)
        .eq('phrase_type', 'eternal_eligible')
        .order('lego_id', { ascending: true })
        .order('target1_duration_ms', { ascending: true, nullsFirst: false })
        .range(eternalOffset, eternalOffset + pageSize - 1)

      if (error) {
        console.error('[loadAllPracticePhrasesGrouped] Query error (eternal):', error)
        break
      }
      if (!page || page.length === 0) break

      for (const row of page) {
        if (!eternalMap.has(row.lego_id)) {
          eternalMap.set(row.lego_id, [])
        }
        eternalMap.get(row.lego_id)!.push(toPhrase(row))
      }

      if (page.length < pageSize) break
      eternalOffset += pageSize
    }

    // v2.0: NO COMPONENTS - removed entirely from learning flow

    console.log(`[loadAllPracticePhrasesGrouped] Loaded ${debutMap.size} LEGOs with debut, ${eternalMap.size} with eternal`)
    return { debutMap, eternalMap }
  } catch (err) {
    console.error('[loadAllPracticePhrasesGrouped] Error:', err)
    return { debutMap, eternalMap }
  }
}
