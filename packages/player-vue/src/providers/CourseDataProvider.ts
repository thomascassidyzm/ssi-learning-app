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
      const { data, error } = await this.client
        .from('courses')
        .select('welcome_audio_uuid, welcome_audio_duration_ms')
        .eq('course_code', this.courseId)
        .single()

      if (error || !data?.welcome_audio_uuid) return null

      return {
        id: data.welcome_audio_uuid,
        url: this.resolveAudioUrl(data.welcome_audio_uuid),
        duration_ms: data.welcome_audio_duration_ms,
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
      // Query practice_cycles for all LEGOs in this seed
      const { data, error } = await this.client
        .from('practice_cycles')
        .select('*')
        .eq('seed_id', seedId)
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
  async loadAllUniqueLegos(limit: number = 1000): Promise<LearningItem[]> {
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

      // Transform to LearningItem format
      return uniqueRecords.slice(0, limit).map((record) => {
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
    // Query practice_cycles for all phrases (position >= 2 are practice phrases)
    // Columns: id, course_code, seed_number, lego_index, position, lego_id, phrase_type,
    //          word_count, known_text, target_text, known_audio_uuid, target1_audio_uuid, target2_audio_uuid
    const { data, error } = await supabase
      .from('practice_cycles')
      .select('*')
      .eq('course_code', courseId)
      .gte('position', 2) // Skip components (0) and debut (1)
      .order('lego_id', { ascending: true })
      .order('word_count', { ascending: false }) // Longest (by word count) first

    if (error) {
      console.error('[loadEternalPhrases] Query error:', error)
      return eternalMap
    }

    if (!data) return eternalMap

    console.log(`[loadEternalPhrases] Loaded ${data.length} practice phrases from practice_cycles`)

    // Group by lego_id and take top 5 longest for each
    const grouped = new Map<string, any[]>()
    for (const row of data) {
      if (!grouped.has(row.lego_id)) {
        grouped.set(row.lego_id, [])
      }
      const phrases = grouped.get(row.lego_id)!
      if (phrases.length < 5) { // Keep only top 5 longest
        phrases.push(row)
      }
    }

    // Transform to EternalPhrase format
    for (const [legoId, rows] of grouped) {
      const phrases: EternalPhrase[] = rows.map(row => ({
        knownText: row.known_text,
        targetText: row.target_text,
        syllableCount: row.word_count || 0,
        audioRefs: {
          known: {
            id: row.known_audio_uuid,
            url: row.known_audio_uuid ? `${audioBaseUrl}/${row.known_audio_uuid}.mp3` : ''
          },
          target: {
            voice1: {
              id: row.target1_audio_uuid,
              url: row.target1_audio_uuid ? `${audioBaseUrl}/${row.target1_audio_uuid}.mp3` : ''
            },
            voice2: {
              id: row.target2_audio_uuid,
              url: row.target2_audio_uuid ? `${audioBaseUrl}/${row.target2_audio_uuid}.mp3` : ''
            }
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
 * Pick a random phrase from the eternal pool
 */
function pickRandomEternal(phrases: EternalPhrase[]): EternalPhrase | null {
  if (!phrases || phrases.length === 0) return null
  const idx = Math.floor(Math.random() * phrases.length)
  return phrases[idx]
}

/**
 * Generate the complete learning script with ROUNDs and spaced repetition
 * This shows exactly what the learner will experience
 */
export async function generateLearningScript(
  provider: CourseDataProvider,
  supabase: any,
  courseId: string,
  audioBaseUrl: string,
  maxLegos: number = 50
): Promise<{ rounds: RoundData[]; allItems: ScriptItem[] }> {
  // Load all unique LEGOs
  const legos = await provider.loadAllUniqueLegos(maxLegos)

  if (legos.length === 0) {
    return { rounds: [], allItems: [] }
  }

  // Load eternal phrases for all LEGOs (for spaced rep and consolidation)
  const eternalPhrases = await loadEternalPhrases(supabase, courseId, audioBaseUrl)

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
    const currentEternals = eternalPhrases.get(currentLego.lego.id) || []
    const roundItems: ScriptItem[] = []

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

    // Phase 1: Introduction Audio (placeholder - actual intro audio would be separate)
    roundItems.push({
      ...baseItem,
      type: 'intro',
    })

    // Phase 2: Components (for M-type LEGOs - skipped for now as we don't have component data)
    // Phase 3: LEGO Debut
    roundItems.push({
      ...baseItem,
      type: 'debut',
    })

    // Phase 4: Debut Phrases (we'd need basket data for multiple phrases)
    // For now, add one debut phrase
    roundItems.push({
      ...baseItem,
      type: 'debut_phrase',
    })

    // Phase 5: Interleaved Spaced Rep - select from ETERNAL phrases
    const reviews = calculateSpacedRepReviews(n)
    const reviewIndices: number[] = []

    for (const review of reviews) {
      const reviewLego = legoMap.get(review.legoIndex)
      if (reviewLego) {
        reviewIndices.push(review.legoIndex)

        // Pick a random eternal phrase for this review
        const reviewEternals = eternalPhrases.get(reviewLego.lego.id) || []
        const selectedPhrase = pickRandomEternal(reviewEternals)

        roundItems.push({
          roundNumber: n,
          legoId: reviewLego.lego.id,
          legoIndex: review.legoIndex,
          seedId: reviewLego.seed.seed_id,
          // Use eternal phrase if available, otherwise fall back to debut
          knownText: selectedPhrase?.knownText || reviewLego.phrase.phrase.known,
          targetText: selectedPhrase?.targetText || reviewLego.phrase.phrase.target,
          audioRefs: selectedPhrase?.audioRefs || reviewLego.phrase.audioRefs,
          audioDurations: reviewLego.audioDurations,
          type: 'spaced_rep',
          reviewOf: review.legoIndex,
          fibonacciPosition: review.fibPosition,
        })
      }
    }

    // Phase 6: Consolidation (2 eternal phrases for the new LEGO)
    // Pick random eternals for consolidation too
    const consolidation1 = pickRandomEternal(currentEternals)
    const consolidation2 = pickRandomEternal(currentEternals)

    roundItems.push({
      ...baseItem,
      type: 'consolidation',
      knownText: consolidation1?.knownText || baseItem.knownText,
      targetText: consolidation1?.targetText || baseItem.targetText,
      audioRefs: consolidation1?.audioRefs || baseItem.audioRefs,
    })
    roundItems.push({
      ...baseItem,
      type: 'consolidation',
      knownText: consolidation2?.knownText || baseItem.knownText,
      targetText: consolidation2?.targetText || baseItem.targetText,
      audioRefs: consolidation2?.audioRefs || baseItem.audioRefs,
    })

    rounds.push({
      roundNumber: n,
      legoId: currentLego.lego.id,
      legoIndex: n,
      seedId: currentLego.seed.seed_id,
      items: roundItems,
      spacedRepReviews: reviewIndices,
    })

    allItems.push(...roundItems)
  }

  console.log(`[generateLearningScript] Generated ${rounds.length} rounds with ${allItems.length} total items`)

  return { rounds, allItems }
}
