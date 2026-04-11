import { ref, computed, type Ref } from 'vue'
import type { SupabaseClient } from '@supabase/supabase-js'
import { getLanguageName } from './useI18n'

export interface ContributionTimeframe {
  minutes: number
  phrases: number
  speakers: number
}

export interface ContributionData {
  global: {
    today: ContributionTimeframe
    days7: ContributionTimeframe
    days30: ContributionTimeframe
    allTime: ContributionTimeframe
  }
  user: {
    today: { minutes: number; phrases: number }
    days7: { minutes: number; phrases: number }
    days30: { minutes: number; phrases: number }
    allTime: { minutes: number; phrases: number }
  }
  targetLanguage: string
  languageName: string
}

function emptyTimeframe(): ContributionTimeframe {
  return { minutes: 0, phrases: 0, speakers: 0 }
}

export function useContribution(client: Ref<SupabaseClient | null>) {
  const data = ref<ContributionData | null>(null)
  const isLoading = ref(false)
  const localPhraseIncrement = ref(0)
  const localMinuteIncrement = ref(0)

  async function fetch(courseId: string, learnerId?: string) {
    if (!client.value) return
    isLoading.value = true

    const targetLang = courseId.split('_for_')[0]
    const today = new Date().toISOString().split('T')[0]
    const days7Ago = new Date(Date.now() - 7 * 86400000).toISOString().split('T')[0]
    const days30Ago = new Date(Date.now() - 30 * 86400000).toISOString().split('T')[0]

    try {
      // Global: fetch daily_contributions rows for this language
      const { data: rows } = await client.value
        .from('daily_contributions')
        .select('contribution_date, phrases_count, minutes_practiced, unique_speakers')
        .eq('target_language', targetLang)
        .gte('contribution_date', days30Ago)
        .order('contribution_date', { ascending: false })

      // Global: all time totals
      const { data: allTimeRow } = await client.value
        .from('daily_contributions')
        .select('phrases_count.sum(), minutes_practiced.sum()')
        .eq('target_language', targetLang)
        .single()

      // Aggregate global by timeframe
      const todayRows = (rows || []).filter(r => r.contribution_date === today)
      const days7Rows = (rows || []).filter(r => r.contribution_date >= days7Ago)
      const days30Rows = rows || []

      const sumRows = (arr: typeof rows) => ({
        minutes: arr?.reduce((s, r) => s + (r.minutes_practiced || 0), 0) || 0,
        phrases: arr?.reduce((s, r) => s + (r.phrases_count || 0), 0) || 0,
        speakers: arr?.reduce((s, r) => s + (r.unique_speakers || 0), 0) || 0,
      })

      const globalToday = todayRows.length > 0
        ? { minutes: todayRows[0].minutes_practiced || 0, phrases: todayRows[0].phrases_count || 0, speakers: todayRows[0].unique_speakers || 0 }
        : emptyTimeframe()

      // User: fetch their sessions across timeframes
      let userToday = { minutes: 0, phrases: 0 }
      let user7 = { minutes: 0, phrases: 0 }
      let user30 = { minutes: 0, phrases: 0 }
      let userAll = { minutes: 0, phrases: 0 }

      if (learnerId) {
        const { data: userSessions } = await client.value
          .from('sessions')
          .select('started_at, duration_seconds, items_practiced')
          .eq('learner_id', learnerId)
          .eq('course_id', courseId)

        if (userSessions) {
          for (const s of userSessions) {
            const date = s.started_at?.split('T')[0]
            const mins = Math.round((s.duration_seconds || 0) / 60)
            const phrases = s.items_practiced || 0

            userAll.minutes += mins
            userAll.phrases += phrases

            if (date >= days30Ago) {
              user30.minutes += mins
              user30.phrases += phrases
            }
            if (date >= days7Ago) {
              user7.minutes += mins
              user7.phrases += phrases
            }
            if (date === today) {
              userToday.minutes += mins
              userToday.phrases += phrases
            }
          }
        }
      }

      data.value = {
        global: {
          today: globalToday,
          days7: sumRows(days7Rows),
          days30: sumRows(days30Rows),
          allTime: {
            minutes: (allTimeRow as any)?.sum ?? 0,
            phrases: (allTimeRow as any)?.['phrases_count.sum()'] ?? sumRows(days30Rows).phrases,
            speakers: 0,
          },
        },
        user: { today: userToday, days7: user7, days30: user30, allTime: userAll },
        targetLanguage: targetLang,
        languageName: getLanguageName(targetLang),
      }

      // Reset local increments on fresh fetch
      localPhraseIncrement.value = 0
      localMinuteIncrement.value = 0
    } catch (e) {
      console.error('[useContribution] fetch error:', e)
    } finally {
      isLoading.value = false
    }
  }

  // Call after each cycle completes — no DB round-trip
  function incrementLocal() {
    localPhraseIncrement.value++
  }

  // Computed: today's global total + local increment (for live counter)
  const todayMinutes = computed(() =>
    (data.value?.global.today.minutes || 0) + localMinuteIncrement.value
  )

  const todayPhrases = computed(() =>
    (data.value?.global.today.phrases || 0) + localPhraseIncrement.value
  )

  const todaySpeakers = computed(() =>
    data.value?.global.today.speakers || 0
  )

  const userTodayPhrases = computed(() =>
    (data.value?.user.today.phrases || 0) + localPhraseIncrement.value
  )

  const languageName = computed(() => data.value?.languageName || '')

  return {
    data,
    isLoading,
    fetch,
    incrementLocal,
    todayMinutes,
    todayPhrases,
    todaySpeakers,
    userTodayPhrases,
    languageName,
  }
}
