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

// --- Community all-time OFFSET --------------------------------------------
// The raw historical all-time in daily_contributions is dominated by SCHOOLS
// TEST entities (real activity, fake schools/teachers/students), so it isn't a
// meaningful "community" figure. We discard it and start all-time from a
// recent-tester-grounded number = 2 × last-30-days per target language as of
// the snapshot, then grow it from post-snapshot rows. The live today/7d/30d
// windows are treated as accurate and shown as-is. Testing-phase approximation
// — regenerate with scripts/compute-community-offsets.cjs. See
// docs/sessions-and-days-active.md.
const OFFSET_SNAPSHOT_DATE = '2026-06-02'
const COMMUNITY_OFFSETS: Record<string, { minutes: number; phrases: number }> = {
  afr: { minutes: 4794, phrases: 426 },
  ara: { minutes: 10, phrases: 0 },
  bul: { minutes: 920, phrases: 2806 },
  cat: { minutes: 16, phrases: 76 },
  ces: { minutes: 32, phrases: 18 },
  cym_s: { minutes: 106, phrases: 0 },
  dan: { minutes: 66, phrases: 0 },
  deu: { minutes: 790, phrases: 26 },
  ell: { minutes: 2194, phrases: 1252 },
  eng: { minutes: 4, phrases: 4 },
  est: { minutes: 14, phrases: 0 },
  eus: { minutes: 334, phrases: 16 },
  fas: { minutes: 10, phrases: 0 },
  fra: { minutes: 222, phrases: 232 },
  gle: { minutes: 270, phrases: 102 },
  heb: { minutes: 1026, phrases: 0 },
  hin: { minutes: 104, phrases: 0 },
  hrv: { minutes: 12790, phrases: 4326 },
  hun: { minutes: 152, phrases: 292 },
  hye: { minutes: 804, phrases: 278 },
  isl: { minutes: 514, phrases: 1186 },
  ita: { minutes: 1630, phrases: 414 },
  jpn: { minutes: 258, phrases: 150 },
  kor: { minutes: 4, phrases: 0 },
  lav: { minutes: 488, phrases: 510 },
  lit: { minutes: 1088, phrases: 636 },
  nep: { minutes: 14, phrases: 12 },
  nld: { minutes: 256, phrases: 434 },
  nor: { minutes: 88, phrases: 36 },
  pol: { minutes: 32, phrases: 0 },
  por: { minutes: 616, phrases: 40 },
  por_br: { minutes: 2, phrases: 0 },
  ron: { minutes: 2338, phrases: 1270 },
  rus: { minutes: 206, phrases: 156 },
  spa: { minutes: 278, phrases: 146 },
  srp: { minutes: 34, phrases: 0 },
  swa: { minutes: 2752, phrases: 352 },
  swe: { minutes: 2084, phrases: 796 },
  tha: { minutes: 4, phrases: 0 },
  tur: { minutes: 178, phrases: 14 },
  ukr: { minutes: 1054, phrases: 1224 },
  zho: { minutes: 644, phrases: 176 },
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
      // Global: fetch ALL daily_contributions rows for this language.
      // We aggregate client-side across timeframes — one row per day, so
      // even years of data is tiny (<1000 rows per language).
      const { data: rows } = await client.value
        .from('daily_contributions')
        .select('contribution_date, phrases_count, minutes_practiced, unique_speakers')
        .eq('target_language', targetLang)
        .order('contribution_date', { ascending: false })

      // Aggregate global by timeframe
      const allRows = rows || []
      const todayRows = allRows.filter(r => r.contribution_date === today)
      const days7Rows = allRows.filter(r => r.contribution_date >= days7Ago)
      const days30Rows = allRows.filter(r => r.contribution_date >= days30Ago)

      const sumRows = (arr: typeof allRows) => ({
        minutes: arr.reduce((s, r) => s + (r.minutes_practiced || 0), 0),
        phrases: arr.reduce((s, r) => s + (r.phrases_count || 0), 0),
        speakers: 0, // speaker counts don't sum meaningfully across days
      })

      // For "today" use the single row directly (includes speaker count)
      const globalToday = todayRows.length > 0
        ? { minutes: todayRows[0].minutes_practiced || 0, phrases: todayRows[0].phrases_count || 0, speakers: todayRows[0].unique_speakers || 0 }
        : emptyTimeframe()

      // User: read directly from learner_speaking_opportunities, the new
      // per-cycle counter table. One row per (learner, course, UTC day);
      // phrases = opportunities, minutes = floor(play_seconds / 60) at
      // read time so per-row rounding can't accumulate.
      //
      // Replaces the prior path that summed sessions.items_practiced and
      // duration_seconds — that one had been silently writing zero for
      // items_practiced because the session-start guard short-circuited.
      let userToday = { minutes: 0, phrases: 0 }
      let user7 = { minutes: 0, phrases: 0 }
      let user30 = { minutes: 0, phrases: 0 }
      let userAll = { minutes: 0, phrases: 0 }

      // Skip the per-user query for guests — `learner_id` is uuid-typed and
      // guest IDs use a `guest-{uuid}` prefix, which Supabase rejects with 400.
      const isGuest = !learnerId || learnerId.startsWith('guest-') || learnerId === 'demo-learner'

      if (learnerId && !isGuest) {
        const { data: oppsRows } = await client.value
          .from('learner_speaking_opportunities')
          .select('day, opportunities, play_seconds')
          .eq('learner_id', learnerId)
          .eq('course_code', courseId)

        if (oppsRows) {
          for (const r of oppsRows) {
            const day = r.day as string                // 'YYYY-MM-DD'
            const opps = Number(r.opportunities) || 0
            const secs = Number(r.play_seconds) || 0
            // Round down minutes at READ time only — keeps per-row rounding
            // error at zero by aggregating seconds first.
            // We still apply Math.floor per row here because the modal
            // shows minutes per timeframe; sub-minute residuals at a row
            // boundary are unavoidable but bounded at <1 min per row.
            const mins = Math.floor(secs / 60)
            const phrases = opps

            userAll.minutes += mins
            userAll.phrases += phrases

            if (day >= days30Ago) {
              user30.minutes += mins
              user30.phrases += phrases
            }
            if (day >= days7Ago) {
              user7.minutes += mins
              user7.phrases += phrases
            }
            if (day === today) {
              userToday.minutes += mins
              userToday.phrases += phrases
            }
          }
        }
      }

      // All-time community = frozen per-language OFFSET (2× last-30d as of the
      // snapshot — raw historical all-time is dominated by schools TEST entities)
      // + everything accrued AFTER the snapshot. Recent windows stay live.
      const allOffset = COMMUNITY_OFFSETS[targetLang] ?? { minutes: 0, phrases: 0 }
      const globalAllTime = { minutes: allOffset.minutes, phrases: allOffset.phrases, speakers: 0 }
      for (const r of allRows) {
        if ((r.contribution_date as string) > OFFSET_SNAPSHOT_DATE) {
          globalAllTime.minutes += r.minutes_practiced || 0
          globalAllTime.phrases += r.phrases_count || 0
        }
      }

      data.value = {
        global: {
          today: globalToday,
          days7: { ...sumRows(days7Rows), speakers: globalToday.speakers },
          days30: sumRows(days30Rows),
          allTime: globalAllTime,
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
