import { ref, computed } from 'vue'
import type { SupabaseClient } from '@supabase/supabase-js'

export interface JourneyData {
  evolution_score: number
  evolution_level: number
  evolution_name: string
  evolution_icon: string
  next_level_threshold: number
  percentile_this_week: number
  total_points: number
  weekly_minutes: number[]
  milestones: Milestone[]
}

export interface Milestone {
  milestone_type: string
  achieved_at: string
  display_text: string
  display_icon: string
  metadata: Record<string, any>
}

export interface ContributionData {
  phrases_count: number
  minutes_practiced: number
  unique_speakers: number
  user_minutes_today: number
  user_phrases_today: number
  target_language: string
  language_name: string
}

const LANGUAGE_NAMES: Record<string, string> = {
  eng: 'English', spa: 'Spanish', fra: 'French', deu: 'German',
  ita: 'Italian', por: 'Portuguese', zho: 'Chinese', jpn: 'Japanese',
  ara: 'Arabic', kor: 'Korean', nld: 'Dutch', gle: 'Irish', cym: 'Welsh',
}

export function useLearnerJourney(client: SupabaseClient) {
  const journey = ref<JourneyData | null>(null)
  const contribution = ref<ContributionData | null>(null)
  const isLoading = ref(false)
  const error = ref<string | null>(null)

  async function fetchJourney(courseId: string) {
    isLoading.value = true
    error.value = null
    try {
      const { data: result, error: err } = await client.rpc('learner_journey_stats', { p_course_id: courseId })
      if (err) throw err
      journey.value = result
    } catch (e: any) {
      error.value = e.message
    } finally {
      isLoading.value = false
    }
  }

  async function fetchContribution(courseId: string) {
    const targetLang = courseId.split('_for_')[0]
    const today = new Date().toISOString().split('T')[0]

    try {
      const { data: contrib } = await client
        .from('daily_contributions')
        .select('*')
        .eq('target_language', targetLang)
        .eq('contribution_date', today)
        .single()

      const { data: sessions } = await client
        .from('sessions')
        .select('duration_seconds, items_practiced')
        .eq('course_id', courseId)
        .gte('started_at', today)

      const userMinutes = sessions?.reduce((sum, s) => sum + (s.duration_seconds || 0), 0) / 60 || 0
      const userPhrases = sessions?.reduce((sum, s) => sum + (s.items_practiced || 0), 0) || 0

      contribution.value = {
        phrases_count: contrib?.phrases_count || 0,
        minutes_practiced: contrib?.minutes_practiced || 0,
        unique_speakers: contrib?.unique_speakers || 0,
        user_minutes_today: Math.round(userMinutes),
        user_phrases_today: userPhrases,
        target_language: targetLang,
        language_name: LANGUAGE_NAMES[targetLang] || targetLang,
      }
    } catch (e: any) {
      console.error('[LearnerJourney] contribution fetch error:', e)
    }
  }

  const evolutionProgress = computed(() => {
    if (!journey.value) return 0
    const { evolution_score, next_level_threshold } = journey.value
    return Math.min(100, Math.round((evolution_score / next_level_threshold) * 100))
  })

  return { journey, contribution, isLoading, error, evolutionProgress, fetchJourney, fetchContribution }
}
