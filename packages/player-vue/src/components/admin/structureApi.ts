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
