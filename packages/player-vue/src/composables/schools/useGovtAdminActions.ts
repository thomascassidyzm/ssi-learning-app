/**
 * useGovtAdminActions — the leader's own write surfaces
 * (region-tier-design.md §1d/§1e/§5c-revised):
 *   - rename their own group ("name your group")
 *   - mint group-bound school_admin invite links + list their state
 *   - create a school directly in their own group (vacant admin seat)
 *
 * All three endpoints derive the caller's group SERVER-SIDE from their own
 * govt_admins row — this composable just carries the bearer token, it never
 * sends a group id.
 */

import { ref } from 'vue'
import { getSchoolsClient } from './client'
import { viewAsRequestHeaders } from '../useUserRole'

export interface SchoolLink {
  id: string
  code: string
  label: string | null
  is_active: boolean
  created_at: string
  redeemed: boolean
  school: { id: string; school_name: string; claimed: boolean; created_at: string } | null
}

async function authHeaders(): Promise<Record<string, string>> {
  const client = getSchoolsClient()
  const { data: { session } } = await client.auth.getSession()
  const headers: Record<string, string> = { 'Content-Type': 'application/json', ...viewAsRequestHeaders() }
  if (session?.access_token) headers['Authorization'] = `Bearer ${session.access_token}`
  return headers
}

export function useGovtAdminActions() {
  const links = ref<SchoolLink[]>([])
  const isLoading = ref(false)
  const error = ref<string | null>(null)

  async function renameGroup(groupId: string, name: string): Promise<boolean> {
    error.value = null
    try {
      const headers = await authHeaders()
      const res = await fetch(`/api/groups/${groupId}`, {
        method: 'PATCH', headers, body: JSON.stringify({ name }),
      })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        throw new Error(data.error || `Request failed: ${res.status}`)
      }
      return true
    } catch (err) {
      error.value = err instanceof Error ? err.message : 'Failed to rename group'
      return false
    }
  }

  async function mintSchoolLink(schoolName: string): Promise<{ code: string } | null> {
    error.value = null
    try {
      const headers = await authHeaders()
      const res = await fetch('/api/invite/create', {
        method: 'POST', headers,
        body: JSON.stringify({
          code_type: 'school_admin',
          metadata: schoolName ? { school_name: schoolName } : undefined,
        }),
      })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        throw new Error(data.error || `Request failed: ${res.status}`)
      }
      return await res.json()
    } catch (err) {
      error.value = err instanceof Error ? err.message : 'Failed to create link'
      return null
    }
  }

  async function fetchSchoolLinks(): Promise<void> {
    isLoading.value = true
    error.value = null
    try {
      const headers = await authHeaders()
      const res = await fetch('/api/govt/school-links', { headers })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        throw new Error(data.error || `Request failed: ${res.status}`)
      }
      const data = await res.json()
      links.value = data.links || []
    } catch (err) {
      error.value = err instanceof Error ? err.message : 'Failed to load links'
    } finally {
      isLoading.value = false
    }
  }

  async function createSchoolInMyGroup(schoolName: string): Promise<{
    school: { id: string; school_name: string; admin_join_code: string; teacher_join_code: string }
  } | null> {
    error.value = null
    try {
      const headers = await authHeaders()
      const res = await fetch('/api/govt/create-school', {
        method: 'POST', headers, body: JSON.stringify({ school_name: schoolName }),
      })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        throw new Error(data.error || `Request failed: ${res.status}`)
      }
      return await res.json()
    } catch (err) {
      error.value = err instanceof Error ? err.message : 'Failed to create school'
      return null
    }
  }

  return {
    links,
    isLoading,
    error,
    renameGroup,
    mintSchoolLink,
    fetchSchoolLinks,
    createSchoolInMyGroup,
  }
}
