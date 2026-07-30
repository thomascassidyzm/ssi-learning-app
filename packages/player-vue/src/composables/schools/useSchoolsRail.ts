/**
 * useSchoolsRail — the WHERE-YOU-ARE rail for the FLAT /schools views.
 *
 * Founder ruling (2026-07-31): "everyone should know where they are in the
 * breadcrumb, even if they can't go UP a level because of permissions … I
 * don't like the LHS anchor just disappearing." The rail is orientation, not
 * navigation — EVERY schools-dashboard view keeps it. The node surfaces
 * (/schools/org/:id) already own their rail; this composable feeds the same
 * rail to the flat views (Classes, Students, class detail, teacher
 * dashboard, Insights, Settings) via SchoolsContainer's rail frame.
 *
 * Per role:
 * · school_admin — the server rail for their school node (same
 *   /api/groups/:id/home payload the node home uses, shared through
 *   nodeHomeCache so hops between flat and node views paint one tree). On a
 *   class page the rail recentres on that class node.
 * · teacher — the server node endpoints 403 teachers (scope = own classes
 *   only, founder ruling 2026-07-30), so the rail is built from
 *   /api/me/teaching-context: the school as NON-INTERACTIVE ancestor context
 *   (they may know where they are, not open the level above), their classes
 *   as rows opening the flat class pages. A groupless teacher (derived
 *   tutor) is rooted at "Your classes" — their top visible level.
 * · legacy rows with no resolvable node (no-school admins, region-code-only
 *   govt admins) — no rail source exists; the flat views render full-width
 *   as before.
 */
import { computed, ref, watch, type ComputedRef, type Ref } from 'vue'
import { useRoute } from 'vue-router'
import { useSchoolContext } from './useSchoolContext'
import { useClassesData } from './useClassesData'
import { getSchoolsClient } from './client'
import { isDemoMode } from '../demo/demoMode'
import {
  cachedRail,
  cacheNodeHome,
  dropCachedNode,
  type RailSnapshot,
} from '@/composables/admin/nodeHomeCache'
import type { RailRef } from '@/components/admin/NodeMapRail.vue'

export interface SchoolsRailData {
  ancestors: RailRef[]
  node: { id: string; name: string; label: string }
  siblings: RailRef[]
  children: RailRef[]
  kind: 'node' | 'class'
}

interface TeachingRailSource {
  school: { id: string; name: string } | null
  classes: { id: string; name: string }[]
}

// Module singletons (the schools-composable idiom) — one fetch per session,
// every railed view reads the same tree.
const nodeRail = ref<RailSnapshot | null>(null)
const nodeRailFor = ref<string>('')
const teaching = ref<TeachingRailSource | null>(null)
let teachingLoadedFor: string | null = null
let nodeRailInFlight: string | null = null

async function getToken(): Promise<string | null> {
  try {
    const client = getSchoolsClient()
    const { data } = await client.auth.getSession()
    return data?.session?.access_token ?? null
  } catch {
    return null
  }
}

/** Test hook. */
export function resetSchoolsRail(): void {
  nodeRail.value = null
  nodeRailFor.value = ''
  teaching.value = null
  teachingLoadedFor = null
  nodeRailInFlight = null
}

