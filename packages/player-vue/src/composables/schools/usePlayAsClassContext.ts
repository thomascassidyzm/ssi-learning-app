import { computed, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'

/**
 * Read-only view of "which class is this play-as-class session running as", for
 * the persistent top bars (SchoolsTopBar, TopNav) that sit ABOVE the embedded
 * player on the play routes.
 *
 * Founder ruling (2026-07-18): the ONE thing the screen must say in play-as-class
 * mode is WHICH CLASS is live — a teacher running back-to-back sessions on a
 * projector/shared device otherwise can't tell 6S from 6M. Identity in the bar =
 * the MOST SPECIFIC ACTIVE CONTEXT, so the class name becomes the primary
 * identity here (school/teacher demoted).
 *
 * The active-class payload is the SAME one every launcher writes
 * (usePlayAsClass.launchClassSession + TeachDashboard.playAsClass) and that
 * PlayerContainer.checkClassContext reads: { id, name, course_code, … } in
 * localStorage 'ssi-active-class' (or sessionStorage 'ssi-demo-active-class' in
 * demo mode).
 */
export interface ActiveClassSession {
  id: string
  name: string
  course_code?: string
  current_seed?: number | null
  last_lego_id?: string | null
  class_learner_id?: string | null
}

// The two embedded play-as-class routes: schools (/schools/play) and tutors
// (/tutors/dashboard/play). Both render PlayerContainer inside a shell whose top
// bar stays above the player.
const PLAY_ROUTE_NAMES = ['schools-play', 'teach-play']

// Every route that renders the player, embedded or not — the two above plus the
// immersive standalone player at '/'. Used to drop the Learn button from the
// shells: you don't offer "Learn" to someone already inside the player (owner
// ruling 2026-08-06).
const PLAYER_ROUTE_NAMES = [...PLAY_ROUTE_NAMES, 'player']

export function usePlayAsClassContext() {
  const route = useRoute()
  const router = useRouter()
  const activeClass = ref<ActiveClassSession | null>(null)

  function readActiveClass() {
    if (typeof window === 'undefined') {
      activeClass.value = null
      return
    }
    const raw =
      sessionStorage.getItem('ssi-demo-active-class') || localStorage.getItem('ssi-active-class')
    if (!raw) {
      activeClass.value = null
      return
    }
    try {
      const parsed = JSON.parse(raw)
      activeClass.value =
        parsed && typeof parsed.id === 'string' && typeof parsed.name === 'string' ? parsed : null
    } catch {
      activeClass.value = null
    }
  }

  // Re-read on any route change (name or the ?class= query) — covers entering a
  // class session from any launcher and leaving it again.
  watch(() => [route.name, route.query.class], readActiveClass, { immediate: true })

  /**
   * True only when this is a genuine class session: on a play route, launched
   * WITH a class (the ?class= query is what distinguishes a class session from
   * staff self-practice via the Learn button, which lands on the SAME route with
   * no class), and the stored payload's id matches that class — guarding against
   * a stale 'ssi-active-class' row left by a previous session.
   */
  const isPlayingAsClass = computed(() => {
    if (!PLAY_ROUTE_NAMES.includes(route.name as string)) return false
    const classId = route.query.class
    return typeof classId === 'string' && activeClass.value?.id === classId
  })

  const className = computed(() => activeClass.value?.name || '')

  /** True on any route that renders the player, class session or not. */
  const isOnPlayerRoute = computed(() => PLAYER_ROUTE_NAMES.includes(route.name as string))

  /**
   * Leave the class session and return home. Clears the stored payload +
   * ?class= query (mirrors PlayerContainer.clearClassContext) so a later
   * self-practice launch on the same route can't rematch this class.
   * Schools users land on the schools DASHBOARD (/schools), tutors on theirs —
   * ending a session must hand the teacher back their home surface, never
   * strand them (founder ruling, 2026-07-30).
   */
  async function exitClassSession() {
    try {
      sessionStorage.removeItem('ssi-demo-active-class')
      localStorage.removeItem('ssi-active-class')
    } catch {
      /* storage may be unavailable — navigation below still exits the mode */
    }
    const backTo = route.name === 'teach-play' ? '/tutors/dashboard' : '/schools'
    activeClass.value = null
    await router.push(backTo)
  }

  return { activeClass, className, isPlayingAsClass, isOnPlayerRoute, exitClassSession }
}
