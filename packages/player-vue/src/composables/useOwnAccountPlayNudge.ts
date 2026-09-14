/**
 * useOwnAccountPlayNudge — "you are playing on your own account; this class
 * wants Play as class" (Tom, 2026-09-14 12:58Z, job #662: teachers must play
 * as class, not as themselves, and Angharad is telling them so).
 *
 * Chepstow's pattern (job #651): a teacher opens the app, lands on the
 * Library, presses play on the course her class is on — and the lesson lands
 * on HER learner, not the class's. The teacher home names the minutes
 * afterwards; this is the steer BEFORE they are lost. It is a steer, never a
 * block: one line, one link to the class page where Play as class lives, and
 * a dismiss.
 *
 * WHO. A signed-in account that TEACHES a class on the course being played,
 * read from GET /api/me/teaching-context — THE-MODEL's one capability read,
 * which lists the caller's classes with their course codes. Nobody else ever
 * sees it: a pupil, a guest, a teacher playing a course none of their classes
 * is on. Fails silent: any error means no nudge, never a wrong one.
 *
 * Module-level cache per user id so the player asks once per session.
 */
import { ref, computed, watch, type Ref } from 'vue'
import { useAdminClient } from '@/composables/useAdminClient'

export interface TaughtClass { id: string; name: string; course_code: string | null }

const classesByUser = new Map<string, Promise<TaughtClass[]>>()

async function fetchTaughtClasses(getAuthToken: () => Promise<string | null>): Promise<TaughtClass[]> {
  const token = await getAuthToken()
  if (!token) return []
  const resp = await fetch('/api/me/teaching-context', { headers: { Authorization: `Bearer ${token}` } })
  if (!resp.ok) return []
  const ctx = await resp.json().catch(() => ({}))
  const classes: unknown[] = Array.isArray(ctx?.classes) ? ctx.classes : []
  return classes
    .filter((c): c is Record<string, unknown> => !!c && typeof c === 'object')
    .map((c) => ({ id: String(c.id ?? ''), name: String(c.name ?? ''), course_code: c.course_code == null ? null : String(c.course_code) }))
    .filter((c) => c.id)
}

/** Test seam: forget every cached answer. */
export function __resetOwnAccountPlayNudge(): void {
  classesByUser.clear()
}

/**
 * @param userId   the signed-in auth uid, or null/'' for a guest
 * @param courseCode the course the player is on
 * Returns the FIRST class the user teaches on that course, or null.
 */
export function useOwnAccountPlayNudge(userId: Ref<string | null | undefined>, courseCode: Ref<string>) {
  const { getAuthToken } = useAdminClient()
  const taught = ref<TaughtClass[]>([])
  const dismissed = ref(false)

  watch(userId, (uid) => {
    taught.value = []
    if (!uid) return
    if (!classesByUser.has(uid)) {
      classesByUser.set(uid, fetchTaughtClasses(getAuthToken).catch(() => []))
    }
    classesByUser.get(uid)!.then((list) => { if (userId.value === uid) taught.value = list })
  }, { immediate: true })

  const nudgeClass = computed<TaughtClass | null>(() => {
    const code = courseCode.value
    if (!code || dismissed.value) return null
    return taught.value.find((c) => c.course_code === code) ?? null
  })

  function dismiss(): void { dismissed.value = true }

  return { nudgeClass, dismiss }
}
