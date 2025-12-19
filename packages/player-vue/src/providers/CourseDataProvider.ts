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
   * Check if learner has already heard the welcome audio
   */
  async hasPlayedWelcome(learnerId: string): Promise<boolean> {
    if (!this.client || !learnerId) return true // Assume played if can't check

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
    if (!this.client || !learnerId) return

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
 * Factory function
 */
export function createCourseDataProvider(config: CourseDataProviderConfig): CourseDataProvider {
  return new CourseDataProvider(config)
}
