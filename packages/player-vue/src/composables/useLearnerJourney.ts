import { ref, computed } from 'vue'
import type { SupabaseClient } from '@supabase/supabase-js'
import { getLanguageName } from '@/composables/useI18n'

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

  async function fetchContribution(courseId: string, learnerId?: string | null) {
    // courseId.split('_for_')[0] is NOT always the target language — regional
    // variant course codes (spa_mx_for_eng, fra_ca_for_eng, por_br_for_eng)
    // carry a qualifier before '_for_' that isn't a real language code, so the
    // naive split produced 'spa_mx' and getLanguageName fell through to the
    // raw uppercased string ("SPA_MX"). The course's own target_lang column
    // is the source of truth.
    let targetLang = courseId.split('_for_')[0]
    try {
      const { data: courseRow } = await client
        .from('courses')
        .select('target_lang')
        .eq('course_code', courseId)
        .maybeSingle()
      if (courseRow?.target_lang) targetLang = courseRow.target_lang
    } catch { /* fall back to the split-derived guess below */ }

    const today = new Date().toISOString().split('T')[0]

    try {
      // .maybeSingle(), not .single() — a language/day with zero
      // daily_contributions rows (a fresh regional variant, an off-peak
      // language) is a normal empty result, not an error; .single() threw a
      // 406 on every such miss and spammed the console.
      const { data: contrib } = await client
        .from('daily_contributions')
        .select('*')
        .eq('target_language', targetLang)
        .eq('contribution_date', today)
        .maybeSingle()

      // Personal today-totals MUST be scoped to THIS learner. Without the
      // learner_id filter this summed EVERY learner's sessions for the course
      // and showed the whole community's minutes as the user's own. Guests have
      // no sessions rows (and a guest id would 400 a uuid column), so skip the
      // query and report zero rather than a misattributed community total.
      const isGuest = !learnerId || learnerId.startsWith('guest-') || learnerId === 'demo-learner'
      let userMinutes = 0
      let userPhrases = 0
      if (!isGuest) {
        const { data: sessions } = await client
          .from('sessions')
          .select('duration_seconds, items_practiced')
          .eq('course_id', courseId)
          .eq('learner_id', learnerId)
          .gte('started_at', today)

        userMinutes = (sessions?.reduce((sum, s) => sum + (s.duration_seconds || 0), 0) || 0) / 60
        userPhrases = sessions?.reduce((sum, s) => sum + (s.items_practiced || 0), 0) || 0
      }

      contribution.value = {
        phrases_count: contrib?.phrases_count || 0,
        minutes_practiced: contrib?.minutes_practiced || 0,
        unique_speakers: contrib?.unique_speakers || 0,
        user_minutes_today: Math.round(userMinutes),
        user_phrases_today: userPhrases,
        target_language: targetLang,
        language_name: getLanguageName(targetLang),
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
