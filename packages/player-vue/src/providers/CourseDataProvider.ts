/**
 * CourseDataProvider - Load course data from Supabase or manifest fallback
 *
 * Provides abstraction for loading learning items with backwards compatibility
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
   */
  private transformToLearningItems(records: any[]): LearningItem[] {
    return records.map((record) => {
      const legoId = record.lego_id
      const seedId = `S${String(record.seed_number).padStart(4, '0')}`

      // Resolve audio URLs from UUIDs (field names from lego_cycles view)
      const knownAudioUrl = this.resolveAudioUrl(record.known_audio_uuid)
      const target1AudioUrl = this.resolveAudioUrl(record.target1_audio_uuid)
      const target2AudioUrl = this.resolveAudioUrl(record.target2_audio_uuid)

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
   * Resolve audio UUID to full S3 URL
   */
  private resolveAudioUrl(uuid: string): string {
    if (!uuid) return ''
    return `${this.audioBaseUrl}/${uuid}.mp3`
  }

  /**
   * Get course metadata
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
   */
  async getWelcomeAudio(): Promise<AudioRef | null> {
    if (!this.client) return null

    try {
      // Use 'welcome' field (new v12 schema) with fallback to old fields
      const { data, error } = await this.client
        .from('courses')
        .select('welcome, welcome_audio_uuid, welcome_audio_duration_ms')
        .eq('course_code', this.courseId)
        .single()

      if (error) return null

      // Prefer new 'welcome' field, fall back to old 'welcome_audio_uuid'
      const welcomeId = data?.welcome || data?.welcome_audio_uuid
      if (!welcomeId) return null

      return {
        id: welcomeId,
        url: this.resolveAudioUrl(welcomeId),
        duration_ms: data.welcome_audio_duration_ms || null,
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
   */
  async getLegoBasket(legoId: string, lego?: LegoPair): Promise<ClassifiedBasket | null> {
    if (!this.client) {
      console.warn('[CourseDataProvider] No Supabase client, returning empty basket')
      return this.createEmptyBasket(legoId, lego)
    }

    try {
      // Query practice_cycles view for all phrases containing this LEGO
      const { data, error } = await this.client
        .from('practice_cycles')
        .select('*')
        .eq('lego_id', legoId)
        .eq('course_code', this.courseId)
        .order('position', { ascending: true })
        .order('target_syllable_count', { ascending: true })

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
      const { data, error } = await this.client
        .from('practice_cycles')
        .select('*')
        .eq('seed_number', seedNumber)
        .eq('course_code', this.courseId)
        .order('lego_id', { ascending: true })
        .order('position', { ascending: true })
        .order('target_syllable_count', { ascending: true })

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
   */
  async getIntroductionAudio(legoId: string): Promise<AudioRef | null> {
    if (!this.client) return null

    try {
      const { data, error } = await this.client
        .from('lego_introductions')
        .select('audio_uuid, duration_ms')
        .eq('lego_id', legoId)
        .eq('course_code', this.courseId)
        .single()

      if (error || !data) return null

      return {
        id: data.audio_uuid,
        url: this.resolveAudioUrl(data.audio_uuid),
        duration_ms: data.duration_ms,
      }
    } catch (err) {
      console.error('[CourseDataProvider] Error loading intro audio:', err)
      return null
    }
  }

  /**
   * Transform database records to ClassifiedBasket
   */
  private transformToBasket(
    legoId: string,
    records: any[],
    lego?: LegoPair
  ): ClassifiedBasket {
    const components: PracticePhrase[] = []
    let debut: PracticePhrase | null = null
    const debutPhrases: PracticePhrase[] = []
    const eternalPhrases: PracticePhrase[] = []

    for (const record of records) {
      const phrase: PracticePhrase = {
        id: record.phrase_id || `${legoId}_P${record.position}`,
        phraseType: this.mapPhraseType(record.position, record.phrase_type),
        phrase: {
          known: record.known_text,
          target: record.target_text,
        },
        audioRefs: {
          known: {
            id: record.known_audio_uuid,
            url: this.resolveAudioUrl(record.known_audio_uuid),
            duration_ms: record.known_duration_ms,
          },
          target: {
            voice1: {
              id: record.target1_audio_uuid,
              url: this.resolveAudioUrl(record.target1_audio_uuid),
              duration_ms: record.target1_duration_ms,
            },
            voice2: {
              id: record.target2_audio_uuid,
              url: this.resolveAudioUrl(record.target2_audio_uuid),
              duration_ms: record.target2_duration_ms,
            },
          },
        },
        wordCount: record.target_word_count || (record.target_text?.split(/\s+/).length || 1),
        containsLegos: [legoId],
      }

      // Classify by position (from APML spec)
      // position 0 = component, position 1 = lego debut, position 2+ = phrases
      const position = record.position || 0
      if (position === 0) {
        components.push(phrase)
      } else if (position === 1) {
        debut = phrase
      } else if (position <= 4) {
        // Positions 2-4 are debut phrases (shortest)
        debutPhrases.push(phrase)
      } else {
        // Position 5+ are eternal phrases
        eternalPhrases.push(phrase)
      }
    }

    // If no explicit debut, create from lego
    if (!debut && lego) {
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
      return uniqueRecords.slice(offset, offset + limit).map((record) => {
        const legoId = record.lego_id
        const seedId = `S${String(record.seed_number).padStart(4, '0')}`

        const knownAudioUrl = this.resolveAudioUrl(record.known_audio_uuid)
        const target1AudioUrl = this.resolveAudioUrl(record.target1_audio_uuid)
        const target2AudioUrl = this.resolveAudioUrl(record.target2_audio_uuid)

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
 * Fibonacci sequence for spaced repetition
 */
const FIBONACCI = [1, 1, 2, 3, 5, 8, 13, 21, 34, 55, 89]

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
 * IMPORTANT: Each LEGO only appears once per round (deduplicated).
 * The Fibonacci sequence has [1, 1, ...] but we don't review the same LEGO twice.
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
 * Load eternal phrases for all LEGOs in one query
 * Returns a map of legoId -> array of eternal phrases (up to 5 longest by word_count)
 */
async function loadEternalPhrases(
  supabase: any,
  courseId: string,
  audioBaseUrl: string
): Promise<Map<string, EternalPhrase[]>> {
  const eternalMap = new Map<string, EternalPhrase[]>()

  if (!supabase) return eternalMap

  try {
    // Query course_practice_phrases directly (practice_cycles view filters by audio existence)
    // Use the source table to get ALL phrases, even those without audio yet
    // Include position >= 1 (skip only components at position 0)
    // The SORT ORDER determines debut vs eternal - shortest vs longest
    const { data, error } = await supabase
      .from('course_practice_phrases')
      .select('*')
      .eq('course_code', courseId)
      .gte('position', 1) // Skip components (0), include debut (1) and practice (2+)
      .order('seed_number', { ascending: true })
      .order('lego_index', { ascending: true })
      .order('word_count', { ascending: false }) // Longest (by word count) first

    if (error) {
      console.error('[loadEternalPhrases] Query error:', error)
      return eternalMap
    }

    if (!data) return eternalMap

    console.log(`[loadEternalPhrases] Loaded ${data.length} practice phrases from course_practice_phrases`)

    // Group by lego_id (constructed from seed_number + lego_index) and take top 5 longest for each
    const grouped = new Map<string, any[]>()
    for (const row of data) {
      // Construct lego_id from seed_number and lego_index
      const legoId = `S${String(row.seed_number).padStart(4, '0')}L${String(row.lego_index).padStart(2, '0')}`
      if (!grouped.has(legoId)) {
        grouped.set(legoId, [])
      }
      const phrases = grouped.get(legoId)!
      if (phrases.length < 5) { // Keep only top 5 longest
        phrases.push({ ...row, lego_id: legoId })
      }
    }

    // Transform to EternalPhrase format
    // Note: Audio refs are empty since course_practice_phrases doesn't have audio columns
    // Audio would be resolved separately via audio_samples table if needed for playback
    for (const [legoId, rows] of grouped) {
      const phrases: EternalPhrase[] = rows.map(row => ({
        knownText: row.known_text,
        targetText: row.target_text,
        syllableCount: row.word_count || 0,
        audioRefs: {
          known: { id: '', url: '' },
          target: {
            voice1: { id: '', url: '' },
            voice2: { id: '', url: '' }
          }
        }
      }))
      eternalMap.set(legoId, phrases)
    }

    console.log(`[loadEternalPhrases] Grouped into ${eternalMap.size} LEGOs with eternal phrases`)
    return eternalMap
  } catch (err) {
    console.error('[loadEternalPhrases] Error:', err)
    return eternalMap
  }
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

/**
 * Load debut phrases for all LEGOs (shortest by syllable count, up to 7 each)
 */
async function loadDebutPhrases(
  supabase: any,
  courseId: string,
  audioBaseUrl: string
): Promise<Map<string, EternalPhrase[]>> {
  const debutMap = new Map<string, EternalPhrase[]>()

  if (!supabase) return debutMap

  try {
    // Query course_practice_phrases directly (practice_cycles view filters by audio existence)
    // Use the source table to get ALL phrases, even those without audio yet
    // Include position >= 1 to get DEBUT phrases (position 1) and practice phrases (position >= 2)
    // Position 0 = components (skip), Position 1 = debut combinations, Position >= 2 = practice
    // Ordered by target_syllable_count ASC to get shortest first
    const { data, error } = await supabase
      .from('course_practice_phrases')
      .select('*')
      .eq('course_code', courseId)
      .gte('position', 1) // Include debut (1) and practice (2+), skip components (0)
      .order('seed_number', { ascending: true })
      .order('lego_index', { ascending: true })
      .order('target_syllable_count', { ascending: true }) // Shortest first for debut

    if (error) {
      console.error('[loadDebutPhrases] Query error:', error)
      return debutMap
    }

    if (!data) return debutMap

    console.log(`[loadDebutPhrases] Loaded ${data.length} practice phrases from course_practice_phrases`)

    // Group by lego_id (constructed from seed_number + lego_index) and take shortest 7 for each
    const grouped = new Map<string, any[]>()
    for (const row of data) {
      // Construct lego_id from seed_number and lego_index
      const legoId = `S${String(row.seed_number).padStart(4, '0')}L${String(row.lego_index).padStart(2, '0')}`
      if (!grouped.has(legoId)) {
        grouped.set(legoId, [])
      }
      const phrases = grouped.get(legoId)!
      if (phrases.length < 7) { // Keep shortest 7
        phrases.push({ ...row, lego_id: legoId })
      }
    }

    // Transform to EternalPhrase format (reuse the same interface)
    // Note: Audio refs are empty since course_practice_phrases doesn't have audio columns
    for (const [legoId, rows] of grouped) {
      const phrases: EternalPhrase[] = rows.map(row => ({
        knownText: row.known_text,
        targetText: row.target_text,
        syllableCount: row.target_syllable_count || row.word_count || 0,
        audioRefs: {
          known: { id: '', url: '' },
          target: {
            voice1: { id: '', url: '' },
            voice2: { id: '', url: '' }
          }
        }
      }))
      debutMap.set(legoId, phrases)
    }

    console.log(`[loadDebutPhrases] Grouped into ${debutMap.size} LEGOs with debut phrases`)
    return debutMap
  } catch (err) {
    console.error('[loadDebutPhrases] Error:', err)
    return debutMap
  }
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
  supabase: any,
  courseId: string,
  audioBaseUrl: string,
  maxLegos: number = 50,
  offset: number = 0
): Promise<{ rounds: RoundData[]; allItems: ScriptItem[] }> {
  // Load unique LEGOs with pagination
  const legos = await provider.loadAllUniqueLegos(maxLegos, offset)

  if (legos.length === 0) {
    return { rounds: [], allItems: [] }
  }

  // Load debut phrases (shortest by syllable count) and eternal phrases (longest)
  const [debutPhrases, eternalPhrases] = await Promise.all([
    loadDebutPhrases(supabase, courseId, audioBaseUrl),
    loadEternalPhrases(supabase, courseId, audioBaseUrl)
  ])

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
    const usedPhrasesInRound = new Set<string>()

    const baseItem: Omit<ScriptItem, 'type' | 'reviewOf' | 'fibonacciPosition'> = {
      roundNumber: n,
      legoId: currentLego.lego.id,
      legoIndex: n,
      seedId: currentLego.seed.seed_id,
      knownText: currentLego.phrase.phrase.known,
      targetText: currentLego.phrase.phrase.target,
      audioRefs: currentLego.phrase.audioRefs,
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
    usedPhrasesInRound.add(baseItem.targetText)

    // Phase 4: Debut Phrases - up to 7 shortest phrases by syllable count
    for (let i = 0; i < Math.min(currentDebuts.length, 7); i++) {
      const phrase = currentDebuts[i]
      // Skip if already used in this round
      if (usedPhrasesInRound.has(phrase.targetText)) continue

      roundItems.push({
        ...baseItem,
        type: 'debut_phrase',
        knownText: phrase.knownText,
        targetText: phrase.targetText,
        audioRefs: phrase.audioRefs,
      })
      usedPhrasesInRound.add(phrase.targetText)
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

      // Find unused phrases from the eternal pool
      const availablePhrases = reviewEternals.filter(p => !usedPhrasesInRound.has(p.targetText))

      // Add as many as we can (up to target), but don't duplicate!
      const phrasesToAdd = Math.min(targetPhraseCount, availablePhrases.length)

      for (let p = 0; p < phrasesToAdd; p++) {
        // Pick randomly from remaining available phrases
        const remainingAvailable = availablePhrases.filter(ph => !usedPhrasesInRound.has(ph.targetText))
        if (remainingAvailable.length === 0) break

        const idx = Math.floor(Math.random() * remainingAvailable.length)
        const selectedPhrase = remainingAvailable[idx]

        roundItems.push({
          roundNumber: n,
          legoId: reviewLego.lego.id,
          legoIndex: review.legoIndex,
          seedId: reviewLego.seed.seed_id,
          knownText: selectedPhrase.knownText,
          targetText: selectedPhrase.targetText,
          audioRefs: selectedPhrase.audioRefs,
          audioDurations: reviewLego.audioDurations,
          type: 'spaced_rep',
          reviewOf: review.legoIndex,
          fibonacciPosition: review.fibPosition,
        })
        usedPhrasesInRound.add(selectedPhrase.targetText)
      }
    }

    // Phase 6: Consolidation (2 eternal phrases for the new LEGO)
    // These CAN overlap with debut phrases since eternal/debut pools overlap
    // So we use a separate tracking set for consolidation
    const usedConsolidation = new Set<string>()

    for (let c = 0; c < 2; c++) {
      // Find phrases not yet used in consolidation (but may overlap with debut)
      const availableForConsolidation = currentEternals.filter(p => !usedConsolidation.has(p.targetText))

      if (availableForConsolidation.length === 0) {
        // Fall back to debut if no eternals available
        if (!usedConsolidation.has(baseItem.targetText)) {
          roundItems.push({
            ...baseItem,
            type: 'consolidation',
          })
          usedConsolidation.add(baseItem.targetText)
        }
        continue
      }

      const idx = Math.floor(Math.random() * availableForConsolidation.length)
      const consolidation = availableForConsolidation[idx]

      roundItems.push({
        ...baseItem,
        type: 'consolidation',
        knownText: consolidation.knownText,
        targetText: consolidation.targetText,
        audioRefs: consolidation.audioRefs,
      })
      usedConsolidation.add(consolidation.targetText)
    }

    // CRITICAL: Remove consecutive identical phrases
    // Early rounds may be very short - that's OK!
    // INTRO is special (plays introduction audio like "The Welsh for X is Y")
    // After INTRO, first practice should NOT be identical to the LEGO text
    const dedupedItems: ScriptItem[] = []
    const legoTargetText = baseItem.targetText // The LEGO's own text

    for (const item of roundItems) {
      // INTRO is always added
      if (item.type === 'intro') {
        dedupedItems.push(item)
        continue
      }

      const prevItem = dedupedItems[dedupedItems.length - 1]

      // After INTRO, skip if this item is the same as the LEGO text
      // (first practice should be a combination, not the bare LEGO repeated)
      if (prevItem?.type === 'intro' && item.targetText === legoTargetText) {
        continue
      }

      // Skip consecutive identical phrases
      if (prevItem && item.targetText === prevItem.targetText) {
        continue
      }

      dedupedItems.push(item)
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
