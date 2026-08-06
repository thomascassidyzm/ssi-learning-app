/**
 * useOrgLeadership — "does this person LEAD an organisation?", as a
 * first-class signal alongside useUserRole's hasSchoolRole.
 *
 * WHY THIS EXISTS (Deborah, staging, 2026-08-06): an org leader created via
 * the /orgs door gets `educational_role = 'govt_admin'` written onto their
 * learner row (api/onboarding/provision.ts, track === 'org'). That role is
 * ALSO what a government/schools admin holds, and `hasSchoolRole` admits it —
 * so the only door the app offered an org leader was "Schools Dashboard",
 * and there was no Organisation Dashboard entry at all. Tom's ruling: "it
 * should know you are an org and not a school".
 *
 * `educational_role` alone CANNOT tell the two apart. The honest source is
 * the caller's own `govt_admins` leader row and the TYPE of the group it
 * points at — `type = 'organisation'` is the org lane; 'region'/'programme'
 * are the schools/government lane (verified live 2026-08-06: 8 organisation
 * leaders, all with zero schools beneath them; every region/programme leader
 * has schools). Both are read SERVER-SIDE from the caller's verified identity
 * via the existing GET /api/org/subscription (leaderGroupId) — the client
 * never queries the org tables directly (the RLS-condition caution).
 *
 * The school side is read from the existing GET /api/me/teaching-context —
 * THE-MODEL's one capability read — so an account that genuinely holds both
 * (provision.ts explicitly supports a school_admin who also starts an org)
 * keeps BOTH doors. An account that leads an organisation and has no school
 * or class affiliation sees ONLY the Organisation Dashboard.
 *
 * FAILS OPEN, deliberately: any error leaves `leadsOrg` false, so the worst
 * case is today's behaviour (the Schools link), never a locked-out leader.
 *
 * Module-level singleton — Settings and Browse both ask, one round trip.
 */

import { ref, computed } from 'vue'
import { useAdminClient } from '@/composables/useAdminClient'

const orgId = ref<string | null>(null)
const orgName = ref<string | null>(null)
const orgType = ref<string | null>(null)
/** A school tag, a legacy admin school, or any class taught. */
const hasSchoolSide = ref(false)
const loaded = ref(false)
let inflight: Promise<void> | null = null

/** Leads a group of type 'organisation' — the org lane, not the schools lane. */
const leadsOrg = computed(() => !!orgId.value && orgType.value === 'organisation')

/** Leads an org AND has no school/class affiliation → the org door only. */
const orgOnly = computed(() => leadsOrg.value && !hasSchoolSide.value)

/** Where the Organisation Dashboard entry goes (the member node surface). */
const orgDashboardPath = computed(() => (orgId.value ? `/org/${orgId.value}` : null))

/** True until the lookup has answered — callers hold the Schools link back. */
const isLoaded = computed(() => loaded.value)

function reset(): void {
  orgId.value = null
  orgName.value = null
  orgType.value = null
  hasSchoolSide.value = false
  loaded.value = false
  inflight = null
}

export function useOrgLeadership() {
  const { getAuthToken } = useAdminClient()

  async function load(): Promise<void> {
    const token = await getAuthToken()
    if (!token) {
      loaded.value = true
      return
    }
    const headers = { Authorization: `Bearer ${token}` }

    try {
      const resp = await fetch('/api/org/subscription', { headers })
      const data = await resp.json().catch(() => ({}))
      const org = data?.org
      if (org?.id) {
        orgId.value = org.id
        orgName.value = org.name ?? null
        orgType.value = org.type ?? null
      }
    } catch {
      // Fail open — no org door, exactly the pre-fix behaviour.
    }

    // Only an org leader needs the school-side question answered; everyone
    // else is unchanged, so don't spend the round trip on them.
    if (leadsOrg.value) {
      try {
        const resp = await fetch('/api/me/teaching-context', { headers })
        const ctx = await resp.json().catch(() => ({}))
        const groups: Array<{ label?: string }> = Array.isArray(ctx?.groups) ? ctx.groups : []
        const classes: unknown[] = Array.isArray(ctx?.classes) ? ctx.classes : []
        hasSchoolSide.value = groups.some((g) => g?.label === 'school') || classes.length > 0
      } catch {
        // Unknown → assume they might be a school person too, and keep both
        // doors. Losing a door is worse than showing one door too many.
        hasSchoolSide.value = true
      }
    }

    loaded.value = true
  }

  /** Idempotent: one fetch per session, shared by every caller. */
  function ensureLoaded(): Promise<void> {
    if (loaded.value) return Promise.resolve()
    if (!inflight) inflight = load()
    return inflight
  }

  return {
    orgId,
    orgName,
    orgType,
    leadsOrg,
    orgOnly,
    orgDashboardPath,
    isLoaded,
    ensureLoaded,
    reset,
  }
}

// Test-only escape hatch, same shape as useUserRole's e2e hook.
export const __orgLeadershipInternals = { orgId, orgName, orgType, hasSchoolSide, loaded, reset }
