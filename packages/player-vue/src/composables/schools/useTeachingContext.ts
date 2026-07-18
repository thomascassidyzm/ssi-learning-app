/**
 * useTeachingContext — the ONE capability read the teacher shell gates on.
 *
 * THE-MODEL.md §6: `{ groups, classes, canPlayAsClass }`. Client-computed
 * tonight (server `GET /api/me/teaching-context` is the target — not built
 * yet); derived from EXISTING data (useSchoolContext + the school-agnostic
 * `myTaughtClassIds` teacher↔class relationship helper), never stored.
 *
 * Tutor-ness is NOT a stored role: `isTutor = groups.length === 0 &&
 * classes.length > 0` (THE-MODEL §1.3/§2.2/I5). Capability gates on this
 * structure, never on `educational_role === 'tutor'` — see THE-MODEL §2.1.
 */
import { computed, ref } from 'vue'
import { useSchoolContext } from './useSchoolContext'
import { myTaughtClassIds } from './classTeacherScope'

export interface TeachingGroup {
  id: string
  label: 'school' | 'group'
}

// Module-level singleton (matches the rest of the schools composables) —
// every caller in the same session sees the same fetched class list.
const classIds = ref<string[]>([])
const isLoading = ref(false)
const loadedForUserId = ref<string | null>(null)

export function useTeachingContext() {
  const { currentUser } = useSchoolContext()

  // "Group" here means a real group/school affiliation, read off the
  // already-loaded school context — schools.node_group_id / a first-class
  // `group` user_tag don't exist yet (THE-MODEL §5 is schema-expand, not
  // done), so this reads the CURRENT shapes (school_id, govt group_id) per
  // I10 (existing shapes keep working unchanged).
  const groups = computed<TeachingGroup[]>(() => {
    const u = currentUser.value
    if (!u) return []
    const out: TeachingGroup[] = []
    if (u.school_id) out.push({ id: u.school_id, label: 'school' })
    if (u.group_id) out.push({ id: u.group_id, label: 'group' })
    return out
  })

  const classes = computed(() => classIds.value)

  /** Fetch this user's taught classes (memoised per user_id). */
  async function load(): Promise<void> {
    const userId = currentUser.value?.user_id
    if (!userId) {
      classIds.value = []
      loadedForUserId.value = null
      return
    }
    if (loadedForUserId.value === userId) return
    isLoading.value = true
    try {
      classIds.value = await myTaughtClassIds(userId)
      loadedForUserId.value = userId
    } finally {
      isLoading.value = false
    }
  }

  // I4: capability gates on structure — has at least one class — not on any
  // role label. (Permission — WHICH staff may operate a class — is a
  // separate, orthogonal concern owned by usePlayAsClass.)
  const canPlayAsClass = computed(() => classes.value.length > 0)

  // I5 / §2.2: derived, never stored.
  const isTutor = computed(() => groups.value.length === 0 && classes.value.length > 0)

  return { groups, classes, canPlayAsClass, isTutor, isLoading, load }
}
