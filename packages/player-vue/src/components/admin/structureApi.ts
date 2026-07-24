// Shared types for the Structure surface (THE-MODEL.md §1.9/§6/§7) —
// the tree lens (StructureTreeNode.vue, recursive) and the table lens
// (AdminStructure.vue's table markup) both render the SAME node shape and
// share the SAME action set via `provide('structureApi', ...)`.
import type { Ref } from 'vue'

export interface StructureRollup {
  childGroupCount: number
  teacherCount: number
  classCount: number
  learnerCount: number
}

export interface StructureCommercial {
  schoolId: string
  platformStatus: string
  trialCourseCode: string | null
  trialKind: string | null
  platformExpiresAt: string | null
  teacherSeats: number
}

export interface StructureNode {
  id: string
  name: string
  label: string
  parent_id: string | null
  is_demo: boolean
  is_test: boolean
  rollup: StructureRollup
  commercial: StructureCommercial | null
  /** Tree lens only — absent (or omitted) rows from the table lens. */
  children: StructureNode[]
}

export interface StructureApi {
  editingId: Ref<string | null>
  editingName: Ref<string>
  startRename(node: StructureNode): void
  saveRename(node: StructureNode): Promise<void>
  cancelRename(): void
  updateLabel(node: StructureNode, label: string): Promise<void>
  openDashboard(node: StructureNode): void
  requestDelete(node: StructureNode): void
  /** Tree lens only — re-root the tree at this node when its children were depth-truncated. */
  drillInto(node: StructureNode): void
}

export type StructureQuickFilter = 'all' | 'groups' | 'schools' | 'trial' | 'paid' | 'demo'

/**
 * Whether a single node (ignoring its children) matches the search text +
 * quick filter — shared by StructureTreeNode (per-child filtering) and
 * AdminStructure's top-level root list, so a search match at the ROOT of
 * the forest (the common case — most orgs are roots with no parent) isn't
 * silently skipped by whichever caller forgets to re-check it.
 */
export function structureNodeSelfMatches(
  n: StructureNode,
  search: string,
  quickFilter: StructureQuickFilter,
): boolean {
  const q = search.trim().toLowerCase()
  if (q && !n.name.toLowerCase().includes(q)) return false
  switch (quickFilter) {
    case 'groups': if (n.commercial) return false; break
    case 'schools': if (!n.commercial) return false; break
    case 'trial': if (n.commercial?.platformStatus !== 'trial') return false; break
    case 'paid': if (!n.commercial || n.commercial.platformStatus === 'trial') return false; break
    case 'demo': if (!n.is_demo) return false; break
  }
  return true
}

/** True if this node or ANY descendant matches — keeps ancestor context for a deep match. */
export function structureNodeIsVisible(
  n: StructureNode,
  search: string,
  quickFilter: StructureQuickFilter,
): boolean {
  if (structureNodeSelfMatches(n, search, quickFilter)) return true
  return n.children.some((c) => structureNodeIsVisible(c, search, quickFilter))
}
