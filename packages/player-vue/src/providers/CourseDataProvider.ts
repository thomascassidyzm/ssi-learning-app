/**
 * CourseDataProvider - Load course data from Supabase or manifest fallback
 *
 * Provides abstraction for loading learning items with backwards compatibility
 */

import type { SupabaseClient } from '@supabase/supabase-js'

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
      // Query lego_with_phrases view for the session range
      const { data, error } = await this.client
        .from('lego_with_phrases')
        .select('*')
        .eq('course_code', this.courseId)
        .gte('seed_position', startSeed)
        .lt('seed_position', startSeed + count)
        .order('seed_position', { ascending: true })
        .order('lego_order', { ascending: true })

      if (error) {
        console.error('[CourseDataProvider] Query error:', error)
        return []
      }

      if (!data || data.length === 0) {
        console.warn('[CourseDataProvider] No data found for course:', this.courseId)
        return []
      }

      // Transform database records to LearningItem format
      return this.transformToLearningItems(data)
    } catch (err) {
      console.error('[CourseDataProvider] Failed to load items:', err)
      return []
    }
  }

  /**
   * Transform database records to LearningItem format
   */
  private transformToLearningItems(records: any[]): LearningItem[] {
    return records.map((record) => {
      const legoId = record.lego_id
      const phraseId = record.phrase_id
      const seedId = record.seed_id

      // Resolve audio URLs from UUIDs
      const knownAudioUrl = this.resolveAudioUrl(record.known_audio_uuid)
      const target1AudioUrl = this.resolveAudioUrl(record.target_audio_uuid_1)
      const target2AudioUrl = this.resolveAudioUrl(record.target_audio_uuid_2)

      return {
        lego: {
          id: legoId,
          type: record.lego_type,
          new: record.is_debut,
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
                id: record.target_audio_uuid_1,
                url: target1AudioUrl
              },
              voice2: {
                id: record.target_audio_uuid_2,
                url: target2AudioUrl
              },
            },
          },
        },
        phrase: {
          id: phraseId,
          phraseType: record.is_debut ? 'debut' : 'practice',
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
                id: record.target_audio_uuid_1,
                url: target1AudioUrl
              },
              voice2: {
                id: record.target_audio_uuid_2,
                url: target2AudioUrl
              },
            },
          },
          wordCount: record.target_text.split(' ').length,
          containsLegos: [legoId],
        },
        seed: {
          seed_id: seedId,
          seed_pair: {
            known: record.seed_known_text,
            target: record.seed_target_text,
          },
          legos: [legoId],
        },
        thread_id: record.thread_id || 1,
        mode: 'practice',
        audioDurations: {
          source: record.known_duration_ms ? record.known_duration_ms / 1000 : 2.0,
          target1: record.target_duration_1_ms ? record.target_duration_1_ms / 1000 : 2.5,
          target2: record.target_duration_2_ms ? record.target_duration_2_ms / 1000 : 2.5,
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
}

/**
 * Factory function
 */
export function createCourseDataProvider(config: CourseDataProviderConfig): CourseDataProvider {
  return new CourseDataProvider(config)
}
