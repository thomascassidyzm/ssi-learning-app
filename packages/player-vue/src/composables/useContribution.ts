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
// All-time community = the real sum of every daily_contributions row, read live.
// (Previously a frozen per-language OFFSET: raw all-time was once schools-test-
// polluted AND the table wasn't anon-readable, so we showed an approximation.
// The pollution is no longer dominant and the SELECT grant is in — so we read
// the true number. See docs/sessions-and-days-active.md.)

export function useContribution(client: Ref<SupabaseClient | null>) {
  const data = ref<ContributionData | null>(null)
  const isLoading = ref(false)
  const localPhraseIncrement = ref(0)
  const localMinuteIncrement = ref(0)

  async function fetch(courseId: string, learnerId?: string) {
    if (!client.value) return
    isLoading.value = true

    // courseId.split('_for_')[0] is NOT always the target language — course
    // codes for regional variants (spa_mx_for_eng, fra_ca_for_eng,
    // por_br_for_eng) carry a qualifier before '_for_' that isn't a real
    // language code, so the naive split produced 'spa_mx' and getLanguageName
    // fell through to the raw uppercased string ("SPA_MX") in the contribution
    // modal, plus every community query below silently matched zero rows.
    // The course's own target_lang column is the source of truth.
    let targetLang = courseId.split('_for_')[0]
    try {
      const { data: courseRow } = await client.value
        .from('courses')
        .select('target_lang')
        .eq('course_code', courseId)
        .maybeSingle()
      if (courseRow?.target_lang) targetLang = courseRow.target_lang
    } catch { /* fall back to the split-derived guess below */ }

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
          // One row per day; without an explicit limit this defaults to ~1000
          // rows, so a very long-running learner's all-time total would silently
          // undercount. 10000 days is ~27 years — safely above any real learner.
          .limit(10000)

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

      // All-time community = the true sum of every daily row (read live now that
      // the table is anon-readable; no more frozen offset). All-time keeps using
      // daily_contributions because it carries pre-LSO history.
      const allSum = sumRows(allRows)
      const globalAllTime = { minutes: allSum.minutes, phrases: allSum.phrases, speakers: 0 }

      // Community WINDOWS (today/7d/30d) come live from the SAME source as the
      // user number (learner_speaking_opportunities, via a security-definer
      // aggregate) — so you can never exceed the community. daily_contributions
      // is fed by COMPLETED sessions only, so its "today" lags badly early in the
      // UTC day (the old "38 / 6"). Falls back to daily_contributions if the RPC
      // isn't deployed yet.
      let globalToday2 = { ...globalToday }
      let globalDays7 = { ...sumRows(days7Rows), speakers: globalToday.speakers }
      let globalDays30 = { ...sumRows(days30Rows), speakers: 0 }
      try {
        const { data: live } = await client.value.rpc('get_community_contribution', { p_target_lang: targetLang })
        if (Array.isArray(live)) {
          const byKey = Object.fromEntries(live.map((r: any) => [r.window_key, r]))
          const pick = (k: string) => byKey[k]
            ? { minutes: Number(byKey[k].minutes) || 0, phrases: Number(byKey[k].phrases) || 0, speakers: Number(byKey[k].speakers) || 0 }
            : null
          globalToday2 = pick('today') ?? globalToday2
          globalDays7 = pick('days7') ?? globalDays7
          globalDays30 = pick('days30') ?? globalDays30
        }
      } catch { /* RPC not deployed — keep the daily_contributions windows */ }

      data.value = {
        global: {
          today: globalToday2,
          days7: globalDays7,
          days30: globalDays30,
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
