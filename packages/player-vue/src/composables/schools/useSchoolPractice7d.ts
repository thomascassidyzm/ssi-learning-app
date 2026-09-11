/**
 * useSchoolPractice7d — the school dashboard's HEADLINE practice figures:
 * minutes in the app this week and classes practising this week, read from
 * /api/school/class-practice-7d's `rollup`.
 *
 * Why this exists (job #265, Tom on staging 2026-09-11): the school dashboard
 * showed all-time hours off a DB view while the internal admin's node home
 * showed minutes in the app this week off the class-practice spine, so the
 * two could never agree for the same school and the school one rounded to
 * "0h" for a school that had practised for minutes. The rollup is computed
 * by the same helpers and the same rule as the admin's page, so the number a
 * leader reads is the number Tom reads.
 *
 * Under View-as / the admin read-view the fetch runs under the ssi_admin's
 * own session, whose scope is empty — so the school being READ is passed as
 * `?school_id=` (verifyAdmin-gated on the server).
 *
 * `rollup` is null until loaded and stays null on failure: the page shows a
 * dash, never a zero that is not real.
 */
import { ref, computed } from 'vue'
import { getSchoolsClient } from './client'
import { useSchoolContext } from './useSchoolContext'

export interface SchoolPractice7dRollup {
  windowDays: number
  classCount: number
  activeClasses7d: number
  inAppMinutes7d: number
}

export function useSchoolPractice7d() {
  const { currentUser } = useSchoolContext()
  const rollup = ref<SchoolPractice7dRollup | null>(null)
  const error = ref<string | null>(null)

  async function fetchRollup(): Promise<void> {
    error.value = null
    try {
      const client = getSchoolsClient()
      const { data: { session } } = await client.auth.getSession()
      const token = session?.access_token
      if (!token) { rollup.value = null; return }
      const user = currentUser.value
      const readingSomeoneElsesSchool = user?._scopeSource === 'admin-view' && user.school_id
      const url = readingSomeoneElsesSchool
        ? `/api/school/class-practice-7d?school_id=${encodeURIComponent(user!.school_id!)}`
        : '/api/school/class-practice-7d'
      const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } })
      if (!res.ok) throw new Error(`class-practice-7d ${res.status}`)
      const data = await res.json()
      const r = data?.rollup
      rollup.value = r && typeof r.inAppMinutes7d === 'number'
        ? { windowDays: r.windowDays ?? 7, classCount: r.classCount ?? 0, activeClasses7d: r.activeClasses7d ?? 0, inAppMinutes7d: r.inAppMinutes7d }
        : null
    } catch (err) {
      rollup.value = null
      error.value = err instanceof Error ? err.message : 'Failed to load this week\'s practice'
    }
  }

  const loaded = computed(() => rollup.value !== null)
  const minutesThisWeek = computed(() => rollup.value?.inAppMinutes7d ?? 0)
  const activeClassesThisWeek = computed(() => rollup.value?.activeClasses7d ?? 0)
  const classCount = computed(() => rollup.value?.classCount ?? 0)

  return { rollup, error, loaded, minutesThisWeek, activeClassesThisWeek, classCount, fetchRollup }
}
