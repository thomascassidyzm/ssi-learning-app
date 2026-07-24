/**
 * Mission engine — module singleton.
 *
 * Lifecycle: a mission arrives either as a deep link (?mission=<id> on any
 * /schools route) or from the "Try a mission" affordance. Deep links split
 * into two steps because of WHERE things are safe to run:
 *
 *   1. prepareMissionFromRoute(to) — called from the /schools beforeEnter
 *      guard. Only primes the role cache so the guard itself doesn't bounce
 *      a role-less visitor, and parks the mission id.
 *   2. activatePendingMission(router) — called from SchoolsContainer setup,
 *      AFTER setSchoolsClient(), where the mission's setup() can safely
 *      touch the schools composables.
 *
 * Completion is route-watched only: router.afterEach against the mission's
 * declarative completion condition. Any navigation while active counts as
 * meaningful progress and re-arms the (single) nudge timer.
 */

import { ref } from 'vue'
import type { RouteLocationNormalized, Router } from 'vue-router'
import { useUserRole } from '@/composables/useUserRole'
import { missionById } from './definitions'
import type { MissionDefinition } from './types'

const activeMission = ref<MissionDefinition | null>(null)
const status = ref<'idle' | 'active' | 'complete'>('idle')
const nudgeVisible = ref(false)

let pendingMissionId: string | null = null
let wroteRoleCache = false
let nudgeShown = false
let nudgeTimer: ReturnType<typeof setTimeout> | null = null
let stopRouteWatch: (() => void) | null = null

/** Dev/staging-gated: everywhere except the production apex. */
export function missionsEnabled(): boolean {
  if (typeof window === 'undefined') return false
  const h = window.location.hostname
  return h !== 'saysomethingin.app' && h !== 'www.saysomethingin.app'
}

/**
 * Guard-time half of a ?mission= deep link. The /schools beforeEnter bounces
 * visitors without a school role before the container ever mounts, so the
 * demo persona's role must be in the cache NOW; everything else waits for
 * activatePendingMission.
 */
export function prepareMissionFromRoute(to: RouteLocationNormalized): void {
  if (!missionsEnabled() || status.value !== 'idle') return
  const id = typeof to.query.mission === 'string' ? to.query.mission : null
  if (!id || !missionById(id)) return
  pendingMissionId = id
  ensureSchoolRole()
}

/** Container-time half — schools client bridge is set, composables are safe. */
export function activatePendingMission(router: Router): void {
  if (!pendingMissionId || status.value !== 'idle') return
  const def = missionById(pendingMissionId)
  pendingMissionId = null
  if (!def) return
  activate(def, router)
  // A deep link can arrive on any /schools route; the mission's own stage is
  // its startRoute (the canon node surface) — move there unless already on it.
  if (router.currentRoute.value.path !== def.startRoute.split('?')[0]) {
    router.replace(def.startRoute).catch(() => {})
  }
}

/** Direct start from an affordance (e.g. "Try a mission" on the teacher dashboard). */
export function startMission(id: string, router: Router): void {
  if (!missionsEnabled() || status.value === 'active') return
  const def = missionById(id)
  if (!def) return
  ensureSchoolRole()
  activate(def, router)
  router.push(def.startRoute).catch(() => {})
}

/**
 * Leave the mission (Done after completion, or End mission while active).
 * Full reload — isDemoMode and the fixture-primed data refs are in-memory
 * only, so a reload restores the real world; a role cache WE wrote is
 * removed so a signed-out visitor isn't left looking like a teacher.
 */
export function exitMission(): void {
  if (wroteRoleCache) {
    try { localStorage.removeItem('ssi-user-role') } catch { /* storage blocked */ }
  }
  window.location.assign('/')
}

export function useMission() {
  return { activeMission, status, nudgeVisible, exitMission }
}

function ensureSchoolRole(): void {
  const role = useUserRole()
  role.restoreFromCache()
  if (!role.hasSchoolRole.value) {
    role.initialize(null, 'teacher')
    wroteRoleCache = true
  }
}

function activate(def: MissionDefinition, router: Router): void {
  def.setup()
  activeMission.value = def
  status.value = 'active'
  nudgeShown = false
  nudgeVisible.value = false
  armNudge(def)
  stopRouteWatch = router.afterEach((to) => {
    if (status.value !== 'active') return
    if (isCompletionRoute(def, to)) complete()
    else armNudge(def)
  })
}

function isCompletionRoute(def: MissionDefinition, to: RouteLocationNormalized): boolean {
  if (to.path !== def.completion.path) return false
  for (const [k, v] of Object.entries(def.completion.query ?? {})) {
    if (String(to.query[k] ?? '') !== v) return false
  }
  return true
}

function armNudge(def: MissionDefinition): void {
  if (nudgeTimer) clearTimeout(nudgeTimer)
  nudgeTimer = null
  if (!def.nudge || nudgeShown) return
  nudgeTimer = setTimeout(() => {
    nudgeShown = true
    nudgeVisible.value = true
  }, def.nudge.afterMs)
}

function complete(): void {
  if (nudgeTimer) clearTimeout(nudgeTimer)
  nudgeTimer = null
  nudgeVisible.value = false
  status.value = 'complete'
  stopRouteWatch?.()
  stopRouteWatch = null
}