export function useSchoolsRail(): {
  rail: ComputedRef<SchoolsRailData | null>
  eligible: ComputedRef<boolean>
  isDemo: Ref<boolean>
} {
  const route = useRoute()
  const ctx = useSchoolContext()
  const { classes: classesData, currentClass } = useClassesData()

  const isClassRoute = computed(() => route.name === 'class-detail')
  const routeClassId = computed(() => (isClassRoute.value ? String(route.params.id || '') : ''))

  // ── school_admin: the server rail, cache-first ──
  const adminScopeId = computed(() => {
    const u = ctx.currentUser.value
    if (!u || !ctx.isSchoolAdmin.value || !u.school_id) return ''
    return routeClassId.value || u.school_id
  })

  async function loadNodeRail(id: string): Promise<void> {
    if (!id || isDemoMode.value) return
    const cached = cachedRail(id)
    if (cached) {
      nodeRail.value = cached
      nodeRailFor.value = id
      return
    }
    if (nodeRailInFlight === id) return
    nodeRailInFlight = id
    try {
      const token = await getToken()
      if (!token) return
      const resp = await fetch(`/api/groups/${id}/home`, {
        headers: { Authorization: `Bearer ${token}` },
      })
      const data = await resp.json().catch(() => ({}))
      if (!resp.ok) {
        // Access lost or node gone — a stale rail must not outlive it.
        dropCachedNode(id)
        if (nodeRailFor.value === id) {
          nodeRail.value = null
          nodeRailFor.value = ''
        }
        return
      }
      cacheNodeHome(id, data, '')
      if (data?.node?.id) {
        nodeRail.value = {
          ancestors: data.ancestors || [],
          node: data.node,
          siblings: data.siblings || [],
          children: data.children || [],
          kind: data.kind,
        }
        nodeRailFor.value = id
      }
    } finally {
      if (nodeRailInFlight === id) nodeRailInFlight = null
    }
  }

  // ── teacher: own classes + school-as-context, one server read ──
  async function loadTeaching(): Promise<void> {
    const uid = ctx.currentUser.value?.user_id
    if (!uid || teachingLoadedFor === uid) return
    if (!ctx.isTeacher.value || ctx.isSchoolAdmin.value || ctx.isGovtAdmin.value) return
    if (isDemoMode.value) {
      // Demo fixtures inject the class list directly — no server round trip.
      teachingLoadedFor = uid
      return
    }
    teachingLoadedFor = uid
    try {
      const token = await getToken()
      if (!token) {
        teachingLoadedFor = null
        return
      }
      const resp = await fetch('/api/me/teaching-context', {
        headers: { Authorization: `Bearer ${token}` },
      })
      if (!resp.ok) {
        teachingLoadedFor = null
        return
      }
      const data = await resp.json()
      const school = (data.groups_detail || []).find((g: any) => g.label === 'school')
      teaching.value = {
        school: school ? { id: school.id, name: school.name } : null,
        classes: (data.classes_detail || []).map((c: any) => ({ id: c.id, name: c.name })),
      }
    } catch {
      teachingLoadedFor = null
    }
  }

  watch(
    [() => ctx.currentUser.value?.user_id, adminScopeId],
    () => {
      if (adminScopeId.value) void loadNodeRail(adminScopeId.value)
      else void loadTeaching()
    },
    { immediate: true },
  )

  const teacherRail = computed<SchoolsRailData | null>(() => {
    const u = ctx.currentUser.value
    if (!u) return null
    const school =
      teaching.value?.school ||
      (u.school_id ? { id: u.school_id, name: u.school_name || 'Your school' } : null)
    // teaching-context is the primary source; the demo fixtures (and any view
    // that already ran useClassesData) fall back to that singleton.
    const classList: { id: string; name: string }[] = teaching.value?.classes?.length
      ? teaching.value.classes
      : classesData.value.map((c) => ({ id: c.id, name: c.class_name }))
    const classRefs: RailRef[] = classList.map((c) => ({
      id: c.id,
      name: c.name,
      label: 'class',
      path: `/schools/classes/${c.id}`,
    }))
    if (isClassRoute.value) {
      const here = classList.find((c) => c.id === routeClassId.value)
      const name = here?.name || currentClass.value?.class_name || 'This class'
      return {
        ancestors: school ? [{ id: school.id, name: school.name, label: 'school', inert: true }] : [],
        node: { id: routeClassId.value, name, label: 'class' },
        siblings: classRefs.filter((c) => c.id !== routeClassId.value),
        children: [],
        kind: 'class',
      }
    }
    return {
      ancestors: [],
      node: school
        ? { id: school.id, name: school.name, label: 'school' }
        : { id: 'own-classes', name: 'Your classes', label: '' },
      siblings: [],
      children: classRefs,
      kind: 'node',
    }
  })

  const rail = computed<SchoolsRailData | null>(() => {
    if (adminScopeId.value) {
      const r = nodeRailFor.value === adminScopeId.value ? nodeRail.value : cachedRail(adminScopeId.value)
      if (!r?.node) return null
      return {
        ancestors: (r.ancestors as RailRef[]) || [],
        node: r.node,
        siblings: (r.siblings as RailRef[]) || [],
        children: r.kind === 'class' ? [] : ((r.children as RailRef[]) || []),
        kind: r.kind === 'class' ? 'class' : 'node',
      }
    }
    if (ctx.isTeacher.value && !ctx.isGovtAdmin.value && !ctx.isSchoolAdmin.value) {
      return teacherRail.value
    }
    return null
  })

  // Eligible = this role WILL have a rail once data lands — the frame
  // reserves the column (skeleton, never a jump). Legacy no-node rows are
  // ineligible and keep the full-width flat layout.
  const eligible = computed(() => {
    const u = ctx.currentUser.value
    if (!u) return false
    if (ctx.isSchoolAdmin.value) return !!u.school_id
    if (ctx.isGovtAdmin.value) return false
    return ctx.isTeacher.value
  })

  return { rail, eligible, isDemo: isDemoMode }
}
