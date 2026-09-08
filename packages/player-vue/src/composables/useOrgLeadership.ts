/**
 * useOrgLeadership — "does this person LEAD an organisation?", as a
 * first-class signal alongside useUserRole's hasSchoolRole.
 *
 * WHY THIS EXISTS (Deborah, staging, 2026-08-06): an org leader created via
 * the /orgs door gets `educational_role = 'govt_admin'` written onto their
 * learner row (api/onboarding/provision.ts, track === 'org'). That role is
 * ALSO what a government/schools admin holds, and `hasSchoolRole` admits it —
 * so the only door the app offered an org leader was "Schools Dashboard",
 * and there was no organisation door at all. Tom's ruling: "it should know
 * you are an org and not a school".
 *
 * HOW IT KNOWS (Tom's ruling 2026-09-08, #409): by the STRUCTURE of the
 * group the caller's own `govt_admins` row points at — teachers or classes
 * established, or a schools row hanging in the subtree, means the schools
 * lane; groups with none of those means the org lane. GET /api/org/
 * subscription reports that structure server-side from the caller's
 * verified identity (the client never queries the org tables directly — the
 * RLS-condition caution), and the ONE derivation in nodeTerminology.ts turns
 * it into a kind. The group's `type` word is still in the payload and is
 * never read here.
 *
 * SUPERSEDED HISTORY, kept legible: from 2026-08-06 to 2026-09-08 this file
 * read `type === 'organisation'` for the org lane and 'region'/'programme'
 * for the schools lane (verified live then: 8 organisation leaders, all with
 * zero schools beneath; every region/programme leader had schools). The
 * structure derivation gives those same leaders the same doors, from the
 * facts the label was standing in for.
 *
 * The school side is read from the existing GET /api/me/teaching-context —
 * THE-MODEL's one capability read — so an account that genuinely holds both
 * (provision.ts explicitly supports a school_admin who also starts an org)
 * keeps BOTH doors. An account that leads an organisation and has no school
 * or class affiliation sees ONLY the organisation door.
 *
 * FAILS OPEN, deliberately: any error leaves `leadsOrg` false, so the worst
 * case is today's behaviour (the Schools link), never a locked-out leader.
 *
 * Module-level singleton — Settings and Browse both ask, one round trip.
 */

import { ref, computed } from 'vue'
import { useAdminClient } from '@/composables/useAdminClient'
import { deriveInstitutionKind } from '@/composables/nodeTerminology'

const orgId = ref<string | null>(null)
const orgName = ref<string | null>(null)
/** The group's own display word. Never branched on — see header. */
const orgType = ref<string | null>(null)
/** The led group's structure, as /api/org/subscription reports it. */
const orgStructure = ref<{ hasSchool?: boolean; childGroupCount?: number; teacherCount?: number; classCount?: number } | null>(null)
/** A school tag, a legacy admin school, or any class taught. */
const hasSchoolSide = ref(false)
const loaded = ref(false)
let inflight: Promise<void> | null = null

/**
 * Leads a group whose STRUCTURE says org — groups but no teachers, classes
 * or schools — so the org lane, not the schools lane. Derived by the same
 * rule the node home uses; the group's `type` word plays no part.
 */
const leadsOrg = computed(() => {
  if (!orgId.value) return false
  const s = orgStructure.value ?? {}
  return deriveInstitutionKind({ kind: 'node', node: { hasSchool: !!s.hasSchool, commercial: null, rollup: s } }) === 'org'
})

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
  orgStructure.value = null
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
        orgStructure.value = org.structure ?? null
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
        // `label` here is the AFFILIATION kind the capability read returns
        // ('school' = a schools-row tag, 'group' = a group tag) — a fact
        // about which table the person is tagged into, not a word anyone
        // chose for a node.
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
export const __orgLeadershipInternals = { orgId, orgName, orgType, orgStructure, hasSchoolSide, loaded, reset }
